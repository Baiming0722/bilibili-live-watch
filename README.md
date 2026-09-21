# BiliLive Watch

本機 BiliBili 直播間監看工具。新增多個直播間後，可即時追蹤開播狀態、封面、觀看人數與分區，支援開播桌面通知、歷史開播記錄、批次管理與資料備份，並可打包為 Electron 桌面應用常駐系統托盤。

- 前端：React 19 + TypeScript + Vite 7
- 後端：純 Node.js `http.createServer`，**零第三方依賴**
- 即時更新：SSE 推播 + 斷線自動降級輪詢
- 測試：Node.js 內建 `node --test`（22+ 測試）

## ✨ 功能特性

- **直播狀態監看**：顯示直播中、未開播、輪播中、鎖定、隱藏、錯誤等狀態，含封面、觀看人數與分區資訊
- **即時推播與降級**：透過 SSE（`/api/events`）即時廣播狀態變動；斷線時自動降級為定時輪詢並於背景重連
- **開播通知**：房間由離線轉為直播時觸發瀏覽器桌面通知與 Web Audio 合成提示音，支援全域開關與單房間個別設定
- **歷史開播記錄**：自動累計每間直播間的開播 Session（每房上限 50 筆），Dashboard 呈現今日開播時間線與 7 日趨勢圖
- **進階篩選預設集**：依分區、線上人數、關注數門檻與排序方式篩選，可儲存為命名預設集一鍵套用
- **批次操作**：批次管理模式支援多選房間，一鍵批次移動分組或批次刪除
- **資料匯入匯出**：完整匯出房間、分組、設定與統計 JSON 備份；匯入支援覆蓋（replace）與增量合併（merge）
- **分組與排序**：自訂分組管理、拖曳卡片排序、房間置頂與備忘筆記
- **播放器預覽**：預設只顯示封面（節省資源），點擊後才載入官方 16:9 iframe 播放器，支援彈幕開關與多房同屏
- **外觀自訂**：明亮 / 暗黑 / 跟隨系統主題、主題色（含自訂 Hex）、卡片大小、字體與介面密度
- **PWA 支援**：提供 Web App Manifest 與 Service Worker，可安裝為桌面 / 行動裝置 App
- **Electron 桌面版**：系統托盤常駐、背景開播輪詢通知、雙擊托盤還原視窗

## 📸 畫面預覽

> 待補充：主畫面（直播間卡片）、Dashboard 今日時間線、批次操作、設定面板、深色模式、Electron 托盤。

## 🛠 技術棧

| 層 | 技術 |
| --- | --- |
| 前端 | React 19、TypeScript、Vite 7、framer-motion |
| 後端 | Node.js 內建模組（無第三方套件），手動路由、SSE、原子化 JSON 寫入 |
| 桌面 | Electron 44、electron-builder（NSIS / Portable） |
| 測試 | Node.js 內建測試執行器（`node --test`） |
| 語系 | 全介面繁體中文（zh-Hant） |

## 🚀 快速開始

### Windows 一鍵啟動

```bat
start.bat
```

腳本會自動檢查 `node` / `npm`、安裝依賴、執行 build、啟動 server 並開啟 `http://127.0.0.1:4174`。關閉腳本視窗即停止服務。

### 手動啟動

```bash
npm install
npm run build
npm start
```

啟動後開啟 `http://127.0.0.1:4174`。

### 開發模式

```bash
npm run dev
```

同時啟動 API server（`127.0.0.1:4174`）與 Vite HMR 開發伺服器（`127.0.0.1:5173`），Vite 會將 `/api` 代理至後端。

### Electron 桌面版

```bash
npm run electron:start   # 啟動桌面應用（自動內嵌 API server）
npm run dist:win         # 打包 Windows 安裝檔 / 免安裝版至 dist-electron/
```

桌面版支援系統托盤常駐：關閉視窗後仍在背景監看，開播時發送系統通知。

## 📜 命令一覽

| 命令 | 說明 |
| --- | --- |
| `npm run dev` | 並行啟動 API（`:4174`）+ Vite HMR（`:5173`） |
| `npm run dev:api` | 僅啟動 API server |
| `npm run dev:web` | 僅啟動 Vite 開發伺服器 |
| `npm run build` | `tsc -b` 靜態檢查 + `vite build` |
| `npm start` | 啟動本機 server（需先 build） |
| `npm run preview` | build 後直接啟動 |
| `npm test` | 執行測試（`node --test`，無需啟動 server） |
| `npm run electron:start` | 啟動 Electron 桌面應用 |
| `npm run dist:win` | 打包 Windows 版本（electron-builder） |

## 🏗 專案結構

```
server/                 ← 後端（純 .js，零依賴）
  index.js              ← HTTP server、路由、靜態檔案、圖片 proxy、SSE
  rooms-service.js      ← 房間 CRUD、分組、BiliBili API 代理、Session 記錄、批次與匯入匯出
  storage.js            ← 資料持久化、schema 遷移、原子化寫入
  sse-broadcaster.js    ← SSE 連線池與廣播
  bilibili.js           ← BiliBili API 查詢（LRU 快取、併發去重）
  filter-pipeline.js    ← 進階篩選純函數管線
src/                    ← 前端（React + TypeScript）
  App.tsx               ← 主應用（SSE + 輪詢降級、批次 Dock、多房同屏）
  hooks/                ← useRooms / usePolling / useEventStream / useTheme
  components/           ← Sidebar、RoomCard、Dashboard、AdvancedFilterBar 等
  utils/                ← 桌面通知、提示音、篩選管線
main.js                 ← Electron 入口（系統托盤、背景通知）
scripts/dev.js          ← 開發用並行啟動器
tests/                  ← node --test 測試（22+ 測試）
```

## 🔌 API 概覽

所有端點皆以 `/api/` 為前綴。

| 方法 | 端點 | 說明 |
| --- | --- | --- |
| GET | `/api/health` | 健康檢查 |
| GET | `/api/events` | SSE 即時推播串流 |
| GET | `/api/rooms` | 列出分組、房間（含即時狀態）、設定與統計 |
| POST | `/api/rooms` | 新增房間（支援房號、短號、完整網址） |
| PATCH / DELETE | `/api/rooms/:roomId` | 更新單房欄位（分組、備忘、置頂、通知）/ 刪除 |
| PATCH | `/api/rooms/:roomId/refresh` | 強制跳過快取刷新單房間 |
| PUT | `/api/rooms/order` | 更新卡片排序 |
| POST | `/api/rooms/batch-delete` | 批次刪除房間 |
| POST | `/api/rooms/batch-move` | 批次移動分組 |
| POST / DELETE | `/api/groups`、`/api/groups/:groupId` | 新增 / 刪除分組 |
| PATCH | `/api/settings` | 儲存設定（主題、通知、篩選預設集等） |
| GET | `/api/export` | 匯出完整 JSON 備份 |
| POST | `/api/import` | 匯入備份（`mode: "merge" \| "replace"`） |
| GET | `/api/image?url=...` | 封面圖片 proxy（僅放行 `hdslb.com`） |

## ⚙️ 設定與資料

預設監聽 `127.0.0.1:4174`，可用環境變數覆寫：

```bat
set PORT=4180
```

資料檔預設為 `data/rooms.json`，可透過 `BILILIVE_DATA_FILE` 指定其他路徑。資料包含房間、分組、設定與統計（歷史 Session）四個節點，舊版格式會自動遷移相容；寫入採暫存檔 + 重新命名的原子化策略，避免寫入中斷毀損資料。

## 💻 開發說明

- 修改 `src/` → Vite 自動 hot reload
- 修改 `server/` → **需手動重啟**（`Ctrl+C` 後重新執行）
- 後端禁止引入第三方套件；全專案使用 ESM（`"type": "module"`）
- `package.json` 中的 `overrides.esbuild` 版本鎖定不可移除

## ✅ 測試與驗證

```bash
npm test                 # node --test（room-utils / advanced / new-features，共 22+ 測試）
npm run build            # TypeScript 靜態檢查 + 打包
npm audit --omit=dev
```

## 📌 限制

- 僅支援公開的 BiliBili 直播間；不處理登入、付費、密碼房或會員限定內容
- BiliBili API 無穩定 CORS header，狀態查詢一律透過本機 Node proxy
- iframe 預覽使用 BiliBili 官方播放器；播放器內部的 cross-origin / permissions policy 主控台訊息屬正常現象，與本應用無關

## 📄 授權條款 (License)

本專案採用 [MIT License](LICENSE) 授權條款。詳細條款內容請參閱專案根目錄下的 [LICENSE](LICENSE) 檔案。

