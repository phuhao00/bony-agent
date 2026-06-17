#!/usr/bin/env bash
# Claude Code 启动前/后检查 — 供 start_local.sh / start_with_tunnel.sh source
# 依赖: PYTHON_EXEC, PROJECT_DIR；以及 log/info/ok/warn（由主脚本提供）

start_claude_code_install_sdk() {
    info "检查 Claude Code SDK (claude-agent-sdk)..."
    if ! "$PYTHON_EXEC" -c "import claude_agent_sdk" 2>/dev/null; then
        log "  claude-agent-sdk 未安装，正在增量安装..."
        if "$PYTHON_EXEC" -m pip install "claude-agent-sdk>=0.2.97" -q; then
            ok "claude-agent-sdk 已安装"
        else
            warn "claude-agent-sdk 安装失败，Claude Code 页可能显示未就绪"
            return 1
        fi
    else
        ok "claude-agent-sdk 已就绪"
    fi
    return 0
}

start_claude_code_bootstrap_env() {
    info "自动配置 Coding 引擎（通义 qwen3-coder-next）..."
    cd "$PROJECT_DIR/backend"
    local _out _ready _model _provider
    _out=$("$PYTHON_EXEC" - <<'PY' 2>/dev/null || true
import json
import sys
from pathlib import Path
from dotenv import load_dotenv

sys.path.insert(0, ".")
load_dotenv(Path(".") / ".env")
from core.coding_provider import ensure_coding_config_auto
from services.claude_code_service import ensure_claude_code_runtime, get_health_status

ensure_coding_config_auto(env_file=str(Path(".") / ".env"))
ensure_claude_code_runtime(install_sdk=False)
h = get_health_status(try_bootstrap=False)
c = h.get("coding") or {}
print(json.dumps({
    "ready": bool(h.get("ready")),
    "model": c.get("model", ""),
    "provider": c.get("provider_name", c.get("provider", "")),
    "reason": h.get("not_ready_reason", ""),
}))
PY
)
    cd "$PROJECT_DIR"
    if [ -z "$_out" ]; then
        warn "Coding 配置检查失败（后端可能尚未完全启动）"
        return 1
    fi
    _ready=$(echo "$_out" | "$PYTHON_EXEC" -c "import sys,json; print(json.load(sys.stdin).get('ready', False))" 2>/dev/null)
    _model=$(echo "$_out" | "$PYTHON_EXEC" -c "import sys,json; print(json.load(sys.stdin).get('model',''))" 2>/dev/null)
    _provider=$(echo "$_out" | "$PYTHON_EXEC" -c "import sys,json; print(json.load(sys.stdin).get('provider',''))" 2>/dev/null)
    CLAUDE_CODE_READY="$_ready"
    CLAUDE_CODE_MODEL="$_model"
    CLAUDE_CODE_PROVIDER="$_provider"
    export CLAUDE_CODE_READY CLAUDE_CODE_MODEL CLAUDE_CODE_PROVIDER
    if [ "$_ready" = "True" ]; then
        ok "Claude Code 就绪 · $_provider · $_model"
    else
        _reason=$(echo "$_out" | "$PYTHON_EXEC" -c "import sys,json; print(json.load(sys.stdin).get('reason',''))" 2>/dev/null)
        warn "Claude Code 未就绪 (${_reason:-unknown}) — 可访问 /claude-code 页检查配置"
    fi
    return 0
}

start_claude_code_health_via_api() {
    info "校验 Claude Code HTTP 健康检查..."
    local _json _ready
    _json=$(curl -sf "http://127.0.0.1:8000/claude-code/health" 2>/dev/null || true)
    if [ -z "$_json" ]; then
        warn "GET /claude-code/health 无响应"
        return 1
    fi
    _ready=$(echo "$_json" | "$PYTHON_EXEC" -c "import sys,json; print(json.load(sys.stdin).get('ready', False))" 2>/dev/null)
    CLAUDE_CODE_READY="$_ready"
    export CLAUDE_CODE_READY
    if [ "$_ready" = "True" ]; then
        ok "GET /claude-code/health → 就绪"
    else
        warn "GET /claude-code/health → 未就绪"
    fi
    return 0
}
