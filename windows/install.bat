@echo off
chcp 65001 >nul
title AI Agent 安装程序

echo ========================================
echo    AI Agent 内容生产数字员工 - 安装
echo ========================================
echo.

:: 1. 解析绝对路径
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%.."
set "ROOT_DIR=%CD%"

echo [路径] 项目根目录: "%ROOT_DIR%"

:: 2. 检测环境
set PY=
where python >nul 2>&1 && set PY=python
if not defined PY where python3 >nul 2>&1 && set PY=python3

if not defined PY (
    echo [错误] 找不到 Python 命令。请安装 Python 3.10+ 并勾选 "Add to PATH"。
    pause
    exit /b 1
)

where node >nul 2>&1 || (
    echo [错误] 找不到 Node.js 命令。请安装 Node.js 18+。
    pause
    exit /b 1
)

:: 3. 后端安装
echo.
echo [1/3] 配置后端虚拟环境...
cd /d "%ROOT_DIR%\backend"

:: 即使存在也尝试检查，如果 Scripts 不存在则认为是损坏的
if not exist ".venv\Scripts\python.exe" (
    echo 正在创建虚拟环境...
    if exist ".venv" rd /s /q ".venv"
    %PY% -m venv .venv || (echo [错误] 创建虚拟环境失败 && pause && exit /b 1)
)

echo 正在安装依赖包 (uvicorn, fastapi 等)...
".venv\Scripts\python.exe" -m pip install --upgrade pip -q
".venv\Scripts\pip.exe" install -r requirements.txt
if %errorlevel% neq 0 (
    echo [错误] 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
)

echo 正在安装浏览器执行环境...
".venv\Scripts\python.exe" -m playwright install chromium

:: 4. 前端安装
echo.
echo [2/3] 配置前端依赖环境...
cd /d "%ROOT_DIR%\web"
if exist "node_modules" (
    echo 依赖已存在，正在检查更新...
)
call npm install --legacy-peer-deps
if %errorlevel% neq 0 (
    echo [错误] 前端依赖安装失败。
    pause
    exit /b 1
)

echo.
echo ========================================
echo [3/3] 安装全部完成！
echo.
echo 请运行 start.bat 启动应用。
echo ========================================
pause
