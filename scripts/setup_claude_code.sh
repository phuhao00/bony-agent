#!/usr/bin/env bash
# Verify Claude Code runtime: SDK bundled CLI or system `claude` on PATH.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# 与 start_local.sh 一致：优先 backend/.venv
VENV_PY="${ROOT}/backend/.venv/bin/python"
[ -x "$VENV_PY" ] || VENV_PY="${ROOT}/venv/bin/python"
[ -x "$VENV_PY" ] || VENV_PY="${ROOT}/.venv/bin/python"
[ -x "$VENV_PY" ] || VENV_PY="python3"

info() { printf '[setup-claude-code] %s\n' "$*"; }
warn() { printf '[setup-claude-code] WARN: %s\n' "$*" >&2; }

if ! "$VENV_PY" -c "import claude_agent_sdk" 2>/dev/null; then
  info "Installing claude-agent-sdk into venv…"
  "$VENV_PY" -m pip install claude-agent-sdk
fi

cd "$ROOT/backend"
RESOLVE=$("$VENV_PY" - <<'PY'
import json
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

sys.path.insert(0, ".")
load_dotenv(Path(".") / ".env")
from core.coding_provider import ensure_coding_config_auto, get_coding_config_summary
from services.claude_code_service import get_health_status, resolve_claude_cli_path

boot = ensure_coding_config_auto(env_file=str(Path(".") / ".env"))
print(json.dumps({
    "cli_path": str(resolve_claude_cli_path() or ""),
    "health": get_health_status(),
    "coding_config": get_coding_config_summary(),
    "bootstrap": boot,
}))
PY
)

CLI_PATH=$(echo "$RESOLVE" | "$VENV_PY" -c "import sys,json; print(json.load(sys.stdin).get('cli_path',''))")
READY=$(echo "$RESOLVE" | "$VENV_PY" -c "import sys,json; print(json.load(sys.stdin)['health'].get('ready', False))")

if [ -z "$CLI_PATH" ]; then
  warn "No claude CLI found. Install: curl -fsSL https://claude.ai/install.sh | bash"
  exit 1
fi

info "Claude CLI: $CLI_PATH"
BOOT=$(echo "$RESOLVE" | "$VENV_PY" -c "import sys,json; b=json.load(sys.stdin).get('bootstrap',{}); print(b.get('provider',''), b.get('model',''), b.get('ready', False))")
info "Coding bootstrap: $BOOT"
if [ "$READY" = "True" ]; then
  info "Claude Code ready (SDK + auth configured)"
else
  warn "CLI present but coding auth missing — check ALIBABA_API_KEY / DASHSCOPE_API_KEY in backend/.env"
fi
