import React from "react";
import { RefreshIcon, TvIcon, XIcon } from "../icons";

interface EmptyStateProps {
  selectedFilter: string;
  searchQuery?: string;
  onClearSearch?: () => void;
  onResetFilter?: () => void;
}

export function EmptyState({
  selectedFilter,
  searchQuery,
  onClearSearch,
  onResetFilter
}: EmptyStateProps) {
  const isSearchActive = Boolean(searchQuery && searchQuery.trim().length > 0);

  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <TvIcon />
      </div>
      <h2>
        {isSearchActive
          ? `找不到與「${searchQuery}」相符的直播間`
          : selectedFilter === "all"
          ? "尚未新增直播間"
          : "此篩選沒有直播間"}
      </h2>
      <p>
        {isSearchActive
          ? "請嘗試更換關鍵字、主播名稱或房號。"
          : selectedFilter === "all"
          ? "在左側輸入房號或直播網址後即可開始即時監看。"
          : "可切換回全部篩選或在左側新增更多直播間。"}
      </p>
      <div className="empty-state-actions">
        {isSearchActive && onClearSearch && (
          <button className="button button-secondary" type="button" onClick={onClearSearch}>
            <XIcon />
            清除搜尋條件
          </button>
        )}
        {selectedFilter !== "all" && onResetFilter && (
          <button className="button button-secondary" type="button" onClick={onResetFilter}>
            <RefreshIcon />
            查看全部直播間
          </button>
        )}
      </div>
    </div>
  );
}
