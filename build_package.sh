#!/bin/bash
# ================================================
#  AI Media Agent — 一键打包 (小白版)
#  直接打包当前配置，解压即用
# ================================================

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$ROOT_DIR/dist"
PACKAGE_NAME="ai-media-agent"

echo ""
echo "╔═══════════════════════════════════════╗"
echo "║   AI Media Agent — 一键打包           ║"
echo "╚═══════════════════════════════════════╝"
echo ""

rm -rf "$DIST_DIR/$PACKAGE_NAME"
mkdir -p "$DIST_DIR/$PACKAGE_NAME"

echo "[1/5] 复制后端..."
mkdir -p "$DIST_DIR/$PACKAGE_NAME/backend"
for dir in agents core tools utils; do
    [ -d "$ROOT_DIR/backend/$dir" ] && cp -r "$ROOT_DIR/backend/$dir" "$DIST_DIR/$PACKAGE_NAME/backend/"
done
cp "$ROOT_DIR/backend/"*.py "$DIST_DIR/$PACKAGE_NAME/backend/" 2>/dev/null || true
cp "$ROOT_DIR/backend/requirements.txt" "$DIST_DIR/$PACKAGE_NAME/backend/"
cp "$ROOT_DIR/backend/Dockerfile" "$DIST_DIR/$PACKAGE_NAME/backend/"
cp "$ROOT_DIR/backend/.dockerignore" "$DIST_DIR/$PACKAGE_NAME/backend/"
# ✅ 直接打包当前 .env (含 API Key)
cp "$ROOT_DIR/backend/.env" "$DIST_DIR/$PACKAGE_NAME/backend/.env"

echo "[2/5] 复制前端..."
mkdir -p "$DIST_DIR/$PACKAGE_NAME/web"
cp -r "$ROOT_DIR/web/app" "$DIST_DIR/$PACKAGE_NAME/web/"
cp -r "$ROOT_DIR/web/public" "$DIST_DIR/$PACKAGE_NAME/web/"
cp "$ROOT_DIR/web/package.json" "$DIST_DIR/$PACKAGE_NAME/web/"
cp "$ROOT_DIR/web/package-lock.json" "$DIST_DIR/$PACKAGE_NAME/web/" 2>/dev/null || true
cp "$ROOT_DIR/web/next.config.ts" "$DIST_DIR/$PACKAGE_NAME/web/"
cp "$ROOT_DIR/web/tsconfig.json" "$DIST_DIR/$PACKAGE_NAME/web/"
cp "$ROOT_DIR/web/postcss.config.mjs" "$DIST_DIR/$PACKAGE_NAME/web/"
cp "$ROOT_DIR/web/eslint.config.mjs" "$DIST_DIR/$PACKAGE_NAME/web/" 2>/dev/null || true
cp "$ROOT_DIR/web/Dockerfile" "$DIST_DIR/$PACKAGE_NAME/web/"
cp "$ROOT_DIR/web/.dockerignore" "$DIST_DIR/$PACKAGE_NAME/web/"

echo "[3/5] 复制启动配置..."
cp "$ROOT_DIR/docker-compose.yml" "$DIST_DIR/$PACKAGE_NAME/"

# Windows 脚本
[ -d "$ROOT_DIR/windows" ] && cp -r "$ROOT_DIR/windows" "$DIST_DIR/$PACKAGE_NAME/"

echo "[4/5] 创建一键启动脚本..."

# === Mac/Linux 一键启动 ===
cat > "$DIST_DIR/$PACKAGE_NAME/start.sh" << 'STARTEOF'
#!/bin/bash
cd "$(dirname "${BASH_SOURCE[0]}")"

echo ""
echo "🚀 AI Media Agent 启动中..."
echo ""

# 检查 Docker
if ! command -v docker &> /dev/null; then
    echo "❌ 请先安装 Docker Desktop:"
    echo "   Mac:     https://docs.docker.com/desktop/install/mac-install/"
    echo "   Windows: https://docs.docker.com/desktop/install/windows-install/"
    echo "   Linux:   https://docs.docker.com/desktop/install/linux/"
    echo ""
    read -p "按回车退出..." 
    exit 1
fi

# 创建目录
mkdir -p storage/outputs storage/uploads storage/temp storage/memory storage/rag logs

# 选择 compose 命令
COMPOSE_CMD="docker compose"
docker compose version &>/dev/null || COMPOSE_CMD="docker-compose"

echo "📦 首次启动需要下载依赖，请耐心等待..."
echo ""
$COMPOSE_CMD up -d --build

echo ""
echo "✅ 启动成功！"
echo ""
echo "👉 请打开浏览器访问: http://localhost:3000"
echo ""
echo "停止服务: $COMPOSE_CMD down"
echo ""

# Mac 自动打开浏览器
if command -v open &> /dev/null; then
    sleep 3
    open http://localhost:3000
fi
STARTEOF
chmod +x "$DIST_DIR/$PACKAGE_NAME/start.sh"

# === Windows 一键启动 (双击运行) ===
cat > "$DIST_DIR/$PACKAGE_NAME/start.bat" << 'BATEOF'
@echo off
title AI Media Agent

echo.
echo [AI Media Agent] Starting...
echo.

where docker >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Docker not found. Please install Docker Desktop first:
    echo    https://docs.docker.com/desktop/install/windows-install/
    echo.
    pause
    exit /b 1
)

if not exist storage\outputs mkdir storage\outputs
if not exist storage\uploads mkdir storage\uploads
if not exist storage\temp mkdir storage\temp
if not exist storage\memory mkdir storage\memory
if not exist logs mkdir logs

echo [INFO] Building and starting services (first run may take a few minutes)...
echo.
docker compose up -d --build

echo.
echo [OK] Started successfully!
echo.
echo Open your browser: http://localhost:3000
echo.

timeout /t 3 >nul
start http://localhost:3000

pause
BATEOF

# === 停止脚本 ===
cat > "$DIST_DIR/$PACKAGE_NAME/stop.sh" << 'STOPEOF'
#!/bin/bash
cd "$(dirname "${BASH_SOURCE[0]}")"
COMPOSE_CMD="docker compose"
docker compose version &>/dev/null || COMPOSE_CMD="docker-compose"
$COMPOSE_CMD down
echo "✅ 已停止"
STOPEOF
chmod +x "$DIST_DIR/$PACKAGE_NAME/stop.sh"

cat > "$DIST_DIR/$PACKAGE_NAME/stop.bat" << 'STOPBAT'
@echo off
docker compose down
echo [OK] Services stopped.
pause
STOPBAT

echo "[5/5] 打包..."
cd "$DIST_DIR"
tar -czf "${PACKAGE_NAME}.tar.gz" "$PACKAGE_NAME"
# 同时生成 zip 方便 Windows 用户
zip -rq "${PACKAGE_NAME}.zip" "$PACKAGE_NAME"

SIZE_TGZ=$(du -sh "${PACKAGE_NAME}.tar.gz" | cut -f1)
SIZE_ZIP=$(du -sh "${PACKAGE_NAME}.zip" | cut -f1)

echo ""
echo "╔═══════════════════════════════════════════╗"
echo "║   ✅ 打包完成！                            ║"
echo "╠═══════════════════════════════════════════╣"
echo "║   Mac/Linux: dist/${PACKAGE_NAME}.tar.gz ($SIZE_TGZ)"
echo "║   Windows:   dist/${PACKAGE_NAME}.zip ($SIZE_ZIP)"
echo "╚═══════════════════════════════════════════╝"
echo ""
echo "📦 给别人使用:"
echo "   1. 发送压缩包"
echo "   2. 解压"
echo "   3. Mac: 双击 start.sh  /  Windows: 双击 start.bat"
echo "   (需要先安装 Docker Desktop)"
echo ""
