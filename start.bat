@echo off
chcp 65001 >nul
setlocal

cd /d "%~dp0"

if "%HOST%"=="" set "HOST=127.0.0.1"
if "%PORT%"=="" set "PORT=4174"
set "APP_URL=http://%HOST%:%PORT%"
set "HEALTH_URL=%APP_URL%/api/rooms"

echo [BiliLive Watch] 正在清理佔用連接埠 %PORT% 的舊進程...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort %PORT% -ErrorAction SilentlyContinue | ForEach-Object { if ($_.OwningProcess -gt 0) { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }" >nul 2>nul

where node >nul 2>nul
if errorlevel 1 (
  echo [BiliLive Watch] 找不到 Node.js。請先安裝 Node.js 20 或更新版本。
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [BiliLive Watch] 找不到 npm。請確認 Node.js 安裝完整。
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo [BiliLive Watch] 第一次啟動，正在安裝依賴...
  call npm install
  if errorlevel 1 (
    echo [BiliLive Watch] 依賴安裝失敗。
    pause
    exit /b 1
  )
)

echo [BiliLive Watch] 正在建置前端...
call npm run build
if errorlevel 1 (
  echo [BiliLive Watch] 建置失敗。
  pause
  exit /b 1
)

echo [BiliLive Watch] 啟動網址：%APP_URL%
start /B powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process '%APP_URL%'" >nul 2>nul

echo [BiliLive Watch] Server 啟動中。關閉此視窗即可停止服務。
call npm start

pause
