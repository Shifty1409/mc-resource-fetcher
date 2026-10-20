@echo off
chcp 65001 >nul
title MC Launcher - Build
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
set ELECTRON_BUILDER_CACHE=%~dp0..\.eb-cache
set CSC_IDENTITY_AUTO_DISCOVERY=false

echo [1/3] building renderer + main ...
node node_modules\electron-vite\bin\electron-vite.js build
if errorlevel 1 goto FAIL

echo [2/3] generating icon ...
if exist build\icon.ico goto ICONOK
echo     (icon missing, skip)
:ICONOK

echo [3/3] packaging zip ...
node node_modules\electron-builder\out\cli\cli.js --win zip --x64
if errorlevel 1 goto FAIL

echo.
echo Done. Output: dist\MC-Launcher-*-win-x64.zip
pause
exit /b 0

:FAIL
echo.
echo BUILD FAILED, see messages above.
pause
exit /b 1
