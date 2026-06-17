@echo off
chcp 65001 >nul
title AI Agent 启动控制器

echo ========================================
echo    AI Agent 内容生产数字员工 - 启动
echo ========================================
echo.

:: 1. 解析绝对路径并规范化
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%.."
set "ROOT_DIR=%CD%"

:: 2. 核心环境检查
set "VENV_PY=%ROOT_DIR%\backend\.venv\Scripts\python.exe"
set "WEB_MODULES=%ROOT_DIR%\web\node_modules"

if not exist "%VENV_PY%" (
    echo [错误] 找不到虚拟环境: "%ROOT_DIR%\backend\.venv"
    echo 请确认您已经成功运行并完成了 install.bat。
    pause
    exit /b 1
)

if not exist "%WEB_MODULES%" (
    echo [提示] 找不到前端 node_modules，正在尝试自动安装 (需数分钟)...
    cd /d "%ROOT_DIR%\web"
    call npm install --legacy-peer-deps
)

:: 3. 启动服务
echo [启动] 后端服务 (127.0.0.1:8000)...
cd /d "%ROOT_DIR%\backend"
start "AI-Backend" cmd /k "title AI-Backend && echo 后端正在运行... && ".venv\Scripts\python.exe" -m uvicorn main:app --host 127.0.0.1 --port 8000"

timeout /t 3 /nobreak >nul

echo [启动] 前端服务 (127.0.0.1:3000)...
cd /d "%ROOT_DIR%\web"
start "AI-Frontend" cmd /k "title AI-Frontend && echo 前端正在编译启动... && npm run dev"

echo.
echo ----------------------------------------
echo 正在尝试打开浏览器界面...
echo 如果页面打不开，请检查 AI-Backend 窗口是否有红色报错。
echo ----------------------------------------
timeout /t 5 /nobreak >nul

start http://127.0.0.1:3000/create/article
