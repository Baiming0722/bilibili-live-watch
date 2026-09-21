import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyAdvancedFilters, sortRoomsAdvanced } from "../server/filter-pipeline.js";
import { fetchRoomBaseInfo } from "../server/bilibili.js";
import { normalizeData, readData, writeData } from "../server/storage.js";
import { refreshRoom } from "../server/rooms-service.js";

// 模擬房間資料
function makeRoom(overrides = {}) {
  return {
    roomId: overrides.roomId ?? 1,
    shortId: overrides.shortId,
    order: overrides.order ?? 0,
    addedAt: overrides.addedAt ?? "2026-01-01T00:00:00.000Z",
    title: overrides.title ?? "測試",
    uname: overrides.uname ?? "主播",
    cover: "",
    online: overrides.online ?? 0,
    attention: overrides.attention ?? 0,
    areaName: overrides.areaName ?? "未分類",
    parentAreaName: overrides.parentAreaName ?? "",
    liveUrl: "https://live.bilibili.com/1",
    liveTime: "",
    status: overrides.status ?? "offline",
    statusLabel: "未開播",
    lastFetchedAt: "2026-01-01T00:00:00.000Z",
  };
}

test("applyAdvancedFilters 能按分區與人氣門檻過濾", () => {
  const rooms = [
    makeRoom({ roomId: 1, areaName: "遊戲", parentAreaName: "網遊", online: 500, attention: 2000 }),
    makeRoom({ roomId: 2, areaName: "音樂", parentAreaName: "音樂", online: 50, attention: 100 }),
    makeRoom({ roomId: 3, areaName: "遊戲", parentAreaName: "手遊", online: 1500, attention: 5000 }),
  ];
  const filtered = applyAdvancedFilters(rooms, { area: "遊戲", parentArea: "all", onlineMin: 1000, attentionMin: 0, sortBy: "order", sortDir: "asc" });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].roomId, 3);

  const filtered2 = applyAdvancedFilters(rooms, { area: "all", parentArea: "音樂", onlineMin: 0, attentionMin: 0, sortBy: "order", sortDir: "asc" });
  assert.equal(filtered2.length, 1);
  assert.equal(filtered2[0].roomId, 2);
});

test("sortRoomsAdvanced 支援多種排序維度", () => {
  const rooms = [
    makeRoom({ roomId: 1, order: 2, online: 100, attention: 10, status: "offline", addedAt: "2026-01-03T00:00:00.000Z" }),
    makeRoom({ roomId: 2, order: 0, online: 1000, attention: 500, status: "live", addedAt: "2026-01-01T00:00:00.000Z" }),
    makeRoom({ roomId: 3, order: 1, online: 500, attention: 1000, status: "live", addedAt: "2026-01-02T00:00:00.000Z" }),
  ];
  // order asc
  assert.deepEqual(sortRoomsAdvanced(rooms, "order", "asc").map((r) => r.roomId), [2, 3, 1]);
  // liveFirst asc => live 在前
  assert.deepEqual(sortRoomsAdvanced(rooms, "liveFirst", "asc").map((r) => r.roomId), [2, 3, 1]);
  // online desc
  assert.deepEqual(sortRoomsAdvanced(rooms, "online", "desc").map((r) => r.roomId), [2, 3, 1]);
  // attention asc
  assert.deepEqual(sortRoomsAdvanced(rooms, "attention", "asc").map((r) => r.roomId), [1, 2, 3]);
  // addedAt asc
  assert.deepEqual(sortRoomsAdvanced(rooms, "addedAt", "asc").map((r) => r.roomId), [2, 3, 1]);
  // attention desc
  assert.deepEqual(sortRoomsAdvanced(rooms, "attention", "desc").map((r) => r.roomId), [3, 2, 1]);
});

test("applyAdvancedFilters 與 sortRoomsAdvanced 可組合形成管線", () => {
  const rooms = [
    makeRoom({ roomId: 1, areaName: "遊戲", online: 2000, status: "live", order: 2 }),
    makeRoom({ roomId: 2, areaName: "遊戲", online: 500, status: "live", order: 0 }),
    makeRoom({ roomId: 3, areaName: "音樂", online: 3000, status: "offline", order: 1 }),
    makeRoom({ roomId: 4, areaName: "遊戲", online: 1500, status: "live", order: 3 }),
  ];
  const filtered = applyAdvancedFilters(rooms, { area: "遊戲", parentArea: "all", onlineMin: 1000, attentionMin: 0, sortBy: "online", sortDir: "desc" });
  const sorted = sortRoomsAdvanced(filtered, "online", "desc");
  assert.deepEqual(sorted.map((r) => r.roomId), [1, 4]);
});

test("fetchRoomBaseInfo 支援 skipCache 跳過快取", async () => {
  let callCount = 0;
  const mockFetch = async () => {
    callCount += 1;
    return {
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          by_room_ids: {
            9999: {
              room_id: 9999,
              short_id: callCount,
              uid: 1,
              title: `標題${callCount}`,
              uname: `主播${callCount}`,
              cover: "",
              online: callCount * 10,
              attention: 0,
              area_name: "測試",
              parent_area_name: "",
              live_url: "https://live.bilibili.com/9999",
              live_time: "",
              live_status: 1,
              lock_status: 0,
              hidden_status: 0,
              is_encrypted: false,
            },
          },
        },
      }),
    };
  };

  const first = await fetchRoomBaseInfo(9999, { fetchImpl: mockFetch });
  assert.equal(first.shortId, 1);
  assert.equal(callCount, 1);

  // 第二次不帶 skipCache 應命中快取，不會再次 fetch
  const second = await fetchRoomBaseInfo(9999, { fetchImpl: mockFetch });
  assert.equal(second.shortId, 1);
  assert.equal(callCount, 1);

  // 帶 skipCache 應強制重新抓取
  const third = await fetchRoomBaseInfo(9999, { fetchImpl: mockFetch, skipCache: true });
  assert.equal(third.shortId, 2);
  assert.equal(callCount, 2);
  assert.equal(third.title, "標題2");
});

test("refreshRoom 強制刷新並回寫 shortId", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bililive-refresh-"));
  const dataFile = path.join(dir, "rooms.json");
  try {
    // 先寫入一個房間，shortId 為 100
    await writeData(
      {
        rooms: [{ roomId: 12345, shortId: 100, addedAt: "2026-01-01T00:00:00.000Z", order: 0 }],
        groups: [],
        settings: undefined,
        stats: { liveDuration: {}, lastLiveAt: {} },
      },
      dataFile,
    );

    let fetchCount = 0;
    const mockFetch = async () => {
      fetchCount += 1;
      return {
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            by_room_ids: {
              12345: {
                room_id: 12345,
                short_id: 999,
                uid: 1,
                title: "新標題",
                uname: "新主播",
                cover: "",
                online: 123,
                attention: 456,
                area_name: "遊戲",
                parent_area_name: "網遊",
                live_url: "https://live.bilibili.com/12345",
                live_time: "",
                live_status: 1,
                lock_status: 0,
                hidden_status: 0,
                is_encrypted: false,
              },
            },
          },
        }),
      };
    };

    const result = await refreshRoom(12345, { dataFile, fetchImpl: mockFetch });
    assert.equal(result.refreshed, true);
    assert.equal(result.room.shortId, 999);
    assert.equal(fetchCount, 1);

    // 檢查 storage 已回寫
    const reloaded = await readData(dataFile);
    assert.equal(reloaded.rooms[0].shortId, 999);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("normalizeData 對舊 stats 缺失能遷移為空物件", () => {
  const oldData = {
    rooms: [{ roomId: 1, addedAt: "2026-01-01T00:00:00.000Z", order: 0 }],
    groups: [],
    settings: { theme: "dark" },
  };
  const normalized = normalizeData(oldData);
  assert.ok(normalized.stats);
  assert.deepEqual(normalized.stats.liveDuration, {});
  assert.deepEqual(normalized.stats.lastLiveAt, {});
});

test("normalizeData 能保留既有 stats 並過濾非法值", () => {
  const data = {
    rooms: [],
    groups: [],
    settings: {},
    stats: {
      liveDuration: { "1": 3600, "2": "invalid", "3": -5 },
      lastLiveAt: { "1": "2026-01-02T00:00:00.000Z", "bad": "not-a-date" },
    },
  };
  const normalized = normalizeData(data);
  assert.equal(normalized.stats.liveDuration["1"], 3600);
  // 非法值應被過濾
  assert.equal(normalized.stats.liveDuration["2"], undefined);
  assert.equal(normalized.stats.liveDuration["3"], undefined);
  assert.equal(normalized.stats.lastLiveAt["1"], "2026-01-02T00:00:00.000Z");
  assert.equal(normalized.stats.lastLiveAt["bad"], undefined);
});
