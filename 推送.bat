@echo off
chcp 65001 >nul
title Push to GitHub
cd /d "%~dp0"

echo ================================================
echo   Push this repository to GitHub
echo ================================================
echo.
echo Step 1: on github.com create an EMPTY repository
echo         (do NOT tick README / .gitignore)
echo Step 2: run this script
echo.
echo NOTE: the next prompt wants YOUR OWN account name
echo       (the one in github.com/XXXX), NOT the project name.
echo.
set "USERNAME="
set /p USERNAME=Your GitHub account name: 
if not defined USERNAME goto NOUSER

set "REPONAME="
set /p REPONAME=Repository name (press Enter for mc-resource-fetcher): 
if not defined REPONAME set "REPONAME=mc-resource-fetcher"

set "URL=https://github.com/%USERNAME%/%REPONAME%.git"
echo.
echo Remote will be: %URL%
echo Verify that page exists before continuing.
echo.

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 goto NOREPO

git remote remove origin >nul 2>&1
git remote add origin "%URL%"
echo Pushing ... a browser window may open for GitHub login.
echo.
git push -u origin main
if errorlevel 1 goto PUSHFAIL

echo.
echo ================================================
echo   Done. Open: https://github.com/%USERNAME%/%REPONAME%
echo ================================================
echo.
echo Next step - publish the built zip as a Release asset
echo (GitHub rejects files larger than 100MB inside a repository):
echo   https://github.com/%USERNAME%/%REPONAME%/releases/new
echo   upload: dist\MC-Launcher-0.1.0-win-x64.zip
echo.
pause
exit /b 0

:NOUSER
echo [ERROR] account name is required.
pause
exit /b 1

:NOREPO
echo [ERROR] this folder is not a git repository.
pause
exit /b 1

:PUSHFAIL
echo.
echo [ERROR] push failed. Common causes:
echo   - the repository was not created yet (create it on github.com first)
echo   - wrong account name / repository name
echo   - authentication cancelled
echo.
pause
exit /b 1
