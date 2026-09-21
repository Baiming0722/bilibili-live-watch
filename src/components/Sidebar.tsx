import React, { FormEvent, RefObject } from "react";
import { AlertIcon, HomeIcon, TrashIcon, XIcon } from "../icons";
import type { AppSettings, RoomGroup } from "../types";
import { SettingsPanel } from "./SettingsPanel";

interface SidebarProps {
  // 新增房間
  roomInput: string;
  setRoomInput: (value: string) => void;
  isAdding: boolean;
  onAddRoom: (event: FormEvent<HTMLFormElement>) => void;
  actionError: string | null;
  roomInputRef: RefObject<HTMLInputElement | null>;

  // 搜尋與篩選
  totalRoomCount: number;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  selectedFilter: string;
  setSelectedFilter: (filter: any) => void;
  filters: Array<{ key: string; label: string; Icon: any }>;
  roomCounts: Record<string, number>;

  // 分組
  groupInput: string;
  setGroupInput: (value: string) => void;
  onCreateGroup: (event: FormEvent<HTMLFormElement>) => void;
  selectedGroupId: string;
  setSelectedGroupId: (groupId: any) => void;
  groups: RoomGroup[];
  groupCounts: Map<string, number>;
  onDeleteGroup: (groupId: string) => void;

  // 設定
  settings: AppSettings;
  onSettingsChange: (patch: Partial<AppSettings>) => void;
  onExport?: () => Promise<void>;
  onImport?: (data: unknown, mode: "merge" | "replace") => Promise<any>;
  onToast?: (message: string, type?: "success" | "error" | "info") => void;
}

export const Sidebar = React.memo(function Sidebar({
  roomInput,
  setRoomInput,
  isAdding,
  onAddRoom,
  actionError,
  roomInputRef,
  totalRoomCount,
  searchQuery,
  setSearchQuery,
  searchInputRef,
  selectedFilter,
  setSelectedFilter,
  filters,
  roomCounts,
  groupInput,
  setGroupInput,
  onCreateGroup,
  selectedGroupId,
  setSelectedGroupId,
  groups,
  groupCounts,
  onDeleteGroup,
  settings,
  onSettingsChange,
  onExport,
  onImport,
  onToast,
}: SidebarProps) {
  return (
    <aside className="sidebar" aria-label="直播間管理">
      <section className="sidebar-section add-section">
        <h2>新增直播間</h2>
        <form className="add-form" onSubmit={onAddRoom}>
          <label className="visually-hidden" htmlFor="roomInput">
            房號
          </label>
          <div className="input-with-action">
            <input
              id="roomInput"
              ref={roomInputRef}
              value={roomInput}
              onChange={(event) => setRoomInput(event.target.value)}
              placeholder="輸入房號或直播網址"
              disabled={isAdding}
            />
            {roomInput && !isAdding && (
              <button
                type="button"
                className="input-clear-btn"
                onClick={() => {
                  setRoomInput("");
                  roomInputRef.current?.focus();
                }}
                title="清空輸入"
                aria-label="清空輸入"
              >
                <XIcon />
              </button>
            )}
          </div>
          <button className="button button-primary add-button" type="submit" disabled={isAdding || !roomInput.trim()}>
            {isAdding ? "新增中..." : "新增監看"}
          </button>
        </form>
        {actionError ? (
          <div className="inline-error" role="alert">
            <AlertIcon />
            <span>{actionError}</span>
          </div>
        ) : null}
      </section>

      <section className="sidebar-section">
        <h2>我的直播間 ({totalRoomCount})</h2>
        <div className="search-box">
          <svg className="search-box-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path strokeLinecap="round" d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜尋主播、標題或房號 (S)"
            aria-label="搜尋直播間"
          />
          {searchQuery && (
            <button
              type="button"
              className="input-clear-btn search-clear-btn"
              onClick={() => {
                setSearchQuery("");
                searchInputRef.current?.focus();
              }}
              title="清空搜尋"
              aria-label="清空搜尋"
            >
              <XIcon />
            </button>
          )}
        </div>
        <nav className="filter-list" aria-label="狀態篩選">
          {filters.map(({ key, label, Icon }) => {
            const count = key === "all" ? totalRoomCount : roomCounts[key] ?? 0;
            return (
              <button
                key={key}
                className={`filter-item ${selectedFilter === key ? "is-active" : ""}`}
                type="button"
                onClick={() => setSelectedFilter(key)}
                title={`${label} (${count})`}
              >
                <Icon />
                <span>{label}</span>
                <strong>{count}</strong>
              </button>
            );
          })}
        </nav>
      </section>

      <section className="sidebar-section">
        <h2>分組</h2>
        <form className="group-form" onSubmit={onCreateGroup}>
          <input
            value={groupInput}
            onChange={(event) => setGroupInput(event.target.value)}
            placeholder="新增分組名稱"
            aria-label="新增分組"
          />
          <button className="button button-secondary" type="submit" disabled={!groupInput.trim()}>
            建立
          </button>
        </form>
        <div className="group-list" aria-label="分組篩選">
          <button
            className={`group-item ${selectedGroupId === "all" ? "is-active" : ""}`}
            type="button"
            onClick={() => setSelectedGroupId("all")}
            title={`全部分組 (${totalRoomCount})`}
          >
            <span>全部分組</span>
            <strong>{totalRoomCount}</strong>
          </button>
          <button
            className={`group-item ${selectedGroupId === "ungrouped" ? "is-active" : ""}`}
            type="button"
            onClick={() => setSelectedGroupId("ungrouped")}
            title={`未分組 (${groupCounts.get("ungrouped") ?? 0})`}
          >
            <span>未分組</span>
            <strong>{groupCounts.get("ungrouped") ?? 0}</strong>
          </button>
          {groups.map((group) => {
            const count = groupCounts.get(group.id) ?? 0;
            return (
              <div className={`group-row ${selectedGroupId === group.id ? "is-active" : ""}`} key={group.id}>
                <button type="button" onClick={() => setSelectedGroupId(group.id)} title={`${group.name} (${count})`}>
                  <span>{group.name}</span>
                  <strong>{count}</strong>
                </button>
                <button
                  className="icon-button group-delete-btn"
                  type="button"
                  onClick={() => onDeleteGroup(group.id)}
                  title={`刪除分組 ${group.name}`}
                >
                  <TrashIcon />
                  <span className="visually-hidden">移除分組</span>
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <SettingsPanel
        settings={settings}
        onChange={onSettingsChange}
        onExport={onExport}
        onImport={onImport}
        onToast={onToast}
      />
    </aside>
  );
});
