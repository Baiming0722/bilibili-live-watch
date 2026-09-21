import React, { DragEvent, useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertIcon,
  BellIcon,
  BellOffIcon,
  CheckIcon,
  CheckSquareIcon,
  Edit3Icon,
  ExternalIcon,
  EyeIcon,
  EyeOffIcon,
  FolderIcon,
  HeartIcon,
  LockIcon,
  MessageSquareIcon,
  MoreVerticalIcon,
  PauseIcon,
  PinIcon,
  PlayIcon,
  SquareIcon,
  TrashIcon
} from "../icons";
import type { LiveRoom, RoomGroup, RoomStatus } from "../types";
import { StatusChip } from "./StatusChip";
import { HighlightText } from "./HighlightText";

const cardVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.96 },
  show: { 
    opacity: 1, 
    y: 0, 
    scale: 1,
    transition: {
      type: "spring" as const,
      stiffness: 280,
      damping: 26
    }
  },
  exit: { 
    opacity: 0, 
    scale: 0.94, 
    y: -16,
    transition: { duration: 0.18, ease: "easeOut" as const }
  }
};

interface RoomCardProps {
  room: LiveRoom;
  groups: RoomGroup[];
  searchQuery: string;
  isPreviewing: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  isBatchMode?: boolean;
  isSelected?: boolean;
  enableAnimation?: boolean;
  onDragStart: (event: DragEvent<HTMLElement>, roomId: number) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragEnter: (roomId: number) => void;
  onDragLeave: (roomId: number) => void;
  onDrop: (roomId: number) => void;
  onTogglePreview: (roomId: number) => void;
  onRefresh: (roomId: number) => void;
  onDelete: (roomId: number) => void;
  onPopOut: (roomId: number) => void;
  onGroupChange: (roomId: number, groupId?: string) => void;
  onToggleSelect?: (roomId: number) => void;
  onUpdateFields?: (roomId: number, fields: { note?: string; pinned?: boolean; notify?: boolean }) => void;
}

export const RoomCard = React.memo(function RoomCard({
  room,
  groups,
  searchQuery,
  isPreviewing,
  isDragging,
  isDragOver,
  isBatchMode = false,
  isSelected = false,
  enableAnimation = true,
  onDragStart,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
  onTogglePreview,
  onRefresh,
  onDelete,
  onPopOut,
  onGroupChange,
  onToggleSelect,
  onUpdateFields,
}: RoomCardProps) {
  const [danmakuEnabled, setDanmakuEnabled] = useState(true);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isGroupSubmenuOpen, setIsGroupSubmenuOpen] = useState(false);
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState(room.note ?? "");

  const menuRef = useRef<HTMLDivElement>(null);
  const noteInputRef = useRef<HTMLInputElement>(null);

  const canPreview = room.status !== "error";
  const isLive = room.status === "live";
  const isPinned = Boolean(room.pinned);
  const isNotifyEnabled = room.notify !== false;
  const liveDuration = isLive ? formatLiveDuration(room.liveTime) : null;

  // 同步外部 room.note 變更
  useEffect(() => {
    if (!isEditingNote) {
      setNoteDraft(room.note ?? "");
    }
  }, [room.note, isEditingNote]);

  // 開啟編輯備註時自動聚焦
  useEffect(() => {
    if (isEditingNote) {
      noteInputRef.current?.focus();
      noteInputRef.current?.select();
    }
  }, [isEditingNote]);

  // 點擊外部自動關閉更多選單
  useEffect(() => {
    if (!isMenuOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
        setIsGroupSubmenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isMenuOpen]);

  const currentGroupName = groups.find((g) => g.id === room.groupId)?.name ?? "未分組";

  const handleSaveNote = () => {
    const trimmed = noteDraft.trim();
    setIsEditingNote(false);
    if (trimmed !== (room.note ?? "")) {
      onUpdateFields?.(room.roomId, { note: trimmed });
    }
  };

  const handleCancelNote = () => {
    setNoteDraft(room.note ?? "");
    setIsEditingNote(false);
  };

  const handleCardClick = (e: React.MouseEvent) => {
    if (isBatchMode) {
      // 避免點擊按鈕或連結時重疊觸發
      const target = e.target as HTMLElement;
      if (!target.closest("button, a, input, select, textarea")) {
        onToggleSelect?.(room.roomId);
      }
    }
  };

  return (
    <motion.article
      className={`room-card ${isPreviewing ? "is-expanded" : ""} ${isDragging ? "is-dragging" : ""} ${
        isDragOver ? "is-drag-over" : ""
      } ${isBatchMode ? "is-batch-mode" : ""} ${isSelected ? "is-selected" : ""} ${isPinned ? "is-pinned" : ""} status-${room.status}`}
      layout={enableAnimation ? ("position" as const) : undefined}
      variants={enableAnimation ? cardVariants : undefined}
      initial={enableAnimation ? "hidden" : undefined}
      animate={enableAnimation ? "show" : undefined}
      exit={enableAnimation ? "exit" : undefined}
      whileHover={enableAnimation && !isDragging && !isPreviewing ? { y: -6, scale: 1.01 } : undefined}
      draggable={!isBatchMode}
      onClick={handleCardClick}
      onDragStart={(e: any) => !isBatchMode && onDragStart(e, room.roomId)}
      onDragOver={!isBatchMode ? onDragOver : undefined}
      onDragEnter={!isBatchMode ? () => onDragEnter(room.roomId) : undefined}
      onDragLeave={!isBatchMode ? () => onDragLeave(room.roomId) : undefined}
      onDrop={!isBatchMode ? () => onDrop(room.roomId) : undefined}
    >
      {/* 置頂金屬光角標 */}
      {isPinned && (
        <div className="pinned-badge" title="此房間已置頂">
          <PinIcon />
        </div>
      )}

      {/* 頂部資訊列：左側 (批次選框 / 拖曳把手 + 狀態晶片 + 開播時長)，右側 (房號 + 快捷通知 + 鎖定圖示) */}
      <div className="card-topline">
        <div className="card-topline-left">
          {isBatchMode ? (
            <button
              type="button"
              className={`batch-checkbox ${isSelected ? "is-checked" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggleSelect?.(room.roomId);
              }}
              title={isSelected ? "取消選取" : "選取房間"}
              aria-label={isSelected ? "取消選取" : "選取房間"}
            >
              {isSelected ? <CheckSquareIcon /> : <SquareIcon />}
            </button>
          ) : (
            <span className="drag-handle" title="按住拖曳排序" aria-label="按住拖曳排序">
              ⋮⋮
            </span>
          )}
          <StatusChip status={room.status} label={room.statusLabel} />
          {liveDuration && (
            <span className="live-duration-chip" title={`開播時間: ${room.liveTime}`}>
              {liveDuration}
            </span>
          )}
        </div>
        <div className="card-topline-right">
          {/* 開播通知快捷開關 */}
          <button
            type="button"
            className={`icon-action-btn quick-notify-btn ${isNotifyEnabled ? "is-active" : "is-muted"}`}
            onClick={(e) => {
              e.stopPropagation();
              onUpdateFields?.(room.roomId, { notify: !isNotifyEnabled });
            }}
            title={isNotifyEnabled ? "開播通知已開啟 (點擊關閉)" : "開播通知已關閉 (點擊開啟)"}
            aria-label="切換開播通知"
          >
            {isNotifyEnabled ? <BellIcon /> : <BellOffIcon />}
          </button>

          <span className="room-id" title={`房號: ${room.shortId ?? room.roomId}`}>
            #{room.shortId ?? room.roomId}
          </span>
          {room.status === "locked" && (
            <span className="flag-item" title="房間已鎖定">
              <LockIcon />
            </span>
          )}
          {room.status === "hidden" && (
            <span className="flag-item" title="房間已隱藏">
              <EyeOffIcon />
            </span>
          )}
        </div>
      </div>

      {/* 3D 雙層嵌套螢幕容器 */}
      <div className="card-media-container">
        {isPreviewing && canPreview ? (
          <PreviewFrame room={room} danmakuEnabled={danmakuEnabled} />
        ) : (
          <CoverFrame
            room={room}
            isLive={isLive}
            onOpenPreview={() => {
              if (!isBatchMode) onTogglePreview(room.roomId);
            }}
            onRetry={() => onRefresh(room.roomId)}
          />
        )}
      </div>

      {/* 卡片主體內容 */}
      <div className="card-body">
        <a
          className="room-title"
          href={room.liveUrl}
          target="_blank"
          rel="noreferrer"
          title={room.title}
          onClick={(e) => {
            if (isBatchMode) {
              e.preventDefault();
              onToggleSelect?.(room.roomId);
            }
          }}
        >
          <HighlightText text={room.title} highlight={searchQuery} />
        </a>

        {/* 自訂備註 (Note) 標籤與行內編輯 */}
        {isEditingNote ? (
          <div className="room-note-editor" onClick={(e) => e.stopPropagation()}>
            <input
              ref={noteInputRef}
              type="text"
              className="room-note-input"
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveNote();
                if (e.key === "Escape") handleCancelNote();
              }}
              placeholder="新增備註 (Enter 儲存，Esc 取消)"
              maxLength={40}
            />
            <button className="note-save-btn" type="button" onClick={handleSaveNote} title="儲存備註">
              <CheckIcon />
            </button>
          </div>
        ) : room.note ? (
          <div
            className="room-note-tag"
            onClick={(e) => {
              e.stopPropagation();
              setIsEditingNote(true);
            }}
            title="點擊編輯備註"
          >
            <Edit3Icon />
            <span className="note-text">{room.note}</span>
          </div>
        ) : null}

        {/* 主播資訊列 */}
        <div className="streamer-row">
          {room.face ? (
            <img className="avatar" src={getProxiedImageUrl(room.face)} alt={room.uname} loading="lazy" />
          ) : (
            <span className="avatar">{room.uname.slice(0, 1).toUpperCase()}</span>
          )}
          <span className="streamer-name" title={room.uname}>
            <HighlightText text={room.uname} highlight={searchQuery} />
          </span>
        </div>

        {/* 數據與時間列 */}
        <div className="meta-row">
          <div className="meta-stats-group">
            <span className="meta-pill" title={`在線觀看人數: ${formatCompactNumber(room.online)}`}>
              <EyeIcon />
              <span>{formatCompactNumber(room.online)}</span>
            </span>
            {room.attention > 0 && (
              <span className="meta-pill" title={`粉絲關注數: ${formatCompactNumber(room.attention)}`}>
                <HeartIcon />
                <span>{formatCompactNumber(room.attention)}</span>
              </span>
            )}
          </div>
          <span className="updated-time-text" title={`資料更新時間: ${formatTime(room.lastFetchedAt)}`}>
            {formatTime(room.lastFetchedAt)}
          </span>
        </div>
      </div>

      {/* 精簡 3D 操作按鈕列 */}
      <div className="card-actions">
        <button
          className={`button ${isPreviewing ? "button-primary" : "button-secondary"} btn-preview`}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTogglePreview(room.roomId);
          }}
          disabled={!canPreview}
          title={isPreviewing ? "收合即時預覽" : "在卡片中快速預覽直播"}
        >
          {isPreviewing ? <PauseIcon /> : <PlayIcon />}
          <span>{isPreviewing ? "收合" : "預覽"}</span>
        </button>

        <a
          className="button button-secondary btn-external"
          href={room.liveUrl}
          target="_blank"
          rel="noreferrer"
          title="在新分頁開啟 BiliBili 直播間"
          onClick={(e) => {
            if (isBatchMode) {
              e.preventDefault();
              onToggleSelect?.(room.roomId);
            }
          }}
        >
          <ExternalIcon />
          <span>直播間</span>
        </a>

        {/* 更多功能下拉選單 */}
        <div className="card-menu-wrapper" ref={menuRef} onClick={(e) => e.stopPropagation()}>
          <button
            className={`button button-secondary icon-button btn-more ${isMenuOpen ? "is-active" : ""}`}
            type="button"
            onClick={() => {
              setIsMenuOpen((prev) => !prev);
              setIsGroupSubmenuOpen(false);
            }}
            aria-label="更多操作"
            title="更多操作"
          >
            <MoreVerticalIcon />
          </button>

          <AnimatePresence>
            {isMenuOpen && (
              <motion.div
                className="card-dropdown-menu"
                initial={{ opacity: 0, scale: 0.95, y: 6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 6 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
              >
                {/* 置頂切換 */}
                <button
                  className="dropdown-item"
                  type="button"
                  onClick={() => {
                    onUpdateFields?.(room.roomId, { pinned: !isPinned });
                    setIsMenuOpen(false);
                  }}
                >
                  <PinIcon />
                  <span>{isPinned ? "取消置頂" : "置頂房間"}</span>
                </button>

                {/* 編輯備忘/備註 */}
                <button
                  className="dropdown-item"
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    setIsEditingNote(true);
                  }}
                >
                  <Edit3Icon />
                  <span>{room.note ? "編輯備忘/備註" : "新增備註"}</span>
                </button>

                {/* 彈幕開關 */}
                <button
                  className="dropdown-item"
                  type="button"
                  onClick={() => {
                    setDanmakuEnabled((prev) => !prev);
                    if (!isPreviewing && canPreview) {
                      onTogglePreview(room.roomId);
                    }
                  }}
                >
                  <MessageSquareIcon />
                  <span>預覽彈幕</span>
                  <span className={`switch ${danmakuEnabled ? "is-on" : ""}`} aria-hidden="true" />
                </button>

                {/* 彈出獨立小視窗 */}
                <button
                  className="dropdown-item"
                  type="button"
                  onClick={() => {
                    onPopOut(room.roomId);
                    setIsMenuOpen(false);
                  }}
                  disabled={!canPreview}
                >
                  <ExternalIcon />
                  <span>獨立彈出視窗</span>
                </button>

                {/* 分組設定子項目 */}
                <div className="dropdown-submenu-section">
                  <button
                    className="dropdown-item"
                    type="button"
                    onClick={() => setIsGroupSubmenuOpen((prev) => !prev)}
                  >
                    <FolderIcon />
                    <span>移動分組 ({currentGroupName})</span>
                  </button>

                  {isGroupSubmenuOpen && (
                    <div className="dropdown-sub-list">
                      <button
                        className={`dropdown-sub-item ${!room.groupId ? "is-selected" : ""}`}
                        type="button"
                        onClick={() => {
                          onGroupChange(room.roomId, undefined);
                          setIsMenuOpen(false);
                        }}
                      >
                        <span>未分組</span>
                        {!room.groupId && <CheckIcon />}
                      </button>
                      {groups.map((group) => (
                        <button
                          key={group.id}
                          className={`dropdown-sub-item ${room.groupId === group.id ? "is-selected" : ""}`}
                          type="button"
                          onClick={() => {
                            onGroupChange(room.roomId, group.id);
                            setIsMenuOpen(false);
                          }}
                        >
                          <span>{group.name}</span>
                          {room.groupId === group.id && <CheckIcon />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="dropdown-divider" />

                {/* 移除房間 */}
                <button
                  className="dropdown-item dropdown-item-danger"
                  type="button"
                  onClick={() => {
                    onDelete(room.roomId);
                    setIsMenuOpen(false);
                  }}
                >
                  <TrashIcon />
                  <span>移除直播間</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.article>
  );
});

function CoverFrame({
  room,
  isLive,
  onOpenPreview,
  onRetry
}: {
  room: LiveRoom;
  isLive: boolean;
  onOpenPreview: () => void;
  onRetry: () => void;
}) {
  const [isLoaded, setIsLoaded] = useState(false);

  if (room.status === "error") {
    return (
      <div className="cover-frame error-frame">
        <AlertIcon />
        <strong>無法讀取直播間資訊</strong>
        <span>{room.error ?? "請稍後再試"}</span>
        <button className="button button-secondary" type="button" onClick={onRetry}>
          重試
        </button>
      </div>
    );
  }

  return (
    <div className="cover-frame cover-interactive" onClick={onOpenPreview} role="button" tabIndex={0}>
      {/* 動態 LIVE 發光 Badge */}
      {isLive && (
        <div className="live-badge-overlay" title="正在直播中">
          <span className="live-badge-dot" />
          <span>LIVE</span>
        </div>
      )}

      {/* 分區標籤浮層 */}
      {room.areaName && (
        <div className="area-badge-overlay" title={`分區: ${room.parentAreaName ? `${room.parentAreaName} · ` : ""}${room.areaName}`}>
          <span>{room.areaName}</span>
        </div>
      )}

      {/* 封面圖片 */}
      {room.cover ? (
        <img
          src={getProxiedImageUrl(room.cover)}
          alt={`${room.title} 封面`}
          loading="lazy"
          onLoad={() => setIsLoaded(true)}
          style={{
            filter: isLoaded ? "none" : "blur(12px)",
            transition: "filter 0.45s ease-out"
          }}
        />
      ) : (
        <NoCover />
      )}

      {/* 懸浮微光播放提示 */}
      <div className="cover-hover-overlay">
        <span className="play-hint-circle">
          <PlayIcon />
        </span>
        <span className="play-hint-text">點擊預覽</span>
      </div>
    </div>
  );
}

function PreviewFrame({ room, danmakuEnabled }: { room: LiveRoom; danmakuEnabled: boolean }) {
  const previewUrl = `https://www.bilibili.com/blackboard/live/live-mobile-playerV3.html?roomId=${room.roomId}&danmaku=${
    danmakuEnabled ? 1 : 0
  }`;

  return (
    <div className="preview-frame">
      <iframe
        title={`${room.title} 直播預覽`}
        src={previewUrl}
        allow="autoplay; fullscreen; picture-in-picture"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}

function NoCover() {
  return (
    <div className="no-cover">
      <PlayIcon />
      <span>無封面</span>
    </div>
  );
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("zh-Hant", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
}

function formatTime(value: string) {
  if (!value) {
    return "--:--:--";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--:--:--";
  }

  return new Intl.DateTimeFormat("zh-Hant", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

function formatLiveDuration(liveTime: string): string | null {
  if (!liveTime) return null;
  const start = new Date(liveTime).getTime();
  if (Number.isNaN(start) || start <= 0) return null;
  const diffMs = Math.max(0, Date.now() - start);
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) return "剛開播";
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function getProxiedImageUrl(imageUrl: string) {
  return `/api/image?url=${encodeURIComponent(imageUrl)}`;
}
