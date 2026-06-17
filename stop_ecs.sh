#!/bin/bash
# stop_ecs.sh — 停止所有 AI Media Agent 服务

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGS_DIR="$PROJECT_DIR/logs"
BACKEND_PID_FILE="$LOGS_DIR/backend.pid"
FRONTEND_PID_FILE="$LOGS_DIR/frontend.pid"

stop_pid() {
    local name="$1"
    local file="$2"
    if [[ -f "$file" ]]; then
        local pid
        pid=$(cat "$file")
        if kill "$pid" 2>/dev/null; then
            echo "✓ $name (PID $pid) 已停止"
        else
            echo "! $name (PID $pid) 进程不存在"
        fi
        rm -f "$file"
    else
        echo "! 未找到 $name 的 PID 文件，尝试强制终止..."
    fi
}

stop_pid "Backend"  "$BACKEND_PID_FILE"
stop_pid "Frontend" "$FRONTEND_PID_FILE"

# 兜底强制清理
lsof -ti:8000,3000 | xargs kill -9 2>/dev/null || true
pkill -f "uvicorn main:app" 2>/dev/null || true
pkill -f "next start" 2>/dev/null || true

echo ""
echo "所有服务已停止。"
