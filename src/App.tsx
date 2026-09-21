import React, { CSSProperties, DragEvent, FormEvent, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { addRoom, createGroup, deleteGroup, deleteRoom, refreshRoom, reorderRooms, saveSettings, updateRoomGroup } from "./api";
import {
  AlertIcon,
  CheckIcon,
  CheckSquareIcon,
  ClockIcon,
  ExternalIcon,
  EyeOffIcon,
  FolderIcon,
  Grid2x2Icon,
  Grid3x3Icon,
  HelpCircleIcon,
  HomeIcon,
  LayersIcon,
  LayoutAutoIcon,
  LockIcon,
  MaximizeIcon,
  MinimizeIcon,
  MoonIcon,
  PlayIcon,
  RefreshIcon,
  SquareIcon,
  SunIcon,
  SystemThemeIcon,
  TrashIcon,
  TvIcon,
  XIcon,
} from "./icons";
import type { AppSettings, LiveRoom, RoomGroup, RoomStatus, RoomsResponse } from "./types";
import { Sidebar } from "./components/Sidebar";
import { RoomCard } from "./components/RoomCard";
import { EmptyState } from "./components/EmptyState";
import { SkeletonCard } from "./components/SkeletonCard";
import { ShortcutsPanel } from "./components/ShortcutsPanel";
import { Dashboard } from "./components/Dashboard";
import { AdvancedFilterBar } from "./components/AdvancedFilterBar";
import { LazyIframe } from "./components/LazyIframe";
import { useRooms } from "./hooks/useRooms";
import { usePolling } from "./hooks/usePolling";
import { useTheme } from "./hooks/useTheme";
import { useEventStream } from "./hooks/useEventStream";
import { computeLiveTransitions, playChime, requestNotificationPermission, showLiveNotification } from "./utils/notify";
import { AdvancedFilters, DEFAULT_ADVANCED_FILTERS, applyAdvancedFilters, sortRoomsAdvanced } from "./utils/filterPipeline";

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
  filterPresets: [],
};

type FilterKey = "all" | "live" | "offline" | "error" | "locked" | "hidden";
type GroupFilterKey = "all" | "ungrouped" | string;
type MultiViewGridMode = "auto" | "2x2" | "3x3" | "focus";

const fontFamilies: Record<string, string> = {
  system: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", sans-serif',
  jhenghei: '"Microsoft JhengHei", "Noto Sans TC", "PingFang TC", sans-serif',
  serif: '"Noto Serif TC", "Source Han Serif TC", "Times New Roman", serif',
  mono: '"Cascadia Code", "JetBrains Mono", Consolas, monospace',
};

const filters: Array<{ key: FilterKey; label: string; status?: RoomStatus; Icon: typeof HomeIcon }> = [
  { key: "all", label: "全部", Icon: HomeIcon },
  { key: "live", label: "直播中", status: "live", Icon: TvIcon },
  { key: "offline", label: "未開播", status: "offline", Icon: ClockIcon },
  { key: "error", label: "錯誤", status: "error", Icon: AlertIcon },
  { key: "locked", label: "已鎖定", status: "locked", Icon: LockIcon },
  { key: "hidden", label: "已隱藏", status: "hidden", Icon: EyeOffIcon },
];

interface AppToast {
  id: string;
  message: string;
  type: "success" | "error" | "info";
  action?: {
    label: string;
    onClick: () => void;
  };
}

export default function App() {
  const {
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
    roomsRef,
    mergeRooms,
  } = useRooms();

  const handleSseMessage = useCallback(
    (data: RoomsResponse) => {
      setRooms((previousRooms) => mergeRooms(previousRooms, data.rooms));
      setGroups((previousGroups) => data.groups ?? previousGroups);
      if (data.settings) setSettings(data.settings);
      if (data.stats) setStats(data.stats);
      if (data.fetchedAt) setLastFetchedAt(data.fetchedAt);
    },
    [mergeRooms, setRooms, setGroups, setSettings, setStats, setLastFetchedAt],
  );

  const { connected } = useEventStream(handleSseMessage, true);
  const { effectiveTheme } = useTheme(settings.theme);

  // SSE 優先，連線成功時暫停輪詢，斷線時自動降級輪詢
  usePolling({ loadRooms, refreshInterval: settings.refreshInterval, paused: connected });

  // 狀態轉換比對與開播提醒
  const prevRoomsRef = useRef<LiveRoom[]>([]);
  useEffect(() => {
    if (prevRoomsRef.current.length > 0) {
      const { wentLive } = computeLiveTransitions(prevRoomsRef.current, rooms);
      if (wentLive.length > 0) {
        if (settings.notifyOnLive) {
          for (const room of wentLive) {
            if (room.notify !== false) {
              showLiveNotification(room);
            }
          }
        }
        if (settings.soundEnabled) {
          playChime(settings.soundVolume);
        }
      }
    }
    prevRoomsRef.current = rooms;
  }, [rooms, settings.notifyOnLive, settings.soundEnabled, settings.soundVolume]);

  // 初次請求通知權限
  useEffect(() => {
    if (settings.notifyOnLive) {
      void requestNotificationPermission();
    }
  }, [settings.notifyOnLive]);

  const [roomInput, setRoomInput] = useState("");
  const [groupInput, setGroupInput] = useState("");
  const [selectedFilter, setSelectedFilter] = useState<FilterKey>("all");
  const [selectedGroupId, setSelectedGroupId] = useState<GroupFilterKey>("all");
  const [previewRoomIds, setPreviewRoomIds] = useState<number[]>([]);
  const [draggingRoomId, setDraggingRoomId] = useState<number | null>(null);
  const [dragOverRoomId, setDragOverRoomId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [toasts, setToasts] = useState<AppToast[]>([]);
  const [isMultiView, setIsMultiView] = useState(false);
  const [multiViewGridMode, setMultiViewGridMode] = useState<MultiViewGridMode>("auto");
  const [focusedRoomId, setFocusedRoomId] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilters>(DEFAULT_ADVANCED_FILTERS);
  const [healthOk, setHealthOk] = useState(true);

  // 批次多選狀態
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [selectedRoomIds, setSelectedRoomIds] = useState<Set<number>>(new Set());
  const [isBatchMoveOpen, setIsBatchMoveOpen] = useState(false);
  const batchMoveMenuRef = useRef<HTMLDivElement>(null);

  // 前端 health 輪詢：每 30s 檢查一次，用於 health-dot 顯示
  useEffect(() => {
    let timer: number | undefined;
    const check = async () => {
      try {
        const res = await fetch("/api/health");
        if (!res.ok) throw new Error("health fail");
        setHealthOk(true);
      } catch {
        setHealthOk(false);
      }
    };
    void check();
    timer = window.setInterval(check, 30000);
    return () => {
      if (timer) window.clearInterval(timer);
    };
  }, []);

  const roomInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const multiViewContainerRef = useRef<HTMLDivElement | null>(null);

  const showToast = useCallback((message: string, type: AppToast["type"] = "info", action?: AppToast["action"]) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((current) => [...current, { id, message, type, action }]);
    setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, 6000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  // 點擊外部關閉批次移動選單
  useEffect(() => {
    if (!isBatchMoveOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (batchMoveMenuRef.current && !batchMoveMenuRef.current.contains(e.target as Node)) {
        setIsBatchMoveOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isBatchMoveOpen]);

  // 全螢幕狀態監聽
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        const target = multiViewContainerRef.current ?? document.documentElement;
        await target.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.error("Fullscreen error:", err);
    }
  }, []);

  const prevIsAnyLiveRef = useRef(false);
  useEffect(() => {
    const isAnyLive = rooms.some((room) => room.status === "live");
    if (isAnyLive !== prevIsAnyLiveRef.current) {
      prevIsAnyLiveRef.current = isAnyLive;
      updateFavicon(isAnyLive);
    }
  }, [rooms]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA" ||
        document.activeElement?.tagName === "SELECT"
      ) {
        return;
      }

      const key = event.key.toLowerCase();

      if (isShortcutsOpen && event.key !== "Escape" && event.key !== "?") {
        return;
      }

      if (key === "r") {
        event.preventDefault();
        void loadRooms({ quiet: true });
        showToast("正在重新整理所有直播間...", "info");
      } else if (event.key === "Escape") {
        event.preventDefault();
        if (isBatchMode) {
          setIsBatchMode(false);
          setSelectedRoomIds(new Set());
          setIsBatchMoveOpen(false);
          showToast("已退出批次管理模式", "info");
        } else if (isMultiView) {
          setIsMultiView(false);
          showToast("已退出多房同屏", "info");
        } else {
          setPreviewRoomIds([]);
          setIsShortcutsOpen(false);
          showToast("已收合所有預覽", "info");
        }
      } else if (key === "s") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (key === "a") {
        event.preventDefault();
        roomInputRef.current?.focus();
        roomInputRef.current?.select();
      } else if (event.key === "?") {
        event.preventDefault();
        setIsShortcutsOpen((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [loadRooms, showToast, isShortcutsOpen, isMultiView, isBatchMode]);

  const appStyle = useMemo(() => {
    const accentColors: Record<string, { light: [string, string, string, string]; dark: [string, string, string, string] }> = {
      blue: { light: ["#1587f2", "#e7f3ff", "#0878df", "#0f5c9e"], dark: ["#4da3ff", "#102b45", "#238eff", "#102b45"] },
      pink: { light: ["#f44773", "#fff0f4", "#e02857", "#a11e3b"], dark: ["#ff5c85", "#351923", "#ff3366", "#351923"] },
      purple: { light: ["#a855f7", "#f3e8ff", "#9333ea", "#6b21a8"], dark: ["#c084fc", "#2e1065", "#a855f7", "#2e1065"] },
      green: { light: ["#10b981", "#d1fae5", "#059669", "#047857"], dark: ["#34d399", "#064e3b", "#10b981", "#064e3b"] },
      orange: { light: ["#f97316", "#ffedd5", "#ea580c", "#c2410c"], dark: ["#fb923c", "#431407", "#f97316", "#431407"] },
    };

    let accent = "#1587f2";
    let accentSoft = "#e7f3ff";
    let accentHover = "#0878df";
    let shadowColor = "#0f5c9e";

    if (settings.accentCustom && /^#[0-9a-fA-F]{6}$/.test(settings.accentCustom)) {
      accent = settings.accentCustom;
      const r = parseInt(settings.accentCustom.slice(1, 3), 16);
      const g = parseInt(settings.accentCustom.slice(3, 5), 16);
      const b = parseInt(settings.accentCustom.slice(5, 7), 16);
      accentSoft = `rgba(${r}, ${g}, ${b}, ${effectiveTheme === "light" ? 0.12 : 0.2})`;
      accentHover = effectiveTheme === "light" 
        ? `rgb(${Math.max(0, r - 25)}, ${Math.max(0, g - 25)}, ${Math.max(0, b - 25)})`
        : `rgb(${Math.min(255, r + 25)}, ${Math.min(255, g + 25)}, ${Math.min(255, b + 25)})`;
      shadowColor = `rgba(${r}, ${g}, ${b}, 0.35)`;
    } else {
      const colorConfig = accentColors[settings.accentColor] || accentColors.blue;
      [accent, accentSoft, accentHover, shadowColor] = effectiveTheme === "light" ? colorConfig.light : colorConfig.dark;
    }

    return {
      "--card-scale": String(settings.cardScale),
      "--font-scale": String(settings.fontScale),
      "--app-font-family": fontFamilies[settings.fontFamily] ?? `"${settings.fontFamily}", ${fontFamilies.system}`,
      "--accent": accent,
      "--accent-soft": accentSoft,
      "--accent-hover": accentHover,
      "--accent-shadow": shadowColor,
    } as CSSProperties;
  }, [settings, effectiveTheme]);

  const roomCounts = useMemo(() => {
    return rooms.reduce(
      (counts, room) => {
        counts.all += 1;
        counts[room.status] = (counts[room.status] ?? 0) + 1;
        return counts;
      },
      {
        all: 0,
        live: 0,
        offline: 0,
        round: 0,
        locked: 0,
        hidden: 0,
        error: 0,
        unknown: 0,
      } as Record<FilterKey | RoomStatus, number>,
    );
  }, [rooms]);

  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const room of rooms) {
      counts.set(room.groupId ?? "ungrouped", (counts.get(room.groupId ?? "ungrouped") ?? 0) + 1);
    }
    return counts;
  }, [rooms]);

  const activeGroupId = selectedGroupId === "all" || selectedGroupId === "ungrouped" ? undefined : selectedGroupId;

  // 三段式 Pipeline：baseFilter → advancedFilter → sort (置頂房間 pinned: true 優先排列)
  const filteredRooms = useMemo(() => {
    const activeFilter = filters.find((filter) => filter.key === selectedFilter);
    const query = deferredSearchQuery.trim().toLowerCase();

    const baseFiltered = rooms.filter((room) => {
      const statusMatches = activeFilter?.status ? room.status === activeFilter.status : true;
      const groupMatches =
        selectedGroupId === "all"
          ? true
          : selectedGroupId === "ungrouped"
            ? !room.groupId
            : room.groupId === selectedGroupId;

      const queryMatches = query
        ? room.uname.toLowerCase().includes(query) ||
          room.title.toLowerCase().includes(query) ||
          String(room.roomId).includes(query) ||
          (room.shortId && String(room.shortId).includes(query)) ||
          room.areaName.toLowerCase().includes(query) ||
          room.parentAreaName.toLowerCase().includes(query)
        : true;

      return statusMatches && groupMatches && queryMatches;
    });

    const advanced = applyAdvancedFilters(baseFiltered, advancedFilters);
    const sorted = sortRoomsAdvanced(advanced, advancedFilters.sortBy, advancedFilters.sortDir);

    // 置頂房間優先排在最前（保持分組/列表內的相對排序）
    return [...sorted].sort((a, b) => {
      const aPinned = a.pinned ? 1 : 0;
      const bPinned = b.pinned ? 1 : 0;
      return bPinned - aPinned;
    });
  }, [rooms, selectedFilter, selectedGroupId, deferredSearchQuery, advancedFilters]);

  const filteredRoomsRef = useRef(filteredRooms);
  useEffect(() => {
    filteredRoomsRef.current = filteredRooms;
  }, [filteredRooms]);

  const liveRooms = useMemo(() => filteredRooms.filter((room) => room.status === "live"), [filteredRooms]);

  const enableAnimation = filteredRooms.length <= 30;

  const handleAddRoom = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!roomInput.trim()) {
        showToast("請輸入 BiliBili 直播房號或直播網址", "error");
        return;
      }

      setIsAdding(true);
      setActionError(null);

      try {
        await addRoom(roomInput, activeGroupId);
        setRoomInput("");
        await loadRooms({ quiet: true });
        showToast("成功新增直播間！", "success");
      } catch (error) {
        showToast((error as Error).message, "error");
      } finally {
        setIsAdding(false);
      }
    },
    [roomInput, activeGroupId, showToast, setActionError, loadRooms],
  );

  const handleCreateGroup = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!groupInput.trim()) {
        setActionError("請輸入分組名稱");
        return;
      }

      try {
        const group = await createGroup(groupInput);
        setGroupInput("");
        setSelectedGroupId(group.id);
        await loadRooms({ quiet: true });
      } catch (error) {
        setActionError((error as Error).message);
      }
    },
    [groupInput, setActionError, loadRooms],
  );

  const handleDeleteGroup = useCallback(
    async (groupId: string) => {
      setActionError(null);
      try {
        await deleteGroup(groupId);
        setSelectedGroupId("all");
        await loadRooms({ quiet: true });
      } catch (error) {
        setActionError((error as Error).message);
      }
    },
    [setActionError, loadRooms],
  );

  const handleRoomGroupChange = useCallback(
    async (roomId: number, groupId?: string) => {
      setActionError(null);
      setRooms((currentRooms) =>
        currentRooms.map((room) => (room.roomId === roomId ? { ...room, groupId: groupId || undefined } : room)),
      );

      try {
        await updateRoomGroup(roomId, groupId || undefined);
        await loadRooms({ quiet: true });
      } catch (error) {
        setActionError((error as Error).message);
        await loadRooms({ quiet: true });
      }
    },
    [loadRooms, setRooms, setActionError],
  );

  const handleDeleteRoom = useCallback(
    async (roomId: number) => {
      setActionError(null);
      const roomToDelete = roomsRef.current.find((r) => r.roomId === roomId);
      if (!roomToDelete) return;

      try {
        await deleteRoom(roomId);
        setPreviewRoomIds((current) => current.filter((id) => id !== roomId));
        setSelectedRoomIds((current) => {
          const next = new Set(current);
          next.delete(roomId);
          return next;
        });
        await loadRooms({ quiet: true });
        showToast(`已移除 ${roomToDelete.uname} 的直播間`, "info", {
          label: "復原",
          onClick: async () => {
            try {
              await addRoom(String(roomToDelete.roomId), roomToDelete.groupId);
              await loadRooms({ quiet: true });
              showToast("已成功復原直播間！", "success");
            } catch (err) {
              showToast(`復原失敗: ${(err as Error).message}`, "error");
            }
          },
        });
      } catch (error) {
        showToast(`移除失敗: ${(error as Error).message}`, "error");
      }
    },
    [loadRooms, showToast, roomsRef, setActionError],
  );

  const handleDropRoom = useCallback(
    async (targetRoomId: number) => {
      setDragOverRoomId(null);
      if (!draggingRoomId || draggingRoomId === targetRoomId) {
        setDraggingRoomId(null);
        return;
      }

      const orderedIds = moveRoomId(
        filteredRoomsRef.current.map((room) => room.roomId),
        draggingRoomId,
        targetRoomId,
      );
      setRooms((currentRooms) => applyVisibleOrder(currentRooms, orderedIds));
      setDraggingRoomId(null);

      try {
        await reorderRooms(orderedIds, activeGroupId);
        await loadRooms({ quiet: true });
      } catch (error) {
        setActionError((error as Error).message);
        await loadRooms({ quiet: true });
      }
    },
    [draggingRoomId, activeGroupId, loadRooms, setActionError],
  );

  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const settingsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (settingsDebounceRef.current) clearTimeout(settingsDebounceRef.current);
    };
  }, []);

  const handleSettingsChange = useCallback(
    (patch: Partial<AppSettings>) => {
      const nextSettings = { ...settingsRef.current, ...patch };
      setSettings(nextSettings);

      const isScaleChange = patch.cardScale !== undefined || patch.fontScale !== undefined;

      if (isScaleChange) {
        if (settingsDebounceRef.current) clearTimeout(settingsDebounceRef.current);
        settingsDebounceRef.current = setTimeout(() => {
          settingsDebounceRef.current = null;
          void saveSettings(patch).catch((error) => {
            setActionError((error as Error).message);
          });
        }, 300);
        return;
      }

      void saveSettings(patch)
        .then((savedSettings) => setSettings(savedSettings))
        .catch((error) => {
          setActionError((error as Error).message);
        });
    },
    [setSettings, setActionError],
  );

  const handleCycleTheme = useCallback(() => {
    const nextThemeMap: Record<"light" | "dark" | "auto", "light" | "dark" | "auto"> = {
      light: "dark",
      dark: "auto",
      auto: "light",
    };
    const next = nextThemeMap[settings.theme || "auto"];
    void handleSettingsChange({ theme: next });
    showToast(`已切換為：${next === "light" ? "明亮模式" : next === "dark" ? "暗黑模式" : "跟隨系統"}`, "info");
  }, [settings.theme, showToast, handleSettingsChange]);

  const handleDragStart = useCallback((event: DragEvent<HTMLElement>, roomId: number) => {
    if (isInteractiveDragTarget(event)) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    setDraggingRoomId(roomId);
  }, []);

  const handleDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const handleDragEnter = useCallback(
    (roomId: number) => {
      if (draggingRoomId && draggingRoomId !== roomId) {
        setDragOverRoomId(roomId);
      }
    },
    [draggingRoomId],
  );

  const handleDragLeave = useCallback((roomId: number) => {
    setDragOverRoomId((current) => (current === roomId ? null : current));
  }, []);

  const handleDrop = useCallback(
    (roomId: number) => {
      void handleDropRoom(roomId);
    },
    [handleDropRoom],
  );

  const handleTogglePreview = useCallback((roomId: number) => {
    setPreviewRoomIds((currentIds) =>
      currentIds.includes(roomId) ? currentIds.filter((id) => id !== roomId) : [...currentIds, roomId],
    );
  }, []);

  const handleRefresh = useCallback(
    async (roomId: number) => {
      try {
        const refreshed = await refreshRoom(roomId);
        setRooms((prev) => {
          const idx = prev.findIndex((r) => r.roomId === roomId);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = { ...prev[idx], ...refreshed } as LiveRoom;
            return next;
          }
          return prev;
        });
        showToast(`已強制刷新：${refreshed.uname}`, "success");
      } catch (error) {
        showToast(`刷新失敗：${(error as Error).message}`, "error");
      }
    },
    [showToast, setRooms],
  );

  const handlePopOut = useCallback(
    (roomId: number) => window.open(`https://live.bilibili.com/blanc/${roomId}?liteVersion=true`, "_blank", "width=800,height=450"),
    [],
  );

  const handleAdvancedChange = useCallback((patch: Partial<AdvancedFilters>) => {
    setAdvancedFilters((prev) => ({ ...prev, ...patch }));
  }, []);
  const handleClearAdvanced = useCallback(() => setAdvancedFilters(DEFAULT_ADVANCED_FILTERS), []);

  // 批次選擇邏輯
  const handleToggleSelectRoom = useCallback((roomId: number) => {
    setSelectedRoomIds((prev) => {
      const next = new Set(prev);
      if (next.has(roomId)) {
        next.delete(roomId);
      } else {
        next.add(roomId);
      }
      return next;
    });
  }, []);

  const handleSelectAllVisible = useCallback(() => {
    const allVisibleIds = filteredRooms.map((r) => r.roomId);
    const isAllSelected = allVisibleIds.length > 0 && allVisibleIds.every((id) => selectedRoomIds.has(id));

    if (isAllSelected) {
      setSelectedRoomIds(new Set());
    } else {
      setSelectedRoomIds(new Set(allVisibleIds));
    }
  }, [filteredRooms, selectedRoomIds]);

  const handleBatchDelete = useCallback(async () => {
    const ids = Array.from(selectedRoomIds);
    if (ids.length === 0) return;
    const confirmMessage = `確定要批次刪除選取的 ${ids.length} 個直播間嗎？`;
    if (!window.confirm(confirmMessage)) return;

    try {
      await batchDelete(ids);
      setSelectedRoomIds(new Set());
      showToast(`已成功批次刪除 ${ids.length} 個直播間`, "success");
    } catch (err) {
      showToast(`批次刪除失敗: ${(err as Error).message}`, "error");
    }
  }, [selectedRoomIds, batchDelete, showToast]);

  const handleBatchMove = useCallback(
    async (targetGroupId: string | null) => {
      const ids = Array.from(selectedRoomIds);
      if (ids.length === 0) return;

      try {
        await batchMove(ids, targetGroupId);
        setIsBatchMoveOpen(false);
        setSelectedRoomIds(new Set());
        const targetGroupName = targetGroupId ? groups.find((g) => g.id === targetGroupId)?.name ?? "分組" : "未分組";
        showToast(`已成功將 ${ids.length} 個直播間移動至「${targetGroupName}」`, "success");
      } catch (err) {
        showToast(`批次移動失敗: ${(err as Error).message}`, "error");
      }
    },
    [selectedRoomIds, batchMove, groups, showToast],
  );

  const renderRoom = (room: LiveRoom) => (
    <RoomCard
      key={room.roomId}
      room={room}
      groups={groups}
      searchQuery={deferredSearchQuery}
      isPreviewing={previewRoomIds.includes(room.roomId)}
      isDragging={draggingRoomId === room.roomId}
      isDragOver={dragOverRoomId === room.roomId}
      isBatchMode={isBatchMode}
      isSelected={selectedRoomIds.has(room.roomId)}
      enableAnimation={enableAnimation}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onTogglePreview={handleTogglePreview}
      onRefresh={handleRefresh}
      onDelete={handleDeleteRoom}
      onPopOut={handlePopOut}
      onGroupChange={handleRoomGroupChange}
      onToggleSelect={handleToggleSelectRoom}
      onUpdateFields={updateRoomFields}
    />
  );

  const gridVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.04,
      },
    },
  };

  const isAllVisibleSelected =
    filteredRooms.length > 0 && filteredRooms.every((r) => selectedRoomIds.has(r.roomId));

  return (
    <div className={`app-shell theme-${effectiveTheme} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`} style={appStyle}>
      <header className="app-header">
        <div className="brand">
          <button
            className="sidebar-toggle-btn"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? "展開側邊欄" : "收合側邊欄"}
            aria-label={sidebarCollapsed ? "展開側邊欄" : "收合側邊欄"}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
              {sidebarCollapsed ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h10M4 18h16" />
              )}
            </svg>
          </button>
          <span className="brand-mark">
            <TvIcon />
          </span>
          <span className="brand-name">BiliLive Watch</span>
        </div>

        <div className="header-status-capsule">
          <button
            type="button"
            className={`capsule-item ${selectedFilter === "all" ? "is-active" : ""}`}
            onClick={() => setSelectedFilter("all")}
            title="查看全部房間"
          >
            <span className="capsule-label">總數</span>
            <span className="capsule-val">{roomCounts.all}</span>
          </button>
          <button
            type="button"
            className={`capsule-item is-live ${selectedFilter === "live" ? "is-active" : ""}`}
            onClick={() => setSelectedFilter("live")}
            title="篩選直播中房間"
          >
            <span className="live-dot" />
            <span className="capsule-label">直播中</span>
            <span className="capsule-val">{roomCounts.live}</span>
          </button>
          <button
            type="button"
            className={`capsule-item ${selectedFilter === "offline" ? "is-active" : ""}`}
            onClick={() => setSelectedFilter("offline")}
            title="篩選未開播房間"
          >
            <span className="capsule-label">未開播</span>
            <span className="capsule-val">{roomCounts.offline}</span>
          </button>
          {roomCounts.error > 0 && (
            <button
              type="button"
              className={`capsule-item is-error ${selectedFilter === "error" ? "is-active" : ""}`}
              onClick={() => setSelectedFilter("error")}
              title="篩選錯誤房間"
            >
              <span className="capsule-label">錯誤</span>
              <span className="capsule-val">{roomCounts.error}</span>
            </button>
          )}
        </div>

        <div className="header-actions">
          <button
            className="icon-action-btn"
            type="button"
            onClick={handleCycleTheme}
            title={`目前模式：${settings.theme === "auto" ? "跟隨系統" : settings.theme === "dark" ? "暗黑" : "明亮"} (點擊切換)`}
            aria-label="切換外觀主題"
          >
            {settings.theme === "light" ? <SunIcon /> : settings.theme === "dark" ? <MoonIcon /> : <SystemThemeIcon />}
          </button>

          <button
            className="icon-action-btn"
            type="button"
            onClick={() => setIsShortcutsOpen(true)}
            title="快捷鍵說明 (?)"
            aria-label="快捷鍵說明"
          >
            <HelpCircleIcon />
          </button>

          <button
            className="button button-primary btn-refresh"
            type="button"
            onClick={() => void loadRooms({ quiet: true, refreshing: true })}
            disabled={isRefreshing}
            title="手動重新整理所有房間狀態 (R)"
          >
            <RefreshIcon className={isRefreshing ? "animate-spin" : ""} />
            <span>{isRefreshing ? "刷新中" : "全部刷新"}</span>
          </button>

          <span className="last-updated" title={`更新時間: ${lastFetchedAt || "無"}`}>
            {lastFetchedAt ? formatTime(lastFetchedAt) : "--:--:--"}
          </span>

          <span
            className={`health-dot ${actionError || !healthOk ? "is-error" : "is-ok"}`}
            title={actionError ? `伺服器異常: ${actionError}` : !healthOk ? "健康檢查失敗" : "連線正常"}
            aria-hidden="true"
          />
        </div>
      </header>

      <div className="workspace">
        <Sidebar
          roomInput={roomInput}
          setRoomInput={setRoomInput}
          isAdding={isAdding}
          onAddRoom={handleAddRoom}
          actionError={actionError}
          roomInputRef={roomInputRef}
          totalRoomCount={roomCounts.all}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          searchInputRef={searchInputRef}
          selectedFilter={selectedFilter}
          setSelectedFilter={setSelectedFilter}
          filters={filters}
          roomCounts={roomCounts}
          groupInput={groupInput}
          setGroupInput={setGroupInput}
          onCreateGroup={handleCreateGroup}
          selectedGroupId={selectedGroupId}
          setSelectedGroupId={setSelectedGroupId}
          groups={groups}
          groupCounts={groupCounts}
          onDeleteGroup={handleDeleteGroup}
          settings={settings}
          onSettingsChange={handleSettingsChange}
          onExport={triggerExport}
          onImport={triggerImport}
          onToast={showToast}
        />

        <main className="content">
          {isLoading ? (
            enableAnimation ? (
              <motion.div className="room-grid" variants={gridVariants} initial="hidden" animate="show">
                {Array.from({ length: 8 }).map((_, i) => (
                  <SkeletonCard key={i} />
                ))}
              </motion.div>
            ) : (
              <div className="room-grid">
                {Array.from({ length: 8 }).map((_, i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            )
          ) : filteredRooms.length > 0 ? (
            <>
              <div className="content-toolbar">
                <div className="toolbar-info">
                  <span className="current-group-badge">{getGroupLabel(selectedGroupId, groups)}</span>
                  <span className="rooms-count-hint">
                    {isBatchMode
                      ? `批次管理模式中 · 已選取 ${selectedRoomIds.size} 間`
                      : `共 ${filteredRooms.length} 個直播間 · 可拖曳卡片自訂排序`}
                  </span>
                </div>

                <div className="toolbar-actions">
                  {/* 批次管理開關 */}
                  <button
                    className={`button ${isBatchMode ? "button-primary" : "button-secondary"} btn-batch-toggle`}
                    type="button"
                    onClick={() => {
                      setIsBatchMode((prev) => {
                        if (prev) {
                          setSelectedRoomIds(new Set());
                          setIsBatchMoveOpen(false);
                        }
                        return !prev;
                      });
                    }}
                    title={isBatchMode ? "退出批次管理" : "進入批次管理模式"}
                  >
                    <LayersIcon />
                    <span>{isBatchMode ? "結束管理" : "批次管理"}</span>
                  </button>

                  <button
                    className={`button ${isMultiView ? "button-primary" : "button-secondary"} btn-multiview`}
                    type="button"
                    onClick={() => setIsMultiView(!isMultiView)}
                    disabled={liveRooms.length === 0}
                    title={liveRooms.length === 0 ? "目前沒有直播中的房間" : "開啟多房同屏即時監看"}
                  >
                    <TvIcon />
                    <span>多房同屏 ({liveRooms.length})</span>
                  </button>
                </div>
              </div>

              <Dashboard rooms={rooms} roomCounts={roomCounts} stats={stats} />
              <AdvancedFilterBar
                rooms={rooms}
                filters={advancedFilters}
                presets={settings.filterPresets}
                onChange={handleAdvancedChange}
                onClear={handleClearAdvanced}
                onSavePreset={async (preset) => {
                  const saved = await saveFilterPreset(preset);
                  showToast(`已成功儲存篩選預設集「${preset.name}」`, "success");
                  return saved;
                }}
                onApplyPreset={(preset) => {
                  setAdvancedFilters({
                    ...preset.filters,
                    sortBy: preset.sortBy as AdvancedFilters["sortBy"],
                    sortDir: preset.sortOrder as AdvancedFilters["sortDir"],
                  });
                  showToast(`已套用篩選預設集「${preset.name}」`, "info");
                }}
                onDeletePreset={async (presetId) => {
                  await deleteFilterPreset(presetId);
                  showToast("已刪除篩選預設集", "info");
                }}
              />

              {isMultiView ? (
                <div className="multi-view-container" ref={multiViewContainerRef}>
                  <div className="multi-view-toolbar">
                    <div className="multi-view-title-group">
                      <span className="multi-view-badge">多房同屏監看中</span>
                      <span className="multi-view-count">共 {liveRooms.length} 間正在直播</span>
                    </div>

                    <div className="multi-view-controls">
                      <div className="multiview-mode-group">
                        <button
                          className={`mode-btn ${multiViewGridMode === "auto" ? "is-active" : ""}`}
                          type="button"
                          onClick={() => setMultiViewGridMode("auto")}
                          title="自適應網格"
                        >
                          <LayoutAutoIcon />
                          <span>自適應</span>
                        </button>
                        <button
                          className={`mode-btn ${multiViewGridMode === "2x2" ? "is-active" : ""}`}
                          type="button"
                          onClick={() => setMultiViewGridMode("2x2")}
                          title="2 × 2 四宮格"
                        >
                          <Grid2x2Icon />
                          <span>2×2</span>
                        </button>
                        <button
                          className={`mode-btn ${multiViewGridMode === "3x3" ? "is-active" : ""}`}
                          type="button"
                          onClick={() => setMultiViewGridMode("3x3")}
                          title="3 × 3 九宮格"
                        >
                          <Grid3x3Icon />
                          <span>3×3</span>
                        </button>
                        <button
                          className={`mode-btn ${multiViewGridMode === "focus" ? "is-active" : ""}`}
                          type="button"
                          onClick={() => {
                            setMultiViewGridMode("focus");
                            if (!focusedRoomId && liveRooms.length > 0) {
                              setFocusedRoomId(liveRooms[0].roomId);
                            }
                          }}
                          title="聚焦主畫面模式"
                        >
                          <TvIcon />
                          <span>聚焦</span>
                        </button>
                      </div>

                      <button
                        className="button button-secondary icon-button"
                        type="button"
                        onClick={toggleFullscreen}
                        title={isFullscreen ? "退出全螢幕" : "進入全螢幕監看"}
                      >
                        {isFullscreen ? <MinimizeIcon /> : <MaximizeIcon />}
                      </button>

                      <button className="button button-secondary" type="button" onClick={() => setIsMultiView(false)}>
                        <XIcon />
                        <span>退出同屏</span>
                      </button>
                    </div>
                  </div>

                  {multiViewGridMode === "focus" && liveRooms.length > 0 ? (
                    <div className="multiview-focus-layout">
                      {(() => {
                        const mainRoom = liveRooms.find((r) => r.roomId === focusedRoomId) || liveRooms[0];
                        const subRooms = liveRooms.filter((r) => r.roomId !== mainRoom.roomId);

                        return (
                          <>
                            <div className="focus-main-cell">
                              <div className="multi-view-cell-header">
                                <div className="cell-header-left">
                                  <span className="live-indicator-pill">主畫面</span>
                                  <span className="multi-view-cell-title" title={`${mainRoom.uname} - ${mainRoom.title}`}>
                                    {mainRoom.uname}：{mainRoom.title}
                                  </span>
                                </div>
                                <a
                                  href={mainRoom.liveUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  title="開啟官方直播間"
                                  className="external-link"
                                >
                                  <ExternalIcon />
                                </a>
                              </div>
                              <LazyIframe
                                title={`${mainRoom.title} 直播預覽`}
                                src={`https://www.bilibili.com/blackboard/live/live-mobile-playerV3.html?roomId=${mainRoom.roomId}&danmaku=1`}
                              />
                            </div>

                            {subRooms.length > 0 && (
                              <div className="focus-sidebar-list">
                                {subRooms.map((room) => (
                                  <div
                                    key={room.roomId}
                                    className="focus-sub-card"
                                    onClick={() => setFocusedRoomId(room.roomId)}
                                    title="點擊設為主畫面"
                                  >
                                    <div className="focus-sub-header">
                                      <span className="sub-uname">{room.uname}</span>
                                      <span className="set-main-hint">設為主畫面</span>
                                    </div>
                                    <LazyIframe
                                      title={`${room.title} 直播預覽`}
                                      src={`https://www.bilibili.com/blackboard/live/live-mobile-playerV3.html?roomId=${room.roomId}&danmaku=1`}
                                    />
                                  </div>
                                ))}
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  ) : (
                    <div className={`multi-view-grid grid-mode-${multiViewGridMode}`}>
                      {liveRooms.map((room) => (
                        <div key={room.roomId} className="multi-view-cell">
                          <div className="multi-view-cell-header">
                            <div className="cell-header-left">
                              <span className="live-indicator-pill">LIVE</span>
                              <span className="multi-view-cell-title" title={`${room.uname} - ${room.title}`}>
                                {room.uname}：{room.title}
                              </span>
                            </div>
                            <a
                              href={room.liveUrl}
                              target="_blank"
                              rel="noreferrer"
                              title="開啟官方直播間"
                              className="external-link"
                            >
                              <ExternalIcon />
                            </a>
                          </div>
                          <LazyIframe
                            title={`${room.title} 直播預覽`}
                            src={`https://www.bilibili.com/blackboard/live/live-mobile-playerV3.html?roomId=${room.roomId}&danmaku=1`}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <motion.div
                  className="room-grid"
                  variants={enableAnimation ? gridVariants : undefined}
                  initial={enableAnimation ? "hidden" : undefined}
                  animate={enableAnimation ? "show" : undefined}
                >
                  <AnimatePresence mode={enableAnimation ? "popLayout" : undefined}>
                    {(() => {
                      if (selectedGroupId === "all") {
                        const elements: React.ReactNode[] = [];
                        groups.forEach((group) => {
                          const groupRooms = filteredRooms.filter((r) => r.groupId === group.id);
                          if (groupRooms.length > 0) {
                            elements.push(
                              <motion.div
                                key={`header-${group.id}`}
                                className="group-header"
                                layout={enableAnimation ? true : undefined}
                                initial={enableAnimation ? { opacity: 0 } : undefined}
                                animate={enableAnimation ? { opacity: 1 } : undefined}
                                exit={enableAnimation ? { opacity: 0 } : undefined}
                              >
                                <h3>{group.name}</h3>
                                <span className="group-count">({groupRooms.length})</span>
                                <div className="group-divider" />
                              </motion.div>,
                            );
                            elements.push(...groupRooms.map(renderRoom));
                          }
                        });
                        const ungrouped = filteredRooms.filter((r) => !r.groupId);
                        if (ungrouped.length > 0) {
                          elements.push(
                            <motion.div
                              key="header-ungrouped"
                              className="group-header"
                              layout={enableAnimation ? true : undefined}
                              initial={enableAnimation ? { opacity: 0 } : undefined}
                              animate={enableAnimation ? { opacity: 1 } : undefined}
                              exit={enableAnimation ? { opacity: 0 } : undefined}
                            >
                              <h3>未分組</h3>
                              <span className="group-count">({ungrouped.length})</span>
                              <div className="group-divider" />
                            </motion.div>,
                          );
                          elements.push(...ungrouped.map(renderRoom));
                        }
                        return elements;
                      }
                      return filteredRooms.map(renderRoom);
                    })()}
                  </AnimatePresence>
                </motion.div>
              )}
            </>
          ) : (
            <EmptyState
              selectedFilter={selectedFilter}
              searchQuery={deferredSearchQuery}
              onClearSearch={() => setSearchQuery("")}
              onResetFilter={() => setSelectedFilter("all")}
            />
          )}
        </main>
      </div>

      {/* 批次管理多選浮動操作列 (Bottom Floating Dock) */}
      <AnimatePresence>
        {isBatchMode && (
          <motion.div
            className="batch-dock-container"
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.95 }}
            transition={{ type: "spring" as const, stiffness: 280, damping: 26 }}
          >
            <div className="batch-dock">
              <div className="batch-dock-info">
                <button
                  type="button"
                  className="batch-select-all-btn"
                  onClick={handleSelectAllVisible}
                  title={isAllVisibleSelected ? "取消全選" : "全選當前顯示房間"}
                >
                  {isAllVisibleSelected ? <CheckSquareIcon /> : <SquareIcon />}
                  <span>{isAllVisibleSelected ? "取消全選" : "全選"}</span>
                </button>
                <span className="batch-dock-count-badge">
                  已選取 <strong>{selectedRoomIds.size}</strong> 個房間
                </span>
              </div>

              <div className="batch-dock-actions">
                {/* 批次移動分組 */}
                <div className="batch-group-dropdown-wrapper" ref={batchMoveMenuRef}>
                  <button
                    className="button button-secondary btn-batch-action"
                    type="button"
                    disabled={selectedRoomIds.size === 0}
                    onClick={() => setIsBatchMoveOpen((prev) => !prev)}
                    title="將選取的房間移動至指定分組"
                  >
                    <FolderIcon />
                    <span>移動至分組</span>
                  </button>

                  <AnimatePresence>
                    {isBatchMoveOpen && (
                      <motion.div
                        className="batch-group-popover"
                        initial={{ opacity: 0, scale: 0.95, y: 8 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 8 }}
                        transition={{ duration: 0.15 }}
                      >
                        <button
                          className="batch-group-item"
                          type="button"
                          onClick={() => handleBatchMove(null)}
                        >
                          <span>未分組</span>
                        </button>
                        {groups.map((group) => (
                          <button
                            key={group.id}
                            className="batch-group-item"
                            type="button"
                            onClick={() => handleBatchMove(group.id)}
                          >
                            <span>{group.name}</span>
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* 批次刪除 */}
                <button
                  className="button button-secondary btn-batch-danger"
                  type="button"
                  disabled={selectedRoomIds.size === 0}
                  onClick={handleBatchDelete}
                  title="批次刪除選取的房間"
                >
                  <TrashIcon />
                  <span>批次刪除</span>
                </button>

                {/* 退出批次 */}
                <button
                  className="button button-secondary btn-batch-exit"
                  type="button"
                  onClick={() => {
                    setIsBatchMode(false);
                    setSelectedRoomIds(new Set());
                    setIsBatchMoveOpen(false);
                  }}
                  title="退出批次管理模式 (Esc)"
                >
                  <XIcon />
                  <span>退出</span>
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="toast-container">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: 50, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className={`toast toast-${toast.type}`}
            >
              <span className="toast-message">{toast.message}</span>
              {toast.action && (
                <button
                  className="toast-action"
                  type="button"
                  onClick={() => {
                    toast.action?.onClick();
                    dismissToast(toast.id);
                  }}
                >
                  {toast.action.label}
                </button>
              )}
              <button className="toast-close" type="button" onClick={() => dismissToast(toast.id)} aria-label="關閉提示">
                &times;
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <AnimatePresence>{isShortcutsOpen && <ShortcutsPanel onClose={() => setIsShortcutsOpen(false)} />}</AnimatePresence>
    </div>
  );
}

function moveRoomId(roomIds: number[], draggedRoomId: number, targetRoomId: number) {
  const nextRoomIds = roomIds.filter((roomId) => roomId !== draggedRoomId);
  const targetIndex = nextRoomIds.indexOf(targetRoomId);
  nextRoomIds.splice(targetIndex >= 0 ? targetIndex : nextRoomIds.length, 0, draggedRoomId);
  return nextRoomIds;
}

function applyVisibleOrder(rooms: LiveRoom[], orderedIds: number[]) {
  const minOrder = rooms
    .filter((room) => orderedIds.includes(room.roomId))
    .reduce((minimum, room) => Math.min(minimum, room.order), Number.MAX_SAFE_INTEGER);
  const startOrder = Number.isFinite(minOrder) ? minOrder : 0;
  const orderMap = new Map(orderedIds.map((roomId, index) => [roomId, startOrder + index]));

  return rooms
    .map((room) => (orderMap.has(room.roomId) ? { ...room, order: orderMap.get(room.roomId)! } : room))
    .sort((a, b) => a.order - b.order || a.addedAt.localeCompare(b.addedAt));
}

function isInteractiveDragTarget(event: DragEvent<HTMLElement>) {
  return Boolean((event.target as HTMLElement).closest("button, a, input, select, textarea, .card-dropdown-menu, .batch-dock, .room-note-editor"));
}

function getGroupLabel(selectedGroupId: GroupFilterKey, groups: RoomGroup[]) {
  if (selectedGroupId === "all") {
    return "全部分組";
  }
  if (selectedGroupId === "ungrouped") {
    return "未分組";
  }
  return groups.find((group) => group.id === selectedGroupId)?.name ?? "分組";
}

function formatTime(value: string) {
  if (!value) {
    return "--:--:--";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--:--:--";
  }

  return new Intl.DateTimeFormat("zh-Hant", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function updateFavicon(isAnyLive: boolean) {
  const favicon = (document.querySelector("link[rel*='icon']") as HTMLLinkElement) || document.createElement("link");
  favicon.type = "image/x-icon";
  favicon.rel = "shortcut icon";

  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const x = 4;
  const y = 6;
  const width = 24;
  const height = 18;
  const radius = 5;
  ctx.fillStyle = "#1587f2";
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "#1587f2";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(10, 2);
  ctx.lineTo(16, 6);
  ctx.moveTo(22, 2);
  ctx.lineTo(16, 6);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(12, 28);
  ctx.lineTo(20, 28);
  ctx.moveTo(16, 24);
  ctx.lineTo(16, 28);
  ctx.stroke();

  if (isAnyLive) {
    ctx.fillStyle = "#f44773";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(25, 7, 5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  }

  favicon.href = canvas.toDataURL("image/png");
  if (!document.head.contains(favicon)) {
    document.head.appendChild(favicon);
  }
}
