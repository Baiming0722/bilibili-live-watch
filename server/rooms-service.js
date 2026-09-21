import { fetchRoomBaseInfo } from "./bilibili.js";
import { parseRoomInput } from "./room-input.js";
import { ROOM_STATUS_LABELS, ROOM_STATUSES } from "./room-status.js";
import {
  createGroup,
  normalizeData,
  readData,
  removeGroup,
  removeRoom,
  reorderRooms,
  updateHistory,
  updateRoomGroup,
  updateRoomShortId,
  updateSettings,
  updateStats,
  upsertRoom,
  withWriteLock,
  writeData
} from "./storage.js";

const DEFAULT_CONCURRENCY = 3;
const STATS_THROTTLE_MS = 60 * 1000;
let lastStatsWriteAt = 0;
const lastLiveStatusMap = new Map();

export async function observeRoomTransitions(displayRooms, options = {}) {
  if (!Array.isArray(displayRooms) || displayRooms.length === 0) {
    return { wentLive: [], wentOffline: [] };
  }

  // 首次呼叫（map 為空且 rooms 有資料）：僅初始化狀態，不記錄任何轉換（避免啟動時誤觸發）
  if (lastLiveStatusMap.size === 0) {
    for (const room of displayRooms) {
      lastLiveStatusMap.set(room.roomId, room.status === "live");
    }
    return { wentLive: [], wentOffline: [] };
  }

  const wentLive = [];
  const wentOffline = [];
  const nowIso = new Date().toISOString();

  for (const room of displayRooms) {
    const isLive = room.status === "live";
    const previousLive = lastLiveStatusMap.get(room.roomId);

    if (previousLive !== undefined) {
      if (!previousLive && isLive) {
        wentLive.push(room.roomId);
        try {
          await updateHistory(room.roomId, { startedAt: nowIso }, options.dataFile);
        } catch {}
      } else if (previousLive && !isLive) {
        wentOffline.push(room.roomId);
        try {
          await updateHistory(room.roomId, { endedAt: nowIso }, options.dataFile);
        } catch {}
      }
    }

    lastLiveStatusMap.set(room.roomId, isLive);
  }

  return { wentLive, wentOffline };
}

export async function listRooms(options = {}) {
  const data = await readData(options.dataFile);
  const fetchedAt = new Date().toISOString();
  const rooms = await mapWithConcurrency(
    data.rooms,
    options.concurrency ?? DEFAULT_CONCURRENCY,
    (savedRoom) => enrichSavedRoom(savedRoom, { ...options, fetchedAt })
  );

  // 狀態轉換偵測（非阻塞）
  void observeRoomTransitions(rooms, options).catch(() => {});

  // 非同步處理短號回寫已在 enrichSavedRoom 內觸發，此處僅處理統計累計
  // 節流 60s 批次寫入 liveDuration，避免每次輪詢都落盤
  const nowMs = Date.now();
  if (nowMs - lastStatsWriteAt >= STATS_THROTTLE_MS) {
    const lastCalcMs = data.stats?.lastCalculatedAt ? Date.parse(data.stats.lastCalculatedAt) : 0;
    const deltaSec = lastCalcMs ? Math.floor((nowMs - lastCalcMs) / 1000) : 0;
    // 即使 delta 為 0，仍需更新 lastCalculatedAt 以避免頻繁計算；但若 delta 過大（> 300s）則截斷避免異常累計
    const safeDelta = deltaSec > 0 && deltaSec < 600 ? deltaSec : (deltaSec >= 600 ? 60 : 0);
    if (safeDelta > 0) {
      const liveDurationPatch = {};
      const lastLiveAtPatch = {};
      let hasLive = false;
      for (const room of rooms) {
        if (room.status === "live") {
          const prev = Number(data.stats?.liveDuration?.[String(room.roomId)] ?? 0);
          liveDurationPatch[String(room.roomId)] = prev + safeDelta;
          lastLiveAtPatch[String(room.roomId)] = fetchedAt;
          hasLive = true;
        }
      }
      if (hasLive || !data.stats?.lastCalculatedAt) {
        lastStatsWriteAt = nowMs;
        // 異步寫入但等待完成以確保 stats 回傳一致（節流已保證頻率低）
        try {
          const nextStats = await updateStats(
            {
              liveDuration: { ...(data.stats?.liveDuration ?? {}), ...liveDurationPatch },
              lastLiveAt: { ...(data.stats?.lastLiveAt ?? {}), ...lastLiveAtPatch },
              lastCalculatedAt: new Date(nowMs).toISOString()
            },
            options.dataFile
          );
          return { rooms, groups: data.groups, settings: data.settings, fetchedAt, stats: nextStats };
        } catch {
          // 統計寫入失敗不影響主流程
        }
      } else {
        // 即使無直播，也更新 lastCalculatedAt 以推進節流窗口
        try {
          const nextStats = await updateStats({ lastCalculatedAt: new Date(nowMs).toISOString() }, options.dataFile);
          return { rooms, groups: data.groups, settings: data.settings, fetchedAt, stats: nextStats };
        } catch {}
        lastStatsWriteAt = nowMs;
      }
    } else if (!data.stats?.lastCalculatedAt) {
      // 首次初始化 lastCalculatedAt
      try {
        const nextStats = await updateStats({ lastCalculatedAt: new Date(nowMs).toISOString() }, options.dataFile);
        return { rooms, groups: data.groups, settings: data.settings, fetchedAt, stats: nextStats };
      } catch {}
      lastStatsWriteAt = nowMs;
    }
  }

  return { rooms, groups: data.groups, settings: data.settings, fetchedAt, stats: data.stats };
}

export async function refreshRoom(roomId, options = {}) {
  const numericRoomId = Number(roomId);
  if (!Number.isSafeInteger(numericRoomId) || numericRoomId <= 0) {
    throw new TypeError(`無效的房號：${roomId}`);
  }
  const data = await readData(options.dataFile);
  const savedRoom = data.rooms.find((r) => r.roomId === numericRoomId);
  if (!savedRoom) {
    return { refreshed: false, roomId: numericRoomId };
  }
  const fetchRoom = options.fetchRoomBaseInfoImpl ?? fetchRoomBaseInfo;
  const fetchedAt = new Date().toISOString();
  const roomInfo = await fetchRoom(numericRoomId, { ...options, skipCache: true });
  // 短號回寫：若遠端 shortId 與本地不一致，立即持久化
  if (roomInfo.shortId && roomInfo.shortId !== savedRoom.shortId) {
    try {
      await updateRoomShortId(numericRoomId, roomInfo.shortId, options.dataFile);
    } catch {}
  }
  const mergedSaved = { ...savedRoom, shortId: roomInfo.shortId ?? savedRoom.shortId };
  const liveRoom = toDisplayRoom(mergedSaved, roomInfo, fetchedAt);
  return { refreshed: true, room: liveRoom };
}

export async function addRoomFromInput(roomInput, groupIdOrOptions, options = {}) {
  const calledWithLegacyOptions =
    groupIdOrOptions && typeof groupIdOrOptions === "object" && !Array.isArray(groupIdOrOptions);
  const groupId = calledWithLegacyOptions ? undefined : groupIdOrOptions;
  const resolvedOptions = calledWithLegacyOptions ? groupIdOrOptions : options;
  const parsedRoomId = parseRoomInput(roomInput);
  const fetchRoom = resolvedOptions.fetchRoomBaseInfoImpl ?? fetchRoomBaseInfo;
  const roomInfo = await fetchRoom(parsedRoomId, resolvedOptions);
  const storedRoom = {
    roomId: roomInfo.roomId,
    shortId: roomInfo.shortId,
    groupId,
    addedAt: new Date().toISOString()
  };
  const upsertResult = await upsertRoom(storedRoom, resolvedOptions.dataFile);

  return {
    room: toDisplayRoom(upsertResult.room, roomInfo, new Date().toISOString()),
    created: upsertResult.created
  };
}

export async function deleteRoom(roomId, options = {}) {
  return removeRoom(Number(roomId), options.dataFile);
}

export async function moveRoomToGroup(roomId, groupId, options = {}) {
  return updateRoomFields(roomId, { groupId }, options);
}

export async function updateRoomFields(roomId, fields = {}, options = {}) {
  const numericRoomId = Number(roomId);
  if (!Number.isSafeInteger(numericRoomId) || numericRoomId <= 0) {
    throw new TypeError(`無效的房號：${roomId}`);
  }

  return withWriteLock(async () => {
    const data = await readData(options.dataFile);
    const roomIndex = data.rooms.findIndex((room) => room.roomId === numericRoomId);
    if (roomIndex < 0) {
      return { updated: false, roomId: numericRoomId };
    }

    const currentRoom = data.rooms[roomIndex];
    const updatedRoom = { ...currentRoom };

    if ("groupId" in fields) {
      if (fields.groupId === null || fields.groupId === undefined || fields.groupId === "") {
        delete updatedRoom.groupId;
      } else {
        const normalizedGroupId = String(fields.groupId).trim();
        if (!data.groups.some((g) => g.id === normalizedGroupId)) {
          throw new TypeError(`找不到分組：${normalizedGroupId}`);
        }
        updatedRoom.groupId = normalizedGroupId;
      }
    }

    if ("note" in fields) {
      if (typeof fields.note === "string") {
        const trimmed = fields.note.trim();
        if (trimmed) {
          updatedRoom.note = trimmed.slice(0, 200);
        } else {
          delete updatedRoom.note;
        }
      } else {
        delete updatedRoom.note;
      }
    }

    if ("pinned" in fields) {
      if (typeof fields.pinned === "boolean") {
        updatedRoom.pinned = fields.pinned;
      } else {
        delete updatedRoom.pinned;
      }
    }

    if ("notify" in fields) {
      if (typeof fields.notify === "boolean") {
        updatedRoom.notify = fields.notify;
      } else {
        delete updatedRoom.notify;
      }
    }

    data.rooms[roomIndex] = updatedRoom;
    await writeData(data, options.dataFile);
    return { updated: true, room: updatedRoom };
  });
}

export async function batchDeleteRooms(roomIds, options = {}) {
  if (!Array.isArray(roomIds)) {
    throw new TypeError("roomIds 必須是陣列");
  }

  const validIds = new Set(
    roomIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0)
  );

  return withWriteLock(async () => {
    const data = await readData(options.dataFile);
    const initialCount = data.rooms.length;
    data.rooms = data.rooms.filter((room) => !validIds.has(room.roomId));
    const deleted = initialCount - data.rooms.length;

    if (deleted > 0) {
      await writeData(data, options.dataFile);
    }

    return { deleted };
  });
}

export async function batchMoveRooms(roomIds, groupId, options = {}) {
  if (!Array.isArray(roomIds)) {
    throw new TypeError("roomIds 必須是陣列");
  }

  const validIds = new Set(
    roomIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0)
  );

  return withWriteLock(async () => {
    const data = await readData(options.dataFile);
    let normalizedGroupId;

    if (groupId !== null && groupId !== undefined && groupId !== "") {
      normalizedGroupId = String(groupId).trim();
      if (!data.groups.some((g) => g.id === normalizedGroupId)) {
        throw new TypeError(`找不到分組：${normalizedGroupId}`);
      }
    }

    let moved = 0;
    data.rooms = data.rooms.map((room) => {
      if (validIds.has(room.roomId)) {
        moved++;
        const next = { ...room };
        if (normalizedGroupId) {
          next.groupId = normalizedGroupId;
        } else {
          delete next.groupId;
        }
        return next;
      }
      return room;
    });

    if (moved > 0) {
      await writeData(data, options.dataFile);
    }

    return { moved };
  });
}

export async function exportData(options = {}) {
  const data = await readData(options.dataFile);
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    ...data
  };
}

export async function importData(payload, mode = "merge", options = {}) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.rooms)) {
    throw new TypeError("無效的匯入資料格式");
  }

  return withWriteLock(async () => {
    if (mode === "replace") {
      const normalized = normalizeData(payload);
      await writeData(normalized, options.dataFile);
      return {
        roomsAdded: normalized.rooms.length,
        groupsAdded: normalized.groups.length,
        roomsTotal: normalized.rooms.length,
        groupsTotal: normalized.groups.length
      };
    }

    // merge 模式
    const current = await readData(options.dataFile);
    const incoming = normalizeData(payload);

    // rooms 去重合併
    const existingRoomIds = new Set(current.rooms.map((r) => r.roomId));
    const newRooms = incoming.rooms.filter((r) => !existingRoomIds.has(r.roomId));
    const maxRoomOrder = current.rooms.reduce((max, r) => Math.max(max, Number(r.order) || 0), -1);
    const adjustedNewRooms = newRooms.map((room, index) => ({
      ...room,
      order: maxRoomOrder + 1 + index
    }));
    const mergedRooms = [...current.rooms, ...adjustedNewRooms];

    // groups 去重合併
    const existingGroupIds = new Set(current.groups.map((g) => g.id));
    const newGroups = incoming.groups.filter((g) => !existingGroupIds.has(g.id));
    const maxGroupOrder = current.groups.reduce((max, g) => Math.max(max, Number(g.order) || 0), -1);
    const adjustedNewGroups = newGroups.map((group, index) => ({
      ...group,
      order: maxGroupOrder + 1 + index
    }));
    const mergedGroups = [...current.groups, ...adjustedNewGroups];

    // stats 合併
    const mergedLiveDuration = { ...(current.stats.liveDuration ?? {}) };
    for (const [key, duration] of Object.entries(incoming.stats.liveDuration ?? {})) {
      const currentVal = mergedLiveDuration[key] ?? 0;
      mergedLiveDuration[key] = Math.max(currentVal, duration);
    }

    const mergedLastLiveAt = { ...(current.stats.lastLiveAt ?? {}) };
    for (const [key, dateStr] of Object.entries(incoming.stats.lastLiveAt ?? {})) {
      const currentVal = mergedLastLiveAt[key];
      if (!currentVal || Date.parse(dateStr) > Date.parse(currentVal)) {
        mergedLastLiveAt[key] = dateStr;
      }
    }

    const mergedHistory = { ...(current.stats.history ?? {}) };
    for (const [key, incomingSessions] of Object.entries(incoming.stats.history ?? {})) {
      const currentSessions = mergedHistory[key] ?? [];
      const sessionMap = new Map();
      for (const s of [...currentSessions, ...incomingSessions]) {
        if (s?.startedAt) {
          sessionMap.set(s.startedAt, s);
        }
      }
      const combined = Array.from(sessionMap.values()).sort((a, b) =>
        a.startedAt.localeCompare(b.startedAt)
      );
      mergedHistory[key] = combined.slice(-50);
    }

    const mergedData = normalizeData({
      version: 2,
      rooms: mergedRooms,
      groups: mergedGroups,
      settings: current.settings,
      stats: {
        liveDuration: mergedLiveDuration,
        lastLiveAt: mergedLastLiveAt,
        history: mergedHistory,
        ...(current.stats.lastCalculatedAt ? { lastCalculatedAt: current.stats.lastCalculatedAt } : {})
      }
    });

    await writeData(mergedData, options.dataFile);

    return {
      roomsAdded: newRooms.length,
      groupsAdded: newGroups.length,
      roomsTotal: mergedData.rooms.length,
      groupsTotal: mergedData.groups.length
    };
  });
}

export async function updateRoomOrder(roomIds, groupId, options = {}) {
  return reorderRooms(roomIds, groupId, options.dataFile);
}

export async function addGroup(name, options = {}) {
  return createGroup(name, options.dataFile);
}

export async function deleteGroup(groupId, options = {}) {
  return removeGroup(groupId, options.dataFile);
}

export async function saveSettings(settings, options = {}) {
  return updateSettings(settings, options.dataFile);
}

export async function enrichSavedRoom(savedRoom, options = {}) {
  const fetchRoom = options.fetchRoomBaseInfoImpl ?? fetchRoomBaseInfo;
  const fetchedAt = options.fetchedAt ?? new Date().toISOString();

  try {
    const roomInfo = await fetchRoom(savedRoom.roomId, options);
    // 短號回寫：若遠端 shortId 與本地不同，異步持久化（不阻斷回傳）
    if (roomInfo.shortId && roomInfo.shortId !== savedRoom.shortId) {
      void updateRoomShortId(savedRoom.roomId, roomInfo.shortId, options.dataFile).catch(() => {});
    }
    return toDisplayRoom(savedRoom, roomInfo, fetchedAt);
  } catch (error) {
    return {
      roomId: savedRoom.roomId,
      shortId: savedRoom.shortId,
      groupId: savedRoom.groupId,
      order: savedRoom.order,
      addedAt: savedRoom.addedAt,
      note: savedRoom.note,
      pinned: savedRoom.pinned,
      notify: savedRoom.notify,
      title: "無法讀取直播間資訊",
      uname: "BiliBili",
      cover: "",
      online: 0,
      attention: 0,
      areaName: "未知",
      parentAreaName: "",
      liveUrl: `https://live.bilibili.com/${savedRoom.roomId}`,
      liveTime: "",
      status: ROOM_STATUSES.error,
      statusLabel: ROOM_STATUS_LABELS.error,
      lastFetchedAt: fetchedAt,
      error: error?.message ?? "未知錯誤"
    };
  }
}

function toDisplayRoom(savedRoom, roomInfo, fetchedAt) {
  return {
    ...roomInfo,
    groupId: savedRoom.groupId,
    order: savedRoom.order,
    addedAt: savedRoom.addedAt,
    note: savedRoom.note,
    pinned: savedRoom.pinned,
    notify: savedRoom.notify,
    lastFetchedAt: fetchedAt
  };
}

export async function mapWithConcurrency(items, limit, worker) {
  const safeLimit = Math.max(1, Number(limit) || DEFAULT_CONCURRENCY);
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runNext() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: Math.min(safeLimit, items.length) }, runNext);
  await Promise.all(workers);
  return results;
}
