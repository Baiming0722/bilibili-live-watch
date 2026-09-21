import { listRooms } from "./rooms-service.js";

const DEFAULT_POLL_INTERVAL_SEC = 60;
const MIN_POLL_INTERVAL_SEC = 15;
const HEARTBEAT_INTERVAL_MS = 25 * 1000;

export const sseClients = new Set();
let pollTimer = null;
let heartbeatTimer = null;
let lastBroadcastSnapshot = null;

/**
 * 提取用於比對 rooms payload 是否有變化的摘要簽章
 */
export function createRoomsFingerprint(payload) {
  if (!payload || !Array.isArray(payload.rooms)) {
    return "";
  }

  const roomSignatures = payload.rooms.map((room) => ({
    roomId: room.roomId,
    status: room.status,
    online: room.online,
    title: room.title,
    liveTime: room.liveTime,
    uname: room.uname,
    cover: room.cover,
    pinned: room.pinned,
    note: room.note,
    notify: room.notify,
    groupId: room.groupId,
    order: room.order
  }));

  const groupSignatures = (payload.groups ?? []).map((group) => ({
    id: group.id,
    name: group.name,
    order: group.order
  }));

  return JSON.stringify({
    rooms: roomSignatures,
    groups: groupSignatures,
    settings: payload.settings ?? {}
  });
}

/**
 * 判斷新抓取的資料快照是否與前次廣播存在差異
 */
export function hasPayloadChanged(prevSnapshot, nextPayload) {
  if (!prevSnapshot) {
    return true;
  }
  return createRoomsFingerprint(prevSnapshot) !== createRoomsFingerprint(nextPayload);
}

/**
 * 向單一 SSE client 發送訊息，若失敗則自動自連線池移除
 */
export function sendSseMessage(clientResponse, eventName, data) {
  if (!clientResponse || clientResponse.writableEnded || clientResponse.destroyed) {
    sseClients.delete(clientResponse);
    return false;
  }

  try {
    const serializedData = typeof data === "string" ? data : JSON.stringify(data);
    const payload = eventName ? `event: ${eventName}\ndata: ${serializedData}\n\n` : `data: ${serializedData}\n\n`;
    clientResponse.write(payload);
    return true;
  } catch {
    sseClients.delete(clientResponse);
    return false;
  }
}

/**
 * 向單一 SSE client 發送註解（如 heartbeat ping）
 */
export function sendSseComment(clientResponse, comment) {
  if (!clientResponse || clientResponse.writableEnded || clientResponse.destroyed) {
    sseClients.delete(clientResponse);
    return false;
  }

  try {
    clientResponse.write(`: ${comment}\n\n`);
    return true;
  } catch {
    sseClients.delete(clientResponse);
    return false;
  }
}

/**
 * 主動廣播房間更新給所有連線中的客戶端
 */
export async function broadcastRoomsUpdate(options = {}) {
  if (sseClients.size === 0) {
    return null;
  }

  const listRoomsFn = options.listRoomsImpl ?? listRooms;
  const currentPayload = await listRoomsFn(options);

  const force = Boolean(options.force);
  if (!force && !hasPayloadChanged(lastBroadcastSnapshot, currentPayload)) {
    return currentPayload;
  }

  lastBroadcastSnapshot = currentPayload;

  for (const client of Array.from(sseClients)) {
    sendSseMessage(client, "rooms", currentPayload);
  }

  return currentPayload;
}

/**
 * 啟動或重置心跳發送器
 */
function ensureHeartbeatStarted() {
  if (heartbeatTimer) {
    return;
  }

  heartbeatTimer = setInterval(() => {
    if (sseClients.size === 0) {
      stopHeartbeat();
      return;
    }

    for (const client of Array.from(sseClients)) {
      sendSseComment(client, "ping");
    }
  }, HEARTBEAT_INTERVAL_MS);

  if (heartbeatTimer.unref) {
    heartbeatTimer.unref();
  }
}

/**
 * 停止心跳發送器
 */
function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/**
 * 啟動後端定時輪詢廣播器
 */
export function startBroadcaster(options = {}) {
  stopBroadcaster();

  if (sseClients.size === 0) {
    return;
  }

  const poll = async () => {
    if (sseClients.size === 0) {
      stopBroadcaster();
      return;
    }

    try {
      const payload = await broadcastRoomsUpdate(options);
      // 若有取得 settings 中的 refreshInterval，動態排程下次輪詢
      const intervalSec = Math.max(
        MIN_POLL_INTERVAL_SEC,
        Number(payload?.settings?.refreshInterval) || DEFAULT_POLL_INTERVAL_SEC
      );
      scheduleNextPoll(intervalSec);
    } catch {
      scheduleNextPoll(DEFAULT_POLL_INTERVAL_SEC);
    }
  };

  function scheduleNextPoll(seconds) {
    if (sseClients.size === 0) {
      stopBroadcaster();
      return;
    }
    pollTimer = setTimeout(poll, seconds * 1000);
    if (pollTimer.unref) {
      pollTimer.unref();
    }
  }

  // 立即排程下一次定時輪詢
  scheduleNextPoll(DEFAULT_POLL_INTERVAL_SEC);
}

/**
 * 停止後端定時輪詢廣播器
 */
export function stopBroadcaster() {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

/**
 * 處理 GET /api/events 端點請求
 */
export async function handleSseEvents(request, response, options = {}) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*"
  });

  if (typeof response.flushHeaders === "function") {
    response.flushHeaders();
  }

  // 連線建立時發送當前最新房間快照
  const listRoomsFn = options.listRoomsImpl ?? listRooms;
  const initialPayload = await listRoomsFn(options);
  lastBroadcastSnapshot = initialPayload;
  sendSseMessage(response, "rooms", initialPayload);

  // 加入連線池
  sseClients.add(response);
  ensureHeartbeatStarted();

  if (sseClients.size === 1) {
    startBroadcaster(options);
  }

  // 監聽連線中斷或錯誤事件以釋放資源
  const cleanup = () => {
    sseClients.delete(response);
    if (sseClients.size === 0) {
      stopBroadcaster();
      stopHeartbeat();
    }
  };

  request.on("close", cleanup);
  response.on("close", cleanup);
  response.on("error", cleanup);
}

/**
 * 重置所有廣播器狀態（供測試與優雅關閉使用）
 */
export function resetBroadcaster() {
  stopBroadcaster();
  stopHeartbeat();
  for (const client of Array.from(sseClients)) {
    try {
      if (!client.writableEnded) {
        client.end();
      }
    } catch {}
  }
  sseClients.clear();
  lastBroadcastSnapshot = null;
}
