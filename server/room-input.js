const ROOM_URL_PATTERN = /(?:https?:\/\/)?(?:www\.)?live\.bilibili\.com\/(?:blanc\/)?(\d+)/i;
const ROOM_ID_PATTERN = /^\d+$/;

export function parseRoomInput(roomInput) {
  if (typeof roomInput !== "string") {
    throw new TypeError("roomInput 必須是字串");
  }

  const value = roomInput.trim();
  if (!value) {
    throw new TypeError("請輸入 BiliBili 直播房號或直播網址");
  }

  const urlMatch = value.match(ROOM_URL_PATTERN);
  const roomIdText = urlMatch?.[1] ?? value;

  if (!ROOM_ID_PATTERN.test(roomIdText)) {
    throw new TypeError(`無法解析直播房號：${value}`);
  }

  const roomId = Number(roomIdText);
  if (!Number.isSafeInteger(roomId) || roomId <= 0) {
    throw new TypeError(`直播房號必須是正整數：${roomIdText}`);
  }

  return roomId;
}
