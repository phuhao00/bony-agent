#!/bin/bash
# start_local.sh - Standard startup script without using /tmp
set -uo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

# ─── 日志工具 ─────────────────────────────────────────────────────────────────
MASTER_LOG="$PROJECT_DIR/logs/start.log"
mkdir -p "$PROJECT_DIR/logs"
# 颜色（非 TTY 时自动降级为空）
if [ -t 1 ]; then
    C_RESET="\033[0m"; C_BOLD="\033[1m"
    C_GREEN="\033[32m"; C_YELLOW="\033[33m"; C_RED="\033[31m"
    C_CYAN="\033[36m";  C_DIM="\033[2m"
else
    C_RESET=""; C_BOLD=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_CYAN=""; C_DIM=""
fi

_ts() { date "+%H:%M:%S"; }

log()  { local msg="$*"; printf "${C_DIM}[%s]${C_RESET} %s\n" "$(_ts)" "$msg" | tee -a "$MASTER_LOG"; }
info() { local msg="$*"; printf "${C_CYAN}${C_BOLD}[%s] ➜${C_RESET}  %s\n" "$(_ts)" "$msg" | tee -a "$MASTER_LOG"; }
ok()   { local msg="$*"; printf "${C_GREEN}${C_BOLD}[%s] ✓${C_RESET}  %s\n" "$(_ts)" "$msg" | tee -a "$MASTER_LOG"; }
warn() { local msg="$*"; printf "${C_YELLOW}${C_BOLD}[%s] ⚠${C_RESET}  %s\n" "$(_ts)" "$msg" | tee -a "$MASTER_LOG"; }
err()  { local msg="$*"; printf "${C_RED}${C_BOLD}[%s] ✗${C_RESET}  %s\n" "$(_ts)" "$msg" | tee -a "$MASTER_LOG"; }
sep()  { printf "${C_DIM}%s${C_RESET}\n" "────────────────────────────────────────────────────────────" | tee -a "$MASTER_LOG"; }

# 检查端口是否空闲
port_free() { ! lsof -ti:"$1" >/dev/null 2>&1; }

# 启动后等 1s 确认进程仍在运行
check_pid() {
    local pid=$1 name=$2
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
        ok "$name 进程存活 (pid $pid)"
        return 0
    else
        err "$name 启动后立即退出 (pid $pid)，请检查日志"
        return 1
    fi
}

wait_for_backend_health() {
    local url="${1:-http://127.0.0.1:8000/health}"
    local max_wait="${2:-45}"
    local i=0
    while [ "$i" -lt "$max_wait" ]; do
        if curl -sf "$url" >/dev/null 2>&1; then
            return 0
        fi
        sleep 1
        i=$((i + 1))
    done
    return 1
}

# 打印日志文件尾部（用于失败时内联诊断）
tail_log() {
    local logfile=$1 lines=${2:-20}
    if [ -f "$logfile" ]; then
        warn "── 最后 $lines 行日志 ($logfile) ──"
        tail -n "$lines" "$logfile" | while IFS= read -r line; do
            printf "    ${C_DIM}%s${C_RESET}\n" "$line" | tee -a "$MASTER_LOG"
        done
    fi
}

log "===== start_local.sh 启动 ($(date)) ====="
log "PROJECT_DIR = $PROJECT_DIR"
sep

info "清理旧进程..."
lsof -ti:8000,8001,3000,1420,50051,50052,50053 | xargs kill -9 2>/dev/null && log "  旧端口进程已终止" || true
pkill -9 node 2>/dev/null && log "  node 已终止" || true
pkill -9 python3 2>/dev/null && log "  python3 已终止" || true
pkill -9 parser-service 2>/dev/null && log "  parser-service 已终止" || true
pkill -9 directory-service 2>/dev/null && log "  directory-service 已终止" || true
pkill -9 -f "services.media_mcp_server" 2>/dev/null && log "  media_mcp_server 已终止" || true
sleep 1

# Configuration
sep
info "环境配置..."
export ZHIPUAI_API_KEY="d03c728160454c709aef8efd3ecfc8b0.PMeYLi1VtnmgwRTs"
export PLAYWRIGHT_BROWSERS_PATH="$PROJECT_DIR/.browsers"
export BACKEND_URL="http://127.0.0.1:8000"
export ORIGINAL_PROJECT_DIR="$PROJECT_DIR"
export NEXT_TELEMETRY_DISABLED=1
# 公网前端域名（餐费群提醒、上传表单链接；与 start_with_tunnel.sh 一致）
TUNNEL_FRONTEND_DOMAIN="${CLOUDFLARE_FRONTEND_DOMAIN:-https://tech-huhao.tech}"
export MEAL_WEB_BASE_URL="${MEAL_WEB_BASE_URL:-${TUNNEL_FRONTEND_DOMAIN%/}}"
export PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-$MEAL_WEB_BASE_URL}"
# macOS：启动后自动 caffeinate，熄屏不断网（设为 0 可关闭）
export KEEP_AWAKE="${KEEP_AWAKE:-1}"
export MEAL_LAN_AUTO="${MEAL_LAN_AUTO:-1}"
log "  BACKEND_URL           = $BACKEND_URL"
log "  MEAL_WEB_BASE_URL     = $MEAL_WEB_BASE_URL"
log "  KEEP_AWAKE            = $KEEP_AWAKE"
log "  PLAYWRIGHT_BROWSERS   = $PLAYWRIGHT_BROWSERS_PATH"
log "  NODE_VERSION          = $(node --version 2>/dev/null || echo '未找到')"
log "  NPM_VERSION           = $(npm --version 2>/dev/null || echo '未找到')"
log "  CARGO_VERSION         = $(cargo --version 2>/dev/null || echo '未找到')"
log "  GO_VERSION            = $(go version 2>/dev/null || echo '未找到')"

export PATH="${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:${PATH}"
if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env)"
  log "  fnm env loaded"
fi
if command -v lark-cli >/dev/null 2>&1; then
  export LARK_CLI_BIN="$(command -v lark-cli)"
  log "  LARK_CLI_BIN = $LARK_CLI_BIN"
fi

# Create log directory
mkdir -p "$PROJECT_DIR/logs"
LOG_PATH="$PROJECT_DIR/logs/agent.log"

# ─── Proto Generation (Python gRPC stubs) ────────────────────────────────────
sep
info "检查 gRPC Proto Stubs..."
PROTO_LOG="$PROJECT_DIR/logs/proto_gen.log"
PY_STUBS="$PROJECT_DIR/backend/generated/mediaagent"
mkdir -p "$PY_STUBS"
NEED_GEN=false

# 需要生成：① stubs 不存在  ② proto 文件比 stubs 新
if ! ls "$PY_STUBS"/*_pb2.py 2>/dev/null | head -1 | grep -q .; then
    NEED_GEN=true
    log "  Python stubs 不存在，需要生成"
else
    for _p in "$PROJECT_DIR/proto/mediaagent"/*.proto; do
        for _s in "$PY_STUBS"/*.py; do
            if [ "$_p" -nt "$_s" ]; then NEED_GEN=true; break 2; fi
        done
    done
fi

if $NEED_GEN; then
    log "  执行 scripts/gen_proto.sh ..."
    if bash "$PROJECT_DIR/scripts/gen_proto.sh" > "$PROTO_LOG" 2>&1; then
        ok "Proto stubs 生成成功 ($(ls "$PY_STUBS"/*_pb2.py 2>/dev/null | wc -l | tr -d ' ') 个文件)"
        log "  详细日志 → $PROTO_LOG"
    else
        warn "Proto stubs 生成失败，gRPC 调用将自动降级"
        tail_log "$PROTO_LOG" 20
    fi
else
    ok "Proto stubs 已是最新，跳过生成"
fi

sep
info "启动 Backend (FastAPI :8000)..."
if [ -f "$PROJECT_DIR/backend/.venv/bin/python3" ]; then
    PYTHON_EXEC="$PROJECT_DIR/backend/.venv/bin/python3"
    log "  使用 backend/.venv"
elif [ -f "$PROJECT_DIR/.venv/bin/python3" ]; then
    PYTHON_EXEC="$PROJECT_DIR/.venv/bin/python3"
    log "  使用 .venv (项目根)"
elif [ -f "$PROJECT_DIR/venv/bin/python3" ]; then
    PYTHON_EXEC="$PROJECT_DIR/venv/bin/python3"
    log "  使用 venv (旧路径)"
else
    err "venv 未找到，请先运行 ./backend/setup_venv.sh"
    exit 1
fi
log "  PYTHON_EXEC = $PYTHON_EXEC"
log "  Python 版本 = $("$PYTHON_EXEC" --version 2>&1)"

# shellcheck source=scripts/start_claude_code_prepare.sh
source "$PROJECT_DIR/scripts/start_claude_code_prepare.sh"
start_claude_code_install_sdk || true

if ! port_free 8000; then
    warn "  端口 8000 仍被占用，尝试强制释放..."
    lsof -ti:8000 | xargs kill -9 2>/dev/null; sleep 1
fi

cd "$PROJECT_DIR/backend"
export PYTHONPATH="$PROJECT_DIR/backend:${PYTHONPATH:-}"
log "  PYTHONPATH = $PYTHONPATH"
log "  日志 → $LOG_PATH"
"$PYTHON_EXEC" -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload > "$LOG_PATH" 2>&1 &
BACKEND_PID=$!
log "  Backend 进程启动 (pid $BACKEND_PID)"

cd "$PROJECT_DIR"
log "  等待 Backend /health 就绪（最多 45s）..."
if wait_for_backend_health "http://127.0.0.1:8000/health" 45; then
    ok "Backend /health 响应正常"
    start_claude_code_bootstrap_env || true
    start_claude_code_health_via_api || true
else
    warn "Backend /health 超时未响应，继续启动其他服务（前端可能短暂 502）"
    tail_log "$LOG_PATH" 15
fi

# ─── AI Media MCP Server (optional, port 36850) ───────────────────────────────
# shellcheck source=scripts/start_media_mcp.sh
source "$PROJECT_DIR/scripts/start_media_mcp.sh"
    start_media_mcp_server || true

# ─── Native Desktop Sidecar (localhost HTTP) ─────────────────────────────────
sep
info "启动 Native Sidecar (桌面原生自动化 HTTP)..."
# shellcheck source=scripts/start_native_sidecar.sh
source "$PROJECT_DIR/scripts/start_native_sidecar.sh"
start_native_sidecar "$PROJECT_DIR" log || warn "Native Sidecar 未就绪（GUI 将回退 Python 桥）"

# ─── OCR Service (Python, port 50051) ────────────────────────────────────────
sep
info "启动 OCR Service (Python gRPC :50051)..."
OCR_LOG="$PROJECT_DIR/logs/ocr.log"
if [ -f "$PROJECT_DIR/services/ocr/server.py" ]; then
    if [ -f "$PROJECT_DIR/services/ocr/.venv/bin/python3" ]; then
        OCR_PYTHON="$PROJECT_DIR/services/ocr/.venv/bin/python3"
        log "  使用 services/ocr/.venv"
    else
        OCR_PYTHON="$PYTHON_EXEC"
        log "  使用主 venv（services/ocr/.venv 不存在）"
    fi
    log "  OCR Python = $("$OCR_PYTHON" --version 2>&1)"
    log "  日志 → $OCR_LOG"
    if ! port_free 50051; then
        warn "  端口 50051 仍被占用，强制释放..."
        lsof -ti:50051 | xargs kill -9 2>/dev/null; sleep 1
    fi
    cd "$PROJECT_DIR/services/ocr"
    export PYTHONPATH="$PROJECT_DIR/backend:$PROJECT_DIR/services/ocr:${PYTHONPATH:-}"
    "$OCR_PYTHON" server.py > "$OCR_LOG" 2>&1 &
    OCR_PID=$!
    cd "$PROJECT_DIR"
    check_pid "$OCR_PID" "OCR Service" || tail_log "$OCR_LOG" 20
else
    warn "services/ocr/server.py 不存在，跳过 OCR Service"
    OCR_PID=""
fi

# ─── Parser Service (Rust, port 50052) ───────────────────────────────────────
sep
info "启动 Parser Service (Rust gRPC :50052)..."
PARSER_LOG="$PROJECT_DIR/logs/parser.log"
PARSER_BIN="$PROJECT_DIR/backend_safety/target/release/parser-service"
if [ -f "$PARSER_BIN" ]; then
    log "  使用预编译二进制: $PARSER_BIN"
    log "  日志 → $PARSER_LOG"
    if ! port_free 50052; then
        warn "  端口 50052 仍被占用，强制释放..."
        lsof -ti:50052 | xargs kill -9 2>/dev/null; sleep 1
    fi
    PARSER_PORT=50052 "$PARSER_BIN" > "$PARSER_LOG" 2>&1 &
    PARSER_PID=$!
    check_pid "$PARSER_PID" "Parser Service" || tail_log "$PARSER_LOG" 20
elif command -v cargo >/dev/null 2>&1 && [ -f "$PROJECT_DIR/backend_safety/Cargo.toml" ]; then
    log "  预编译二进制不存在，开始 cargo build --release ..."
    log "  cargo = $(cargo --version 2>&1)"
    cd "$PROJECT_DIR/backend_safety"
    cargo build --release 2>&1 | tee -a "$PARSER_LOG" | tail -5 | while IFS= read -r line; do
        log "    [cargo] $line"
    done
    BUILD_EXIT=${PIPESTATUS[0]}
    cd "$PROJECT_DIR"
    if [ "$BUILD_EXIT" -eq 0 ]; then
        ok "Rust 构建成功"
        if ! port_free 50052; then
            warn "  端口 50052 仍被占用，强制释放..."
            lsof -ti:50052 | xargs kill -9 2>/dev/null; sleep 1
        fi
        PARSER_PORT=50052 "$PARSER_BIN" >> "$PARSER_LOG" 2>&1 &
        PARSER_PID=$!
        check_pid "$PARSER_PID" "Parser Service" || tail_log "$PARSER_LOG" 20
    else
        err "Rust 构建失败 (exit $BUILD_EXIT)，跳过 Parser Service"
        tail_log "$PARSER_LOG" 30
        PARSER_PID=""
    fi
else
    warn "预编译二进制和 cargo 均不可用，跳过 Parser Service"
    [ ! -f "$PROJECT_DIR/backend_safety/Cargo.toml" ] && log "  Cargo.toml 不存在: $PROJECT_DIR/backend_safety/Cargo.toml"
    PARSER_PID=""
fi

# ─── Directory Service (Go, port 50053) ──────────────────────────────────────
sep
info "启动 Directory Service (Go gRPC :50053)..."
DIRECTORY_LOG="$PROJECT_DIR/logs/directory.log"
DIRECTORY_BIN="$PROJECT_DIR/backend_massive_concurrent/bin/directory-service"
if [ -f "$DIRECTORY_BIN" ]; then
    log "  使用预编译二进制: $DIRECTORY_BIN"
    log "  日志 → $DIRECTORY_LOG"
    if ! port_free 50053; then
        warn "  端口 50053 仍被占用，强制释放..."
        lsof -ti:50053 | xargs kill -9 2>/dev/null; sleep 1
    fi
    DIRECTORY_PORT=50053 "$DIRECTORY_BIN" > "$DIRECTORY_LOG" 2>&1 &
    DIRECTORY_PID=$!
    check_pid "$DIRECTORY_PID" "Directory Service" || tail_log "$DIRECTORY_LOG" 20
elif command -v go >/dev/null 2>&1 && [ -f "$PROJECT_DIR/backend_massive_concurrent/cmd/server/main.go" ]; then
    log "  预编译二进制不存在，开始 go build ..."
    log "  $(go version 2>&1)"
    cd "$PROJECT_DIR/backend_massive_concurrent"
    mkdir -p bin
    go build -v -o bin/directory-service ./cmd/server 2>&1 | tee -a "$DIRECTORY_LOG" | tail -5 | while IFS= read -r line; do
        log "    [go] $line"
    done
    BUILD_EXIT=${PIPESTATUS[0]}
    cd "$PROJECT_DIR"
    if [ "$BUILD_EXIT" -eq 0 ]; then
        ok "Go 构建成功"
        if ! port_free 50053; then
            warn "  端口 50053 仍被占用，强制释放..."
            lsof -ti:50053 | xargs kill -9 2>/dev/null; sleep 1
        fi
        DIRECTORY_PORT=50053 "$DIRECTORY_BIN" >> "$DIRECTORY_LOG" 2>&1 &
        DIRECTORY_PID=$!
        check_pid "$DIRECTORY_PID" "Directory Service" || tail_log "$DIRECTORY_LOG" 20
    else
        err "Go 构建失败 (exit $BUILD_EXIT)，跳过 Directory Service"
        tail_log "$DIRECTORY_LOG" 30
        DIRECTORY_PID=""
    fi
else
    warn "预编译二进制和 go 均不可用，跳过 Directory Service"
    [ ! -f "$PROJECT_DIR/backend_massive_concurrent/cmd/server/main.go" ] && log "  main.go 不存在: $PROJECT_DIR/backend_massive_concurrent/cmd/server/main.go"
    DIRECTORY_PID=""
fi

sep
info "启动 Frontend (Next.js :3000)..."
cd "$PROJECT_DIR/web"
# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    log "  node_modules 不存在，执行 npm install ..."
    npm install 2>&1 | tail -5 | while IFS= read -r line; do log "    [npm] $line"; done
else
    log "  node_modules 已存在，跳过安装"
fi
log "  Next.js 版本 = $(node -e "try{const p=require('./node_modules/next/package.json');console.log(p.version)}catch(e){console.log('未知')}" 2>/dev/null)"

# Auto-detect all private-network IPs and export for Next.js allowedDevOrigins.
# This allows any LAN client to hit /api/* routes without hitting Next.js's
# dev-mode host check (which would silently block requests and disable the Send button).
_LAN_IPS=()
if command -v ipconfig >/dev/null 2>&1; then
    # macOS
    for _iface in en0 en1 en2 en3; do
        _ip=$(ipconfig getifaddr "$_iface" 2>/dev/null)
        [ -n "$_ip" ] && _LAN_IPS+=("$_ip")
    done
fi
if command -v ip >/dev/null 2>&1; then
    # Linux
    while IFS= read -r _ip; do
        _LAN_IPS+=("$_ip")
    done < <(ip -4 addr show scope global 2>/dev/null | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}(?=/)')
fi
if [ ${#_LAN_IPS[@]} -gt 0 ]; then
    export ALLOWED_DEV_ORIGINS="$(IFS=','; echo "${_LAN_IPS[*]}")"
    log "  ALLOWED_DEV_ORIGINS = $ALLOWED_DEV_ORIGINS"
fi

if ! port_free 3000; then
    warn "  端口 3000 仍被占用，强制释放..."
    lsof -ti:3000 | xargs kill -9 2>/dev/null; sleep 1
fi
log "  Frontend 日志写入终端（前台输出）"
npm run dev -- -H 0.0.0.0 &
FRONTEND_PID=$!
log "  Frontend 进程启动 (pid $FRONTEND_PID)"

# ─── Desktop Pet (Boni Tauri Sidecar) ────────────────────────────────────────
sep
info "桌面宠物 (Boni Sidecar) — 默认不随脚本启动，可在陪伴室手动拉起"
set +u
# shellcheck source=scripts/start_desktop_pet.sh
source "$PROJECT_DIR/scripts/start_desktop_pet.sh"
desktop_pet_start "$PROJECT_DIR" log || warn "桌宠未启动（陪伴室 /companion →「启动桌宠」，或 START_DESKTOP_PET=1）"
set -u

# 获取局域网 IP（macOS / Linux 兼容）
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null \
    || ipconfig getifaddr en1 2>/dev/null \
    || hostname -I 2>/dev/null | awk '{print $1}')

sep
ok "所有服务已启动"
printf "  %-14s %s\n" "Backend"   "http://localhost:8000  (pid $BACKEND_PID)"
printf "  %-14s %s\n" "Frontend"  "http://localhost:3000  (pid $FRONTEND_PID)"
if [ "${CLAUDE_CODE_READY:-}" = "True" ]; then
    printf "  %-14s %s\n" "Claude Code" "就绪 · ${CLAUDE_CODE_PROVIDER:-通义} · ${CLAUDE_CODE_MODEL:-qwen3-coder-next}"
    printf "  %-14s %s\n" "Claude Code页" "http://localhost:3000/claude-code"
else
    printf "  %-14s %s\n" "Claude Code" "未就绪 — http://localhost:3000/claude-code"
fi
[ -n "${OCR_PID:-}"       ] && printf "  %-14s %s\n" "OCR"       "grpc://localhost:50051 (pid $OCR_PID)"
[ -n "${PARSER_PID:-}"    ] && printf "  %-14s %s\n" "Parser"    "grpc://localhost:50052 (pid $PARSER_PID)"
[ -n "${DIRECTORY_PID:-}" ] && printf "  %-14s %s\n" "Directory" "grpc://localhost:50053 (pid $DIRECTORY_PID)"
[ -n "${SIDECAR_PID:-}" ] && printf "  %-14s %s\n" "Native Sidecar" "http://127.0.0.1:$(tr -d '[:space:]' < "$PROJECT_DIR/storage/temp/sidecar.port" 2>/dev/null || echo '?') (pid $SIDECAR_PID)"
[ -n "${DESKTOP_PET_PID:-}" ] && printf "  %-14s %s\n" "Desktop Pet" "Boni Sidecar (pid ${DESKTOP_PET_PID}, Cmd+Shift+B)"
[ -z "${DESKTOP_PET_PID:-}" ] && printf "  %-14s %s\n" "Desktop Pet" "未启动 · http://localhost:3000/companion → 启动桌宠"
if [ -n "${LAN_IP:-}" ]; then
  printf "  %-14s %s\n" "LAN Backend"  "http://$LAN_IP:8000"
  printf "  %-14s %s\n" "LAN Frontend" "http://$LAN_IP:3000"
fi
# shellcheck source=scripts/start_finalize.sh
source "$PROJECT_DIR/scripts/start_finalize.sh"
start_finalize_after_services
start_finalize_print_summary "%-14s" "%s"
sep
printf "  %-20s %s\n" "Backend Logs"   "tail -f $LOG_PATH"
[ -n "${OCR_PID:-}"       ] && printf "  %-20s %s\n" "OCR Logs"       "tail -f $OCR_LOG"
[ -n "${PARSER_PID:-}"    ] && printf "  %-20s %s\n" "Parser Logs"    "tail -f $PARSER_LOG"
[ -n "${DIRECTORY_PID:-}" ] && printf "  %-20s %s\n" "Directory Logs" "tail -f $DIRECTORY_LOG"
[ -n "${DESKTOP_PET_PID:-}" ] && printf "  %-20s %s\n" "Desktop Pet Logs" "tail -f $PROJECT_DIR/logs/desktop-pet.log"
printf "  %-20s %s\n" "Master Start Log" "tail -f $MASTER_LOG"
[ -n "${LARK_CLI_BIN:-}" ] && printf "  %-20s %s\n" "lark-cli" "$LARK_CLI_BIN"
sep

cleanup() {
    echo ""
    sep
    info "收到退出信号，停止所有服务..."
    # shellcheck source=scripts/start_finalize.sh
    source "$PROJECT_DIR/scripts/start_finalize.sh" 2>/dev/null || true
    start_finalize_cleanup 2>/dev/null || true
    # shellcheck source=scripts/start_desktop_pet.sh
    source "$PROJECT_DIR/scripts/start_desktop_pet.sh" 2>/dev/null || true
    desktop_pet_stop 2>/dev/null || true
    [ -n "${DESKTOP_PET_PID:-}" ] && log "  Desktop Pet 已终止 (pid $DESKTOP_PET_PID)"
    kill $BACKEND_PID 2>/dev/null   && log "  Backend   已终止 (pid $BACKEND_PID)"
    [ -n "${MEDIA_MCP_PID:-}" ] && kill $MEDIA_MCP_PID 2>/dev/null && log "  Media MCP 已终止 (pid $MEDIA_MCP_PID)"
    kill $FRONTEND_PID 2>/dev/null  && log "  Frontend  已终止 (pid $FRONTEND_PID)"
    [ -n "${OCR_PID:-}"       ] && kill $OCR_PID 2>/dev/null       && log "  OCR       已终止 (pid $OCR_PID)"
    [ -n "${PARSER_PID:-}"    ] && kill $PARSER_PID 2>/dev/null    && log "  Parser    已终止 (pid $PARSER_PID)"
    [ -n "${DIRECTORY_PID:-}" ] && kill $DIRECTORY_PID 2>/dev/null && log "  Directory 已终止 (pid $DIRECTORY_PID)"
    [ -n "${SIDECAR_PID:-}" ] && kill $SIDECAR_PID 2>/dev/null && log "  Native Sidecar 已终止 (pid $SIDECAR_PID)"
    # shellcheck source=scripts/start_native_sidecar.sh
    source "$PROJECT_DIR/scripts/start_native_sidecar.sh" 2>/dev/null || true
    stop_native_sidecar 2>/dev/null || true
    log "===== 退出 ($(date)) ====="
    exit
}

trap cleanup SIGINT SIGTERM
wait
