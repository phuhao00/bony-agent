#!/bin/bash
# Upsert stock-footage API keys into backend/.env (values never printed).
# Usage:
#   PIXABAY_API_KEY=your_key bash electron/scripts/ensure_stock_env_keys.sh
#   # or edit backend/.env directly, then rebuild

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="$ROOT/backend/.env"

upsert_key() {
  local key="$1"
  local val="${2:-}"
  [ -n "$val" ] || return 0
  touch "$ENV_FILE"
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    # macOS sed in-place
    sed -i '' "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    printf '\n%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
  echo "[ensure-stock] updated $key in backend/.env"
}

upsert_key PIXABAY_API_KEY "${PIXABAY_API_KEY:-}"
upsert_key PEXELS_API_KEY "${PEXELS_API_KEY:-}"

python3 - "$ENV_FILE" <<'PY'
import re, sys
from pathlib import Path
p = Path(sys.argv[1])
if not p.exists():
    print("[ensure-stock] backend/.env missing")
    raise SystemExit(1)
text = p.read_text(errors="ignore")
for key in ("PEXELS_API_KEY", "PIXABAY_API_KEY"):
    m = re.search(rf"^{key}=(.*)$", text, re.M)
    val = (m.group(1).strip() if m else "")
    print(f"[ensure-stock] {key}: {'set' if val else 'empty/missing'}")
PY
