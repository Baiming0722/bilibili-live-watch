import { mapRoomStatus, ROOM_STATUS_LABELS } from "./room-status.js";

const BILIBILI_ROOM_INFO_ENDPOINT =
  "https://api.live.bilibili.com/xlive/web-room/v1/index/getRoomBaseInfo";
const DEFAULT_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 30000; // 30 seconds
const MAX_ROOM_CACHE_SIZE = 200;

const roomInfoCache = new Map(); // roomId -> { data, timestamp, promise }

export class BilibiliApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "BilibiliApiError";
    this.code = details.code ?? "bilibili_api_error";
    this.status = details.status;
    this.roomId = details.roomId;
    this.endpoint = details.endpoint;
    this.cause = details.cause;
  }
}

export async function fetchRoomBaseInfo(roomId, options = {}) {
  const now = Date.now();
  const skipCache = options.skipCache === true;
  if (!skipCache) {
    const cached = roomInfoCache.get(roomId);
    if (cached && (now - cached.timestamp < CACHE_TTL_MS)) {
      if (cached.promise) {
        return cached.promise;
      }
      if (cached.data) {
        // LRU：命中時更新順序
        roomInfoCache.delete(roomId);
        roomInfoCache.set(roomId, cached);
        return cached.data;
      }
    }
    // 若有過期項目但非有效快取，清理舊鍵避免佔位
    if (cached && (now - cached.timestamp >= CACHE_TTL_MS)) {
      roomInfoCache.delete(roomId);
    }
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = new URL(BILIBILI_ROOM_INFO_ENDPOINT);
  endpoint.searchParams.set("req_biz", "video");
  endpoint.searchParams.set("room_ids", String(roomId));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const fetchPromise = (async () => {
    try {
      const response = await fetchImpl(endpoint, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 BiliLiveWatch/0.1",
          Referer: `https://live.bilibili.com/${roomId}`
        }
      });

      if (!response.ok) {
        throw new BilibiliApiError(`BiliBili API 回應 ${response.status}：roomId=${roomId}`, {
          code: "bad_status",
          status: response.status,
          roomId,
          endpoint: endpoint.href
        });
      }

      const payload = await response.json();
      if (payload?.code !== 0) {
        throw new BilibiliApiError(
          `BiliBili API 查詢失敗：roomId=${roomId}, code=${payload?.code}, message=${payload?.message ?? "unknown"}`,
          {
            code: "api_code",
            roomId,
            endpoint: endpoint.href
          }
        );
      }

      const roomValues = Object.values(payload?.data?.by_room_ids ?? {});
      if (roomValues.length === 0) {
        throw new BilibiliApiError(`找不到 BiliBili 直播間：roomId=${roomId}`, {
          code: "not_found",
          roomId,
          endpoint: endpoint.href
        });
      }

      const data = normalizeRoomInfo(roomValues[0]);
      
      // LRU：先移除舊鍵（若存在），再判斷是否需淘汰最舊項目
      if (roomInfoCache.has(roomId)) roomInfoCache.delete(roomId);
      if (roomInfoCache.size >= MAX_ROOM_CACHE_SIZE) {
        const oldestKey = roomInfoCache.keys().next().value;
        roomInfoCache.delete(oldestKey);
      }
      roomInfoCache.set(roomId, { data, timestamp: Date.now() });
      return data;
    } catch (error) {
      // 併發修正：僅當目前快取仍指向本次 fetchPromise 時才清除，避免誤清新寫入
      const current = roomInfoCache.get(roomId);
      if (current && current.promise === fetchPromise) {
        roomInfoCache.delete(roomId);
      }
      
      if (error instanceof BilibiliApiError) {
        throw error;
      }

      const isAbort = error?.name === "AbortError";
      throw new BilibiliApiError(
        `${isAbort ? "BiliBili API 查詢逾時" : "BiliBili API 查詢錯誤"}：roomId=${roomId}, endpoint=${endpoint.href}`,
        {
          code: isAbort ? "timeout" : "network_error",
          roomId,
          endpoint: endpoint.href,
          cause: error
        }
      );
    } finally {
      clearTimeout(timeout);
    }
  })();

  // Cache the ongoing promise（LRU：先刪再設以移到尾端）
  if (roomInfoCache.has(roomId)) roomInfoCache.delete(roomId);
  // 若已達上限，先淘汰最舊
  if (roomInfoCache.size >= MAX_ROOM_CACHE_SIZE) {
    const oldestKey = roomInfoCache.keys().next().value;
    roomInfoCache.delete(oldestKey);
  }
  roomInfoCache.set(roomId, { promise: fetchPromise, timestamp: now });

  return fetchPromise;
}

export function normalizeRoomInfo(roomInfo) {
  const roomId = toNumber(roomInfo.room_id);
  const shortId = toNumber(roomInfo.short_id);
  const status = mapRoomStatus(roomInfo);
  const cover = stringOrEmpty(roomInfo.cover) || stringOrEmpty(roomInfo.background);
  const face = stringOrEmpty(roomInfo.face);

  return {
    roomId,
    shortId: shortId > 0 ? shortId : undefined,
    uid: toNumber(roomInfo.uid),
    title: stringOrFallback(roomInfo.title, "未命名直播間"),
    uname: stringOrFallback(roomInfo.uname, "未知主播"),
    cover,
    face,
    online: Math.max(0, toNumber(roomInfo.online)),
    attention: Math.max(0, toNumber(roomInfo.attention)),
    areaName: stringOrFallback(roomInfo.area_name, "未分類"),
    parentAreaName: stringOrEmpty(roomInfo.parent_area_name),
    liveUrl: stringOrFallback(roomInfo.live_url, `https://live.bilibili.com/${roomId}`),
    liveTime: stringOrEmpty(roomInfo.live_time),
    status,
    statusLabel: ROOM_STATUS_LABELS[status],
    lockStatus: toNumber(roomInfo.lock_status),
    hiddenStatus: toNumber(roomInfo.hidden_status),
    isEncrypted: roomInfo.is_encrypted === true
  };
}

function toNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function stringOrEmpty(value) {
  return typeof value === "string" ? value : "";
}

function stringOrFallback(value, fallback) {
  const text = stringOrEmpty(value).trim();
  return text || fallback;
}
