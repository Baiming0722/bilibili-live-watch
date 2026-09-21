import type { AddRoomResponse, AppSettings, LiveRoom, RoomGroup, RoomsResponse } from "./types";

export async function fetchRooms(signal?: AbortSignal): Promise<RoomsResponse> {
  const response = await fetch("/api/rooms", { signal });
  return readJsonResponse<RoomsResponse>(response);
}

export async function addRoom(roomInput: string, groupId?: string): Promise<AddRoomResponse> {
  const response = await fetch("/api/rooms", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ roomInput, groupId })
  });
  return readJsonResponse<AddRoomResponse>(response);
}

export async function deleteRoom(roomId: number): Promise<void> {
  const response = await fetch(`/api/rooms/${roomId}`, { method: "DELETE" });
  await readJsonResponse(response);
}

export async function patchRoom(
  roomId: number,
  fields: { groupId?: string | null; note?: string; pinned?: boolean; notify?: boolean },
): Promise<void> {
  const response = await fetch(`/api/rooms/${roomId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  await readJsonResponse(response);
}

/** 相容別名：僅更新分組，內部委派給 patchRoom */
export async function updateRoomGroup(roomId: number, groupId?: string): Promise<void> {
  await patchRoom(roomId, { groupId: groupId ?? null });
}

export async function reorderRooms(roomIds: number[], groupId?: string): Promise<void> {
  const response = await fetch("/api/rooms/order", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ roomIds, groupId })
  });
  await readJsonResponse(response);
}

export async function createGroup(name: string): Promise<RoomGroup> {
  const response = await fetch("/api/groups", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name })
  });
  const payload = await readJsonResponse<{ group: RoomGroup }>(response);
  return payload.group;
}

export async function deleteGroup(groupId: string): Promise<void> {
  const response = await fetch(`/api/groups/${groupId}`, { method: "DELETE" });
  await readJsonResponse(response);
}

export async function saveSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  const response = await fetch("/api/settings", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ settings })
  });
  const payload = await readJsonResponse<{ settings: AppSettings }>(response);
  return payload.settings;
}

export async function refreshRoom(roomId: number): Promise<import("./types").LiveRoom> {
  const response = await fetch(`/api/rooms/${roomId}/refresh`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
  });
  const payload = await readJsonResponse<{ room: import("./types").LiveRoom }>(response);
  return payload.room;
}

export async function batchDeleteRooms(roomIds: number[]): Promise<{ deleted: number }> {
  const response = await fetch("/api/rooms/batch-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomIds }),
  });
  return readJsonResponse<{ deleted: number }>(response);
}

export async function batchMoveRooms(roomIds: number[], groupId: string | null): Promise<{ moved: number }> {
  const response = await fetch("/api/rooms/batch-move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomIds, groupId }),
  });
  return readJsonResponse<{ moved: number }>(response);
}

export async function exportData(): Promise<Blob> {
  const response = await fetch("/api/export");
  if (!response.ok) {
    throw new Error(`匯出失敗: ${response.status}`);
  }
  return response.blob();
}

export async function importData(
  data: unknown,
  mode: "merge" | "replace",
): Promise<{ roomsAdded: number; groupsAdded: number; roomsTotal: number; groupsTotal: number }> {
  const response = await fetch("/api/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data, mode }),
  });
  return readJsonResponse(response);
}

export async function fetchHealth(): Promise<{ status: string; uptime: number; roomsCount: number }> {
  const response = await fetch("/api/health");
  return readJsonResponse(response);
}

async function readJsonResponse<T = unknown>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message = payload?.error?.message ?? `API request failed: ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}
