#!/bin/bash

echo "🛑 停止 ChromaDB 服务..."

docker-compose -f docker-compose.chroma.yml down

echo "✅ ChromaDB 服务已停止"
