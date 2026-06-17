#!/usr/bin/env python3
"""Compare backend/ with electron/resources/backend/ for drift."""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "backend"
DST = ROOT / "electron" / "resources" / "backend"

# Key files that must stay in sync (Electron bundles these)
KEY_PATHS = [
    "main.py",
    "routers/knowledge_router.py",
    "routers/customer_service_router.py",
    "routers/auth_router.py",
    "utils/rag_manager.py",
    "services/customer_service_engine.py",
    "services/customer_service_retrieval.py",
]


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    if not DST.is_dir():
        print(f"WARN: electron backend copy missing: {DST}")
        return 0

    mismatches: list[str] = []
    for rel in KEY_PATHS:
        src = SRC / rel
        dst = DST / rel
        if not src.is_file():
            continue
        if not dst.is_file():
            mismatches.append(f"missing in electron copy: {rel}")
            continue
        if _sha256(src) != _sha256(dst):
            mismatches.append(f"hash mismatch: {rel}")

    if mismatches:
        print("Electron sync check FAILED:")
        for line in mismatches:
            print(f"  - {line}")
        print("Run electron sync or copy updated backend files before release.")
        return 1

    print("Electron sync check OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
