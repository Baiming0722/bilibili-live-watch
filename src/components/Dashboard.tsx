import React, { useMemo, useState } from "react";
import type { LiveRoom, LiveSession } from "../types";

interface DashboardStats {
  liveDuration?: Record<string, number>;
  lastLiveAt?: Record<string, string>;
  lastCalculatedAt?: string;
  history?: Record<string, LiveSession[]>;
}

interface DashboardProps {
  rooms: LiveRoom[];
  roomCounts: Record<string, number>;
  stats?: DashboardStats | null;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function formatTimeOnly(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return "--:--";
    return d.toLocaleTimeString("zh-Hant", { hour: "2-digit", minute: "2-digit", hour12: false });
  } catch {
    return "--:--";
  }
}

function formatDateShort(date: Date): string {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return `${m}/${d}`;
}

export const Dashboard = React.memo(function Dashboard({ rooms, roomCounts, stats }: DashboardProps) {
  const [isOpen, setIsOpen] = useState(false);

  const total = roomCounts.all ?? rooms.length;
  const live = roomCounts.live ?? 0;
  const offline = roomCounts.offline ?? 0;
  const err = roomCounts.error ?? 0;
  const round = roomCounts.round ?? 0;
  const liveRate = total > 0 ? Math.round((live / total) * 100) : 0;

  const onlineTop5 = useMemo(() => {
    if (!isOpen) return [] as LiveRoom[];
    return [...rooms].sort((a, b) => b.online - a.online).slice(0, 5);
  }, [rooms, isOpen]);

  const attentionTop5 = useMemo(() => {
    if (!isOpen) return [] as LiveRoom[];
    return [...rooms].sort((a, b) => b.attention - a.attention).slice(0, 5);
  }, [rooms, isOpen]);

  const durationTop5 = useMemo(() => {
    if (!isOpen) return [] as { room: LiveRoom; duration: number }[];
    const map = stats?.liveDuration ?? {};
    return [...rooms]
      .map((r) => ({ room: r, duration: Number(map[String(r.roomId)] ?? 0) }))
      .filter((x) => x.duration > 0)
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 5);
  }, [rooms, stats, isOpen]);

  const areaTop5 = useMemo(() => {
    if (!isOpen) return [] as [string, number][];
    const counter = new Map<string, number>();
    for (const r of rooms) {
      const key = r.areaName || "未分類";
      counter.set(key, (counter.get(key) ?? 0) + 1);
    }
    return Array.from(counter.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [rooms, isOpen]);

  const maxAreaCount = areaTop5[0]?.[1] ?? 1;

  // 今日開播紀錄時間線 (Timeline)
  const todayTimeline = useMemo(() => {
    if (!isOpen) return [];
    const historyMap = stats?.history ?? {};
    const roomMap = new Map<number, LiveRoom>();
    for (const r of rooms) roomMap.set(r.roomId, r);

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    const items: Array<{
      roomId: number;
      uname: string;
      title: string;
      startedAt: string;
      endedAt?: string;
      isCurrentLive: boolean;
      durationText: string;
    }> = [];

    for (const [roomIdStr, sessions] of Object.entries(historyMap)) {
      const roomId = Number(roomIdStr);
      const room = roomMap.get(roomId);
      if (!Array.isArray(sessions)) continue;

      for (const sess of sessions) {
        if (!sess?.startedAt) continue;
        const startTime = new Date(sess.startedAt).getTime();
        // 如果是在今天開始，或是在今天結束，或是目前正在直播
        const endTime = sess.endedAt ? new Date(sess.endedAt).getTime() : Date.now();
        if (endTime >= startOfToday) {
          const isCurrent = !sess.endedAt && room?.status === "live";
          const durSec = Math.max(0, Math.floor((endTime - startTime) / 1000));
          items.push({
            roomId,
            uname: room?.uname ?? `房號 ${roomId}`,
            title: room?.title ?? "",
            startedAt: sess.startedAt,
            endedAt: sess.endedAt,
            isCurrentLive: isCurrent,
            durationText: formatDuration(durSec),
          });
        }
      }
    }

    return items.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()).slice(0, 10);
  }, [rooms, stats?.history, isOpen]);

  // 7 日開播趨勢圖 (7-Day Trend)
  const trend7Days = useMemo(() => {
    if (!isOpen) return [];
    const historyMap = stats?.history ?? {};
    const days: Array<{ dateStr: string; label: string; count: number; durationSeconds: number }> = [];

    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const startOfDay = d.getTime();
      const endOfDay = startOfDay + 24 * 60 * 60 * 1000;

      let count = 0;
      let totalDuration = 0;

      for (const sessions of Object.values(historyMap)) {
        if (!Array.isArray(sessions)) continue;
        for (const s of sessions) {
          if (!s?.startedAt) continue;
          const sTime = new Date(s.startedAt).getTime();
          if (sTime >= startOfDay && sTime < endOfDay) {
            count++;
            const eTime = s.endedAt ? new Date(s.endedAt).getTime() : Math.min(Date.now(), endOfDay);
            totalDuration += Math.max(0, Math.floor((eTime - sTime) / 1000));
          }
        }
      }

      days.push({
        dateStr: d.toISOString().slice(0, 10),
        label: i === 0 ? "今日" : formatDateShort(d),
        count,
        durationSeconds: totalDuration,
      });
    }

    return days;
  }, [stats?.history, isOpen]);

  const maxTrendCount = useMemo(() => {
    return Math.max(...trend7Days.map((d) => d.count), 1);
  }, [trend7Days]);

  return (
    <section className="dashboard-panel">
      <button className="dashboard-toggle" type="button" onClick={() => setIsOpen((v) => !v)} aria-expanded={isOpen}>
        <span className="dashboard-toggle-title">📊 統計儀表板</span>
        <span className="dashboard-toggle-hint">{isOpen ? "點擊收合" : "點擊展開"}</span>
        <span className={`dashboard-chevron ${isOpen ? "is-open" : ""}`}>▾</span>
      </button>
      {isOpen && (
        <div className="dashboard-content">
          {/* 總覽卡片 */}
          <div className="dashboard-overview">
            {[
              { label: "總數", value: total, accent: "var(--accent)" },
              { label: "直播中", value: live, accent: "var(--pink)" },
              { label: "未開播", value: offline, accent: "#64748b" },
              { label: "異常", value: err, accent: "var(--danger)" },
              { label: "輪播", value: round, accent: "#f59e0b" },
            ].map((card) => (
              <div key={card.label} className="dashboard-card" style={{ borderLeftColor: card.accent }}>
                <span className="dashboard-card-label">{card.label}</span>
                <strong className="dashboard-card-value">{card.value}</strong>
              </div>
            ))}
          </div>

          {/* 開播率比例條 */}
          <div className="dashboard-rate">
            <div className="dashboard-rate-header">
              <span>開播率</span>
              <strong>{liveRate}%</strong>
            </div>
            <div className="dashboard-rate-bar">
              <div className="dashboard-rate-fill" style={{ width: `${liveRate}%` }} />
            </div>
            <span className="dashboard-rate-desc">
              {live} / {total} 間直播中
            </span>
          </div>

          {/* 7 日趨勢與今日時間線 */}
          <div className="dashboard-insights-grid">
            {/* 7 日趨勢圖 */}
            <div className="dashboard-section dashboard-trend-section">
              <h4>📈 過去 7 日開播場次趨勢</h4>
              <div className="dashboard-trend-chart">
                {trend7Days.map((day) => {
                  const heightPercent = Math.max(8, Math.round((day.count / maxTrendCount) * 100));
                  return (
                    <div key={day.dateStr} className="trend-bar-col" title={`${day.dateStr}: ${day.count} 次開播 (累計 ${formatDuration(day.durationSeconds)})`}>
                      <span className="trend-bar-val">{day.count}</span>
                      <div className="trend-bar-track">
                        <div className="trend-bar-fill" style={{ height: `${heightPercent}%` }} />
                      </div>
                      <span className="trend-bar-label">{day.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 今日開播時間線 */}
            <div className="dashboard-section dashboard-timeline-section">
              <h4>🕒 今日開播動態時間線</h4>
              {todayTimeline.length === 0 ? (
                <span className="dashboard-empty">今日尚無開播動態紀錄</span>
              ) : (
                <div className="dashboard-timeline">
                  {todayTimeline.map((item, idx) => (
                    <div key={`${item.roomId}-${item.startedAt}-${idx}`} className="timeline-item">
                      <span className={`timeline-dot ${item.isCurrentLive ? "is-live" : ""}`} />
                      <div className="timeline-body">
                        <div className="timeline-header">
                          <span className="timeline-name" title={item.uname}>{item.uname}</span>
                          <span className="timeline-time">
                            {formatTimeOnly(item.startedAt)}
                            {item.endedAt ? ` ~ ${formatTimeOnly(item.endedAt)}` : item.isCurrentLive ? " ~ 直播中" : ""}
                          </span>
                        </div>
                        {item.title && <div className="timeline-title" title={item.title}>{item.title}</div>}
                        <div className="timeline-meta">
                          <span className="timeline-duration">時長：{item.durationText}</span>
                          {item.isCurrentLive && <span className="timeline-badge-live">LIVE</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="dashboard-grid">
            {/* 人氣 Top5 */}
            <div className="dashboard-section">
              <h4>🔥 人氣 Top5（線上）</h4>
              {onlineTop5.length === 0 ? (
                <span className="dashboard-empty">暫無資料</span>
              ) : (
                <ol className="dashboard-rank">
                  {onlineTop5.map((r) => (
                    <li key={r.roomId}>
                      <span className="rank-name" title={`${r.uname} - ${r.title}`}>{r.uname}</span>
                      <span className="rank-value">{r.online.toLocaleString("zh-Hant")}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div className="dashboard-section">
              <h4>💖 關注 Top5</h4>
              {attentionTop5.length === 0 ? (
                <span className="dashboard-empty">暫無資料</span>
              ) : (
                <ol className="dashboard-rank">
                  {attentionTop5.map((r) => (
                    <li key={r.roomId}>
                      <span className="rank-name" title={`${r.uname} - ${r.title}`}>{r.uname}</span>
                      <span className="rank-value">{r.attention.toLocaleString("zh-Hant")}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div className="dashboard-section">
              <h4>⏱️ 累計時長 Top5</h4>
              {durationTop5.length === 0 ? (
                <span className="dashboard-empty">尚無直播時長累計（需直播後滿 60 秒統計）</span>
              ) : (
                <ol className="dashboard-rank">
                  {durationTop5.map(({ room, duration }) => (
                    <li key={room.roomId}>
                      <span className="rank-name" title={`${room.uname} - ${room.title}`}>{room.uname}</span>
                      <span className="rank-value">{formatDuration(duration)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div className="dashboard-section">
              <h4>🗂️ 分區分布 Top5</h4>
              {areaTop5.length === 0 ? (
                <span className="dashboard-empty">暫無資料</span>
              ) : (
                <ul className="dashboard-area">
                  {areaTop5.map(([area, count]) => (
                    <li key={area}>
                      <span className="area-name">{area}</span>
                      <div className="area-bar">
                        <div className="area-bar-fill" style={{ width: `${Math.round((count / maxAreaCount) * 100)}%` }} />
                      </div>
                      <span className="area-count">{count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
});
