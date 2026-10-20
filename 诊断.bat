@echo off
chcp 65001 >nul
title MC Launcher - Diagnose
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
set MC_LAUNCHER_DEBUG=1
del boot.log 2>nul
echo Starting with log capture ...
node_modules\electron\dist\electron.exe . --enable-logging=stderr > diag.log 2>&1
echo.
echo ===== exit code: %ERRORLEVEL% =====
if exist boot.log (
  echo ----- boot.log -----
  type boot.log
)
echo ----- diag.log -----
type diag.log
echo.
echo Send the text above to the developer.
pause
