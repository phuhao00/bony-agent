#!/bin/bash
# ================================================
#  AI Media Agent — 原生运行发布包 (不使用 Docker)
#  生成适合小白直接双击运行的本地安装包
# ================================================

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$ROOT_DIR/dist"
PACKAGE_NAME="ai-media-agent-native"

echo ""
echo "╔═══════════════════════════════════════╗"
echo "║   打包 AI Media Agent 原生运行版      ║"
echo "╚═══════════════════════════════════════╝"
echo ""

rm -rf "$DIST_DIR/$PACKAGE_NAME"
mkdir -p "$DIST_DIR/$PACKAGE_NAME"

echo "[1/4] 复制后端和前端代码..."
# 后端
mkdir -p "$DIST_DIR/$PACKAGE_NAME/backend"
for dir in agents core tools utils; do
    [ -d "$ROOT_DIR/backend/$dir" ] && cp -r "$ROOT_DIR/backend/$dir" "$DIST_DIR/$PACKAGE_NAME/backend/"
done
cp "$ROOT_DIR/backend/"*.py "$DIST_DIR/$PACKAGE_NAME/backend/" 2>/dev/null || true
cp "$ROOT_DIR/backend/requirements.txt" "$DIST_DIR/$PACKAGE_NAME/backend/"
# ✅ 直接打包当前 .env (免除配置烦恼)
if [ -f "$ROOT_DIR/backend/.env" ]; then
    cp "$ROOT_DIR/backend/.env" "$DIST_DIR/$PACKAGE_NAME/backend/.env"
else
    cp "$ROOT_DIR/backend/.env.example" "$DIST_DIR/$PACKAGE_NAME/backend/.env"
fi

# 前端
mkdir -p "$DIST_DIR/$PACKAGE_NAME/web"
cp -r "$ROOT_DIR/web/app" "$DIST_DIR/$PACKAGE_NAME/web/"
cp -r "$ROOT_DIR/web/public" "$DIST_DIR/$PACKAGE_NAME/web/"
cp "$ROOT_DIR/web/package.json" "$DIST_DIR/$PACKAGE_NAME/web/"
cp "$ROOT_DIR/web/package-lock.json" "$DIST_DIR/$PACKAGE_NAME/web/" 2>/dev/null || true
cp "$ROOT_DIR/web/next.config.ts" "$DIST_DIR/$PACKAGE_NAME/web/"
cp "$ROOT_DIR/web/tsconfig.json" "$DIST_DIR/$PACKAGE_NAME/web/"
cp "$ROOT_DIR/web/postcss.config.mjs" "$DIST_DIR/$PACKAGE_NAME/web/"
cp "$ROOT_DIR/web/eslint.config.mjs" "$DIST_DIR/$PACKAGE_NAME/web/" 2>/dev/null || true
# 前端环境
echo "BACKEND_URL=http://localhost:8000" > "$DIST_DIR/$PACKAGE_NAME/web/.env.local"

echo "[2/4] 生成 Windows 一键脚本..."
cat > "$DIST_DIR/$PACKAGE_NAME/1-Install.bat" << 'WINOEF1'
@echo off
chcp 65001 >nul
set PYTHONUTF8=1
title AI Media Agent Setup

echo ========================================
echo    AI Media Agent Setup
echo ========================================
echo.

python --version >nul 2>&1
if errorlevel 1 (
    echo [INFO] Python not found. Downloading and installing Python 3.10 automatically...
    echo        This may take a few minutes. Please wait...
    powershell -Command "Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.10.11/python-3.10.11-amd64.exe' -OutFile 'python_installer.exe'"
    start /wait python_installer.exe /quiet InstallAllUsers=0 PrependPath=1 Include_test=0
    del python_installer.exe
    echo.
    echo [SUCCESS] Python installed successfully!
    echo [IMPORTANT] Environment variables have changed. 
    echo Please CLOSE THIS WINDOW and double-click "1-Install.bat" again to continue.
    pause
    exit /b 1
)

node --version >nul 2>&1
if errorlevel 1 (
    echo [INFO] Node.js not found. Downloading and installing Node.js 20 automatically...
    echo        This may take a few minutes. Please wait...
    powershell -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.12.0/node-v20.12.0-x64.msi' -OutFile 'node_installer.msi'"
    start /wait msiexec.exe /i node_installer.msi /quiet /qn /norestart
    del node_installer.msi
    echo.
    echo [SUCCESS] Node.js installed successfully!
    echo [IMPORTANT] Environment variables have changed. 
    echo Please CLOSE THIS WINDOW and double-click "1-Install.bat" again to continue.
    pause
    exit /b 1
)

echo [1/3] Creating Python Virtual Environment...
cd /d "%~dp0backend"
if not exist ".venv" (
    python -m venv .venv
)

echo [2/3] Installing Python Dependencies (may take a while)...
call .venv\Scripts\activate.bat
pip install -r requirements.txt -q
set PLAYWRIGHT_BROWSERS_PATH=%~dp0.browsers
python -m playwright install chromium

echo [3/3] Installing Frontend Dependencies...
cd /d "%~dp0..\web"
call npm install

echo.
echo ========================================
echo    Setup Complete! 
echo    You can now run "2-Start.bat"
echo ========================================
pause
WINOEF1

cat > "$DIST_DIR/$PACKAGE_NAME/2-Start.bat" << 'WINOEF2'
@echo off
chcp 65001 >nul
set PYTHONUTF8=1
title AI Media Agent Waiter

echo ========================================
echo    Starting AI Media Agent...
echo ========================================
echo.

set ROOT_DIR=%~dp0
set PLAYWRIGHT_BROWSERS_PATH=%ROOT_DIR%.browsers

if not exist "%ROOT_DIR%logs" mkdir "%ROOT_DIR%logs"
if not exist "%ROOT_DIR%storage\outputs" mkdir "%ROOT_DIR%storage\outputs"

echo [1/2] Starting Backend Server...
cd /d "%ROOT_DIR%backend"
if not exist ".venv" (
    echo [ERROR] Environment not installed. Please run "1-Install.bat" first.
    pause
    exit /b 1
)
start "AI Agent Backend" cmd /c "call .venv\Scripts\activate.bat && python -m uvicorn main:app --host 0.0.0.0 --port 8000"

timeout /t 3 /nobreak >nul

echo [2/2] Starting Frontend Server...
cd /d "%ROOT_DIR%web"
start "AI Agent Frontend" cmd /c "npm run dev"

echo.
echo Waiting for servers to initialize...
timeout /t 5 /nobreak >nul

start http://localhost:3000
echo.
echo Services running in background windows.
echo You can close this window now.
WINOEF2

echo "[3/4] 生成 Mac 一键脚本..."
cat > "$DIST_DIR/$PACKAGE_NAME/1-Install-Mac.command" << 'MACINIT'
#!/bin/bash
cd "$(dirname "$0")"

echo "========================================"
echo "   AI Media Agent Setup (Mac)"
echo "========================================"
echo ""

if ! command -v python3 &> /dev/null; then
    echo "❌ [ERROR] Python3 not found. Please install Python 3.10+"
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo "❌ [ERROR] Node.js not found. Please install Node.js 18+"
    exit 1
fi

echo "[1/3] Creating Python Virtual Environment..."
cd backend
if [ ! -d ".venv" ]; then
    python3 -m venv .venv
fi

echo "[2/3] Installing Python Dependencies..."
source .venv/bin/activate
pip install -r requirements.txt -q
export PLAYWRIGHT_BROWSERS_PATH="$(pwd)/../.browsers"
python -m playwright install chromium

echo "[3/3] Installing Frontend Dependencies..."
cd ../web
npm install

echo ""
echo "========================================"
echo "   Setup Complete! "
echo "   You can now run '2-Start-Mac.command'"
echo "========================================"
MACINIT
chmod +x "$DIST_DIR/$PACKAGE_NAME/1-Install-Mac.command"

cat > "$DIST_DIR/$PACKAGE_NAME/2-Start-Mac.command" << 'MACRUN'
#!/bin/bash
cd "$(dirname "$0")"
ROOT_DIR="$(pwd)"

echo "========================================"
echo "   Starting AI Media Agent..."
echo "========================================"
echo ""

mkdir -p logs
mkdir -p storage/outputs 

if [ ! -d "backend/.venv" ]; then
    echo "❌ [ERROR] Environment not installed. Run '1-Install-Mac.command' first."
    exit 1
fi

export PLAYWRIGHT_BROWSERS_PATH="$ROOT_DIR/.browsers"

echo "[1/2] Starting Backend Server..."
cd backend
source .venv/bin/activate
python -m uvicorn main:app --host 0.0.0.0 --port 8000 > ../logs/backend.log 2>&1 &
BACKEND_PID=$!

sleep 2

echo "[2/2] Starting Frontend Server..."
cd ../web
npm run dev > ../logs/frontend.log 2>&1 &
FRONTEND_PID=$!

echo ""
echo "✅ Services Started!"
echo "Backend logging to logs/backend.log"
echo "Frontend logging to logs/frontend.log"
echo ""

sleep 3
open http://localhost:3000

echo "Press Ctrl+C to stop services..."
trap "kill $BACKEND_PID $FRONTEND_PID; exit" INT TERM
wait
MACRUN
chmod +x "$DIST_DIR/$PACKAGE_NAME/2-Start-Mac.command"

echo "[4/4] 打包..."
cd "$DIST_DIR"
rm -f "${PACKAGE_NAME}.zip"
zip -rq "${PACKAGE_NAME}.zip" "$PACKAGE_NAME"

SIZE_ZIP=$(du -sh "${PACKAGE_NAME}.zip" | cut -f1)

echo ""
echo "╔═══════════════════════════════════════════╗"
echo "║   ✅ 打包完成！(原生运行版)               ║"
echo "╠═══════════════════════════════════════════╣"
echo "║   输出: dist/${PACKAGE_NAME}.zip   "
echo "║   大小: $SIZE_ZIP                         "
echo "╚═══════════════════════════════════════════╝"
echo ""
echo "📦 小白使用方法 (无需 Docker):"
echo "   1. 将 ${PACKAGE_NAME}.zip 发送给朋友"
echo "   2. 解压文件夹"
echo "   3. 首次运行: 双击 【1-安装环境】文件自动下载安装环境"
echo "   4. 以后启动: 双击 【2-启动软件】文件自动运行并打开网页"
echo ""
