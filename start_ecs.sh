#!/bin/bash
# start_ecs.sh — Ubuntu / Alibaba Cloud ECS 一键启动脚本
# 适用环境: Ubuntu 20.04 / 22.04 / 24.04
# 使用方法: chmod +x start_ecs.sh && sudo ./start_ecs.sh
#
# 启动后对外暴露:
#   前端  http://<公网IP>:3000
#   后端  http://<公网IP>:8000
#   文档  http://<公网IP>:8000/docs
#
# 阿里云ECS安全组需放行: TCP 3000, TCP 8000
#
# 可选环境变量:
#   BACKEND_PORT=8000      后端端口
#   FRONTEND_PORT=3000     前端端口
#   NODE_MAJOR=20          Node.js 大版本
#   INSTALL_WHISPER=true   安装 Whisper ASR（大包，默认跳过）

set -euo pipefail

# ── 颜色 ─────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log_info()  { echo -e "${GREEN}[✓]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
log_error() { echo -e "${RED}[✗]${NC} $*" >&2; }
log_step()  { echo -e "\n${BLUE}${BOLD}▶ $*${NC}"; }

# ── 路径配置 ──────────────────────────────────────────────────────────────────
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGS_DIR="$PROJECT_DIR/logs"
BACKEND_LOG="$LOGS_DIR/backend.log"
FRONTEND_LOG="$LOGS_DIR/frontend.log"
BACKEND_PID_FILE="$LOGS_DIR/backend.pid"
FRONTEND_PID_FILE="$LOGS_DIR/frontend.pid"

mkdir -p "$LOGS_DIR"
cd "$PROJECT_DIR"

# ── 端口配置 ──────────────────────────────────────────────────────────────────
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
NODE_MAJOR="${NODE_MAJOR:-20}"    # Node.js 大版本号

# ── 清理退出 ──────────────────────────────────────────────────────────────────
cleanup() {
    echo ""
    log_warn "正在停止所有服务..."
    if [[ -f "$BACKEND_PID_FILE" ]]; then
        kill "$(cat "$BACKEND_PID_FILE")" 2>/dev/null || true
        rm -f "$BACKEND_PID_FILE"
    fi
    if [[ -f "$FRONTEND_PID_FILE" ]]; then
        kill "$(cat "$FRONTEND_PID_FILE")" 2>/dev/null || true
        rm -f "$FRONTEND_PID_FILE"
    fi
    log_info "服务已停止。"
    exit 0
}
trap cleanup SIGINT SIGTERM

# ════════════════════════════════════════════════════════════════════════════════
log_step "Step 1 · 检查操作系统"
# ════════════════════════════════════════════════════════════════════════════════
if ! command -v apt-get &>/dev/null; then
    log_error "此脚本仅支持 Ubuntu / Debian 系统（未找到 apt-get）"
    exit 1
fi
DISTRO=$(lsb_release -ds 2>/dev/null || grep PRETTY_NAME /etc/os-release | cut -d'"' -f2)
log_info "操作系统: $DISTRO"

# ════════════════════════════════════════════════════════════════════════════════
log_step "Step 2 · 停止已有服务"
# ════════════════════════════════════════════════════════════════════════════════
lsof -ti:"$BACKEND_PORT","$FRONTEND_PORT" | xargs kill -9 2>/dev/null || true
pkill -f "uvicorn main:app" 2>/dev/null || true
pkill -f "next start"       2>/dev/null || true
pkill -f "next-server"      2>/dev/null || true
sleep 1
log_info "旧进程已清理"

# ════════════════════════════════════════════════════════════════════════════════
log_step "Step 3 · 安装系统依赖"
# ════════════════════════════════════════════════════════════════════════════════
log_info "更新 apt 软件源..."
sudo apt-get update -q

log_info "安装基础构建工具与 Python..."
sudo apt-get install -y -q \
    python3 python3-pip python3-venv python3-dev \
    build-essential pkg-config \
    libssl-dev libffi-dev \
    libxml2-dev libxslt1-dev \
    zlib1g-dev libjpeg-dev libpng-dev libtiff-dev \
    git curl wget lsof unzip ca-certificates gnupg
log_info "Python: $(python3 --version 2>&1)"

log_info "安装 FFmpeg（视频/音频混剪必需）..."
sudo apt-get install -y -q ffmpeg
log_info "FFmpeg: $(ffmpeg -version 2>&1 | head -1)"

log_info "安装中文字体（字幕渲染必需）..."
sudo apt-get install -y -q \
    fonts-wqy-zenhei \
    fonts-wqy-microhei \
    fonts-noto-cjk 2>/dev/null || \
sudo apt-get install -y -q fonts-wqy-zenhei || \
log_warn "中文字体安装失败，字幕功能可能受影响"

log_info "安装 Playwright 浏览器系统依赖..."
sudo apt-get install -y -q \
    libnss3 libnspr4 \
    libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libdbus-1-3 \
    libxkbcommon0 libxcomposite1 \
    libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 2>/dev/null || true
# libasound2 在 Ubuntu 22+ 已更名为 libasound2t64
sudo apt-get install -y -q libasound2 2>/dev/null || \
sudo apt-get install -y -q libasound2t64 2>/dev/null || true
log_info "系统依赖安装完成"

# ════════════════════════════════════════════════════════════════════════════════
log_step "Step 4 · 安装 Node.js ${NODE_MAJOR}.x"
# ════════════════════════════════════════════════════════════════════════════════
NODE_INSTALLED_MAJOR=0
if command -v node &>/dev/null; then
    NODE_INSTALLED_MAJOR=$(node -e 'process.stdout.write(process.version.slice(1).split(".")[0])' 2>/dev/null || echo 0)
fi

if [[ "$NODE_INSTALLED_MAJOR" -lt 18 ]]; then
    log_warn "安装 Node.js ${NODE_MAJOR}.x（当前版本: ${NODE_INSTALLED_MAJOR:-无}）..."
    # 优先阿里云镜像（国内 ECS 速度更快）
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
    sudo apt-get install -y -q nodejs
    log_info "Node.js 安装完成"
else
    log_info "Node.js 已满足要求（已安装 v${NODE_INSTALLED_MAJOR}）"
fi
log_info "Node.js: $(node --version)  npm: $(npm --version)"

log_info "配置 npm 国内镜像（阿里云加速）..."
npm config set registry https://registry.npmmirror.com 2>/dev/null || true

# ════════════════════════════════════════════════════════════════════════════════
log_step "Step 5 · 创建存储目录"
# ════════════════════════════════════════════════════════════════════════════════
log_info "创建运行所需目录..."
mkdir -p \
    "$PROJECT_DIR/storage/outputs" \
    "$PROJECT_DIR/storage/uploads" \
    "$PROJECT_DIR/storage/temp" \
    "$PROJECT_DIR/storage/tmp" \
    "$PROJECT_DIR/storage/rag" \
    "$PROJECT_DIR/storage/memory" \
    "$PROJECT_DIR/storage/chroma_db" \
    "$PROJECT_DIR/storage/knowledge" \
    "$PROJECT_DIR/storage/profiles" \
    "$PROJECT_DIR/storage/scheduler" \
    "$PROJECT_DIR/storage/debug" \
    "$PROJECT_DIR/storage/trending" \
    "$PROJECT_DIR/.browsers" \
    "$PROJECT_DIR/logs"
log_info "目录创建完成"

# ════════════════════════════════════════════════════════════════════════════════
log_step "Step 6 · 配置环境变量"
# ════════════════════════════════════════════════════════════════════════════════
ENV_FILE="$PROJECT_DIR/backend/.env"
if [[ ! -f "$ENV_FILE" ]]; then
    if [[ -f "$PROJECT_DIR/backend/.env.example" ]]; then
        cp "$PROJECT_DIR/backend/.env.example" "$ENV_FILE"
        log_warn "已从 .env.example 创建 backend/.env"
    else
        touch "$ENV_FILE"
    fi
    echo ""
    echo -e "  ${RED}${BOLD}⚠️  请先填写 API Key，然后重新运行此脚本！${NC}"
    echo -e "  ${YELLOW}nano $ENV_FILE${NC}"
    echo ""
    log_warn "跳过 API Key 配置，服务可能无法正常调用 AI 接口。"
else
    log_info "backend/.env 已存在"
fi

# ════════════════════════════════════════════════════════════════════════════════
log_step "Step 7 · 配置 Python 虚拟环境"
# ════════════════════════════════════════════════════════════════════════════════
VENV_DIR=""
if [[ -f "$PROJECT_DIR/backend/.venv/bin/python3" ]]; then
    VENV_DIR="$PROJECT_DIR/backend/.venv"
    log_info "复用已有 venv: backend/.venv"
elif [[ -f "$PROJECT_DIR/venv/bin/python3" ]]; then
    VENV_DIR="$PROJECT_DIR/venv"
    log_info "复用已有 venv: venv/"
else
    log_info "创建 Python 虚拟环境: backend/.venv ..."
    python3 -m venv "$PROJECT_DIR/backend/.venv"
    VENV_DIR="$PROJECT_DIR/backend/.venv"
    log_info "虚拟环境创建完成"
fi

PYTHON_EXEC="$VENV_DIR/bin/python3"
PIP_EXEC="$VENV_DIR/bin/pip"
log_info "Python 可执行文件: $PYTHON_EXEC ($(${PYTHON_EXEC} --version 2>&1))"

# ════════════════════════════════════════════════════════════════════════════════
log_step "Step 8 · 安装 Python 依赖"
# ════════════════════════════════════════════════════════════════════════════════
PIP_MIRROR="-i https://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com"

log_info "升级 pip、setuptools、wheel..."
"$PIP_EXEC" install --upgrade pip setuptools wheel -q \
    $PIP_MIRROR

log_info "安装 requirements.txt 依赖（首次可能需要 3-10 分钟）..."
"$PIP_EXEC" install -r "$PROJECT_DIR/backend/requirements.txt" \
    $PIP_MIRROR \
    --timeout 120 \
    --retries 3

log_info "安装补充依赖（llama-index-embeddings-langchain、openai、httpx）..."
"$PIP_EXEC" install \
    $PIP_MIRROR \
    --timeout 120 \
    openai \
    llama-index-embeddings-langchain \
    httpx \
    anyio 2>/dev/null || log_warn "部分补充包安装失败（非核心功能，可忽略）"

# 可选：Whisper ASR（体积较大，默认跳过）
if [[ "${INSTALL_WHISPER:-false}" == "true" ]]; then
    log_info "安装 Whisper ASR（可能需要数分钟）..."
    "$PIP_EXEC" install openai-whisper $PIP_MIRROR --timeout 180 || \
        log_warn "Whisper 安装失败，ASR 功能不可用"
fi
log_info "Python 依赖安装完成"

# ════════════════════════════════════════════════════════════════════════════════
log_step "Step 9 · 安装 Playwright Chromium"
# ════════════════════════════════════════════════════════════════════════════════
export PLAYWRIGHT_BROWSERS_PATH="$PROJECT_DIR/.browsers"
mkdir -p "$PLAYWRIGHT_BROWSERS_PATH"

CHROMIUM_INSTALLED=$(find "$PLAYWRIGHT_BROWSERS_PATH" -maxdepth 1 -name "chromium-*" -type d 2>/dev/null | wc -l)
if [[ "$CHROMIUM_INSTALLED" -eq 0 ]]; then
    log_info "安装 Playwright Chromium 浏览器..."
    PLAYWRIGHT_BIN="$VENV_DIR/bin/playwright"
    if [[ -f "$PLAYWRIGHT_BIN" ]]; then
        "$PLAYWRIGHT_BIN" install chromium 2>&1 | tail -5 || \
        "$PYTHON_EXEC" -m playwright install chromium 2>&1 | tail -5 || \
        log_warn "Playwright 安装失败（社媒自动发布不可用，其他功能正常）"
    else
        "$PYTHON_EXEC" -m playwright install chromium 2>&1 | tail -5 || \
        log_warn "Playwright 安装失败（社媒自动发布不可用，其他功能正常）"
    fi
    log_info "Playwright 浏览器安装完成"
else
    log_info "Playwright Chromium 已安装，跳过"
fi

# ════════════════════════════════════════════════════════════════════════════════
log_step "Step 10 · 安装前端依赖并构建"
# ════════════════════════════════════════════════════════════════════════════════
cd "$PROJECT_DIR/web"
log_info "安装 npm 依赖..."
npm install --prefer-offline 2>/dev/null || npm install
log_info "npm 依赖安装完成"

log_info "构建 Next.js 生产版本（首次可能需要 2-5 分钟）..."
NEXT_TELEMETRY_DISABLED=1 npm run build
log_info "前端构建完成"

# ════════════════════════════════════════════════════════════════════════════════
log_step "Step 11 · 配置防火墙"
# ════════════════════════════════════════════════════════════════════════════════
if command -v ufw &>/dev/null; then
    UFW_STATUS=$(sudo ufw status 2>/dev/null | head -1 || echo "inactive")
    if echo "$UFW_STATUS" | grep -q "active"; then
        sudo ufw allow "$FRONTEND_PORT"/tcp comment 'AI-Agent-Frontend' 2>/dev/null || true
        sudo ufw allow "$BACKEND_PORT"/tcp  comment 'AI-Agent-Backend'  2>/dev/null || true
        log_info "UFW 已开放端口 $FRONTEND_PORT / $BACKEND_PORT"
    else
        log_warn "UFW 未启用，跳过 UFW 配置"
    fi
fi

echo ""
log_warn "请确认阿里云 ECS 安全组已添加以下入方向规则:"
echo -e "   协议 TCP  端口 ${BOLD}${FRONTEND_PORT}${NC}   （前端）"
echo -e "   协议 TCP  端口 ${BOLD}${BACKEND_PORT}${NC}   （后端 API）"

# ════════════════════════════════════════════════════════════════════════════════
log_step "Step 12 · 获取公网 IP"
# ════════════════════════════════════════════════════════════════════════════════
PUBLIC_IP=""
# 阿里云 ECS 元数据接口（优先，不消耗公网流量）
PUBLIC_IP=$(curl -sf --connect-timeout 3 http://100.100.100.200/latest/meta-data/eipv4 2>/dev/null)          || true
[[ -z "$PUBLIC_IP" ]] && PUBLIC_IP=$(curl -sf --connect-timeout 3 http://100.100.100.200/latest/meta-data/public-ipv4 2>/dev/null) || true
[[ -z "$PUBLIC_IP" ]] && PUBLIC_IP=$(curl -sf --connect-timeout 5 https://api.ipify.org 2>/dev/null)         || true
[[ -z "$PUBLIC_IP" ]] && PUBLIC_IP=$(curl -sf --connect-timeout 5 https://ifconfig.me 2>/dev/null)           || true
[[ -z "$PUBLIC_IP" ]] && PUBLIC_IP=$(curl -sf --connect-timeout 5 http://checkip.amazonaws.com 2>/dev/null)  || true
PUBLIC_IP="${PUBLIC_IP:-<your-ecs-public-ip>}"
log_info "公网 IP: $PUBLIC_IP"

# ════════════════════════════════════════════════════════════════════════════════
log_step "Step 13 · 启动后端"
# ════════════════════════════════════════════════════════════════════════════════
cd "$PROJECT_DIR/backend"
export PYTHONPATH="$PROJECT_DIR/backend:${PYTHONPATH:-}"
export PLAYWRIGHT_BROWSERS_PATH="$PROJECT_DIR/.browsers"
export NEXT_TELEMETRY_DISABLED=1

nohup "$PYTHON_EXEC" -m uvicorn main:app \
    --host 0.0.0.0 \
    --port "$BACKEND_PORT" \
    --workers 2 \
    --log-level info \
    > "$BACKEND_LOG" 2>&1 &
echo $! > "$BACKEND_PID_FILE"
log_info "后端启动中... (PID: $(cat "$BACKEND_PID_FILE"))"

log_info "等待后端就绪（最长 60s）..."
READY=0
for i in $(seq 1 60); do
    if curl -sf "http://localhost:$BACKEND_PORT/health" &>/dev/null; then
        log_info "后端健康检查通过 ✓ (${i}s)"
        READY=1
        break
    fi
    # 检测进程是否已崩溃
    if ! kill -0 "$(cat "$BACKEND_PID_FILE")" 2>/dev/null; then
        log_error "后端进程已退出，请查看日志:"
        tail -30 "$BACKEND_LOG"
        exit 1
    fi
    printf "."
    sleep 1
done
[[ "$READY" -eq 0 ]] && log_warn "后端未在 60s 内响应，请检查: tail -f $BACKEND_LOG"
echo ""

# ════════════════════════════════════════════════════════════════════════════════
log_step "Step 14 · 启动前端"
# ════════════════════════════════════════════════════════════════════════════════
cd "$PROJECT_DIR/web"
nohup env \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT="$FRONTEND_PORT" \
    HOSTNAME="0.0.0.0" \
    node_modules/.bin/next start \
        --hostname 0.0.0.0 \
        --port "$FRONTEND_PORT" \
    > "$FRONTEND_LOG" 2>&1 &
echo $! > "$FRONTEND_PID_FILE"
log_info "前端启动中... (PID: $(cat "$FRONTEND_PID_FILE"))"
sleep 4

# 验证前端
if curl -sf "http://localhost:$FRONTEND_PORT" &>/dev/null; then
    log_info "前端健康检查通过 ✓"
elif ! kill -0 "$(cat "$FRONTEND_PID_FILE")" 2>/dev/null; then
    log_error "前端进程已退出，请查看日志:"
    tail -20 "$FRONTEND_LOG"
    exit 1
fi

# ════════════════════════════════════════════════════════════════════════════════
# ── 启动完成摘要 ──────────────────────────────────────────────────────────────
# ════════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║       🚀  AI Media Agent — 已启动 (阿里云 ECS)                 ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════════════════════╣${NC}"
printf "${GREEN}║${NC}  🌐 前端界面    ${CYAN}http://%-38s${NC}${GREEN}║${NC}\n" "${PUBLIC_IP}:${FRONTEND_PORT}"
printf "${GREEN}║${NC}  ⚙️  后端 API    ${CYAN}http://%-38s${NC}${GREEN}║${NC}\n" "${PUBLIC_IP}:${BACKEND_PORT}"
printf "${GREEN}║${NC}  📖 接口文档    ${CYAN}http://%-38s${NC}${GREEN}║${NC}\n" "${PUBLIC_IP}:${BACKEND_PORT}/docs"
echo -e "${GREEN}╠══════════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC}  📄 后端日志: tail -f $BACKEND_LOG"
echo -e "${GREEN}║${NC}  📄 前端日志: tail -f $FRONTEND_LOG"
echo -e "${GREEN}║${NC}  🛑 停止服务: ./stop_ecs.sh  或  Ctrl+C"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# ── 保持前台运行，Ctrl+C 触发 cleanup ────────────────────────────────────────
wait
