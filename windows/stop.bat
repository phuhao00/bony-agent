@echo off
chcp 65001 >nul
title 停止 AI Agent 服务

echo 正在停止服务...

:: 停止 Node.js 进程
taskkill /f /im node.exe >nul 2>&1

:: 停止 Python 进程 (uvicorn)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000"') do taskkill /f /pid %%a >nul 2>&1

echo 服务已停止
timeout /t 2 /nobreak >nul
