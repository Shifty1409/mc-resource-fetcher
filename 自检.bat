@echo off
chcp 65001 >nul
title MC Launcher - Self Test
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
set MC_LAUNCHER_HOME=%~dp0.mcdata

echo Compiling harness ...
node node_modules\typescript\bin\tsc -p tsconfig.harness.json
echo.
echo Running self test (it really downloads and launches the game) ...
node .harness\main\harness.js --mc=1.20.1 --loader=fabric
echo.
echo Result is also written to .mcdata\logs\smoke.log
pause
