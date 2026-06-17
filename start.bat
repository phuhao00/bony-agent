@echo off
setlocal enabledelayedexpansion
title AI Media Agent

:: Ports to clear
set "BACKEND_PORT=8000"
set "FRONTEND_PORT=3000"

echo [1/4] Cleaning up ports %BACKEND_PORT% and %FRONTEND_PORT%...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%BACKEND_PORT% " 2^>nul') do taskkill /f /pid %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%FRONTEND_PORT% " 2^>nul') do taskkill /f /pid %%a >nul 2>&1

set "ROOT_DIR=%~dp0"
set "NODE_BIN=!ROOT_DIR!storage\tools\node\node-v20.18.3-win-x64"
set "VENV_PYTHON=!ROOT_DIR!venv\Scripts\python.exe"

:: Set path for the current process and its children
set "PATH=!NODE_BIN!;%PATH%"

echo [2/4] Starting Backend on %BACKEND_PORT%...
:: Run backend in background within same terminal (no /k or new window title)
start /B cmd /c "cd /d !ROOT_DIR! && set PYTHONPATH=!ROOT_DIR!backend && set PATH=!NODE_BIN!;%PATH% && !VENV_PYTHON! -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port %BACKEND_PORT%"

echo [3/4] Starting Frontend on %FRONTEND_PORT%...
:: Launch browser in background (wait 5s for backend to init)
start /B cmd /c "timeout /t 5 >nul && start http://localhost:3000"

:: Run frontend in foreground
cd /d !ROOT_DIR!web
set PATH=!NODE_BIN!;%PATH%
echo Starting Frontend...
call npm run dev

echo [DONE] Applications are running in separate windows.
pause
