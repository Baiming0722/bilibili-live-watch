import { useEffect, useRef, useState } from "react";
import type { RoomsResponse } from "../types";

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 3000;

/**
 * SSE 客戶端 Hook：連線 /api/events，接收即時房間資料推送。
 * 斷線自動重連（最多 5 次），超過後放棄並 warn。
 */
export function useEventStream(
  onMessage: (data: RoomsResponse) => void,
  enabled: boolean,
): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const onMessageRef = useRef(onMessage);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      return;
    }

    let eventSource: EventSource | null = null;
    let retryCount = 0;
    let retryTimer: number | undefined;
    let disposed = false;

    const connect = () => {
      if (disposed) return;

      eventSource = new EventSource("/api/events");

      eventSource.onopen = () => {
        if (disposed) return;
        retryCount = 0;
        setConnected(true);
      };

      eventSource.addEventListener("rooms", (event: MessageEvent) => {
        if (disposed) return;
        try {
          const parsed = JSON.parse(event.data) as RoomsResponse;
          onMessageRef.current(parsed);
        } catch {
          /* 資料解析失敗，忽略此筆 */
        }
      });

      eventSource.onerror = () => {
        if (disposed) return;
        eventSource?.close();
        eventSource = null;
        setConnected(false);

        if (retryCount < MAX_RETRIES) {
          retryCount += 1;
          retryTimer = window.setTimeout(connect, RETRY_DELAY_MS);
        } else {
          console.warn("[useEventStream] 已達最大重連次數，放棄 SSE 連線");
        }
      };
    };

    connect();

    return () => {
      disposed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      eventSource?.close();
      eventSource = null;
      setConnected(false);
    };
  }, [enabled]);

  return { connected };
}
