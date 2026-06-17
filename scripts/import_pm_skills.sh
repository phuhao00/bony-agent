#!/usr/bin/env bash
# Import deanpeters/Product-Manager-Skills starter pack into .agent/skills/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON="${ROOT}/venv/bin/python"
if [[ ! -x "$PYTHON" ]]; then
  PYTHON="$(command -v python3)"
fi

exec "$PYTHON" "${ROOT}/scripts/import_pm_skills.py" "$@"
