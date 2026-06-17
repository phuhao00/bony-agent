#!/bin/bash
# ================================================
#  AI Media Agent — 一键部署脚本
#  用法: ./deploy.sh
#  前提: 已安装 Docker 和 Docker Compose
# ================================================

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

echo ""
echo "╔═══════════════════════════════════════╗"
echo "║   AI Media Agent — 一键部署           ║"
echo "╚═══════════════════════════════════════╝"
echo ""

# 1. 检查 Docker
if ! command -v docker &> /dev/null; then
    echo "❌ 未安装 Docker。请先安装 Docker:"
    echo "   https://docs.docker.com/get-docker/"
    exit 1
fi

if ! docker compose version &> /dev/null && ! docker-compose version &> /dev/null; then
    echo "❌ 未安装 Docker Compose。请先安装:"
    echo "   https://docs.docker.com/compose/install/"
    exit 1
fi

# 2. 检查 .env 配置
if [ ! -f "$PROJECT_DIR/backend/.env" ]; then
    echo "📝 未检测到 backend/.env 文件，正在从模板创建..."
    cp "$PROJECT_DIR/backend/.env.example" "$PROJECT_DIR/backend/.env"
    echo ""
    echo "⚠️  请编辑 backend/.env 配置你的 API Key，然后重新运行此脚本。"
    echo "   文件位置: $PROJECT_DIR/backend/.env"
    echo ""
    exit 1
fi

# 3. 创建数据目录
mkdir -p "$PROJECT_DIR/storage/outputs"
mkdir -p "$PROJECT_DIR/storage/uploads"
mkdir -p "$PROJECT_DIR/storage/temp"
mkdir -p "$PROJECT_DIR/storage/memory"
mkdir -p "$PROJECT_DIR/storage/rag"
mkdir -p "$PROJECT_DIR/logs"

# 4. 选择 compose 命令
COMPOSE_CMD="docker compose"
if ! docker compose version &> /dev/null; then
    COMPOSE_CMD="docker-compose"
fi

# 5. 构建和启动
echo "🔨 构建 Docker 镜像 (首次需要几分钟)..."
$COMPOSE_CMD build

echo ""
echo "🚀 启动服务..."
$COMPOSE_CMD up -d

echo ""
echo "╔═══════════════════════════════════════╗"
echo "║   ✅ 部署成功！                       ║"
echo "║                                       ║"
echo "║   前端: http://localhost:3000          ║"
echo "║   后端: http://localhost:8000          ║"
echo "║                                       ║"
echo "║   停止: $COMPOSE_CMD down              ║"
echo "║   日志: $COMPOSE_CMD logs -f           ║"
echo "╚═══════════════════════════════════════╝"
echo ""
