import type { LiveRoom } from "../types";

export type AdvancedFilterSortBy = "order" | "liveFirst" | "online" | "attention" | "addedAt";
export type AdvancedFilterSortDir = "asc" | "desc";

export interface AdvancedFilters {
  area: string | "all";
  parentArea: string | "all";
  onlineMin: number;
  attentionMin: number;
  sortBy: AdvancedFilterSortBy;
  sortDir: AdvancedFilterSortDir;
}

export const DEFAULT_ADVANCED_FILTERS: AdvancedFilters = {
  area: "all",
  parentArea: "all",
  onlineMin: 0,
  attentionMin: 0,
  sortBy: "order",
  sortDir: "asc",
};

/**
 * 進階篩選：依分區、父分區、人氣門檻過濾
 * 純函數，可單元測試
 */
export function applyAdvancedFilters(rooms: LiveRoom[], filters: AdvancedFilters): LiveRoom[] {
  if (!filters) return rooms;
  return rooms.filter((room) => {
    if (filters.area !== "all" && room.areaName !== filters.area) return false;
    if (filters.parentArea !== "all" && room.parentAreaName !== filters.parentArea) return false;
    if (Number.isFinite(filters.onlineMin) && filters.onlineMin > 0 && room.online < filters.onlineMin) return false;
    if (Number.isFinite(filters.attentionMin) && filters.attentionMin > 0 && room.attention < filters.attentionMin) return false;
    return true;
  });
}

/**
 * 進階排序：支援多種排序維度與方向
 * 純函數，可單元測試
 */
export function sortRoomsAdvanced(
  rooms: LiveRoom[],
  sortBy: AdvancedFilterSortBy,
  sortDir: AdvancedFilterSortDir,
): LiveRoom[] {
  const dir = sortDir === "desc" ? -1 : 1;
  const copy = [...rooms];
  copy.sort((a, b) => {
    let cmp = 0;
    switch (sortBy) {
      case "order":
        cmp = a.order - b.order;
        if (cmp === 0) cmp = a.addedAt.localeCompare(b.addedAt);
        break;
      case "liveFirst": {
        const rank = (status: string) => (status === "live" ? 0 : 1);
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
        cmp = a.addedAt.localeCompare(b.addedAt);
        break;
      default:
        cmp = 0;
    }
    return cmp * dir;
  });
  return copy;
}
