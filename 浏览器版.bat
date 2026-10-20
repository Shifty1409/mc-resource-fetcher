@echo off
chcp 65001 >nul
title MC Launcher - Browser Mode
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
set MC_LAUNCHER_HOME=%~dp0.mcdata

if not exist ".harness\main\server.js" call node node_modules\typescript\bin\tsc -p tsconfig.harness.json
if not exist "out\main\index.js" call node node_modules\electron-vite\bin\electron-vite.js build

echo Starting browser mode. The URL is printed below.
echo Close this window to stop the service.
echo.
node .harness\main\server.js --port=19388 --open
echo.
echo Server stopped.
pause
