import type { AdvancedFilters } from "./utils/filterPipeline";

export type RoomStatus = "live" | "offline" | "round" | "locked" | "hidden" | "error" | "unknown";

export interface LiveRoom {
  roomId: number;
  shortId?: number;
  groupId?: string;
  order: number;
  uid?: number;
  title: string;
  uname: string;
  cover: string;
  face?: string;
  online: number;
  attention: number;
  areaName: string;
  parentAreaName: string;
  liveUrl: string;
  liveTime: string;
  status: RoomStatus;
  statusLabel: string;
  addedAt: string;
  lastFetchedAt: string;
  error?: string;
  note?: string;
  pinned?: boolean;
  notify?: boolean;
}

export interface RoomGroup {
  id: string;
  name: string;
  order: number;
  createdAt: string;
}

export interface LiveSession {
  startedAt: string;
  endedAt?: string;
}

export interface FilterPreset {
  id: string;
  name: string;
  filters: AdvancedFilters;
  sortBy: string;
  sortOrder: "asc" | "desc";
  createdAt: string;
}

export interface AppSettings {
  theme: "light" | "dark" | "auto";
  cardScale: number;
  fontScale: number;
  fontFamily: string;
  refreshInterval: number;
  accentColor: string;
  notifyOnLive: boolean;
  soundEnabled: boolean;
  soundVolume: number;
  accentCustom: string | null;
  density: "compact" | "standard" | "comfortable";
  filterPresets: FilterPreset[];
}

export interface RoomsResponse {
  rooms: LiveRoom[];
  groups: RoomGroup[];
  settings: AppSettings;
  fetchedAt: string;
  stats?: {
    liveDuration: Record<string, number>;
    lastLiveAt: Record<string, string>;
    lastCalculatedAt?: string;
    history?: Record<string, LiveSession[]>;
  };
}

export interface AddRoomResponse {
  room: LiveRoom;
  created: boolean;
}
