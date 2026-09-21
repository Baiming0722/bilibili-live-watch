import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  batchDeleteRooms,
  batchMoveRooms,
  exportData,
  importData,
  observeRoomTransitions,
  updateRoomFields
} from "../server/rooms-service.js";
import { EventEmitter } from "node:events";
import {
  broadcastRoomsUpdate,
  handleSseEvents,
  resetBroadcaster,
  sendSseComment,
  sendSseMessage,
  sseClients
} from "../server/sse-broadcaster.js";
import {
  DEFAULT_SETTINGS,
  normalizeData,
  normalizeStats,
  readData,
  updateHistory,
  writeData
} from "../server/storage.js";

test("1. normalizeData 對 note / pinned / notify 的清洗與邊界處理", () => {
  const rawData = {
    rooms: [
      {
        roomId: 1,
        note: "  這是一個備忘錄  ",
        pinned: true,
        notify: false
      },
      {
        roomId: 2,
        note: "a".repeat(250), // 超過 200 字元截斷
        pinned: "not-boolean", // 非布林值忽略
        notify: 123 // 非布林值忽略
      },
      {
        roomId: 3,
        note: "   ", // 空字串不保留
        pinned: false,
        notify: true
      },
      {
        roomId: 4,
        note: 12345 // 非字串不保留
      }
    ]
  };

  const normalized = normalizeData(rawData);
  assert.equal(normalized.rooms[0].note, "這是一個備忘錄");
  assert.equal(normalized.rooms[0].pinned, true);
  assert.equal(normalized.rooms[0].notify, false);

  assert.equal(normalized.rooms[1].note, "a".repeat(200));
  assert.equal(normalized.rooms[1].pinned, undefined);
  assert.equal(normalized.rooms[1].notify, undefined);

  assert.equal(normalized.rooms[2].note, undefined);
  assert.equal(normalized.rooms[2].pinned, false);
  assert.equal(normalized.rooms[2].notify, true);

  assert.equal(normalized.rooms[3].note, undefined);
  assert.equal(normalized.rooms[3].pinned, undefined);
  assert.equal(normalized.rooms[3].notify, undefined);
});

test("2. normalizeSettings 對新設定的清洗", () => {
  const validSettings = {
    notifyOnLive: false,
    soundEnabled: false,
    soundVolume: 0.8,
    accentCustom: "#123456",
    density: "compact",
    filterPresets: [{ id: "p1", name: "預設1", extra: 1 }]
  };
  const normalizedValid = normalizeData({ settings: validSettings }).settings;
  assert.equal(normalizedValid.notifyOnLive, false);
  assert.equal(normalizedValid.soundEnabled, false);
  assert.equal(normalizedValid.soundVolume, 0.8);
  assert.equal(normalizedValid.accentCustom, "#123456");
  assert.equal(normalizedValid.density, "compact");
  assert.deepEqual(normalizedValid.filterPresets, [{ id: "p1", name: "預設1", extra: 1 }]);

  // 測試 8 碼 hex 色碼
  const normalizedHex8 = normalizeData({ settings: { accentCustom: "#123456aa" } }).settings;
  assert.equal(normalizedHex8.accentCustom, "#123456aa");

  // 測試無效值回退
  const invalidSettings = {
    notifyOnLive: "yes",
    soundEnabled: null,
    soundVolume: 1.5, // 超出 clamp 到 1
    accentCustom: "not-a-hex",
    density: "super-compact", // 不在白名單
    filterPresets: "invalid"
  };
  const normalizedInvalid = normalizeData({ settings: invalidSettings }).settings;
  assert.equal(normalizedInvalid.notifyOnLive, DEFAULT_SETTINGS.notifyOnLive);
  assert.equal(normalizedInvalid.soundEnabled, DEFAULT_SETTINGS.soundEnabled);
  assert.equal(normalizedInvalid.soundVolume, 1);
  assert.equal(normalizedInvalid.accentCustom, null);
  assert.equal(normalizedInvalid.density, "standard");
  assert.deepEqual(normalizedInvalid.filterPresets, []);
});

test("3. normalizeStats 對 history session 的清洗與 50 條上限截斷", () => {
  const sessions = [];
  for (let i = 0; i < 60; i++) {
    sessions.push({
      startedAt: new Date(Date.now() + i * 1000).toISOString(),
      endedAt: new Date(Date.now() + i * 1000 + 500).toISOString()
    });
  }
  sessions.push({ startedAt: "invalid-date" }); // 無效 startedAt
  sessions.push({ startedAt: new Date().toISOString(), endedAt: "invalid-date" }); // 無效 endedAt

  const rawStats = {
    history: {
      "123": sessions,
      badRoom: [{ startedAt: new Date().toISOString() }]
    }
  };

  const normalized = normalizeStats(rawStats);
  assert.equal(normalized.history.badRoom, undefined);
  assert.equal(normalized.history["123"].length, 50);
  assert.equal(normalized.history["123"][49].startedAt, sessions[59].startedAt);
});

test("4. batchDeleteRooms 與 batchMoveRooms", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "bililive-batch-"));
  const dataFile = path.join(temporaryDirectory, "rooms.json");

  try {
    await writeData(
      {
        rooms: [
          { roomId: 1, order: 0 },
          { roomId: 2, order: 1 },
          { roomId: 3, order: 2 }
        ],
        groups: [{ id: "group-fav", name: "特別關注", order: 0, createdAt: new Date().toISOString() }]
      },
      dataFile
    );

    // 批次移動
    const moveResult = await batchMoveRooms([1, 3], "group-fav", { dataFile });
    assert.equal(moveResult.moved, 2);
    let data = await readData(dataFile);
    assert.equal(data.rooms.find((r) => r.roomId === 1).groupId, "group-fav");
    assert.equal(data.rooms.find((r) => r.roomId === 2).groupId, undefined);
    assert.equal(data.rooms.find((r) => r.roomId === 3).groupId, "group-fav");

    // 批次刪除
    const deleteResult = await batchDeleteRooms([1, 2], { dataFile });
    assert.equal(deleteResult.deleted, 2);
    data = await readData(dataFile);
    assert.equal(data.rooms.length, 1);
    assert.equal(data.rooms[0].roomId, 3);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("5. importData 的 replace 與 merge 模式", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "bililive-import-"));
  const dataFile = path.join(temporaryDirectory, "rooms.json");

  try {
    await writeData(
      {
        rooms: [{ roomId: 1, order: 0, addedAt: "2026-01-01T00:00:00.000Z" }],
        groups: [{ id: "group-1", name: "分組1", order: 0, createdAt: "2026-01-01T00:00:00.000Z" }],
        settings: { theme: "light" },
        stats: {
          liveDuration: { "1": 100 },
          lastLiveAt: { "1": "2026-01-01T00:00:00.000Z" },
          history: { "1": [{ startedAt: "2026-01-01T00:00:00.000Z" }] }
        }
      },
      dataFile
    );

    // 測試 merge 模式
    const incomingData = {
      rooms: [
        { roomId: 1, order: 0, addedAt: "2026-01-01T00:00:00.000Z" },
        { roomId: 2, order: 0, addedAt: "2026-01-02T00:00:00.000Z" }
      ],
      groups: [{ id: "group-2", name: "分組2", order: 0, createdAt: "2026-01-02T00:00:00.000Z" }],
      settings: { theme: "dark" },
      stats: {
        liveDuration: { "1": 500, "2": 300 },
        lastLiveAt: { "1": "2026-01-05T00:00:00.000Z" },
        history: { "1": [{ startedAt: "2026-01-05T00:00:00.000Z" }] }
      }
    };

    const mergeResult = await importData(incomingData, "merge", { dataFile });
    assert.equal(mergeResult.roomsAdded, 1);
    assert.equal(mergeResult.groupsAdded, 1);
    assert.equal(mergeResult.roomsTotal, 2);
    assert.equal(mergeResult.groupsTotal, 2);

    let data = await readData(dataFile);
    assert.equal(data.settings.theme, "light"); // 保留現有設定
    assert.equal(data.stats.liveDuration["1"], 500); // 取較大值
    assert.equal(data.stats.lastLiveAt["1"], "2026-01-05T00:00:00.000Z");
    assert.equal(data.stats.history["1"].length, 2);

    // 測試 replace 模式
    const replaceResult = await importData(
      {
        rooms: [{ roomId: 99, order: 0, addedAt: "2026-02-01T00:00:00.000Z" }],
        groups: []
      },
      "replace",
      { dataFile }
    );
    assert.equal(replaceResult.roomsTotal, 1);
    data = await readData(dataFile);
    assert.equal(data.rooms[0].roomId, 99);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("6. observeRoomTransitions 狀態轉換偵測與 history 寫入", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "bililive-observe-"));
  const dataFile = path.join(temporaryDirectory, "rooms.json");

  try {
    await writeData(
      {
        rooms: [{ roomId: 101, order: 0 }, { roomId: 102, order: 1 }],
        groups: [],
        settings: undefined,
        stats: { liveDuration: {}, lastLiveAt: {}, history: {} }
      },
      dataFile
    );

    // 首次呼叫：僅初始化，不觸發轉換
    const initialTransition = await observeRoomTransitions(
      [
        { roomId: 101, status: "live" },
        { roomId: 102, status: "offline" }
      ],
      { dataFile }
    );
    assert.deepEqual(initialTransition, { wentLive: [], wentOffline: [] });

    // 第二次呼叫：101 下播，102 開播
    const nextTransition = await observeRoomTransitions(
      [
        { roomId: 101, status: "offline" },
        { roomId: 102, status: "live" }
      ],
      { dataFile }
    );
    assert.deepEqual(nextTransition.wentLive, [102]);
    assert.deepEqual(nextTransition.wentOffline, [101]);

    const data = await readData(dataFile);
    assert.ok(data.stats.history["102"]?.length > 0);
    assert.ok(data.stats.history["102"][0].startedAt);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("7. updateRoomFields 完整欄位更新", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "bililive-fields-"));
  const dataFile = path.join(temporaryDirectory, "rooms.json");

  try {
    await writeData(
      {
        rooms: [{ roomId: 888, order: 0 }],
        groups: [{ id: "group-test", name: "測試分組", order: 0, createdAt: new Date().toISOString() }]
      },
      dataFile
    );

    const updateRes = await updateRoomFields(
      888,
      {
        groupId: "group-test",
        note: "主推 V 圈",
        pinned: true,
        notify: false
      },
      { dataFile }
    );

    assert.equal(updateRes.updated, true);
    assert.equal(updateRes.room.groupId, "group-test");
    assert.equal(updateRes.room.note, "主推 V 圈");
    assert.equal(updateRes.room.pinned, true);
    assert.equal(updateRes.room.notify, false);

    const data = await readData(dataFile);
    assert.deepEqual(data.rooms[0], {
      roomId: 888,
      groupId: "group-test",
      order: 0,
      addedAt: data.rooms[0].addedAt,
      note: "主推 V 圈",
      pinned: true,
      notify: false
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("8. SSE 連線建立、初始 Snapshot 與 Headers 驗證", async () => {
  resetBroadcaster();

  class MockResponse extends EventEmitter {
    constructor() {
      super();
      this.headers = {};
      this.statusCode = 0;
      this.chunks = [];
      this.writableEnded = false;
    }
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
      return this;
    }
    flushHeaders() {}
    write(chunk) {
      this.chunks.push(chunk);
      return true;
    }
    end() {
      this.writableEnded = true;
      this.emit("close");
    }
  }

  const req = new EventEmitter();
  const res = new MockResponse();

  const mockPayload = {
    rooms: [{ roomId: 999, status: "live", title: "測試直播", online: 100 }],
    groups: [],
    settings: { refreshInterval: 30 }
  };

  await handleSseEvents(req, res, {
    listRoomsImpl: async () => mockPayload
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Content-Type"], "text/event-stream");
  assert.equal(res.headers["Cache-Control"], "no-cache, no-transform");
  assert.equal(res.headers["Connection"], "keep-alive");
  assert.equal(res.headers["Access-Control-Allow-Origin"], "*");

  // 驗證初始 snapshot
  assert.equal(res.chunks.length, 1);
  assert.equal(res.chunks[0], `event: rooms\ndata: ${JSON.stringify(mockPayload)}\n\n`);
  assert.equal(sseClients.size, 1);

  // 驗證斷開連線後自動從連線池清理
  req.emit("close");
  assert.equal(sseClients.size, 0);

  resetBroadcaster();
});

test("9. SSE 主動廣播與心跳 ping / 異常 client 移除", async () => {
  resetBroadcaster();

  class MockResponse extends EventEmitter {
    constructor() {
      super();
      this.chunks = [];
      this.writableEnded = false;
    }
    write(chunk) {
      this.chunks.push(chunk);
      return true;
    }
  }

  const client1 = new MockResponse();
  const client2 = new MockResponse();

  sseClients.add(client1);
  sseClients.add(client2);

  const updatedPayload = {
    rooms: [{ roomId: 999, status: "offline", title: "測試下播", online: 0 }],
    groups: [],
    settings: { refreshInterval: 30 }
  };

  // 測試主動廣播
  await broadcastRoomsUpdate({
    force: true,
    listRoomsImpl: async () => updatedPayload
  });

  assert.equal(client1.chunks[0], `event: rooms\ndata: ${JSON.stringify(updatedPayload)}\n\n`);
  assert.equal(client2.chunks[0], `event: rooms\ndata: ${JSON.stringify(updatedPayload)}\n\n`);

  // 測試心跳 ping 註解
  sendSseComment(client1, "ping");
  assert.equal(client1.chunks[1], ": ping\n\n");

  // 測試異常 client 自動移除
  const brokenClient = new MockResponse();
  brokenClient.write = () => {
    throw new Error("Connection reset by peer");
  };
  sseClients.add(brokenClient);
  assert.equal(sseClients.size, 3);

  sendSseMessage(brokenClient, "rooms", updatedPayload);
  assert.equal(sseClients.has(brokenClient), false);
  assert.equal(sseClients.size, 2);

  resetBroadcaster();
});

