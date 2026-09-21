import type { LiveRoom } from "../types";

// ─── 通知權限 ───────────────────────────────────────────────

/** 請求瀏覽器通知權限，若尚未決定則觸發 requestPermission */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!("Notification" in window)) return "denied";
  if (Notification.permission !== "default") return Notification.permission;
  return Notification.requestPermission();
}

// ─── 開播通知 ───────────────────────────────────────────────

/** 發送開播桌面通知，tag 防重複 */
export function showLiveNotification(room: LiveRoom): void {
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const notification = new Notification(`${room.uname} 開播了！`, {
    body: room.title,
    icon: room.face || room.cover,
    tag: `live-${room.roomId}`,
  });

  notification.onclick = () => {
    window.focus();
    window.dispatchEvent(
      new CustomEvent("bililive-focus-room", { detail: { roomId: room.roomId } }),
    );
  };
}

// ─── 提示音 ─────────────────────────────────────────────────

/** 模組層級懶建立 AudioContext */
let audioCtx: AudioContext | null = null;

/** 用 WebAudio 合成短促提示音（440→880Hz，200ms exponential ramp） */
export function playChime(volume: number): void {
  const clampedVolume = Math.max(0, Math.min(1, volume));
  if (clampedVolume === 0) return;

  if (!audioCtx) {
    audioCtx = new AudioContext();
  }

  const triggerSound = (ctx: AudioContext) => {
    const now = ctx.currentTime;
    const duration = 0.2;

    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(440, now);
    oscillator.frequency.exponentialRampToValueAtTime(880, now + duration);

    gainNode.gain.setValueAtTime(clampedVolume, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.start(now);
    oscillator.stop(now + duration);
  };

  // 瀏覽器可能因尚未互動而 suspend AudioContext
  if (audioCtx.state === "suspended") {
    audioCtx.resume().then(() => {
      if (audioCtx) triggerSound(audioCtx);
    }).catch(() => {
      /* 靜默跳過：使用者尚未互動，無法播放 */
    });
    return;
  }

  triggerSound(audioCtx);
}

// ─── 狀態轉換偵測 ─────────────────────────────────────────

export interface LiveTransitions {
  wentLive: LiveRoom[];
  wentOffline: LiveRoom[];
}

/**
 * 比對前後兩次房間列表，偵測開播/下播的轉換。
 * 新房間（不存在於 prevRooms 中）不算 wentLive，避免首次新增即觸發通知。
 */
export function computeLiveTransitions(
  prevRooms: LiveRoom[],
  nextRooms: LiveRoom[],
): LiveTransitions {
  const prevMap = new Map<number, LiveRoom>();
  for (const room of prevRooms) prevMap.set(room.roomId, room);

  const wentLive: LiveRoom[] = [];
  const wentOffline: LiveRoom[] = [];

  for (const next of nextRooms) {
    const prev = prevMap.get(next.roomId);
    if (!prev) continue; // 新房間不觸發通知

    if (next.status === "live" && prev.status !== "live") {
      wentLive.push(next);
    } else if (next.status !== "live" && prev.status === "live") {
      wentOffline.push(next);
    }
  }

  return { wentLive, wentOffline };
}
