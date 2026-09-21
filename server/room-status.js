export const ROOM_STATUSES = {
  live: "live",
  offline: "offline",
  round: "round",
  locked: "locked",
  hidden: "hidden",
  error: "error",
  unknown: "unknown"
};

export const ROOM_STATUS_LABELS = {
  live: "直播中",
  offline: "未開播",
  round: "輪播中",
  locked: "鎖定",
  hidden: "隱藏",
  error: "錯誤",
  unknown: "未知"
};

export function mapRoomStatus(roomInfo) {
  if (Number(roomInfo?.hidden_status ?? 0) !== 0) {
    return ROOM_STATUSES.hidden;
  }

  if (Number(roomInfo?.lock_status ?? 0) !== 0 || roomInfo?.is_encrypted === true) {
    return ROOM_STATUSES.locked;
  }

  switch (Number(roomInfo?.live_status)) {
    case 1:
      return ROOM_STATUSES.live;
    case 0:
      return ROOM_STATUSES.offline;
    case 2:
      return ROOM_STATUSES.round;
    default:
      return ROOM_STATUSES.unknown;
  }
}
