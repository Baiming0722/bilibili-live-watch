import { mkdir, readFile, rename, writeFile, stat } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import process from "node:process";
import os from "node:os";

// 寫入串列鎖：保證所有 read-modify-write 操作循序執行，避免並行寫入導致 Lost Update
// 讀操作（readData / listRooms）可並發，不需加鎖；所有寫入路徑皆為 read-modify-write 且在 withWriteLock 內重讀最新資料，
// 因此 listRooms 的快照讀取不會與寫入產生 Lost Update。若需強一致讀，可使用 withReadLock（此處以註釋說明，寫入已具互斥性）。
let writeLock = Promise.resolve();

async function withWriteLock(fn) {
  const previous = writeLock;
  let releaseLock;
  writeLock = new Promise((resolve) => { releaseLock = resolve; });
  await previous;
  try {
    return await fn();
  } finally {
    releaseLock();
  }
}

export { withWriteLock };

export const DEFAULT_SETTINGS = {
  theme: "auto",
  cardScale: 1,
  fontScale: 1,
  fontFamily: "system",
  refreshInterval: 60,
  accentColor: "blue",
  notifyOnLive: true,
  soundEnabled: true,
  soundVolume: 0.5,
  accentCustom: null,
  density: "standard",
  filterPresets: []
};

export function getDataFilePath() {
  return process.env.BILILIVE_DATA_FILE ?? path.join(os.homedir(), ".bililive-watch", "rooms.json");
}

export async function readData(dataFile = getDataFilePath()) {
  try {
    const fileExists = await stat(dataFile).then((s) => s.isFile()).catch(() => false);

    if (!fileExists && dataFile === getDataFilePath()) {
      const legacyPath = path.join(process.cwd(), "data", "rooms.json");
      const legacyExists = await stat(legacyPath).then((s) => s.isFile()).catch(() => false);
      if (legacyExists) {
        try {
          const content = await readFile(legacyPath, "utf8");
          await writeData(JSON.parse(content), dataFile);
          console.log(`[Migration] 成功將舊有資料自 ${legacyPath} 遷移至 ${dataFile}`);
        } catch (migError) {
          console.error("[Migration] 遷移舊資料失敗：", migError);
        }
      }
    }

    const content = await readFile(dataFile, "utf8");
    return normalizeData(JSON.parse(content));
  } catch (error) {
    if (error.code === "ENOENT") {
      return normalizeData({});
    }

    throw new Error(`讀取直播間資料失敗：file=${dataFile}, reason=${error.message}`);
  }
}

export async function writeData(data, dataFile = getDataFilePath()) {
  const normalizedData = normalizeData(data);

  await mkdir(path.dirname(dataFile), { recursive: true });
  // 暫存檔名加入隨機後綴，避免同一 PID 內並行寫入與 Windows 檔案鎖定衝突
  const suffix = crypto.randomBytes(4).toString("hex");
  const temporaryFile = `${dataFile}.${process.pid}.${suffix}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(normalizedData, null, 2)}\n`, "utf8");
  // Windows 下 rename 可能因檔案仍被佔用而 EPERM，最多重試 3 次（間隔 50ms）
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await rename(temporaryFile, dataFile);
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
      const isRetryable = err?.code === "EPERM" || err?.code === "EBUSY" || err?.code === "EACCES";
      if (!isRetryable || attempt === 2) throw err;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  if (lastError) throw lastError;
  return normalizedData;
}

export async function readRooms(dataFile = getDataFilePath()) {
  return (await readData(dataFile)).rooms;
}

export async function writeRooms(rooms, dataFile = getDataFilePath()) {
  return withWriteLock(async () => {
    const data = await readData(dataFile);
    return (await writeData({ ...data, rooms }, dataFile)).rooms;
  });
}

export async function upsertRoom(roomRecord, dataFile = getDataFilePath()) {
  return withWriteLock(async () => {
    const data = await readData(dataFile);
    const existingIndex = data.rooms.findIndex((room) => room.roomId === roomRecord.roomId);

    if (existingIndex >= 0) {
      const existingRoom = data.rooms[existingIndex];
      const mergedRoom = {
        ...existingRoom,
        shortId: roomRecord.shortId ?? existingRoom.shortId,
        groupId: normalizeGroupId(roomRecord.groupId) ?? existingRoom.groupId
      };
      data.rooms[existingIndex] = mergedRoom;
      await writeData(data, dataFile);
      return { room: mergedRoom, created: false };
    }

    const nextRoom = normalizeStoredRoom({
      ...roomRecord,
      order: getNextRoomOrder(data.rooms)
    });
    if (!nextRoom) {
      throw new Error(`無效的直播間資料：roomId=${roomRecord?.roomId}`);
    }

    data.rooms.push(nextRoom);
    await writeData(data, dataFile);
    return { room: nextRoom, created: true };
  });
}

export async function removeRoom(roomId, dataFile = getDataFilePath()) {
  return withWriteLock(async () => {
    const data = await readData(dataFile);
    const nextRooms = data.rooms.filter((room) => room.roomId !== Number(roomId));
    const removed = nextRooms.length !== data.rooms.length;
    if (removed) {
      await writeData({ ...data, rooms: nextRooms }, dataFile);
    }

    return { removed, roomId: Number(roomId) };
  });
}

export async function updateRoomGroup(roomId, groupId, dataFile = getDataFilePath()) {
  return withWriteLock(async () => {
    const data = await readData(dataFile);
    const normalizedGroupId = normalizeGroupId(groupId);
    assertGroupExists(data.groups, normalizedGroupId);

    const roomIndex = data.rooms.findIndex((room) => room.roomId === Number(roomId));
    if (roomIndex < 0) {
      return { updated: false, roomId: Number(roomId) };
    }

    data.rooms[roomIndex] = {
      ...data.rooms[roomIndex],
      ...(normalizedGroupId ? { groupId: normalizedGroupId } : { groupId: undefined }),
      order: data.rooms[roomIndex].order
    };
    await writeData(data, dataFile);
    return { updated: true, room: data.rooms[roomIndex] };
  });
}

export async function reorderRooms(roomIds, groupId, dataFile = getDataFilePath()) {
  if (!Array.isArray(roomIds)) {
    throw new TypeError("roomIds 必須是陣列");
  }

  return withWriteLock(async () => {
    const data = await readData(dataFile);
    const normalizedGroupId = normalizeGroupId(groupId);
    assertGroupExists(data.groups, normalizedGroupId);
    const orderedIds = roomIds.map(Number).filter((roomId) => Number.isSafeInteger(roomId) && roomId > 0);
    const affectedRooms = data.rooms.filter((room) => orderedIds.includes(room.roomId));
    const baseOrder = affectedRooms.reduce((minOrder, room) => Math.min(minOrder, Number(room.order) || 0), Number.MAX_SAFE_INTEGER);
    const startOrder = Number.isFinite(baseOrder) ? baseOrder : 0;
    const orderMap = new Map(orderedIds.map((roomId, index) => [roomId, startOrder + index]));

    const rooms = data.rooms.map((room) => {
      if (!orderMap.has(room.roomId)) {
        return room;
      }

      return {
        ...room,
        order: orderMap.get(room.roomId)
      };
    });

    await writeData({ ...data, rooms }, dataFile);
    return { updated: true };
  });
}

export async function createGroup(name, dataFile = getDataFilePath()) {
  const groupName = normalizeGroupName(name);
  return withWriteLock(async () => {
    const data = await readData(dataFile);
    const group = {
      id: createGroupId(groupName),
      name: groupName,
      order: data.groups.length,
      createdAt: new Date().toISOString()
    };

    data.groups.push(group);
    await writeData(data, dataFile);
    return group;
  });
}

export async function removeGroup(groupId, dataFile = getDataFilePath()) {
  const normalizedGroupId = normalizeGroupId(groupId);
  if (!normalizedGroupId) {
    throw new TypeError("缺少分組 ID");
  }

  return withWriteLock(async () => {
    const data = await readData(dataFile);
    const nextGroups = data.groups.filter((group) => group.id !== normalizedGroupId);
    const removed = nextGroups.length !== data.groups.length;
    if (!removed) {
      return { removed: false, groupId: normalizedGroupId };
    }

    const nextRooms = data.rooms.map((room) =>
      room.groupId === normalizedGroupId ? { ...room, groupId: undefined } : room
    );
    await writeData({ ...data, groups: nextGroups, rooms: nextRooms }, dataFile);
    return { removed: true, groupId: normalizedGroupId };
  });
}

export async function updateSettings(settingsPatch, dataFile = getDataFilePath()) {
  return withWriteLock(async () => {
    const data = await readData(dataFile);
    const settings = normalizeSettings({ ...data.settings, ...settingsPatch });
    await writeData({ ...data, settings }, dataFile);
    return settings;
  });
}

export function normalizeData(value) {
  const legacyRooms = Array.isArray(value) ? value : value?.rooms;
  const rooms = normalizeRooms(legacyRooms);
  const groups = normalizeGroups(value?.groups);
  const validGroupIds = new Set(groups.map((group) => group.id));

  return {
    version: 2,
    rooms: rooms
      .map((room) => (room.groupId && !validGroupIds.has(room.groupId) ? { ...room, groupId: undefined } : room))
      .sort(sortRooms),
    groups,
    settings: normalizeSettings(value?.settings),
    stats: normalizeStats(value?.stats)
  };
}

export function normalizeStats(stats) {
  const rawDuration = stats?.liveDuration;
  const rawLastLiveAt = stats?.lastLiveAt;
  const rawHistory = stats?.history;
  const liveDuration = {};
  const lastLiveAt = {};
  const history = {};

  if (rawDuration && typeof rawDuration === "object") {
    for (const [key, val] of Object.entries(rawDuration)) {
      const seconds = Number(val);
      if (Number.isFinite(seconds) && seconds >= 0) {
        liveDuration[String(Number(key))] = Math.floor(seconds);
      }
    }
  }

  if (rawLastLiveAt && typeof rawLastLiveAt === "object") {
    for (const [key, val] of Object.entries(rawLastLiveAt)) {
      if (typeof val === "string" && !Number.isNaN(Date.parse(val))) {
        lastLiveAt[String(Number(key))] = val;
      }
    }
  }

  if (rawHistory && typeof rawHistory === "object") {
    for (const [key, sessions] of Object.entries(rawHistory)) {
      const numericRoomId = Number(key);
      if (!Number.isSafeInteger(numericRoomId) || numericRoomId <= 0) continue;
      if (!Array.isArray(sessions)) continue;

      const validSessions = [];
      for (const session of sessions) {
        if (!session || typeof session !== "object") continue;
        const startedAt = session.startedAt;
        if (typeof startedAt !== "string" || Number.isNaN(Date.parse(startedAt))) {
          continue;
        }

        const sessionObj = { startedAt };
        if (session.endedAt !== undefined) {
          if (typeof session.endedAt === "string" && !Number.isNaN(Date.parse(session.endedAt))) {
            sessionObj.endedAt = session.endedAt;
          } else {
            // 無效的 endedAt 導致整個 session 被視為無效
            continue;
          }
        }
        validSessions.push(sessionObj);
      }

      history[String(numericRoomId)] = validSessions.slice(-50);
    }
  }

  // 保留內部節流時間戳（若存在），用於 liveDuration 增量計算的節流
  const lastCalculatedAt = typeof stats?.lastCalculatedAt === "string" ? stats.lastCalculatedAt : undefined;
  return {
    liveDuration,
    lastLiveAt,
    history,
    ...(lastCalculatedAt ? { lastCalculatedAt } : {})
  };
}

// 短號回寫：異步更新指定房間的 shortId，不阻斷主流程
export async function updateRoomShortId(roomId, shortId, dataFile = getDataFilePath()) {
  const numericRoomId = Number(roomId);
  const numericShortId = Number(shortId);
  if (!Number.isSafeInteger(numericRoomId) || numericRoomId <= 0) return { updated: false };
  if (!Number.isSafeInteger(numericShortId) || numericShortId <= 0) return { updated: false };
  return withWriteLock(async () => {
    const data = await readData(dataFile);
    const idx = data.rooms.findIndex((r) => r.roomId === numericRoomId);
    if (idx < 0) return { updated: false };
    if (data.rooms[idx].shortId === numericShortId) return { updated: false };
    data.rooms[idx] = { ...data.rooms[idx], shortId: numericShortId };
    await writeData(data, dataFile);
    return { updated: true, room: data.rooms[idx] };
  });
}

// 統計增量更新：供 rooms-service 在 listRooms 後批次調用
export async function updateStats(patch, dataFile = getDataFilePath()) {
  return withWriteLock(async () => {
    const data = await readData(dataFile);
    const nextStats = normalizeStats({ ...data.stats, ...patch });
    // 合併 liveDuration 與 lastLiveAt 的增量（patch 可能僅含部分 roomId）
    if (patch.liveDuration) {
      nextStats.liveDuration = { ...data.stats.liveDuration, ...patch.liveDuration };
    }
    if (patch.lastLiveAt) {
      nextStats.lastLiveAt = { ...data.stats.lastLiveAt, ...patch.lastLiveAt };
    }
    if (patch.lastCalculatedAt) {
      nextStats.lastCalculatedAt = patch.lastCalculatedAt;
    }
    await writeData({ ...data, stats: nextStats }, dataFile);
    return nextStats;
  });
}

function normalizeRooms(rooms) {
  return Array.isArray(rooms)
    ? rooms
        .map((room, index) => normalizeStoredRoom({ ...room, order: Number.isFinite(Number(room?.order)) ? room.order : index }))
        .filter((room) => room !== null)
    : [];
}

function normalizeGroups(groups) {
  return Array.isArray(groups)
    ? groups
        .map((group, index) => normalizeGroup({ ...group, order: Number.isFinite(Number(group?.order)) ? group.order : index }))
        .filter((group) => group !== null)
        .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt))
    : [];
}

export function normalizeStoredRoom(room) {
  const roomId = Number(room?.roomId);
  if (!Number.isSafeInteger(roomId) || roomId <= 0) {
    return null;
  }

  const shortId = Number(room?.shortId);
  const addedAt = typeof room?.addedAt === "string" ? room.addedAt : new Date(0).toISOString();
  const groupId = normalizeGroupId(room?.groupId);
  const order = Number(room?.order);

  const note = typeof room?.note === "string" ? room.note.trim().slice(0, 200) : undefined;
  const pinned = typeof room?.pinned === "boolean" ? room.pinned : undefined;
  const notify = typeof room?.notify === "boolean" ? room.notify : undefined;

  return {
    roomId,
    ...(Number.isSafeInteger(shortId) && shortId > 0 ? { shortId } : {}),
    ...(groupId ? { groupId } : {}),
    addedAt,
    order: Number.isFinite(order) ? order : 0,
    ...(note ? { note } : {}),
    ...(pinned !== undefined ? { pinned } : {}),
    ...(notify !== undefined ? { notify } : {})
  };
}

function normalizeGroup(group) {
  const id = normalizeGroupId(group?.id);
  const name = typeof group?.name === "string" ? group.name.trim() : "";
  if (!id || !name) {
    return null;
  }

  const order = Number(group?.order);
  return {
    id,
    name: name.slice(0, 24),
    order: Number.isFinite(order) ? order : 0,
    createdAt: typeof group?.createdAt === "string" ? group.createdAt : new Date(0).toISOString()
  };
}

export async function updateHistory(roomId, session, dataFile = getDataFilePath()) {
  const numericRoomId = Number(roomId);
  if (!Number.isSafeInteger(numericRoomId) || numericRoomId <= 0) {
    throw new TypeError(`無效的房號：${roomId}`);
  }

  return withWriteLock(async () => {
    const data = await readData(dataFile);
    const key = String(numericRoomId);
    const currentSessions = Array.isArray(data.stats.history?.[key]) ? [...data.stats.history[key]] : [];

    if (session?.startedAt && !session?.endedAt) {
      if (typeof session.startedAt === "string" && !Number.isNaN(Date.parse(session.startedAt))) {
        currentSessions.push({ startedAt: session.startedAt });
      }
    } else if (session?.endedAt && !session?.startedAt) {
      if (typeof session.endedAt === "string" && !Number.isNaN(Date.parse(session.endedAt))) {
        const lastIndex = currentSessions.length - 1;
        if (lastIndex >= 0 && currentSessions[lastIndex].startedAt && !currentSessions[lastIndex].endedAt) {
          currentSessions[lastIndex] = { ...currentSessions[lastIndex], endedAt: session.endedAt };
        }
      }
    } else if (session?.startedAt && session?.endedAt) {
      if (
        typeof session.startedAt === "string" &&
        !Number.isNaN(Date.parse(session.startedAt)) &&
        typeof session.endedAt === "string" &&
        !Number.isNaN(Date.parse(session.endedAt))
      ) {
        currentSessions.push({ startedAt: session.startedAt, endedAt: session.endedAt });
      }
    }

    const cappedSessions = currentSessions.slice(-50);
    const nextStats = {
      ...data.stats,
      history: {
        ...(data.stats.history ?? {}),
        [key]: cappedSessions
      }
    };

    await writeData({ ...data, stats: nextStats }, dataFile);
    return nextStats;
  });
}

function normalizeSettings(settings) {
  const cardScale = clampNumber(settings?.cardScale, 0.5, 2.0, DEFAULT_SETTINGS.cardScale);
  const fontScale = clampNumber(settings?.fontScale, 0.5, 2.0, DEFAULT_SETTINGS.fontScale);
  const theme = ["light", "dark", "auto"].includes(settings?.theme) ? settings.theme : DEFAULT_SETTINGS.theme;

  const fontFamily =
    typeof settings?.fontFamily === "string" && settings.fontFamily.trim() !== ""
      ? settings.fontFamily
      : DEFAULT_SETTINGS.fontFamily;

  const refreshInterval = [30, 60, 180, 300].includes(settings?.refreshInterval)
    ? settings.refreshInterval
    : DEFAULT_SETTINGS.refreshInterval;

  const accentColor = ["blue", "pink", "purple", "green", "orange"].includes(settings?.accentColor)
    ? settings.accentColor
    : DEFAULT_SETTINGS.accentColor;

  const notifyOnLive =
    typeof settings?.notifyOnLive === "boolean" ? settings.notifyOnLive : DEFAULT_SETTINGS.notifyOnLive;

  const soundEnabled =
    typeof settings?.soundEnabled === "boolean" ? settings.soundEnabled : DEFAULT_SETTINGS.soundEnabled;

  const soundVolume = clampNumber(settings?.soundVolume, 0, 1, DEFAULT_SETTINGS.soundVolume);

  const accentCustom =
    typeof settings?.accentCustom === "string" && /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(settings.accentCustom)
      ? settings.accentCustom
      : DEFAULT_SETTINGS.accentCustom;

  const density = ["compact", "standard", "comfortable"].includes(settings?.density)
    ? settings.density
    : DEFAULT_SETTINGS.density;

  const filterPresets = Array.isArray(settings?.filterPresets)
    ? settings.filterPresets.filter(
        (preset) => preset && typeof preset === "object" && typeof preset.id === "string" && typeof preset.name === "string"
      )
    : DEFAULT_SETTINGS.filterPresets;

  return {
    theme,
    cardScale,
    fontScale,
    fontFamily,
    refreshInterval,
    accentColor,
    notifyOnLive,
    soundEnabled,
    soundVolume,
    accentCustom,
    density,
    filterPresets
  };
}

function normalizeGroupId(groupId) {
  if (groupId === null || groupId === undefined || groupId === "") {
    return undefined;
  }

  const value = String(groupId).trim();
  return /^[a-z0-9-]{1,40}$/i.test(value) ? value : undefined;
}

function normalizeGroupName(name) {
  const value = typeof name === "string" ? name.trim() : "";
  if (!value) {
    throw new TypeError("請輸入分組名稱");
  }

  return value.slice(0, 24);
}

function assertGroupExists(groups, groupId) {
  if (groupId && !groups.some((group) => group.id === groupId)) {
    throw new TypeError(`找不到分組：${groupId}`);
  }
}

function getNextRoomOrder(rooms) {
  return rooms.reduce((maxOrder, room) => Math.max(maxOrder, Number(room.order) || 0), -1) + 1;
}

function createGroupId(name) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 18);
  return `${slug || "group"}-${Date.now().toString(36)}`;
}

function clampNumber(value, min, max, fallback) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numberValue));
}

function sortRooms(a, b) {
  return a.order - b.order || a.addedAt.localeCompare(b.addedAt);
}
