#!/usr/bin/env python3
"""Run DashScope PSD layer split on a local image.

Usage (from repo root):
  ./venv/bin/python scripts/compare_psd_engines.py /path/to/poster.png
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND = PROJECT_ROOT / "backend"
sys.path.insert(0, str(BACKEND))
import os

os.chdir(BACKEND)

from PIL import Image  # noqa: E402

from tools.image_layer_split_tools import get_split_psd_status, split_image_to_psd  # noqa: E402
from tools.media_common import OUTPUT_DIR  # noqa: E402


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: compare_psd_engines.py <image_path>")
        return 1

    src = Path(sys.argv[1]).expanduser()
    if not src.is_file():
        print(f"File not found: {src}")
        return 1

    stem = src.stem
    dest = Path(OUTPUT_DIR) / f"ab_{stem}.png"
    Image.open(src).convert("RGBA").save(dest, "PNG")
    image_url = f"/api/media/{dest.name}"

    status = get_split_psd_status()
    print("Engine status:", json.dumps(status, ensure_ascii=False, indent=2, default=str))

    if not status.get("can_split"):
        print("\n[ERROR] DASHSCOPE_API_KEY not configured.")
        return 1

    normal = split_image_to_psd(image_url, max_layers=6, include_ocr=True, high_quality=False)
    print("\n[standard]", normal.get("engine"), normal.get("layer_count"), normal.get("filename"))

    hq = split_image_to_psd(image_url, max_layers=6, include_ocr=True, high_quality=True)
    print("[high_quality]", hq.get("engine"), hq.get("layer_count"), hq.get("filename"))

    print("\nCompare PSD files in storage/outputs/ visually in Photoshop/Photopea.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
