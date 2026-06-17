#!/usr/bin/env python3
"""CLI wrapper for Hermes ↔ AI Media Agent skill sync."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND))

from services.skill_sync import sync_from_hermes, sync_to_hermes  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync skills between Hermes and .agent/skills")
    parser.add_argument(
        "direction",
        choices=["from_hermes", "to_hermes", "both"],
        help="Sync direction",
    )
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing files")
    args = parser.parse_args()

    if args.direction in {"from_hermes", "both"}:
        print("=== from Hermes ===")
        print(sync_from_hermes(dry_run=args.dry_run))
    if args.direction in {"to_hermes", "both"}:
        print("=== to Hermes ===")
        print(sync_to_hermes(dry_run=args.dry_run))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
