#!/usr/bin/env bash
# Shared Boni desktop pet (Tauri sidecar) launcher for start_local.sh / start_with_tunnel.sh
#
# Env:
#   START_DESKTOP_PET=1|0     default 0 — set 1 to auto-start with start_local.sh
#   VITE_BACKEND_URL          default http://127.0.0.1:8000
#   VITE_CONSOLE_URL          default http://127.0.0.1:3000/companion
#   DESKTOP_PET_DEV=1|0       default 1 — use `npm run tauri:dev`; set 0 to launch built .app only

desktop_pet_port_free() {
    ! lsof -ti:"$1" >/dev/null 2>&1
}

# Usage: desktop_pet_start PROJECT_DIR [log_function_name]
# Sets DESKTOP_PET_PID on success (exported).
desktop_pet_start() {
    local project_dir="$1"
    local log_fn="${2:-echo}"

    # 避免父脚本 set -u 下未 export 导致子函数赋值不可见
    export DESKTOP_PET_PID=""

    if [ "${START_DESKTOP_PET:-0}" = "0" ]; then
        "$log_fn" "桌面宠物未随脚本启动（默认关闭；陪伴室 /companion →「启动桌宠」，或 START_DESKTOP_PET=1）"
        return 0
    fi

    local pet_dir="$project_dir/desktop-pet"
    if [ ! -f "$pet_dir/package.json" ]; then
        "$log_fn" "desktop-pet/ 不存在，跳过桌宠"
        return 0
    fi

    if ! command -v npm >/dev/null 2>&1; then
        "$log_fn" "npm 未找到，跳过桌宠"
        return 0
    fi

    export VITE_BACKEND_URL="${VITE_BACKEND_URL:-http://127.0.0.1:8000}"
    export VITE_CONSOLE_URL="${VITE_CONSOLE_URL:-http://127.0.0.1:3000/companion}"

    local backend_health="${VITE_BACKEND_URL%/}/health"
    if ! curl -sf "$backend_health" >/dev/null 2>&1; then
        "$log_fn" "Backend 未就绪 ($backend_health)，跳过桌宠"
        return 0
    fi

    local pet_log="$project_dir/logs/desktop-pet.log"
    mkdir -p "$project_dir/logs"

    # Prefer release .app when DESKTOP_PET_DEV=0 and bundle exists
    if [ "${DESKTOP_PET_DEV:-1}" = "0" ]; then
        local app_bundle=""
        for candidate in \
            "$pet_dir/src-tauri/target/release/bundle/macos/"*.app \
            "$project_dir/storage/desktop-pet/"*.app; do
            if [ -d "$candidate" ]; then
                app_bundle="$candidate"
                break
            fi
        done
        if [ -n "$app_bundle" ]; then
            "$log_fn" "启动桌宠 (release): $app_bundle"
            open -a "$app_bundle" >> "$pet_log" 2>&1 &
            DESKTOP_PET_PID=$!
            export DESKTOP_PET_PID
            "$log_fn" "桌面宠物已打开 (pid ${DESKTOP_PET_PID})"
            return 0
        fi
        "$log_fn" "未找到 release .app，回退 tauri dev"
    fi

    if ! command -v cargo >/dev/null 2>&1; then
        "$log_fn" "cargo 未找到，跳过桌宠（开发模式需 Rust 工具链）"
        return 0
    fi

    if [ ! -d "$pet_dir/node_modules" ]; then
        "$log_fn" "desktop-pet node_modules 不存在，执行 npm install ..."
        if ! (cd "$pet_dir" && npm install >> "$pet_log" 2>&1); then
            "$log_fn" "desktop-pet npm install 失败，见 $pet_log"
            return 1
        fi
    fi

    if ! desktop_pet_port_free 1420; then
        "$log_fn" "端口 1420 被占用，释放旧桌宠 dev 进程..."
        lsof -ti:1420 | xargs kill -9 2>/dev/null || true
        sleep 1
    fi

    "$log_fn" "  VITE_BACKEND_URL = $VITE_BACKEND_URL"
    "$log_fn" "  VITE_CONSOLE_URL = $VITE_CONSOLE_URL"
    "$log_fn" "  桌宠日志 → $pet_log"

    (cd "$pet_dir" && npm run tauri:dev >> "$pet_log" 2>&1) &
    DESKTOP_PET_PID=$!
    export DESKTOP_PET_PID

    # 首次 cargo 编译可能 1-3 分钟；轮询 Vite :1420 就绪
    local waited=0
    while [ "$waited" -lt 180 ]; do
        if curl -sf "http://127.0.0.1:1420/" >/dev/null 2>&1; then
            "$log_fn" "桌面宠物 UI 就绪 (pid ${DESKTOP_PET_PID}, http://127.0.0.1:1420)"
            return 0
        fi
        if ! kill -0 "$DESKTOP_PET_PID" 2>/dev/null; then
            break
        fi
        sleep 2
        waited=$((waited + 2))
    done

    if kill -0 "$DESKTOP_PET_PID" 2>/dev/null; then
        "$log_fn" "桌宠进程在运行但 UI 未就绪 (pid ${DESKTOP_PET_PID})，请查看 $pet_log"
        return 0
    fi

    "$log_fn" "桌面宠物启动失败，见 $pet_log"
    DESKTOP_PET_PID=""
    export DESKTOP_PET_PID
    return 1
}

desktop_pet_stop() {
    if [ -n "${DESKTOP_PET_PID:-}" ]; then
        kill "$DESKTOP_PET_PID" 2>/dev/null || true
    fi
    lsof -ti:1420 2>/dev/null | xargs kill -9 2>/dev/null || true
    pkill -f "ai-media-agent-desktop-pet" 2>/dev/null || true
    pkill -f "desktop-pet.*tauri dev" 2>/dev/null || true
}
