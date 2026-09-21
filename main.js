import { app, BrowserWindow, Menu, Tray, nativeImage } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4174);

// 16x16 紫色主題托盤圖示 Base64 PNG
const TRAY_ICON_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAd0lEQVR4nGNgwAK6Y75JdMd8i+yO+VYNxSC2BDa12DTO7Y759h8HnovToO6YbxbdMd8e49EMwyA1FthsJkYzsiESyAbgczZO7yDbTqpmGJZggIYwuQZEMkCjiVwDqqliAMVeoCwQKY5GqiQkipMyVTITFoOIys4AMQk0E6PdVooAAAAASUVORK5CYII=";

// 啟動 API / Static 伺服器
import("./server/index.js");

let mainWindow = null;
let tray = null;
let statusPollTimer = null;

async function updateTrayTooltip() {
  if (!tray) return;

  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/rooms`);
    if (!res.ok) return;

    const data = await res.json();
    const rooms = Array.isArray(data?.rooms) ? data.rooms : [];
    const liveCount = rooms.filter((room) => room.status === "live").length;

    const tooltip =
      liveCount > 0
        ? `BiliLive Watch — ${liveCount} 個直播中`
        : "BiliLive Watch — 目前無直播";

    tray.setToolTip(tooltip);
  } catch {
    // 查詢錯誤時靜默忽略
  }
}

function createTray() {
  const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL);
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "顯示視窗",
      click: () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip("BiliLive Watch — 目前無直播");

  tray.on("click", () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  updateTrayTooltip();
  statusPollTimer = setInterval(updateTrayTooltip, 30_000);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 650,
    title: "BiliLive Watch",
    icon: path.join(__dirname, "build/icon.png"),
    backgroundColor: "#090b12",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // 移除預設選單欄，保持簡潔原生感
  mainWindow.setMenuBarVisibility(false);

  // 防抖加載：若 API 伺服器尚未 listen 完成，將以 100ms 間隔重試
  const loadURLWithRetry = () => {
    mainWindow.loadURL(`http://127.0.0.1:${PORT}`).catch(() => {
      setTimeout(loadURLWithRetry, 100);
    });
  };

  loadURLWithRetry();

  // 點擊關閉按鈕時縮小至系統托盤
  mainWindow.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// 單一實例保護：防止多重啟動造成 port 衝突與重複視窗
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.on("before-quit", () => {
    app.isQuitting = true;
    if (statusPollTimer) {
      clearInterval(statusPollTimer);
      statusPollTimer = null;
    }
  });

  app.whenReady().then(() => {
    createWindow();
    createTray();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      } else if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
