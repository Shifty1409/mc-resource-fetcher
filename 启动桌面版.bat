@echo off
chcp 65001 >nul
title MC Launcher - Desktop
cd /d "%~dp0"

rem keep this console minimized so it does not cover the UI
if not "%~1"=="--min" (
  start "" /min "%~f0" --min
  exit /b 0
)

rem ============ 2) app-window mode (Edge/Chrome --app) ============
if exist "resources\server\main\server.js" (
  set "SERVER_EXE=%~dp0MC-Launcher.exe"
  set "SERVER_JS=resources\server\main\server.js"
  set "DATA_DIR=%~dp0MCLauncherData"
  set ELECTRON_RUN_AS_NODE=1
) else (
  set "SERVER_EXE=node"
  set "SERVER_JS=.harness\main\server.js"
  set "DATA_DIR=%~dp0.mcdata"
  set ELECTRON_RUN_AS_NODE=
)
set "MC_LAUNCHER_HOME=%DATA_DIR%"
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"
del "%DATA_DIR%\server-port.txt" 2>nul

echo Starting local service ...
start "MC Launcher Service" /min "%SERVER_EXE%" %SERVER_JS% --port=19388

set "PORT="
for /l %%i in (1,1,25) do (
  if exist "%DATA_DIR%\server-port.txt" (
    set /p PORT=<"%DATA_DIR%\server-port.txt"
    goto READY
  )
  ping -n 2 127.0.0.1 >nul
)
echo [ERROR] local service did not start within 25s.
echo Check "%DATA_DIR%\logs\server.log".
pause
exit /b 1

:READY
echo Service ready: http://127.0.0.1:%PORT%/

set "BROWSER="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if defined BROWSER goto APPMODE
echo No Edge/Chrome found, opening default browser instead.
start "" "http://127.0.0.1:%PORT%/"
pause
exit /b 0

:APPMODE
echo Opening app window ...
start /wait "" "%BROWSER%" --app=http://127.0.0.1:%PORT%/ --window-size=1400,880 --user-data-dir="%DATA_DIR%\app-window" --no-first-run --no-default-browser-check
echo Window closed, stopping service ...
powershell -NoProfile -Command "try{Invoke-WebRequest -UseBasicParsing -Method POST http://127.0.0.1:%PORT%/api/shutdown -TimeoutSec 2 | Out-Null}catch{}"
ping -n 3 127.0.0.1 >nul
exit /b 0
