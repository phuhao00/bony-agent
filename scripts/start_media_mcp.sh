#!/usr/bin/env bash
# Media MCP (:36850) — 与 start_local.sh / start_with_tunnel.sh 共用
# Backend lifespan 会通过 mcp_managed 恢复 ai_media_agent，勿重复启动。
# 依赖: PYTHON_EXEC, PROJECT_DIR, port_free, log, info, ok, warn, sep, check_pid

start_media_mcp_server() {
    if [ "${START_MEDIA_MCP:-1}" != "1" ]; then
        return 0
    fi

    sep
    info "启动 AI Media MCP Server (:36850)..."
    MEDIA_MCP_LOG="$PROJECT_DIR/logs/media_mcp.log"

    _media_mcp_pid_on_port() {
        lsof -ti:36850 2>/dev/null | head -1
    }

    if ! port_free 36850; then
        _existing="$(_media_mcp_pid_on_port)"
        if [ -n "$_existing" ]; then
            ok "Media MCP 已在运行 (pid ${_existing}，通常由 Backend MCP 托管恢复)"
            MEDIA_MCP_PID="$_existing"
            return 0
        fi
        warn "  端口 36850 被占用，尝试强制释放..."
        lsof -ti:36850 | xargs kill -9 2>/dev/null || true
        pkill -9 -f "services.media_mcp_server" 2>/dev/null || true
        sleep 1
    fi

    if ! port_free 36850; then
        _existing="$(_media_mcp_pid_on_port)"
        if [ -n "$_existing" ]; then
            ok "Media MCP 已在运行 (pid $_existing)"
            MEDIA_MCP_PID="$_existing"
            return 0
        fi
        warn "  端口 36850 仍被占用，跳过 Media MCP 启动"
        return 1
    fi

    cd "$PROJECT_DIR/backend"
    export MEDIA_MCP_PORT=36850
    export MEDIA_MCP_HOST=127.0.0.1
    "$PYTHON_EXEC" -m services.media_mcp_server > "$MEDIA_MCP_LOG" 2>&1 &
    MEDIA_MCP_PID=$!
    log "  Media MCP 进程启动 (pid $MEDIA_MCP_PID)"
    cd "$PROJECT_DIR"
    sleep 1
    check_pid "$MEDIA_MCP_PID" "Media MCP" || true
    return 0
}
