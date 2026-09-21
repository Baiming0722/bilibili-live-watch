import React, { useMemo, useState } from "react";
import type { FilterPreset, LiveRoom } from "../types";
import type { AdvancedFilters } from "../utils/filterPipeline";

interface AdvancedFilterBarProps {
  rooms: LiveRoom[];
  filters: AdvancedFilters;
  presets?: FilterPreset[];
  onChange: (patch: Partial<AdvancedFilters>) => void;
  onClear: () => void;
  onSavePreset?: (preset: Omit<FilterPreset, "id" | "createdAt"> & { id?: string }) => Promise<FilterPreset | void>;
  onApplyPreset?: (preset: FilterPreset) => void;
  onDeletePreset?: (presetId: string) => Promise<void>;
}

const ONLINE_OPTIONS = [0, 100, 1000, 10000];
const ATTENTION_OPTIONS = [0, 100, 1000, 10000];

export const AdvancedFilterBar = React.memo(function AdvancedFilterBar({
  rooms,
  filters,
  presets = [],
  onChange,
  onClear,
  onSavePreset,
  onApplyPreset,
  onDeletePreset,
}: AdvancedFilterBarProps) {
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
  const [presetNameInput, setPresetNameInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const areaOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rooms) if (r.areaName) set.add(r.areaName);
    return Array.from(set).sort();
  }, [rooms]);

  const parentAreaOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rooms) if (r.parentAreaName) set.add(r.parentAreaName);
    return Array.from(set).sort();
  }, [rooms]);

  const handleSavePreset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!presetNameInput.trim() || !onSavePreset) return;
    setIsSaving(true);
    try {
      await onSavePreset({
        name: presetNameInput.trim(),
        filters: {
          area: filters.area,
          parentArea: filters.parentArea,
          onlineMin: filters.onlineMin,
          attentionMin: filters.attentionMin,
          sortBy: filters.sortBy,
          sortDir: filters.sortDir,
        },
        sortBy: filters.sortBy,
        sortOrder: filters.sortDir,
      });
      setPresetNameInput("");
      setIsPresetModalOpen(false);
    } catch {
      // handled upstream
    } finally {
      setIsSaving(false);
    }
  };

  const handleSelectPreset = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const presetId = e.target.value;
    if (!presetId) return;
    const target = presets.find((p) => p.id === presetId);
    if (target && onApplyPreset) {
      onApplyPreset(target);
    }
  };

  return (
    <div className="advanced-filter-bar">
      <div className="advanced-filter-group">
        <label className="advanced-filter-label">分區</label>
        <select
          value={filters.area}
          onChange={(e) => onChange({ area: e.target.value })}
          aria-label="篩選分區"
        >
          <option value="all">全部分區</option>
          {areaOptions.map((area) => (
            <option key={area} value={area}>
              {area}
            </option>
          ))}
        </select>
      </div>

      <div className="advanced-filter-group">
        <label className="advanced-filter-label">父分區</label>
        <select
          value={filters.parentArea}
          onChange={(e) => onChange({ parentArea: e.target.value })}
          aria-label="篩選父分區"
        >
          <option value="all">全部父分區</option>
          {parentAreaOptions.map((pa) => (
            <option key={pa} value={pa}>
              {pa}
            </option>
          ))}
        </select>
      </div>

      <div className="advanced-filter-group">
        <label className="advanced-filter-label">線上 ≥</label>
        <select
          value={String(filters.onlineMin)}
          onChange={(e) => onChange({ onlineMin: Number(e.target.value) })}
          aria-label="線上人數門檻"
        >
          {ONLINE_OPTIONS.map((v) => (
            <option key={v} value={String(v)}>
              {v === 0 ? "不限" : `≥ ${v}`}
            </option>
          ))}
        </select>
      </div>

      <div className="advanced-filter-group">
        <label className="advanced-filter-label">關注 ≥</label>
        <select
          value={String(filters.attentionMin)}
          onChange={(e) => onChange({ attentionMin: Number(e.target.value) })}
          aria-label="關注門檻"
        >
          {ATTENTION_OPTIONS.map((v) => (
            <option key={v} value={String(v)}>
              {v === 0 ? "不限" : `≥ ${v}`}
            </option>
          ))}
        </select>
      </div>

      <div className="advanced-filter-group">
        <label className="advanced-filter-label">排序</label>
        <select
          value={filters.sortBy}
          onChange={(e) => onChange({ sortBy: e.target.value as AdvancedFilters["sortBy"] })}
          aria-label="排序方式"
        >
          <option value="order">自訂排序</option>
          <option value="liveFirst">直播優先</option>
          <option value="online">人氣（線上）</option>
          <option value="attention">關注數</option>
          <option value="addedAt">新增時間</option>
        </select>
        <select
          value={filters.sortDir}
          onChange={(e) => onChange({ sortDir: e.target.value as AdvancedFilters["sortDir"] })}
          aria-label="排序方向"
        >
          <option value="asc">升序</option>
          <option value="desc">降序</option>
        </select>
      </div>

      {/* 篩選預設集管理 */}
      <div className="advanced-filter-group preset-group">
        <label className="advanced-filter-label">預設集</label>
        <select
          value=""
          onChange={handleSelectPreset}
          aria-label="套用篩選預設集"
          className="preset-select"
        >
          <option value="">套用預設集...</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="preset-action-buttons">
        <button
          className="button button-secondary preset-save-btn"
          type="button"
          onClick={() => setIsPresetModalOpen(true)}
          title="將目前篩選與排序條件儲存為預設集"
        >
          儲存預設集
        </button>

        {presets.length > 0 && onDeletePreset && (
          <div className="preset-chips-list">
            {presets.map((p) => (
              <span key={p.id} className="preset-chip">
                <button
                  type="button"
                  className="preset-chip-apply"
                  onClick={() => onApplyPreset?.(p)}
                  title={`套用「${p.name}」`}
                >
                  {p.name}
                </button>
                <button
                  type="button"
                  className="preset-chip-delete"
                  onClick={() => onDeletePreset(p.id)}
                  title={`刪除「${p.name}」`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <button className="button button-secondary advanced-filter-clear" type="button" onClick={onClear}>
        清除篩選
      </button>

      {/* 儲存預設集 Modal */}
      {isPresetModalOpen && (
        <div className="preset-modal-backdrop" onClick={() => setIsPresetModalOpen(false)}>
          <div className="preset-modal-content" onClick={(e) => e.stopPropagation()}>
            <h4>💾 儲存篩選預設集</h4>
            <form onSubmit={handleSavePreset}>
              <p className="preset-modal-desc">為當前篩選條件（分區、人氣/關注門檻與排序）命名：</p>
              <input
                type="text"
                className="input"
                placeholder="例如：熱門原神、高粉主推..."
                value={presetNameInput}
                onChange={(e) => setPresetNameInput(e.target.value)}
                autoFocus
                maxLength={30}
              />
              <div className="preset-modal-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setIsPresetModalOpen(false)}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={!presetNameInput.trim() || isSaving}
                >
                  {isSaving ? "儲存中..." : "確認儲存"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
});
