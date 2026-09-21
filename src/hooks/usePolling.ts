import { useEffect, useRef } from "react";

interface UsePollingOptions {
  loadRooms: (options?: { quiet?: boolean; signal?: AbortSignal }) => Promise<void>;
  refreshInterval: number;
  paused?: boolean;
}

/**
 * 輪詢邏輯：透過 ref 追蹤 refreshInterval，避免 loadRooms 因 interval 變動而重建。
 * 同時實作 visibilitychange 節流：hidden 時暫停輪詢，visible 時立即重拉並重啟計時器。
 * 支援 paused 模式（如 SSE 連線成功時暫停輪詢）。
 */
export function usePolling({ loadRooms, refreshInterval, paused = false }: UsePollingOptions) {
  const intervalRef = useRef(refreshInterval);
  const loadRoomsRef = useRef(loadRooms);
  const pausedRef = useRef(paused);

  useEffect(() => {
    intervalRef.current = refreshInterval;
  }, [refreshInterval]);

  useEffect(() => {
    loadRoomsRef.current = loadRooms;
  }, [loadRooms]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    if (paused) return;

    const controller = new AbortController();
    void loadRoomsRef.current({ signal: controller.signal });

    let timer: number | undefined;

    const startPolling = () => {
      if (timer !== undefined) window.clearInterval(timer);
      if (pausedRef.current) return;
      const ms = (intervalRef.current || 60) * 1000;
      timer = window.setInterval(() => {
        if (!document.hidden && !pausedRef.current) {
          void loadRoomsRef.current({ quiet: true });
        }
      }, ms);
    };

    const stopPolling = () => {
      if (timer !== undefined) {
        window.clearInterval(timer);
        timer = undefined;
      }
    };

    startPolling();

    const handleVisibilityChange = () => {
      if (pausedRef.current) return;
      if (document.hidden) {
        stopPolling();
      } else {
        // 回到可見時立即刷新一次並重啟輪詢
        void loadRoomsRef.current({ quiet: true });
        startPolling();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      controller.abort();
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [paused]);
}
