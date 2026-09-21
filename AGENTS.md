# BiliLive Watch — AGENTS.md

## 概要

本機 BiliBili 直播間監看工具。前端 React 19 + TypeScript + Vite 7，後端純 Node.js `http.createServer`（**無 Express、無任何第三方套件**），支援 SSE 即時推播、開播桌面/音效通知、歷史開播 Session 記錄、批次操作、資料匯入匯出、PWA 與 Electron 桌面托盤常駐。

## 關鍵約定

- **繁體中文語系**：所有 UI 字串、錯誤訊息、程式碼註解優先使用繁體中文 (zh-Hant)
- **後端零依賴**：`server/` 僅使用 Node.js 內建模組，不可引入第三方套件。路由為手動字串比對，無 Router 抽象
- **TypeScript 僅前端**：`tsconfig.json` 設定 `noEmit: true`，`tsc` 僅做靜態檢查，Vite 負責打包。後端全為 `.js` 檔
- **ESM 全域**：`"type": "module"`，所有 import 必須使用 ESM 語法（含 `.js` 副檔名）
- **esbuild 版本鎖定**：`package.json` 中 `"overrides": { "esbuild": "0.28.1" }`，不可移除

## 命令

| 用途 | 命令 | 備註 |
|---|---|---|
| 開發 | `npm run dev` | 並行啟動 API (`:4174`) + Vite HMR (`:5173`)。Vite proxy `/api` → `127.0.0.1:4174` |
| 僅 API | `npm run dev:api` | `node server/index.js` |
| 僅前端 | `npm run dev:web` | `vite --host 127.0.0.1` |
| Build | `npm run build` | `tsc -b && vite build` |
| Production | `npm start` | 需先 build |
| 測試 | `npm test` | **Node.js 內建 `node --test`**，非 Jest/Vitest，涵蓋 22+ tests |
| Electron | `npm run electron:start` | 自動內嵌啟動 API server |
| 打包 | `npm run dist:win` | `electron-builder` → `dist-electron/` |

### 開發須知
- 修改 `src/` → Vite 自動 hot reload
- 修改 `server/` → **需手動重啟**（`Ctrl+C` 再 `npm run dev`）
- 測試無需 build 或啟動 server

## 架構

```
server/           ← 後端（純 .js，零依賴）
  index.js        ← HTTP server 入口、路由分發、靜態檔案服務、圖片 proxy、結構化日誌、SSE 與 Health
  rooms-service.js← 業務邏輯：房間 CRUD、分組管理、BiliBili API 代理、狀態轉換偵測、歷史 Session 寫入、批次操作與匯入匯出
  storage.js      ← 資料持久化、schema 遷移、原子化寫入（withWriteLock 串列鎖、暫存檔隨機後綴、EPERM 3次重試）、normalizeData / normalizeStats / normalizeSettings
  sse-broadcaster.js ← Server-Sent Events 連線池管理、主動廣播與心跳 ping
  bilibili.js     ← BiliBili API 查詢、LRU 200 條/30s TTL 快取、併發去重、skipCache 強制刷新
  filter-pipeline.js ← 純函數篩選管線（供 node --test 共用）：applyAdvancedFilters / sortRoomsAdvanced / DEFAULT_ADVANCED_FILTERS
  room-input.js   ← 房號/URL 解析
  room-status.js  ← 狀態常數與映射
src/              ← 前端（React + TypeScript）
  App.tsx         ← 組合式核心，整合 SSE 與輪詢降級、批次操作 Floating Dock、多房同屏與全螢幕
  hooks/
    useRooms.ts   ← 房間/分組/設定/統計狀態與 CRUD、差異合併 mergeRooms/mergeGroups、批次操作、匯入匯出與篩選預設集
    usePolling.ts ← 輪詢與可見性節流（paused 控制降級）
    useTheme.ts   ← 監聽 prefers-color-scheme 並切換主題
    useEventStream.ts ← SSE 即時串流連線管理與斷線自動重連
  utils/
    notify.ts     ← 瀏覽器桌面通知 (Web Notification) 與 Web Audio API 提示音合成
    filterPipeline.ts ← AdvancedFilters 型別與純函數管線
  styles.css      ← 完整設計系統（深淺主題、3D 質感、動畫、時間線、趨勢圖與批次 Dock）
  api.ts          ← API 請求封裝（含 SSE 連線、批次端點、匯入匯出）
  types.ts        ← 共用型別定義（LiveSession, FilterPreset, AppSettings, RoomsResponse 等）
  components/     ← Sidebar, RoomCard, SettingsPanel, LazyIframe, EmptyState,
                    SkeletonCard, ShortcutsPanel, StatusChip, HighlightText, Dashboard, AdvancedFilterBar
main.js           ← Electron 入口（支援系統托盤 Tray、開播輪詢通知、雙擊還原與背景常駐）
scripts/dev.js    ← 開發用並行啟動器
tests/            ← 測試檔 room-utils.test.js、advanced.test.js、new-features.test.js（共 22 測試）
```

## 資料 Schema (v2)

`rooms.json` 包含四個頂層節點：
- `rooms`: 直播間陣列
  - `roomId`: number（標準真實房號）
  - `shortId?`: number（短號）
  - `groupId?`: string（分組 ID）
  - `order`: number（自訂排序權重）
  - `addedAt`: string（ISO 時間字串）
  - `note?`: string（備忘筆記，上限 200 字）
  - `pinned?`: boolean（置頂狀態）
  - `notify?`: boolean（個別開播通知開關）
- `groups`: 分組陣列 `{ id, name, order, createdAt }`
- `settings`: 使用者設定
  - `theme`: "light" | "dark" | "auto"
  - `cardScale` / `fontScale` / `fontFamily` / `refreshInterval` / `accentColor`
  - `notifyOnLive`: boolean（全域開播通知）
  - `soundEnabled`: boolean（提示音開關）
  - `soundVolume`: number (0~1)
  - `accentCustom`: string | null（自訂主題色 Hex）
  - `density`: "compact" | "standard" | "comfortable"
  - `filterPresets`: `FilterPreset[]`（進階篩選預設集清單）
- `stats`: 統計與歷史數據
  - `liveDuration`: Record<roomId, number>（秒數）
  - `lastLiveAt`: Record<roomId, string>（ISO 時間）
  - `history`: Record<roomId, LiveSession[]>（歷史場次列表，每房上限 50 筆）
  - `lastCalculatedAt?`: string（內部節流計算時間戳）

## API 端點

所有 API 皆以 `/api/` 為前綴：

- `GET /api/health` — 健康檢查 `{ status, uptime, roomsCount }`
- `GET /api/events` — Server-Sent Events (SSE) 即時推播串流
- `GET /api/rooms` — 列出分組、房間（含即時狀態）、設定與統計數據
- `GET /api/image?url=<encoded_url>` — 圖片代理（5MB 限制、http→https 升級、僅放行 hdslb.com）
- `POST /api/rooms` — 新增房間（body: `{ "roomInput": "6" }`，支援房號/短號/完整 URL）
- `PUT /api/rooms/order` — 更新排序
- `POST /api/rooms/batch-delete` — 批次刪除房間 `{ "roomIds": [1, 2] }`
- `POST /api/rooms/batch-move` — 批次移動分組 `{ "roomIds": [1, 2], "groupId": "group-id" }`
- `PATCH /api/rooms/:roomId/refresh` — 強制跳過快取刷新單房間並回寫 shortId
- `PATCH /api/rooms/:roomId` — 更新單房欄位（groupId, note, pinned, notify）
- `DELETE /api/rooms/:roomId` — 刪除房間
- `POST /api/groups` — 新增分組
- `DELETE /api/groups/:groupId` — 刪除分組
- `PATCH /api/settings` — 儲存設定（含自訂色、密度、通知設定與篩選預設集）
- `GET /api/export` — 匯出完整設定與房間 JSON 備份檔
- `POST /api/import` — 匯入備份（支援 `mode: "merge" | "replace"`）

## 重要特性說明

### 1. 即時推播 (SSE) 與輪詢降級
- 前端透過 `useEventStream` 訂閱 `/api/events`，後端房間狀態變動時即時主動廣播。
- `usePolling` 監聽 SSE 連線狀態，連線成功時自動暫停定時輪詢；當 SSE 斷線時無縫降級回原本的定時輪詢，並在背景自動重連。

### 2. 開播通知與提示音
- 前端在房間狀態由非 live 轉為 live 時觸發，比對 `settings.notifyOnLive` 與房間個別 `room.notify !== false`。
- 支援瀏覽器原生 Web Notification 與 Web Audio API 晶亮合成提示音（無需載入外部音訊檔）。

### 3. 今日開播時間線與 7 日趨勢
- `Dashboard.tsx` 整合「過去 7 日開播場次趨勢圖」與「今日開播動態時間線」。
- 數據源自後端自動累計之 `stats.history` 歷史 Session 記錄。

### 4. 進階篩選預設集 (Presets)
- `AdvancedFilterBar.tsx` 支援將當前篩選條件（分區、父分區、線上門檻、關注門檻、排序方式）儲存為命名預設集，並提供一鍵套用與刪除管理。

### 5. 批次操作與匯入匯出
- 支援進入批次管理模式，多選房間後一鍵批次移動分組或批次刪除。
- 支援將全部房間、分組、設定與統計數據匯出為 JSON，並支援覆蓋（replace）或增量合併（merge）匯入。

### 6. PWA 與桌面托盤
- 提供 Web App Manifest 與 Service Worker 支援離線快取與 PWA 安裝。
- Electron 桌面殼層具備系統托盤 (System Tray)、後台常駐監看與開播系統通知。
