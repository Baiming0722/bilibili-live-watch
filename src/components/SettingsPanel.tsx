import React, { useState, useRef, useEffect } from "react";
import type { AppSettings } from "../types";
import { playChime, requestNotificationPermission } from "../utils/notify";

interface SettingsPanelProps {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  onExport?: () => Promise<void>;
  onImport?: (data: unknown, mode: "merge" | "replace") => Promise<any>;
  onToast?: (message: string, type?: "success" | "error" | "info") => void;
}

const PRESET_ACCENTS = [
  { id: "blue", label: "科技藍", color: "#1587f2" },
  { id: "pink", label: "櫻花粉", color: "#f44773" },
  { id: "purple", label: "電競紫", color: "#a855f7" },
  { id: "green", label: "翡翠綠", color: "#10b981" },
  { id: "orange", label: "活力橘", color: "#f97316" },
];

export const SettingsPanel = React.memo(function SettingsPanel({
  settings,
  onChange,
  onExport,
  onImport,
  onToast,
}: SettingsPanelProps) {
  const [localFonts, setLocalFonts] = useState<string[]>([]);
  const [isLoadingFonts, setIsLoadingFonts] = useState(false);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | "unsupported">(
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported"
  );

  // 匯入模式選擇 Modal
  const [pendingImportData, setPendingImportData] = useState<any | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setNotifPermission(Notification.permission);
    }
  }, []);

  const handleToggleNotification = async () => {
    if (!("Notification" in window)) {
      onToast?.("您的瀏覽器不支援桌面通知功能", "error");
      return;
    }

    if (Notification.permission === "denied") {
      onToast?.("桌面通知權限已被瀏覽器封鎖，請至瀏覽器設定中允許通知", "error");
      return;
    }

    if (!settings.notifyOnLive && Notification.permission === "default") {
      const perm = await requestNotificationPermission();
      setNotifPermission(perm);
      if (perm === "granted") {
        onChange({ notifyOnLive: true });
        onToast?.("已成功開啟開播桌面通知", "success");
      } else if (perm === "denied") {
        onToast?.("您已拒絕通知權限，無法開啟開播提醒", "error");
      }
      return;
    }

    const nextState = !settings.notifyOnLive;
    onChange({ notifyOnLive: nextState });
    onToast?.(nextState ? "已開啟開播桌面通知" : "已關閉開播桌面通知", "info");
  };

  const handleToggleSound = () => {
    const nextState = !settings.soundEnabled;
    onChange({ soundEnabled: nextState });
    onToast?.(nextState ? "已開啟開播提示音效" : "已關閉開播提示音效", "info");
  };

  const handleTestSound = () => {
    playChime(settings.soundVolume ?? 0.5);
  };

  const handleDensityChange = (density: "compact" | "standard" | "comfortable") => {
    if (density === "compact") {
      onChange({ density: "compact", cardScale: 0.85, fontScale: 0.9 });
    } else if (density === "comfortable") {
      onChange({ density: "comfortable", cardScale: 1.15, fontScale: 1.1 });
    } else {
      onChange({ density: "standard", cardScale: 1.0, fontScale: 1.0 });
    }
  };

  const handleSelectPresetAccent = (accentId: string) => {
    onChange({ accentColor: accentId, accentCustom: null });
  };

  const handleCustomAccentChange = (hex: string) => {
    onChange({ accentCustom: hex });
  };

  const handleLoadFonts = async () => {
    if (isLoadingFonts) return;
    if (!("queryLocalFonts" in window)) {
      onToast?.("您的瀏覽器不支援讀取本機字體功能", "error");
      return;
    }
    try {
      setIsLoadingFonts(true);
      // @ts-ignore
      const fonts = await window.queryLocalFonts();
      // @ts-ignore
      const fontNames = Array.from(new Set(fonts.map((f: any) => f.family))).sort();
      setLocalFonts(fontNames as string[]);
      onToast?.(`已成功讀取 ${fontNames.length} 種系統字體`, "success");
    } catch (err) {
      console.error(err);
      onToast?.("無法讀取本機字體，請確認您已允許瀏覽器權限", "error");
    } finally {
      setIsLoadingFonts(false);
    }
  };

  const handleExportClick = async () => {
    if (!onExport) return;
    try {
      setIsExporting(true);
      await onExport();
      onToast?.("已成功匯出備份資料檔案", "success");
    } catch (err) {
      onToast?.(`匯出失敗: ${(err as Error).message}`, "error");
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);
        if (!parsed || (typeof parsed !== "object")) {
          throw new Error("無效的備份檔案格式");
        }
        setPendingImportData(parsed);
      } catch (err) {
        onToast?.(`檔案解析失敗: ${(err as Error).message}`, "error");
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };
    reader.readAsText(file);
  };

  const handleConfirmImport = async (mode: "merge" | "replace") => {
    if (!pendingImportData || !onImport) return;
    try {
      setIsImporting(true);
      const res = await onImport(pendingImportData, mode);
      const importedRooms = res?.importedRooms ?? (Array.isArray(pendingImportData.rooms) ? pendingImportData.rooms.length : 0);
      const importedGroups = res?.importedGroups ?? (Array.isArray(pendingImportData.groups) ? pendingImportData.groups.length : 0);
      onToast?.(
        `匯入成功！模式: ${mode === "merge" ? "合併" : "覆蓋"}，共匯入 ${importedRooms} 間房間、${importedGroups} 個分組`,
        "success"
      );
      setPendingImportData(null);
    } catch (err) {
      onToast?.(`匯入失敗: ${(err as Error).message}`, "error");
    } finally {
      setIsImporting(false);
    }
  };

  const currentDensity = settings.density || "standard";
  const customAccentValue = settings.accentCustom || "#1587f2";

  return (
    <div className="settings-panel-container">
      {/* 區塊 1: 🔔 開播通知與聲音 */}
      <section className="sidebar-section settings-section">
        <h2>🔔 開播通知與聲音</h2>

        {/* 桌面通知 */}
        <div className="settings-toggle-row">
          <div className="toggle-label-group">
            <span className="toggle-title">全域開播桌面通知</span>
            <span className="toggle-desc">主播開播時發送系統推播提醒</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={Boolean(settings.notifyOnLive)}
            className={`settings-switch ${settings.notifyOnLive ? "is-checked" : ""}`}
            onClick={handleToggleNotification}
            title={settings.notifyOnLive ? "點擊關閉通知" : "點擊開啟通知"}
          >
            <span className="switch-knob" />
          </button>
        </div>

        {notifPermission === "denied" && (
          <div className="permission-warning-tip">
            ⚠️ 瀏覽器通知權限已被封鎖，請至網址列左側網站設定中允許通知
          </div>
        )}

        {/* 開播提示音效 */}
        <div className="settings-toggle-row">
          <div className="toggle-label-group">
            <span className="toggle-title">開播提示音效</span>
            <span className="toggle-desc">偵測到開播時播放提示音</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={Boolean(settings.soundEnabled)}
            className={`settings-switch ${settings.soundEnabled ? "is-checked" : ""}`}
            onClick={handleToggleSound}
            title={settings.soundEnabled ? "點擊關閉音效" : "點擊開啟音效"}
          >
            <span className="switch-knob" />
          </button>
        </div>

        {/* 音效音量與試聽 */}
        {settings.soundEnabled && (
          <div className="settings-row sound-volume-row">
            <div className="slider-header-row">
              <span>音效音量</span>
              <div className="slider-val-test">
                <span className="slider-val-badge">
                  {Math.round((settings.soundVolume ?? 0.5) * 100)}%
                </span>
                <button
                  type="button"
                  className="test-sound-btn"
                  onClick={handleTestSound}
                  title="試聽當前音量提示音"
                >
                  試聽
                </button>
              </div>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={settings.soundVolume ?? 0.5}
              onChange={(event) => onChange({ soundVolume: Number(event.target.value) })}
              aria-label="音效音量"
            />
          </div>
        )}
      </section>

      {/* 區塊 2: 🎨 個性化與排版密度 */}
      <section className="sidebar-section settings-section">
        <h2>🎨 個性化與排版</h2>

        {/* 模式 */}
        <label className="settings-row">
          <span>外觀模式</span>
          <select
            value={settings.theme}
            onChange={(event) => onChange({ theme: event.target.value as "light" | "dark" | "auto" })}
          >
            <option value="light">明亮模式</option>
            <option value="dark">暗黑模式</option>
            <option value="auto">跟隨系統</option>
          </select>
        </label>

        {/* 主題色與自訂色 */}
        <div className="settings-row">
          <span>主題顏色</span>
          <div className="accent-color-palette">
            {PRESET_ACCENTS.map((item) => {
              const isSelected = !settings.accentCustom && (settings.accentColor || "blue") === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`accent-color-swatch ${isSelected ? "is-active" : ""}`}
                  style={{ backgroundColor: item.color }}
                  onClick={() => handleSelectPresetAccent(item.id)}
                  title={item.label}
                  aria-label={item.label}
                />
              );
            })}
            {/* 自訂取色器 */}
            <label
              className={`accent-custom-picker-label ${settings.accentCustom ? "is-active" : ""}`}
              title={`自訂顏色 (${customAccentValue})`}
            >
              <input
                type="color"
                className="accent-custom-color-input"
                value={customAccentValue}
                onChange={(e) => handleCustomAccentChange(e.target.value)}
              />
              <span
                className="accent-custom-preview"
                style={{ backgroundColor: customAccentValue }}
              />
            </label>
          </div>
        </div>

        {/* 版面密度預設檔 */}
        <div className="settings-row">
          <span>版面密度</span>
          <div className="density-presets-group">
            <button
              type="button"
              className={`density-preset-btn ${currentDensity === "compact" ? "is-active" : ""}`}
              onClick={() => handleDensityChange("compact")}
            >
              緊湊
            </button>
            <button
              type="button"
              className={`density-preset-btn ${currentDensity === "standard" ? "is-active" : ""}`}
              onClick={() => handleDensityChange("standard")}
            >
              標準
            </button>
            <button
              type="button"
              className={`density-preset-btn ${currentDensity === "comfortable" ? "is-active" : ""}`}
              onClick={() => handleDensityChange("comfortable")}
            >
              舒適
            </button>
          </div>
        </div>

        {/* 刷新頻率 */}
        <label className="settings-row">
          <span>自動刷新頻率</span>
          <select
            value={settings.refreshInterval || 60}
            onChange={(event) => onChange({ refreshInterval: Number(event.target.value) })}
          >
            <option value={30}>30 秒</option>
            <option value={60}>1 分鐘</option>
            <option value={180}>3 分鐘</option>
            <option value={300}>5 分鐘</option>
          </select>
        </label>

        {/* 卡片微調 */}
        <label className="settings-row">
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>卡片大小</span>
            <span style={{ fontVariantNumeric: "tabular-nums", opacity: 0.8 }}>{settings.cardScale.toFixed(2)}x</span>
          </div>
          <input
            type="range"
            min="0.5"
            max="2.0"
            step="0.05"
            value={settings.cardScale}
            onChange={(event) => onChange({ cardScale: Number(event.target.value) })}
          />
        </label>

        {/* 字體大小 */}
        <label className="settings-row">
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>字體大小</span>
            <span style={{ fontVariantNumeric: "tabular-nums", opacity: 0.8 }}>{settings.fontScale.toFixed(2)}x</span>
          </div>
          <input
            type="range"
            min="0.5"
            max="2.0"
            step="0.05"
            value={settings.fontScale}
            onChange={(event) => onChange({ fontScale: Number(event.target.value) })}
          />
        </label>

        {/* 字體 */}
        <label className="settings-row" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <span>字體選擇</span>
          <select
            value={settings.fontFamily}
            onChange={(event) => onChange({ fontFamily: event.target.value })}
          >
            <option value="system">系統預設</option>
            <option value="jhenghei">微軟正黑體</option>
            <option value="serif">襯線字體</option>
            <option value="mono">等寬字體</option>
            {localFonts.length > 0 && (
              <optgroup label="本機字體">
                {localFonts.map((font) => (
                  <option key={font} value={font}>{font}</option>
                ))}
              </optgroup>
            )}
            {!["system", "jhenghei", "serif", "mono"].includes(settings.fontFamily) && !localFonts.includes(settings.fontFamily) && (
              <option value={settings.fontFamily}>{settings.fontFamily}</option>
            )}
          </select>
          {"queryLocalFonts" in window && (
            <button
              className="button button-secondary"
              type="button"
              onClick={handleLoadFonts}
              disabled={isLoadingFonts}
              style={{ minHeight: "32px", fontSize: "12.5px" }}
            >
              {isLoadingFonts ? "讀取中..." : localFonts.length === 0 ? "載入系統字體清單" : "重新載入系統字體"}
            </button>
          )}
        </label>
      </section>

      {/* 區塊 3: 📦 資料備份與還原 */}
      <section className="sidebar-section settings-section">
        <h2>📦 資料備份與還原</h2>
        <div className="backup-actions-grid">
          <button
            type="button"
            className="button button-secondary backup-btn"
            onClick={handleExportClick}
            disabled={isExporting}
            title="匯出所有房間、分組與設定至 JSON 檔案"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span>{isExporting ? "匯出中..." : "匯出備份"}</span>
          </button>

          <button
            type="button"
            className="button button-secondary backup-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            title="從 JSON 備份檔匯入房間與設定"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <span>匯入備份</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={handleFileSelected}
          />
        </div>
      </section>

      {/* 匯入模式選擇確認對話框 Modal */}
      {pendingImportData && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card import-modal-card">
            <div className="modal-header">
              <h3>選擇匯入模式</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setPendingImportData(null)}
                aria-label="取消"
              >
                &times;
              </button>
            </div>
            <div className="modal-body">
              <p className="import-modal-hint">
                偵測到備份檔案包含{" "}
                <strong>{Array.isArray(pendingImportData.rooms) ? pendingImportData.rooms.length : 0}</strong> 個直播間、
                <strong>{Array.isArray(pendingImportData.groups) ? pendingImportData.groups.length : 0}</strong> 個分組。
                請選擇匯入方式：
              </p>

              <div className="import-mode-options">
                <div className="import-mode-card" onClick={() => handleConfirmImport("merge")}>
                  <div className="import-mode-title">
                    <strong>合併模式 (Merge)</strong>
                    <span className="badge-recommend">推薦</span>
                  </div>
                  <div className="import-mode-desc">
                    保留現有房間與分組，僅追加檔案中未存在的新房間與分組。
                  </div>
                </div>

                <div className="import-mode-card danger-mode" onClick={() => handleConfirmImport("replace")}>
                  <div className="import-mode-title">
                    <strong>覆蓋模式 (Replace)</strong>
                  </div>
                  <div className="import-mode-desc">
                    以匯入檔案內容完全覆蓋現有的所有房間、分組與設定。
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setPendingImportData(null)}
                disabled={isImporting}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
