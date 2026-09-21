# BiliLive Watch（bilibili-live-watch）

本機 Bilibili 直播間即時監看與開播通知工具。新增多個直播間後，可即時追蹤開播狀態、封面、觀看人數與分區，支援開播桌面通知、歷史開播記錄統計、批次管理與資料備份，並可打包為 Electron 桌面應用常駐系統托盤。

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-Zero--Dependency-339933?logo=nodedotjs&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green.svg)

---

## ✨ 功能特性 (Features)

- **直播狀態即時監看**：精準顯示直播中、未開播、輪播中、鎖定、隱藏及錯誤等狀態，同步取得即時封面、觀看人數與詳細分區。
- **SSE 即時推播與自動降級**：後端透過 Server-Sent Events（`/api/events`）即時廣播狀態變動；連線中斷時前端無縫降級為定時輪詢並於背景自動重連。
- **雙重開播通知與提示音**：直播間由離線轉為開播時，觸發瀏覽器桌面通知（Web Notification）與 Web Audio API 原生合成晶亮提示音；支援全域開關與單房獨立設定。
- **歷史開播記錄與儀表板**：自動累計每間直播間開播場次（Session，每房上限 50 筆），於 Dashboard 提供「今日開播時間線」與「過去 7 日開播趨勢圖」。
- **進階篩選與自訂預設集**：支援依據主分區、子分區、線上人氣、關注數門檻與多維度排序篩選，並可儲存為命名預設集一鍵套用。
- **批次管理操作**：支援進入批次管理模式，透過 Floating Dock 浮動列進行多選房間、批次移動分組或批次快速刪除。
- **播放器預覽與多房同屏**：卡片預設僅顯示靜態封面以極致節省資源，點擊後延遲載入官方 16:9 iframe 播放器，支援彈幕開關與多房同屏監看。
- **資料匯出與增量備份**：支援將完整房間清單、分組、自訂設定與歷史統計匯出為 JSON；匯入時支援「完全覆蓋（replace）」與「增量合併（merge）」雙模式。
- **個人化外觀與 PWA**：提供明亮 / 暗黑 / 跟隨系統三種主題、自訂 Hex 主題色、卡片縮放與緊湊密度調節；內建 Manifest 與 Service Worker 支援 PWA 安裝。
- **Electron 桌面托盤常駐**：支援打包為桌面應用，關閉視窗後自動縮小至 Windows 系統托盤背景輪詢監看，雙擊托盤圖示即時還原。

---

## 🏗️ 系統架構與技術棧 (Architecture & Tech Stack)

### 系統架構流程圖

```text
瀏覽器 / Electron 桌面前端 (React 19 + Vite 7)
          │
          ├── [SSE 串流連線] ──► /api/events ── 即時狀態廣播
          │
          └── [HTTP API / 靜態資源] ──► Node.js 原生 HTTP 伺服器 (:4174)
                                             │
                                             ├─► Bilibili 官方 API（LRU 30s 快取 + 併發去重）
                                             ├─► 圖片防盜鏈代理（/api/image，校驗 *.hdslb.com）
                                             └─► 原子化檔案儲存（data/rooms.json，withWriteLock）
```

### 技術棧一覽

| 領域 | 技術與版本 | 說明與職責 |
| --- | --- | --- |
| **前端框架** | React 19.2 + TypeScript 5.9 | 元件化使用者介面、型別安全保證 |
| **建構工具** | Vite 7.3 | 現代化前端開發伺服器、HMR 熱重載與生產編譯 |
| **動態樣式** | Framer Motion 12.4 + 原生 CSS 變數 | 流暢微互動動畫、深淺色主題切換 |
| **後端核心** | Node.js 原生 HTTP（**零第三方依賴**） | 手動路由分發、SSE 連線池管理、結構化日誌 |
| **桌面環境** | Electron 44.0 + electron-builder 26.15 | 系統托盤 (Tray) 常駐、Windows 桌面應用打包 |
| **測試框架** | Node.js 內建測試執行器（`node --test`） | 無需打包即時驗證核心純函數與篩選管線（22+ Tests） |
| **介面語系** | 繁體中文（zh-Hant） | 完整在地化文字呈現 |

---

## 🚀 快速開始 (Quick Start)

### 環境需求

- **Node.js**：`>= 18.0.0`（建議使用 LTS 版本）
- **npm**：`>= 9.0.0`

### Windows 一鍵啟動

專案根目錄內建自動化批次檔，雙擊執行或於終端機執行：

```bat
start.bat
```

腳本會自動檢測 Node.js 與 npm 環境、自動安裝依賴、編譯前端並啟動服務，隨後自動開啟瀏覽器訪問 `http://127.0.0.1:4174`。

### 手動命令列啟動

```bash
# 1. 安裝專案依賴
npm install

# 2. 編譯前端靜態資產
npm run build

# 3. 啟動生產伺服器
npm start
```

啟動完成後，開啟瀏覽器訪問 `http://127.0.0.1:4174` 即可使用。

### 開發模式

```bash
# 同步啟動後端 API (:4174) 與 Vite HMR 前端伺服器 (:5173)
npm run dev
```

開發模式下，Vite 會自動將 `/api` 請求反向代理至 `127.0.0.1:4174`。

---

## 📦 打包與分發 (Build & Packaging)

### Electron 桌面模式

本專案支援將 Web 介面與後端服務整合封裝為原生桌面應用：

```bash
# 本地啟動桌面模式（自動於背景載入 API 服務並建立視窗）
npm run electron:start

# 打包 Windows 桌面發行檔（產物將輸出至 dist-electron/）
npm run dist:win
```

### 打包產物說明

| 產物類型 | 檔案格式 | 特性說明 |
| --- | --- | --- |
| **免安裝版 (Portable)** | `.exe` | 單一執行檔，隨開即用，適合放在隨身碟或快速體驗 |
| **安裝程式 (NSIS)** | `Setup.exe` | 支援自訂安裝目錄、建立桌面捷徑與開始功能表項目 |

> **托盤運作行為**：關閉桌面視窗時應用不會中斷，而是最小化至工作列系統托盤（System Tray）持續監看；當追蹤的直播間開播時，將彈出 Windows 系統原生推播通知。

---

## 🛠️ 開發常用指令 (Scripts)

| 指令 | 說明 |
| --- | --- |
| `npm run dev` | 並行啟動後端 API (`:4174`) 與前端 Vite HMR 開發伺服器 (`:5173`) |
| `npm run dev:api` | 單獨啟動後端原生 HTTP 伺服器 |
| `npm run dev:web` | 單獨啟動前端 Vite 開發伺服器 |
| `npm run build` | 執行 TypeScript 類型檢查（`tsc -b`）與 Vite 生產打包 |
| `npm start` | 啟動本機生產伺服器（需先執行 `npm run build`） |
| `npm run preview` | 先編譯前端再啟動本機伺服器預覽 |
| `npm test` | 執行 Node.js 內建單元測試（`node --test`，包含 22+ 項測試） |
| `npm run electron:start` | 啟動 Electron 桌面版應用進行偵錯 |
| `npm run dist:win` | 編譯並使用 electron-builder 打包 Windows 桌面應用 |

---

## 📁 專案結構 (Directory Structure)

```text
bilibili-live-watch/
├── server/                     # 後端模組（純原生 JavaScript，零第三方套件）
│   ├── index.js                # 伺服器入口、手動路由分發、靜態託管、日誌與健康檢查
│   ├── rooms-service.js        # 房間業務邏輯：CRUD、B 站 API 代理、狀態轉換與歷史 Session
│   ├── storage.js              # 資料持久化、Schema 自動遷移與原子化寫入鎖
│   ├── sse-broadcaster.js      # Server-Sent Events 連線池管理、廣播與心跳 Ping
│   ├── bilibili.js             # Bilibili 直播 API 請求、LRU 快取與併發請求合併
│   ├── filter-pipeline.js      # 純函數篩選與排序管線（供後端與測試共用）
│   ├── room-input.js           # 直播間輸入解析（支援純房號、短號、完整 URL）
│   └── room-status.js          # 直播狀態常數與對應狀態碼映射
├── src/                        # 前端應用（React 19 + TypeScript 5）
│   ├── App.tsx                 # 主應用元件（整合 SSE 串流、輪詢降級、Dock 與同屏）
│   ├── main.tsx                # React 渲染入口點
│   ├── styles.css              # 全域樣式系統（3D 質感、主題變數、時間線與響應式格線）
│   ├── api.ts                  # 前端 API 請求封裝（SSE 訂閱、批次操作與備份匯入匯出）
│   ├── types.ts                # TypeScript 介面定義（房間、分組、設定與歷史 Session）
│   ├── hooks/                  # 自訂 React Hooks
│   │   ├── useRooms.ts         # 房間清單狀態、CRUD 操作、差異合併與篩選預設集
│   │   ├── usePolling.ts       # 智慧輪詢與頁面能見度節流
│   │   ├── useEventStream.ts   # SSE 串流連線監聽與自動重連機制
│   │   └── useTheme.ts         # 系統與使用者自訂深淺主題監聽
│   ├── components/             # UI 元件庫
│   │   ├── Sidebar.tsx         # 側邊欄（分組切換、統計摘要與新增入口）
│   │   ├── RoomCard.tsx        # 直播間卡片（狀態指示、延遲 iframe 與快捷操作）
│   │   ├── Dashboard.tsx       # 數據儀表板（今日開播時間線與 7 日趨勢圖）
│   │   ├── AdvancedFilterBar.tsx # 進階篩選列（分區/人氣篩選與命名預設集管理）
│   │   └── SettingsPanel.tsx   # 設定面板（外觀、主題色、通知開關與備份還原）
│   └── utils/                  # 前端工具庫
│       ├── notify.ts           # Web Notification 桌面推播與 Web Audio API 提示音合成
│       └── filterPipeline.ts   # 前端篩選純函數管線
├── tests/                      # 單元測試集（Node.js 內建測試執行器）
│   ├── room-utils.test.js      # 房號解析與狀態映射測試
│   ├── advanced.test.js        # 進階篩選管線測試
│   └── new-features.test.js    # Session 歷史與批次操作邏輯測試
├── scripts/
│   └── dev.js                  # 開發環境雙行程並行啟動腳本
├── main.js                     # Electron 主行程（視窗管理、背景輪詢與系統托盤）
├── start.bat                   # Windows 一鍵啟動腳本
├── package.json                # 專案依賴、腳本與打包配置
├── tsconfig.json               # TypeScript 編譯設定（前端 noEmit）
├── vite.config.ts              # Vite 開發與建構配置
└── LICENSE                     # MIT 授權條款檔案
```

---

## ⚙️ 環境設定與資料儲存 (Configuration & Data)

### 環境變數設定

服務預設監聽於 `127.0.0.1:4174`，可透過環境變數覆寫指定參數：

| 環境變數 | 預設值 | 說明 |
| --- | --- | --- |
| `PORT` | `4174` | 後端 HTTP 服務監聽連接埠 |
| `BILILIVE_DATA_FILE` | `data/rooms.json` | 房間、分組、設定與歷史統計資料儲存路徑 |

### JSON 資料儲存與原子寫入機制

- **資料結構**：`data/rooms.json` 包含 `rooms`（房間清單）、`groups`（分組）、`settings`（外觀與通知設定）與 `stats`（開播歷史 Session 紀錄）四大節點。
- **架構相容遷移**：系統啟動時會自動校驗 Schema，並對舊版本結構平滑遷移補齊缺漏欄位。
- **原子寫入保護**：
  - 寫入前取得記憶體串列鎖（`withWriteLock`），避免並行衝突。
  - 將內容寫入臨時檔案（`rooms.json.tmp.<random>`）並確實完成磁碟刷新。
  - 使用 `fs.rename` 原子替換目標檔案；針對 Windows 系統常見的暫態 `EPERM` / `EBUSY` 檔案鎖定，提供自動重試機制，確保斷電或程序崩潰時資料庫絕對不損壞。

---

## ⚠️ 注意事項與限制 (Notes & Limitations)

- **公開直播間限制**：本工具僅支援 Bilibili 公開直播間狀態查詢；不支援且不處理會員專屬、密碼鎖定或大航海付費限定內容。
- **API 代理與快取**：B 站官方 API 未提供跨域 CORS 標頭，所有直播狀態與資料均由本機 Node.js 服務代理查詢；內建 30 秒 TTL 的 LRU 快取與並行去重機制，防止對 B 站伺服器造成過度負載。
- **圖片防盜鏈機制**：B 站圖片伺服器（`*.hdslb.com`）具備嚴格 Referer 檢查，本系統提供 `/api/image` 串流代理，並嚴格限制僅能存取官方圖片網域。
- **播放器 iframe 限制**：內嵌播放器直接呼叫 Bilibili 官方播放頁面，瀏覽器主控台若出現 Permissions Policy 或跨域警告屬於官方頁面正常輸出，不影響播放功能。

---

## 📄 授權條款 (License)

本專案採用 [MIT License](LICENSE) 授權條款開放原始碼。詳細條款文字請參閱專案目錄下的 [LICENSE](LICENSE) 檔案。
