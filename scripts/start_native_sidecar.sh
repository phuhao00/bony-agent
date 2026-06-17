#!/usr/bin/env bash
# Shared Native Sidecar launcher for start_local.sh / start_with_tunnel.sh
#
# Starts backend/services/native_sidecar_server.py and writes
# storage/temp/sidecar.port + sidecar.token for the FastAPI bridge client.
#
# Usage (after PYTHON_EXEC and PROJECT_DIR are set):
#   source "$PROJECT_DIR/scripts/start_native_sidecar.sh"
#   start_native_sidecar "$PROJECT_DIR" log
#
# Sets SIDECAR_PID (may be empty if already running).

start_native_sidecar() {
    local project_dir="$1"
    local log_fn="${2:-echo}"

    export SIDECAR_PID=""

    local script="$project_dir/backend/services/native_sidecar_server.py"
    if [ ! -f "$script" ]; then
        "$log_fn" "backend/services/native_sidecar_server.py 不存在，跳过 Native Sidecar"
        return 0
    fi

    mkdir -p "$project_dir/storage/temp" "$project_dir/logs"
    local sidecar_log="$project_dir/logs/native-sidecar.log"
    export PYTHONPATH="$project_dir/backend:${PYTHONPATH:-}"

    if [ -f "$project_dir/storage/temp/sidecar.port" ]; then
        local port
        port="$(tr -d '[:space:]' < "$project_dir/storage/temp/sidecar.port")"
        if [ -n "$port" ] && curl -sf "http://127.0.0.1:${port}/health" >/dev/null 2>&1; then
            "$log_fn" "Native Sidecar 已在运行 (127.0.0.1:${port})"
            return 0
        fi
    fi

    rm -f "$project_dir/storage/temp/sidecar.port" "$project_dir/storage/temp/sidecar.token"
    "$log_fn" "  Native Sidecar 日志 → $sidecar_log"
    cd "$project_dir" || return 1
    "$PYTHON_EXEC" "$script" >> "$sidecar_log" 2>&1 &
    SIDECAR_PID=$!
    export SIDECAR_PID
    sleep 0.6

    if [ -f "$project_dir/storage/temp/sidecar.port" ]; then
        local new_port
        new_port="$(tr -d '[:space:]' < "$project_dir/storage/temp/sidecar.port")"
        "$log_fn" "Native Sidecar 已启动 (127.0.0.1:${new_port}, pid $SIDECAR_PID)"
    elif kill -0 "$SIDECAR_PID" 2>/dev/null; then
        "$log_fn" "Native Sidecar 进程已启动 (pid $SIDECAR_PID)，等待 port 文件…"
    else
        "$log_fn" "Native Sidecar 启动失败，请查看 $sidecar_log"
        SIDECAR_PID=""
        export SIDECAR_PID
        return 1
    fi
    return 0
}

stop_native_sidecar() {
    if [ -n "${SIDECAR_PID:-}" ]; then
        kill "$SIDECAR_PID" 2>/dev/null || true
    fi
}
