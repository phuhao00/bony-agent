#!/bin/bash
# start_with_tunnel.sh - 含 Cloudflare 内网穿透的完整启动脚本
# 基于 start_local.sh，在全量服务基础上追加 Cloudflare Tunnel
set -uo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

# ─── 日志工具 ─────────────────────────────────────────────────────────────────
MASTER_LOG="$PROJECT_DIR/logs/start_tunnel.log"
mkdir -p "$PROJECT_DIR/logs"
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

port_free() { ! lsof -ti:"$1" >/dev/null 2>&1; }

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

tail_log() {
    local logfile=$1 lines=${2:-20}
    if [ -f "$logfile" ]; then
        warn "── 最后 $lines 行日志 ($logfile) ──"
        tail -n "$lines" "$logfile" | while IFS= read -r line; do
            printf "    ${C_DIM}%s${C_RESET}\n" "$line" | tee -a "$MASTER_LOG"
        done
    fi
}

log "===== start_with_tunnel.sh 启动 ($(date)) ====="
log "PROJECT_DIR = $PROJECT_DIR"
sep

info "清理旧进程..."
lsof -ti:8000,8001,3000,1420,36850,50051,50052,50053 | xargs kill -9 2>/dev/null && log "  旧端口进程已终止" || true
pkill -9 node 2>/dev/null && log "  node 已终止" || true
pkill -9 python3 2>/dev/null && log "  python3 已终止" || true
pkill -9 parser-service 2>/dev/null && log "  parser-service 已终止" || true
pkill -9 directory-service 2>/dev/null && log "  directory-service 已终止" || true
pkill -9 -f "services.media_mcp_server" 2>/dev/null && log "  media_mcp_server 已终止" || true
sleep 1

# ─── 环境配置 ─────────────────────────────────────────────────────────────────
sep
info "环境配置..."
export ZHIPUAI_API_KEY="d03c728160454c709aef8efd3ecfc8b0.PMeYLi1VtnmgwRTs"
export PLAYWRIGHT_BROWSERS_PATH="$PROJECT_DIR/.browsers"
export BACKEND_URL="http://127.0.0.1:8000"
export ORIGINAL_PROJECT_DIR="$PROJECT_DIR"
export NEXT_TELEMETRY_DISABLED=1
# 公网前端域名（餐费群提醒、上传表单链接等；与下方 Tunnel 段共用默认值）
TUNNEL_FRONTEND_DOMAIN="${CLOUDFLARE_FRONTEND_DOMAIN:-https://tech-huhao.tech}"
TUNNEL_BACKEND_DOMAIN="${CLOUDFLARE_BACKEND_DOMAIN:-https://api.tech-huhao.tech}"
export MEAL_WEB_BASE_URL="${MEAL_WEB_BASE_URL:-${TUNNEL_FRONTEND_DOMAIN%/}}"
export PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-$MEAL_WEB_BASE_URL}"
export CLOUDFLARE_FRONTEND_DOMAIN="${CLOUDFLARE_FRONTEND_DOMAIN:-$TUNNEL_FRONTEND_DOMAIN}"
export KEEP_AWAKE="${KEEP_AWAKE:-1}"
export MEAL_LAN_AUTO="${MEAL_LAN_AUTO:-0}"
log "  BACKEND_URL           = $BACKEND_URL"
log "  KEEP_AWAKE            = $KEEP_AWAKE"
log "  MEAL_WEB_BASE_URL     = $MEAL_WEB_BASE_URL"
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

mkdir -p "$PROJECT_DIR/logs"
LOG_PATH="$PROJECT_DIR/logs/agent.log"

# ─── Proto Generation (Python gRPC stubs) ────────────────────────────────────
sep
info "检查 gRPC Proto Stubs..."
PROTO_LOG="$PROJECT_DIR/logs/proto_gen.log"
PY_STUBS="$PROJECT_DIR/backend/generated/mediaagent"
mkdir -p "$PY_STUBS"
NEED_GEN=false

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

# ─── Backend (FastAPI :8000) ──────────────────────────────────────────────────
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

# Claude Code SDK + Coding 配置（与 start_local.sh 一致）
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

# ─── Cloudflare Tunnel（域名已在「环境配置」段注入 MEAL_WEB_BASE_URL）────────
TUNNEL_NAME="${CLOUDFLARE_TUNNEL_NAME:-gosteam-tech}"
# 提取纯主机名（去掉 https:// 前缀），供 Next.js allowedDevOrigins 使用
TUNNEL_FRONTEND_HOST="${TUNNEL_FRONTEND_DOMAIN#https://}"
TUNNEL_FRONTEND_HOST="${TUNNEL_FRONTEND_HOST#http://}"
TUNNEL_BACKEND_HOST="${TUNNEL_BACKEND_DOMAIN#https://}"
TUNNEL_BACKEND_HOST="${TUNNEL_BACKEND_HOST#http://}"

# ─── Frontend (Next.js :3000) ─────────────────────────────────────────────────
sep
info "启动 Frontend (Next.js :3000)..."
cd "$PROJECT_DIR/web"
if [ ! -d "node_modules" ]; then
    log "  node_modules 不存在，执行 npm install ..."
    npm install 2>&1 | tail -5 | while IFS= read -r line; do log "    [npm] $line"; done
else
    log "  node_modules 已存在，跳过安装"
fi
log "  Next.js 版本 = $(node -e "try{const p=require('./node_modules/next/package.json');console.log(p.version)}catch(e){console.log('未知')}" 2>/dev/null)"

# 自动探测局域网 IP，注入 allowedDevOrigins 防止 Next.js dev 模式阻断跨 IP 请求
# 同时包含 Cloudflare Tunnel 域名，避免从公网域名访问时 /_next/* 被拦截导致页面不停刷新
_ALL_ORIGINS=()
if command -v ipconfig >/dev/null 2>&1; then
    for _iface in en0 en1 en2 en3; do
        _ip=$(ipconfig getifaddr "$_iface" 2>/dev/null)
        [ -n "$_ip" ] && _ALL_ORIGINS+=("$_ip")
    done
fi
if command -v ip >/dev/null 2>&1; then
    while IFS= read -r _ip; do
        _ALL_ORIGINS+=("$_ip")
    done < <(ip -4 addr show scope global 2>/dev/null | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}(?=/)')
fi
# 追加 Cloudflare Tunnel 公网主机名
[ -n "$TUNNEL_FRONTEND_HOST" ] && _ALL_ORIGINS+=("$TUNNEL_FRONTEND_HOST")
[ -n "$TUNNEL_BACKEND_HOST"  ] && _ALL_ORIGINS+=("$TUNNEL_BACKEND_HOST")
if [ ${#_ALL_ORIGINS[@]} -gt 0 ]; then
    export ALLOWED_DEV_ORIGINS="$(IFS=','; echo "${_ALL_ORIGINS[*]}")"
    log "  ALLOWED_DEV_ORIGINS = $ALLOWED_DEV_ORIGINS"
fi

if ! port_free 3000; then
    warn "  端口 3000 仍被占用，强制释放..."
    lsof -ti:3000 | xargs kill -9 2>/dev/null; sleep 1
fi
npm run dev -- -H 0.0.0.0 &
FRONTEND_PID=$!
log "  Frontend 进程启动 (pid $FRONTEND_PID)"

# ─── Cloudflare Tunnel (内网穿透) ─────────────────────────────────────────────
sep
info "启动 Cloudflare Tunnel (内网穿透)..."
TUNNEL_LOG="$PROJECT_DIR/logs/cloudflared.log"
TUNNEL_PID=""
CLOUDFLARED_BIN=$(which cloudflared 2>/dev/null || echo "/opt/homebrew/bin/cloudflared")
TUNNEL_CONFIG="$HOME/.cloudflared/config.yml"
# TUNNEL_NAME / TUNNEL_FRONTEND_DOMAIN / TUNNEL_BACKEND_DOMAIN 已在前面定义

if [ -f "$CLOUDFLARED_BIN" ] && [ -f "$TUNNEL_CONFIG" ]; then
    log "  cloudflared = $CLOUDFLARED_BIN  (版本: $("$CLOUDFLARED_BIN" --version 2>/dev/null | head -1))"
    log "  config      = $TUNNEL_CONFIG"
    log "  tunnel      = $TUNNEL_NAME"
    log "  日志 → $TUNNEL_LOG"
    "$CLOUDFLARED_BIN" tunnel --config "$TUNNEL_CONFIG" --protocol http2 run "$TUNNEL_NAME" \
        >> "$TUNNEL_LOG" 2>&1 &
    TUNNEL_PID=$!
    log "  Tunnel 进程启动 (pid $TUNNEL_PID)，等待 3s..."
    sleep 3
    if kill -0 "$TUNNEL_PID" 2>/dev/null; then
        ok "Cloudflare Tunnel 运行中 (pid $TUNNEL_PID)"
        log "  Frontend 域名: $TUNNEL_FRONTEND_DOMAIN"
        log "  Backend  域名: $TUNNEL_BACKEND_DOMAIN"
    else
        err "Cloudflare Tunnel 启动失败，降级为本地访问"
        tail_log "$TUNNEL_LOG" 20
        TUNNEL_PID=""
    fi
elif [ ! -f "$CLOUDFLARED_BIN" ]; then
    warn "cloudflared 未安装，跳过内网穿透（仅本地/局域网可访问）"
    log "  安装方式(macOS): brew install cloudflared"
    log "  官方文档: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/"
else
    warn "$TUNNEL_CONFIG 不存在，跳过内网穿透"
    log "  初始化隧道:"
    log "    cloudflared tunnel login"
    log "    cloudflared tunnel create $TUNNEL_NAME"
    log "    # 编辑 $TUNNEL_CONFIG 配置路由规则后重试"
fi

# ─── Desktop Pet (Boni Tauri Sidecar) ────────────────────────────────────────
sep
info "桌面宠物 (Boni Sidecar) — 默认不随脚本启动，可在陪伴室手动拉起"
# 桌宠连本机 backend；陪伴室可打开 Tunnel 公网域名或本地 :3000
export VITE_BACKEND_URL="${VITE_BACKEND_URL:-http://127.0.0.1:8000}"
if [ -n "${TUNNEL_PID:-}" ] && [ -n "${TUNNEL_FRONTEND_DOMAIN:-}" ]; then
    export VITE_CONSOLE_URL="${TUNNEL_FRONTEND_DOMAIN%/}/companion"
    log "  桌宠控制台 URL (Tunnel) = $VITE_CONSOLE_URL"
else
    export VITE_CONSOLE_URL="${VITE_CONSOLE_URL:-http://127.0.0.1:3000/companion}"
fi
set +u
# shellcheck source=scripts/start_desktop_pet.sh
source "$PROJECT_DIR/scripts/start_desktop_pet.sh"
desktop_pet_start "$PROJECT_DIR" log || warn "桌宠未启动（陪伴室 /companion →「启动桌宠」，或 START_DESKTOP_PET=1）"
set -u

# ─── 获取局域网 IP ──────────────────────────────────────────────────────────────
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null \
    || ipconfig getifaddr en1 2>/dev/null \
    || hostname -I 2>/dev/null | awk '{print $1}')

# ─── 启动摘要 ──────────────────────────────────────────────────────────────────
sep
ok "所有服务已启动"
printf "  %-18s %s\n" "Backend"    "http://localhost:8000  (pid $BACKEND_PID)"
printf "  %-18s %s\n" "Frontend"   "http://localhost:3000  (pid $FRONTEND_PID)"
if [ "${CLAUDE_CODE_READY:-}" = "True" ]; then
    printf "  %-18s %s\n" "Claude Code" "就绪 · ${CLAUDE_CODE_PROVIDER:-通义} · ${CLAUDE_CODE_MODEL:-qwen3-coder-next}"
    [ -n "${TUNNEL_FRONTEND_DOMAIN:-}" ] && printf "  %-18s %s\n" "Claude Code页" "${TUNNEL_FRONTEND_DOMAIN%/}/claude-code"
else
    printf "  %-18s %s\n" "Claude Code" "未就绪 — ${TUNNEL_FRONTEND_DOMAIN:-http://localhost:3000}/claude-code"
fi
[ -n "${MEDIA_MCP_PID:-}" ] && printf "  %-18s %s\n" "Media MCP"  "http://127.0.0.1:36850 (pid $MEDIA_MCP_PID)"
[ -n "${OCR_PID:-}"       ] && printf "  %-18s %s\n" "OCR"        "grpc://localhost:50051 (pid $OCR_PID)"
[ -n "${PARSER_PID:-}"    ] && printf "  %-18s %s\n" "Parser"     "grpc://localhost:50052 (pid $PARSER_PID)"
[ -n "${DIRECTORY_PID:-}" ] && printf "  %-18s %s\n" "Directory"  "grpc://localhost:50053 (pid $DIRECTORY_PID)"
if [ -f "$PROJECT_DIR/storage/temp/sidecar.port" ]; then
    _sc_port="$(tr -d '[:space:]' < "$PROJECT_DIR/storage/temp/sidecar.port" 2>/dev/null || echo '?')"
    printf "  %-18s %s\n" "Native Sidecar" "http://127.0.0.1:${_sc_port}${SIDECAR_PID:+ (pid $SIDECAR_PID)}"
fi
if [ -n "${TUNNEL_PID:-}" ]; then
    printf "  %-18s %s\n" "Tunnel"      "Cloudflare (pid $TUNNEL_PID)"
    printf "  %-18s %s\n" "Frontend域名" "$TUNNEL_FRONTEND_DOMAIN"
    printf "  %-18s %s\n" "Backend域名"  "$TUNNEL_BACKEND_DOMAIN"
fi
[ -n "${DESKTOP_PET_PID:-}" ] && printf "  %-18s %s\n" "Desktop Pet" "Boni Sidecar (pid ${DESKTOP_PET_PID}, Cmd+Shift+B)"
[ -z "${DESKTOP_PET_PID:-}" ] && printf "  %-18s %s\n" "Desktop Pet" "未启动 · /companion → 启动桌宠"
if [ -n "${LAN_IP:-}" ]; then
    printf "  %-18s %s\n" "LAN Backend"  "http://$LAN_IP:8000"
    printf "  %-18s %s\n" "LAN Frontend" "http://$LAN_IP:3000"
fi
# shellcheck source=scripts/start_finalize.sh
source "$PROJECT_DIR/scripts/start_finalize.sh"
start_finalize_after_services
start_finalize_print_summary "%-18s" "%s"
sep
printf "  %-24s %s\n" "Backend Logs"    "tail -f $LOG_PATH"
[ -n "${MEDIA_MCP_PID:-}" ] && printf "  %-24s %s\n" "Media MCP Logs"  "tail -f $PROJECT_DIR/logs/media_mcp.log"
[ -n "${OCR_PID:-}"       ] && printf "  %-24s %s\n" "OCR Logs"        "tail -f $OCR_LOG"
[ -n "${PARSER_PID:-}"    ] && printf "  %-24s %s\n" "Parser Logs"     "tail -f $PARSER_LOG"
[ -n "${DIRECTORY_PID:-}" ] && printf "  %-24s %s\n" "Directory Logs"  "tail -f $DIRECTORY_LOG"
[ -n "${TUNNEL_PID:-}"    ] && printf "  %-24s %s\n" "Tunnel Logs"     "tail -f $TUNNEL_LOG"
[ -n "${DESKTOP_PET_PID:-}" ] && printf "  %-24s %s\n" "Desktop Pet Logs" "tail -f $PROJECT_DIR/logs/desktop-pet.log"
printf "  %-24s %s\n" "Master Start Log" "tail -f $MASTER_LOG"
[ -n "${LARK_CLI_BIN:-}" ] && printf "  %-24s %s\n" "lark-cli" "$LARK_CLI_BIN"
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
    [ -n "${TUNNEL_PID:-}"    ] && kill $TUNNEL_PID 2>/dev/null    && log "  Tunnel    已终止 (pid $TUNNEL_PID)"
    log "===== 退出 ($(date)) ====="
    exit
}

trap cleanup SIGINT SIGTERM
wait
