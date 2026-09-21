// 前端與後端共用的進階篩選純函數（JS 版本，供 Node 測試使用）
// 與 src/utils/filterPipeline.ts 邏輯保持一致

export const DEFAULT_ADVANCED_FILTERS = {
  area: "all",
  parentArea: "all",
  onlineMin: 0,
  attentionMin: 0,
  sortBy: "order",
  sortDir: "asc",
};

export function applyAdvancedFilters(rooms, filters) {
  if (!filters) return rooms;
  return rooms.filter((room) => {
    if (filters.area !== "all" && room.areaName !== filters.area) return false;
    if (filters.parentArea !== "all" && room.parentAreaName !== filters.parentArea) return false;
    if (Number.isFinite(filters.onlineMin) && filters.onlineMin > 0 && room.online < filters.onlineMin) return false;
    if (Number.isFinite(filters.attentionMin) && filters.attentionMin > 0 && room.attention < filters.attentionMin) return false;
    return true;
  });
}

export function sortRoomsAdvanced(rooms, sortBy, sortDir) {
  const dir = sortDir === "desc" ? -1 : 1;
  const copy = [...rooms];
  copy.sort((a, b) => {
    let cmp = 0;
    switch (sortBy) {
      case "order":
        cmp = a.order - b.order;
        if (cmp === 0) cmp = String(a.addedAt).localeCompare(String(b.addedAt));
        break;
      case "liveFirst": {
        const rank = (status) => (status === "live" ? 0 : 1);
        cmp = rank(a.status) - rank(b.status);
        if (cmp === 0) cmp = a.order - b.order;
        break;
      }
      case "online":
        cmp = a.online - b.online;
        break;
      case "attention":
        cmp = a.attention - b.attention;
        break;
      case "addedAt":
        cmp = String(a.addedAt).localeCompare(String(b.addedAt));
        break;
      default:
        cmp = 0;
    }
    return cmp * dir;
  });
  return copy;
}
