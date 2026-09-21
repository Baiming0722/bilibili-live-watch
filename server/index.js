import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  addGroup,
  addRoomFromInput,
  batchDeleteRooms,
  batchMoveRooms,
  deleteGroup,
  deleteRoom,
  exportData,
  importData,
  listRooms,
  refreshRoom,
  saveSettings,
  updateRoomFields,
  updateRoomOrder
} from "./rooms-service.js";
import { broadcastRoomsUpdate, handleSseEvents } from "./sse-broadcaster.js";
import { readData } from "./storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const distRoot = path.join(projectRoot, "dist");
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 4174);

const imageCache = new Map(); // url -> { buffer, contentType, timestamp }，利用 Map insertion order 實作 LRU
const MAX_IMAGE_CACHE_SIZE = 100;
const IMAGE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB—防止遠端巨大回應灌爆記憶體

// 定期清掃過期的圖片快取（TTL 5min），避免 Map 內殘留冷資料
const imageCacheSweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of imageCache) {
    if (now - entry.timestamp > IMAGE_CACHE_TTL_MS) {
      imageCache.delete(key);
    }
  }
}, IMAGE_CACHE_TTL_MS);
if (imageCacheSweepTimer.unref) imageCacheSweepTimer.unref();

const server = http.createServer(async (request, response) => {
  const reqId = crypto.randomUUID().slice(0, 8);
  const startMs = Date.now();
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  // 為後續日誌記錄原始資訊
  const logOnFinish = () => {
    const duration = Date.now() - startMs;
    const status = response.statusCode || 200;
    const iso = new Date(startMs).toISOString();
    console.log(`[${iso}] ${reqId} ${request.method} ${requestUrl.pathname} ${status} ${duration}ms`);
  };
  // 監聽完成後才記錄（確保 statusCode 已寫入）
  response.on("finish", logOnFinish);

  try {
    if (requestUrl.pathname.startsWith("/api/")) {
      await handleApiRequest(request, response, requestUrl);
      return;
    }

    await serveStaticFile(response, requestUrl.pathname);
  } catch (error) {
    if (!response.headersSent) {
      sendJson(response, getHttpStatus(error), {
        error: {
          message: error?.message ?? "伺服器發生未知錯誤",
          code: error?.code ?? "internal_error"
        }
      });
    }
  }
});

server.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    console.warn(`[Server] Port ${port} 已被佔用，沿用既有伺服器執行。`);
    return;
  }
  console.error("[Server Error]", error);
});

server.listen(port, host, () => {
  console.log(`BiliLive Watch server listening on http://${host}:${port}`);
});

async function handleApiRequest(request, response, requestUrl) {
  if (request.method === "GET" && requestUrl.pathname === "/api/events") {
    await handleSseEvents(request, response);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/health") {
    let roomsCount = 0;
    try {
      const data = await readData();
      roomsCount = data.rooms?.length ?? 0;
    } catch {
      roomsCount = 0;
    }
    sendJson(response, 200, { status: "ok", uptime: process.uptime(), roomsCount });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/rooms") {
    sendJson(response, 200, await listRooms());
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/export") {
    const data = await exportData();
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="bililive-backup-${dateStr}.json"`,
      "Cache-Control": "no-cache"
    });
    response.end(JSON.stringify(data));
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/import") {
    const body = await readJsonBody(request);
    const result = await importData(body.data ?? body, body.mode);
    void broadcastRoomsUpdate().catch(() => {});
    sendJson(response, 200, result);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/image") {
    await proxyImage(response, requestUrl);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/rooms/batch-delete") {
    const body = await readJsonBody(request);
    const result = await batchDeleteRooms(body.roomIds);
    void broadcastRoomsUpdate().catch(() => {});
    sendJson(response, 200, result);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/rooms/batch-move") {
    const body = await readJsonBody(request);
    const result = await batchMoveRooms(body.roomIds, body.groupId);
    void broadcastRoomsUpdate().catch(() => {});
    sendJson(response, 200, result);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/rooms") {
    const body = await readJsonBody(request);
    const result = await addRoomFromInput(body.roomInput, body.groupId);
    void broadcastRoomsUpdate().catch(() => {});
    sendJson(response, result.created ? 201 : 200, result);
    return;
  }

  if (request.method === "PUT" && requestUrl.pathname === "/api/rooms/order") {
    const body = await readJsonBody(request);
    const result = await updateRoomOrder(body.roomIds, body.groupId);
    void broadcastRoomsUpdate().catch(() => {});
    sendJson(response, 200, result);
    return;
  }

  // 強制刷新需在一般 PATCH /api/rooms/:roomId 之前匹配，避免被通用規則攔截
  const refreshMatch = requestUrl.pathname.match(/^\/api\/rooms\/(\d+)\/refresh$/);
  if (request.method === "PATCH" && refreshMatch) {
    const result = await refreshRoom(Number(refreshMatch[1]));
    if (!result.refreshed) {
      sendJson(response, 404, {
        error: {
          message: `找不到要刷新的直播間：roomId=${refreshMatch[1]}`,
          code: "not_found"
        }
      });
      return;
    }
    void broadcastRoomsUpdate().catch(() => {});
    sendJson(response, 200, { room: result.room });
    return;
  }

  const patchRoomMatch = requestUrl.pathname.match(/^\/api\/rooms\/(\d+)$/);
  if (request.method === "PATCH" && patchRoomMatch) {
    const body = await readJsonBody(request);
    const result = await updateRoomFields(Number(patchRoomMatch[1]), body);
    if (result.updated) {
      void broadcastRoomsUpdate().catch(() => {});
    }
    sendJson(response, result.updated ? 200 : 404, result.updated ? result : {
      error: {
        message: `找不到要更新的直播間：roomId=${patchRoomMatch[1]}`,
        code: "not_found"
      }
    });
    return;
  }

  const deleteMatch = requestUrl.pathname.match(/^\/api\/rooms\/(\d+)$/);
  if (request.method === "DELETE" && deleteMatch) {
    const result = await deleteRoom(Number(deleteMatch[1]));
    if (result.removed) {
      void broadcastRoomsUpdate().catch(() => {});
    }
    sendJson(response, result.removed ? 200 : 404, result.removed ? result : {
      error: {
        message: `找不到要移除的直播間：roomId=${deleteMatch[1]}`,
        code: "not_found"
      }
    });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/groups") {
    const body = await readJsonBody(request);
    const group = await addGroup(body.name);
    void broadcastRoomsUpdate().catch(() => {});
    sendJson(response, 201, { group });
    return;
  }

  const deleteGroupMatch = requestUrl.pathname.match(/^\/api\/groups\/([a-z0-9-]+)$/i);
  if (request.method === "DELETE" && deleteGroupMatch) {
    const result = await deleteGroup(deleteGroupMatch[1]);
    if (result.removed) {
      void broadcastRoomsUpdate().catch(() => {});
    }
    sendJson(response, result.removed ? 200 : 404, result.removed ? result : {
      error: {
        message: `找不到要移除的分組：groupId=${deleteGroupMatch[1]}`,
        code: "not_found"
      }
    });
    return;
  }

  if (request.method === "PATCH" && requestUrl.pathname === "/api/settings") {
    const body = await readJsonBody(request);
    const settings = await saveSettings(body.settings ?? body);
    void broadcastRoomsUpdate().catch(() => {});
    sendJson(response, 200, { settings });
    return;
  }

  sendJson(response, 404, {
    error: {
      message: `找不到 API：${request.method} ${requestUrl.pathname}`,
      code: "not_found"
    }
  });
}

async function readJsonBody(request) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > 1024 * 1024) {
      throw new Error("Request body 超過 1MB 限制");
    }
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`無法解析 JSON request body：${error.message}`);
  }
}

async function serveStaticFile(response, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const normalizedPath = decodeURIComponent(requestedPath).replace(/^\/+/, "");
  const filePath = path.resolve(distRoot, normalizedPath);
  const resolvedDistRoot = path.resolve(distRoot);

  if (filePath !== resolvedDistRoot && !filePath.startsWith(resolvedDistRoot + path.sep)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  const resolvedFilePath = (await getReadableFilePath(filePath)) ?? path.join(distRoot, "index.html");
  const fileInfo = await stat(resolvedFilePath).catch(() => null);

  if (!fileInfo?.isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("前端尚未 build。請先執行 npm run build，或開發時使用 npm run dev。");
    return;
  }

  response.writeHead(200, {
    "Content-Type": getContentType(resolvedFilePath),
    "Cache-Control": resolvedFilePath.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable"
  });
  createReadStream(resolvedFilePath).pipe(response);
}

async function getReadableFilePath(filePath) {
  const fileInfo = await stat(filePath).catch(() => null);
  return fileInfo?.isFile() ? filePath : null;
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache"
  });
  response.end(JSON.stringify(payload));
}

async function proxyImage(response, requestUrl) {
  const imageUrlText = requestUrl.searchParams.get("url");
  const imageUrl = parseAllowedImageUrl(imageUrlText);

  const now = Date.now();
  const cached = imageCache.get(imageUrl);

  if (cached && (now - cached.timestamp < IMAGE_CACHE_TTL_MS)) {
    // LRU：命中時更新順序，將其移至 Map 尾端（最新）
    imageCache.delete(imageUrl);
    imageCache.set(imageUrl, cached);
    response.writeHead(200, {
      "Content-Type": cached.contentType,
      "Cache-Control": "public, max-age=900"
    });
    response.end(cached.buffer);
    return;
  }
  // 若快取已過期，移除舊項目，準備重新抓取
  if (cached) {
    imageCache.delete(imageUrl);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const imageResponse = await fetch(imageUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 BiliLiveWatch/0.1",
        Referer: "https://live.bilibili.com/"
      }
    });

    if (!imageResponse.ok) {
      throw new Error(`讀取封面圖片失敗：status=${imageResponse.status}, url=${imageUrl}`);
    }

    const contentType = imageResponse.headers.get("content-type") ?? "application/octet-stream";
    const declaredLength = Number(imageResponse.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_IMAGE_BYTES) {
      throw new Error(`封面圖片過大：${declaredLength} bytes，上限 ${MAX_IMAGE_BYTES} bytes`);
    }
    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
    if (imageBuffer.length > MAX_IMAGE_BYTES) {
      throw new Error(`封面圖片過大：${imageBuffer.length} bytes，上限 ${MAX_IMAGE_BYTES} bytes`);
    }

    // Manage cache size
    if (imageCache.size >= MAX_IMAGE_CACHE_SIZE) {
      const oldestKey = imageCache.keys().next().value;
      imageCache.delete(oldestKey);
    }
    
    imageCache.set(imageUrl, {
      buffer: imageBuffer,
      contentType,
      timestamp: now
    });

    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=900"
    });
    response.end(imageBuffer);
  } finally {
    clearTimeout(timeout);
  }
}

export function parseAllowedImageUrl(imageUrlText) {
  if (!imageUrlText) {
    throw new TypeError("缺少封面圖片 URL");
  }

  let normalizedUrl = imageUrlText;
  if (imageUrlText.startsWith("http://")) {
    normalizedUrl = "https://" + imageUrlText.slice(7);
  }

  const imageUrl = new URL(normalizedUrl);
  const allowedHost = imageUrl.hostname === "hdslb.com" || imageUrl.hostname.endsWith(".hdslb.com");
  if (imageUrl.protocol !== "https:" || !allowedHost) {
    throw new TypeError(`不允許代理此圖片 URL：${imageUrlText}`);
  }

  return imageUrl.href;
}

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon"
  };

  return mimeTypes[extension] ?? "application/octet-stream";
}

function getHttpStatus(error) {
  if (error instanceof TypeError) {
    return 400;
  }

  switch (error?.code) {
    case "not_found":
      return 404;
    case "timeout":
      return 504;
    case "bad_status":
    case "api_code":
    case "network_error":
      return 502;
    default:
      return 500;
  }
}
