#!/bin/bash

# ChromaDB 本地部署启动脚本

set -e

echo "🚀 启动 ChromaDB 本地服务..."

# 检查 Docker 是否安装
if ! command -v docker &> /dev/null; then
    echo "❌ Docker 未安装，请先安装 Docker"
    echo "访问 https://docs.docker.com/get-docker/ 安装"
    exit 1
fi

# 检查 Docker Compose 是否安装
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose 未安装，请先安装"
    echo "访问 https://docs.docker.com/compose/install/ 安装"
    exit 1
fi

# 创建数据目录
mkdir -p storage/chroma_data

# 检查 .env 文件
if [ ! -f .env ]; then
    echo "⚠️  .env 文件不存在，使用默认配置"
    echo "CHROMA_HOST=localhost" > .env
    echo "CHROMA_PORT=8001" >> .env
    echo "CHROMA_USE_HTTP=false" >> .env
fi

echo "📦 拉取最新镜像..."
docker-compose -f docker-compose.chroma.yml pull

echo "🟢 启动 ChromaDB 服务..."
docker-compose -f docker-compose.chroma.yml up -d

echo "⏳ 等待服务启动..."
sleep 5

# 检查服务状态
if curl -s http://localhost:8001/api/v1/heartbeat > /dev/null; then
    echo "✅ ChromaDB 服务启动成功！"
    echo ""
    echo "📊 访问地址："
    echo "   - ChromaDB API: http://localhost:8001"
    echo "   - ChromaDB UI:  http://localhost:3001"
    echo ""
    echo "📁 数据存储位置：./storage/chroma_data"
    echo ""
    echo "📝 要启用 HTTP 模式，请设置环境变量："
    echo "   export CHROMA_USE_HTTP=true"
    echo ""
    echo "🛑 停止服务：./stop_chroma.sh"
else
    echo "❌ 服务启动失败，请检查日志："
    echo "   docker-compose -f docker-compose.chroma.yml logs"
    exit 1
fi
