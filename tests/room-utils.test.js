import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseRoomInput } from "../server/room-input.js";
import { mapRoomStatus, ROOM_STATUSES } from "../server/room-status.js";
import { addRoomFromInput, deleteRoom } from "../server/rooms-service.js";
import { createGroup, readData, readRooms, reorderRooms, updateSettings, writeRooms } from "../server/storage.js";

test("parseRoomInput accepts room ids and BiliBili live URLs", () => {
  assert.equal(parseRoomInput("6"), 6);
  assert.equal(parseRoomInput(" https://live.bilibili.com/7734200?from=search "), 7734200);
  assert.equal(parseRoomInput("https://live.bilibili.com/blanc/2233"), 2233);
});

test("parseRoomInput rejects invalid values", () => {
  assert.throws(() => parseRoomInput(""), /請輸入/);
  assert.throws(() => parseRoomInput("https://example.com/6"), /無法解析/);
  assert.throws(() => parseRoomInput("0"), /正整數/);
});

test("mapRoomStatus maps BiliBili status fields", () => {
  assert.equal(mapRoomStatus({ live_status: 1, lock_status: 0, hidden_status: 0 }), ROOM_STATUSES.live);
  assert.equal(mapRoomStatus({ live_status: 0, lock_status: 0, hidden_status: 0 }), ROOM_STATUSES.offline);
  assert.equal(mapRoomStatus({ live_status: 2, lock_status: 0, hidden_status: 0 }), ROOM_STATUSES.round);
  assert.equal(mapRoomStatus({ live_status: 1, lock_status: 1, hidden_status: 0 }), ROOM_STATUSES.locked);
  assert.equal(mapRoomStatus({ live_status: 1, lock_status: 0, hidden_status: 1 }), ROOM_STATUSES.hidden);
});

test("storage writes, reads, sorts, and deletes saved rooms", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "bililive-watch-"));
  const dataFile = path.join(temporaryDirectory, "rooms.json");

  try {
    await writeRooms(
      [
        { roomId: 3, addedAt: "2026-06-24T10:01:00.000Z" },
        { roomId: 1, shortId: 1, addedAt: "2026-06-24T10:00:00.000Z" }
      ],
      dataFile
    );

    assert.deepEqual(await readRooms(dataFile), [
      { roomId: 3, addedAt: "2026-06-24T10:01:00.000Z", order: 0 },
      { roomId: 1, shortId: 1, addedAt: "2026-06-24T10:00:00.000Z", order: 1 }
    ]);

    assert.deepEqual(await deleteRoom(1, { dataFile }), { removed: true, roomId: 1 });
    assert.deepEqual(await readRooms(dataFile), [{ roomId: 3, addedAt: "2026-06-24T10:01:00.000Z", order: 0 }]);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("addRoomFromInput stores canonical room id only once", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "bililive-watch-"));
  const dataFile = path.join(temporaryDirectory, "rooms.json");
  const fetchRoomBaseInfoImpl = async () => ({
    roomId: 7734200,
    shortId: 6,
    uid: 50329118,
    title: "測試直播間",
    uname: "測試主播",
    cover: "",
    online: 12,
    attention: 34,
    areaName: "測試分區",
    parentAreaName: "測試",
    liveUrl: "https://live.bilibili.com/7734200",
    liveTime: "2026-06-24 10:00:00",
    status: "live",
    statusLabel: "直播中",
    lockStatus: 0,
    hiddenStatus: 0,
    isEncrypted: false
  });

  try {
    const firstResult = await addRoomFromInput("6", { dataFile, fetchRoomBaseInfoImpl });
    const secondResult = await addRoomFromInput("https://live.bilibili.com/6", {
      dataFile,
      fetchRoomBaseInfoImpl
    });

    assert.equal(firstResult.created, true);
    assert.equal(secondResult.created, false);
    assert.deepEqual(JSON.parse(await readFile(dataFile, "utf8")).rooms, [
      {
        roomId: 7734200,
        shortId: 6,
        addedAt: firstResult.room.addedAt,
        order: 0
      }
    ]);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("groups, ordering, and settings are persisted in schema v2", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "bililive-watch-"));
  const dataFile = path.join(temporaryDirectory, "rooms.json");

  try {
    await writeRooms(
      [
        { roomId: 1, addedAt: "2026-06-24T10:00:00.000Z" },
        { roomId: 2, addedAt: "2026-06-24T10:01:00.000Z" }
      ],
      dataFile
    );
    const group = await createGroup("常看", dataFile);
    await reorderRooms([2, 1], undefined, dataFile);
    const settings = await updateSettings({ theme: "dark", cardScale: 1.2, fontFamily: "mono" }, dataFile);
    const data = await readData(dataFile);

    assert.equal(group.name, "常看");
    assert.match(group.id, /^group-[a-z0-9]+$/);
    assert.equal(data.groups[0].name, "常看");
    assert.deepEqual(
      data.rooms.map((room) => room.roomId),
      [2, 1]
    );
    assert.equal(settings.theme, "dark");
    assert.equal(settings.cardScale, 1.2);
    assert.equal(settings.fontFamily, "mono");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
