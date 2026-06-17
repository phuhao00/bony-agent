#!/bin/bash
# 打包 AI Media Agent Windows 发布版（内部使用，含 .env）
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$ROOT_DIR/dist"
STAGE_DIR="$ROOT_DIR/storage/temp/windows-package"
PACKAGE_NAME="ai-media-agent-windows"
PACKAGE_DIR="$STAGE_DIR/$PACKAGE_NAME"
ZIP_PATH="$DIST_DIR/${PACKAGE_NAME}.zip"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║   AI Media Agent — Windows 发布包构建            ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ── 清理 staging ─────────────────────────────────────────────────────────────
rm -rf "$STAGE_DIR"
mkdir -p "$PACKAGE_DIR" "$DIST_DIR"

# rsync 通用排除项
RSYNC_EXCLUDES=(
  --exclude '.DS_Store'
  --exclude '__MACOSX'
  --exclude '._*'
  --exclude '__pycache__'
  --exclude '.pytest_cache'
  --exclude '*.pyc'
  --exclude '.venv'
  --exclude 'venv'
  --exclude 'node_modules'
  --exclude '.next/cache'
  --exclude '.git'
  --exclude 'agent.log'
  --exclude 'agent.log.*'
  --exclude 'tsconfig.tsbuildinfo'
  --exclude '*.code-workspace'
)

rsync_dir() {
  local src="$1" dst="$2"
  mkdir -p "$dst"
  rsync -a "${RSYNC_EXCLUDES[@]}" "$src/" "$dst/"
}

# ── 1. 后端 ───────────────────────────────────────────────────────────────────
echo "[1/8] 复制后端..."
mkdir -p "$PACKAGE_DIR/backend"
for dir in agents core tools utils services routers generated admin assets; do
  [ -d "$ROOT_DIR/backend/$dir" ] && rsync_dir "$ROOT_DIR/backend/$dir" "$PACKAGE_DIR/backend/$dir"
done
cp "$ROOT_DIR/backend/main.py" "$PACKAGE_DIR/backend/"
cp "$ROOT_DIR/backend/requirements.txt" "$PACKAGE_DIR/backend/"
[ -f "$ROOT_DIR/backend/__init__.py" ] && cp "$ROOT_DIR/backend/__init__.py" "$PACKAGE_DIR/backend/"
cp "$ROOT_DIR/backend/.env" "$PACKAGE_DIR/backend/.env"
cp "$ROOT_DIR/backend/.env.example" "$PACKAGE_DIR/backend/.env.example" 2>/dev/null || true

# ── 2. 前端 ───────────────────────────────────────────────────────────────────
echo "[2/8] 复制前端..."
mkdir -p "$PACKAGE_DIR/web"
for dir in app components lib contexts hooks types messages public; do
  [ -d "$ROOT_DIR/web/$dir" ] && rsync_dir "$ROOT_DIR/web/$dir" "$PACKAGE_DIR/web/$dir"
done
for f in package.json package-lock.json next.config.ts tsconfig.json postcss.config.mjs eslint.config.mjs next-env.d.ts; do
  [ -f "$ROOT_DIR/web/$f" ] && cp "$ROOT_DIR/web/$f" "$PACKAGE_DIR/web/"
done
cp "$ROOT_DIR/web/.env.local" "$PACKAGE_DIR/web/.env.local" 2>/dev/null || \
  echo "BACKEND_URL=http://127.0.0.1:8000" > "$PACKAGE_DIR/web/.env.local"

# ── 3. Agent Skills ───────────────────────────────────────────────────────────
echo "[3/8] 复制 Agent Skills..."
[ -d "$ROOT_DIR/.agent" ] && rsync_dir "$ROOT_DIR/.agent" "$PACKAGE_DIR/.agent"
[ -d "$ROOT_DIR/.agents" ] && rsync_dir "$ROOT_DIR/.agents" "$PACKAGE_DIR/.agents"

# ── 4. Windows 脚本 ───────────────────────────────────────────────────────────
echo "[4/8] 复制 Windows 脚本..."
mkdir -p "$PACKAGE_DIR/windows"
cp "$ROOT_DIR/windows/"*.bat "$PACKAGE_DIR/windows/" 2>/dev/null || true
cp "$ROOT_DIR/windows/README.txt" "$PACKAGE_DIR/windows/" 2>/dev/null || true
cp "$ROOT_DIR/start_windows.bat" "$PACKAGE_DIR/start_windows.bat"

# ── 5. 存储目录（配置 + 空目录结构，不含大体积 outputs）────────────────────────
echo "[5/8] 创建 storage 目录结构..."
STORAGE_DIRS=(
  outputs uploads temp tmp rag memory knowledge profiles scheduler
  trending chroma_db computer debug evolution approvals tasks traces
  research customer_service companion meal feishu_votes jenkins tools
)
for d in "${STORAGE_DIRS[@]}"; do
  mkdir -p "$PACKAGE_DIR/storage/$d"
done
mkdir -p "$PACKAGE_DIR/logs" "$PACKAGE_DIR/.browsers"

# 复制小型运行时配置（不含大文件）
for cfg in mcp_servers.json skills_enabled.json mcp_managed.json lobster_nodes.json hermes_instances.json; do
  [ -f "$ROOT_DIR/storage/$cfg" ] && cp "$ROOT_DIR/storage/$cfg" "$PACKAGE_DIR/storage/$cfg"
done
# 平台凭证与知识库索引（内部团队需要）
[ -f "$ROOT_DIR/storage/platform_credentials.json" ] && \
  cp "$ROOT_DIR/storage/platform_credentials.json" "$PACKAGE_DIR/storage/"
[ -d "$ROOT_DIR/storage/profiles" ] && \
  rsync_dir "$ROOT_DIR/storage/profiles" "$PACKAGE_DIR/storage/profiles"
[ -d "$ROOT_DIR/storage/scheduler" ] && \
  rsync_dir "$ROOT_DIR/storage/scheduler" "$PACKAGE_DIR/storage/scheduler"
[ -d "$ROOT_DIR/storage/knowledge" ] && \
  rsync_dir "$ROOT_DIR/storage/knowledge" "$PACKAGE_DIR/storage/knowledge"
[ -d "$ROOT_DIR/storage/rag" ] && \
  rsync_dir "$ROOT_DIR/storage/rag" "$PACKAGE_DIR/storage/rag"

# ── 6. 文档 ───────────────────────────────────────────────────────────────────
echo "[6/8] 复制文档..."
for doc in README.md AGENTS.md CLAUDE.md; do
  [ -f "$ROOT_DIR/$doc" ] && cp "$ROOT_DIR/$doc" "$PACKAGE_DIR/"
done
[ -f "$ROOT_DIR/docs/WINDOWS_DEPLOYMENT.md" ] && \
  mkdir -p "$PACKAGE_DIR/docs" && cp "$ROOT_DIR/docs/WINDOWS_DEPLOYMENT.md" "$PACKAGE_DIR/docs/"

# ── 7. 内部使用说明 ───────────────────────────────────────────────────────────
cat > "$PACKAGE_DIR/使用说明.txt" << 'EOF'
AI Media Agent — Windows 内部版
================================

【一键启动（推荐）】
  双击 start_windows.bat
  首次运行会自动安装 Python/Node/FFmpeg/Playwright 并构建前端（约 5-15 分钟）
  后续启动约 30 秒

【访问地址】
  前端: http://127.0.0.1:3000
  后端: http://127.0.0.1:8000
  文档: http://127.0.0.1:8000/docs

【API Key】
  已预置 backend\.env，开箱即用
  如需修改，编辑 backend\.env 后重启

【停止服务】
  运行 windows\stop.bat 或关闭 AI-Backend / AI-Frontend 窗口

【分步操作】
  windows\install.bat  — 仅安装依赖
  windows\start.bat    — 仅启动（需先 install）
  windows\stop.bat     — 停止服务
EOF

# ── 8. 打包 zip ───────────────────────────────────────────────────────────────
echo "[7/8] 创建 ZIP 压缩包..."
rm -f "$ZIP_PATH"
(cd "$STAGE_DIR" && zip -r -X "$ZIP_PATH" "$PACKAGE_NAME" -q)

echo "[8/8] 验证压缩包..."
# 检查不应出现的条目
BAD=$(zipinfo -1 "$ZIP_PATH" 2>/dev/null | grep -E '(^|/)(__MACOSX|\.DS_Store|node_modules|\.venv|\.git)(/|$)|(^|/)\._' || true)
if [ -n "$BAD" ]; then
  echo "⚠ 警告：压缩包含不应出现的条目："
  echo "$BAD" | head -5
fi

# 检查超长路径
LONG=$(zipinfo -1 "$ZIP_PATH" 2>/dev/null | awk 'length($0) > 200 { print length($0), $0 }' | head -5)
if [ -n "$LONG" ]; then
  echo "⚠ 警告：存在超长路径（Windows 可能解压失败）："
  echo "$LONG"
fi

SIZE=$(du -sh "$ZIP_PATH" | cut -f1)
FILE_COUNT=$(zipinfo -1 "$ZIP_PATH" | wc -l | tr -d ' ')

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║   ✅ Windows 发布包构建完成                       ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  输出: dist/${PACKAGE_NAME}.zip"
echo "║  大小: $SIZE"
echo "║  文件: $FILE_COUNT 个"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "📦 给同事使用："
echo "   1. 发送 dist/${PACKAGE_NAME}.zip"
echo "   2. 解压到短路径（如 C:\\ai-agent\\）"
echo "   3. 双击 start_windows.bat"
echo ""
