import React, { useEffect, useRef } from "react";
import { motion } from "framer-motion";

interface ShortcutsPanelProps {
  onClose: () => void;
}

// 可聚焦元素的查詢字串（用於 focus trap 循環）
const FOCUSABLE_SELECTOR =
  'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function ShortcutsPanel({ onClose }: ShortcutsPanelProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const modal = modalRef.current;
    if (!modal) return;

    // 記錄開啟 modal 前的焦點元素，並把焦點移至 modal 內
    const previouslyFocused = document.activeElement as HTMLElement | null;
    modal.focus();

    const handleTabKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;

      const focusableElements = Array.from(
        modal.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      );
      if (focusableElements.length === 0) {
        // 無可聚焦元素時，阻止 Tab 跳出 modal
        event.preventDefault();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      // Shift+Tab 在第一個元素上：循環到最後一個
      if (event.shiftKey && activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
        return;
      }

      // Tab 在最後一個元素上：循環到第一個
      if (!event.shiftKey && activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    modal.addEventListener("keydown", handleTabKey);

    return () => {
      modal.removeEventListener("keydown", handleTabKey);
      // 關閉 modal 時還原焦點；以防元素已不存在或不再可聚焦
      try {
        previouslyFocused?.focus();
      } catch {
        // 元素已不存在則忽略
      }
    };
  }, []);

  return (
    <motion.div
      className="shortcuts-modal-overlay"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        ref={modalRef}
        className="shortcuts-modal-content"
        role="dialog"
        aria-modal="true"
        aria-label="鍵盤快捷鍵說明"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.9, y: 30 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 30 }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
      >
        <div className="shortcuts-header">
          <h2>鍵盤快捷鍵</h2>
          <button className="close-btn" onClick={onClose} aria-label="關閉">
            &times;
          </button>
        </div>
        <div className="shortcuts-body">
          <div className="shortcut-row">
            <span className="shortcut-key">R</span>
            <span className="shortcut-desc">重新整理所有直播間狀態</span>
          </div>
          <div className="shortcut-row">
            <span className="shortcut-key">S</span>
            <span className="shortcut-desc">快速聚焦搜尋框</span>
          </div>
          <div className="shortcut-row">
            <span className="shortcut-key">A</span>
            <span className="shortcut-desc">快速聚焦新增房號輸入框</span>
          </div>
          <div className="shortcut-row">
            <span className="shortcut-key">Esc</span>
            <span className="shortcut-desc">收合所有直播預覽 / 關閉此面板</span>
          </div>
          <div className="shortcut-row">
            <span className="shortcut-key">?</span>
            <span className="shortcut-desc">開啟或關閉此說明面板</span>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
