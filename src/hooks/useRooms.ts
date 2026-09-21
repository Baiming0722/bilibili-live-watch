import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../api";
import type { AppSettings, FilterPreset, LiveRoom, RoomGroup, RoomsResponse } from "../types";

// 預設設定，與 App.tsx 保持一致
const DEFAULT_SETTINGS: AppSettings = {
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
  density: "standard" as const,
  filterPresets: [] as FilterPreset[],
};

// 用於比對房間是否實質相等的顯示用欄位清單（不含 uid 等非顯示欄位）
const ROOM_DISPLAY_KEYS = [
  "roomId",
  "shortId",
  "groupId",
  "order",
  "addedAt",
  "title",
  "uname",
  "cover",
  "face",
  "online",
  "attention",
  "areaName",
  "parentAreaName",
  "liveUrl",
  "liveTime",
  "status",
  "statusLabel",
  "lastFetchedAt",
  "error",
  "note",
  "pinned",
  "notify",
] as const;

function roomsAreEqual(a: LiveRoom, b: LiveRoom): boolean {
  for (const key of ROOM_DISPLAY_KEYS) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

/**
 * 差異合併 rooms：若新 room 與舊 room「實質相等」則沿用舊物件參考，
 * 讓 React.memo 包裹的 RoomCard 跳過 re-render；
 * 若所有 rooms 與順序皆未變動則沿用舊陣列。
 */
function mergeRooms(previous: LiveRoom[], next: LiveRoom[]): LiveRoom[] {
  if (previous.length === 0) return next;
  const previousMap = new Map<number, LiveRoom>();
  for (const room of previous) previousMap.set(room.roomId, room);
  let hasAnyChanged = false;
  const merged = next.map((nextRoom) => {
    const prevRoom = previousMap.get(nextRoom.roomId);
    if (prevRoom && roomsAreEqual(prevRoom, nextRoom)) {
      return prevRoom;
    }
    hasAnyChanged = true;
    return nextRoom;
  });
  if (!hasAnyChanged && previous.length === next.length) {
    const sameOrder = previous.every((room, i) => room.roomId === next[i].roomId);
    if (sameOrder) return previous;
  }
  return merged;
}

/**
 * 差異合併 groups：若新 group 與舊 group「實質相等」則沿用舊物件參考，
 * 讓依賴 groups 的元件避免不必要 re-render；
 * 若所有 groups 與順序皆未變動則沿用舊陣列。
 */
function mergeGroups(previous: RoomGroup[], next: RoomGroup[]): RoomGroup[] {
  if (previous.length === 0) return next;
  const previousMap = new Map<string, RoomGroup>();
  for (const group of previous) previousMap.set(group.id, group);
  let hasAnyChanged = false;
  const merged = next.map((nextGroup) => {
    const prevGroup = previousMap.get(nextGroup.id);
    if (prevGroup && prevGroup.name === nextGroup.name && prevGroup.order === nextGroup.order) {
      return prevGroup;
    }
    hasAnyChanged = true;
    return nextGroup;
  });
  if (!hasAnyChanged && previous.length === next.length) {
    const sameOrder = previous.every((group, i) => group.id === next[i].id);
    if (sameOrder) return previous;
  }
  return merged;
}

export function useRooms() {
  const [rooms, setRooms] = useState<LiveRoom[]>([]);
  const [groups, setGroups] = useState<RoomGroup[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [stats, setStats] = useState<{ liveDuration: Record<string, number>; lastLiveAt: Record<string, string>; lastCalculatedAt?: string } | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const roomsRef = useRef(rooms);

  useEffect(() => {
    roomsRef.current = rooms;
  }, [rooms]);

  // 使用 useCallback 確保 loadRooms 參考穩定，不因 settings.refreshInterval 變動而重建
  // 真正的 interval 值由 usePolling 透過 ref 追蹤
  const loadRooms = useCallback(async (options: { quiet?: boolean; signal?: AbortSignal; refreshing?: boolean } = {}) => {
    setActionError(null);
    setIsLoading(!options.quiet);
    setIsRefreshing(Boolean(options.refreshing));

    if (!options.signal) {
      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();
    }
    const signal = options.signal ?? abortControllerRef.current?.signal;

    try {
      const response = await api.fetchRooms(signal);
      setRooms((previousRooms) => mergeRooms(previousRooms, response.rooms));
      setGroups((previousGroups) => mergeGroups(previousGroups, response.groups));
      setSettings(response.settings ?? DEFAULT_SETTINGS);
      setStats((response as unknown as { stats?: typeof stats }).stats ?? null);
      setLastFetchedAt(response.fetchedAt);
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        setActionError((error as Error).message);
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  const updateRoomFields = useCallback(
    async (roomId: number, fields: { groupId?: string | null; note?: string; pinned?: boolean; notify?: boolean }) => {
      setActionError(null);
      // 樂觀更新本地狀態
      setRooms((currentRooms) =>
        currentRooms.map((room) => (room.roomId === roomId ? { ...room, ...fields, groupId: fields.groupId ?? undefined } : room)),
      );
      try {
        await api.patchRoom(roomId, fields);
        await loadRooms({ quiet: true });
      } catch (error) {
        setActionError((error as Error).message);
        await loadRooms({ quiet: true });
        throw error;
      }
    },
    [loadRooms],
  );

  const batchDelete = useCallback(
    async (roomIds: number[]) => {
      if (roomIds.length === 0) return { deleted: 0 };
      setActionError(null);
      try {
        const res = await api.batchDeleteRooms(roomIds);
        await loadRooms({ quiet: true });
        return res;
      } catch (error) {
        setActionError((error as Error).message);
        throw error;
      }
    },
    [loadRooms],
  );

  const batchMove = useCallback(
    async (roomIds: number[], groupId: string | null) => {
      if (roomIds.length === 0) return { moved: 0 };
      setActionError(null);
      try {
        const res = await api.batchMoveRooms(roomIds, groupId);
        await loadRooms({ quiet: true });
        return res;
      } catch (error) {
        setActionError((error as Error).message);
        throw error;
      }
    },
    [loadRooms],
  );

  const triggerExport = useCallback(async () => {
    setActionError(null);
    try {
      const blob = await api.exportData();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bililive-rooms-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      setActionError((error as Error).message);
      throw error;
    }
  }, []);

  const triggerImport = useCallback(
    async (data: unknown, mode: "merge" | "replace") => {
      setActionError(null);
      try {
        const res = await api.importData(data, mode);
        await loadRooms({ quiet: true });
        return res;
      } catch (error) {
        setActionError((error as Error).message);
        throw error;
      }
    },
    [loadRooms],
  );

  const saveFilterPreset = useCallback(
    async (preset: Omit<FilterPreset, "id" | "createdAt"> & { id?: string }) => {
      setActionError(null);
      const existing = settings.filterPresets ?? [];
      const id = preset.id || `preset-${Date.now()}`;
      const fullPreset: FilterPreset = {
        id,
        name: preset.name,
        filters: preset.filters,
        sortBy: preset.sortBy,
        sortOrder: preset.sortOrder,
        createdAt: new Date().toISOString(),
      };

      const updatedPresets = existing.some((p) => p.id === id)
        ? existing.map((p) => (p.id === id ? fullPreset : p))
        : [...existing, fullPreset];

      try {
        const savedSettings = await api.saveSettings({ filterPresets: updatedPresets });
        setSettings(savedSettings);
        return fullPreset;
      } catch (error) {
        setActionError((error as Error).message);
        throw error;
      }
    },
    [settings.filterPresets],
  );

  const deleteFilterPreset = useCallback(
    async (presetId: string) => {
      setActionError(null);
      const existing = settings.filterPresets ?? [];
      const updatedPresets = existing.filter((p) => p.id !== presetId);
      try {
        const savedSettings = await api.saveSettings({ filterPresets: updatedPresets });
        setSettings(savedSettings);
      } catch (error) {
        setActionError((error as Error).message);
        throw error;
      }
    },
    [settings.filterPresets],
  );

  return {
    rooms,
    setRooms,
    groups,
    setGroups,
    settings,
    setSettings,
    stats,
    setStats,
    lastFetchedAt,
    setLastFetchedAt,
    isLoading,
    isRefreshing,
    actionError,
    setActionError,
    loadRooms,
    updateRoomFields,
    batchDelete,
    batchMove,
    triggerExport,
    triggerImport,
    saveFilterPreset,
    deleteFilterPreset,
    abortControllerRef,
    roomsRef,
    mergeRooms,
    roomsAreEqual,
  };
}
