#!/usr/bin/env python3
"""ffprobe 兼容垫片（ffprobe compatibility shim）。

适用场景：精简/沙箱环境（如容器、CI、AI Agent 运行时）中只有
imageio-ffmpeg 自带的静态 ffmpeg，而没有随发行版附带的 ffprobe。
本脚本实现 bony-agent 代码库实际用到的 ffprobe 查询子集：

  1. ffprobe -v error -show_entries format=duration \
         -of default=noprint_wrappers=1:nokey=1 <file>   -> 纯数字秒
  2. ffprobe -v quiet -select_streams v:0 \
         -show_entries stream=width,height -of json <file> -> JSON
  3. ffprobe ... -of csv=p=0 <file>                        -> "宽,高"

内部通过 `ffmpeg -i <file>` 解析 stderr 中的 Duration / Video stream 元数据，
仅使用标准库。真实环境中若系统已安装 ffprobe，本垫片不会被使用
（main.py 仅在 shutil.which('ffprobe') 为空时安装它）。
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys


def _find_ffmpeg() -> str:
    """优先使用与本垫片同目录的 ffmpeg，其次 PATH，最后 imageio-ffmpeg。"""
    here = os.path.dirname(os.path.abspath(__file__))
    cand = os.path.join(here, "ffmpeg.exe" if os.name == "nt" else "ffmpeg")
    if os.path.isfile(cand):
        return cand
    from shutil import which
    found = which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg  # type: ignore
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


def _probe(file_path: str) -> dict:
    ffmpeg = _find_ffmpeg()
    try:
        r = subprocess.run(
            [ffmpeg, "-hide_banner", "-i", file_path],
            capture_output=True, text=True, timeout=60,
        )
        meta = r.stderr or ""
    except Exception as exc:  # noqa: BLE001
        print(f"ffprobe-shim: probe failed: {exc}", file=sys.stderr)
        return {"duration": 0.0, "width": 1280, "height": 720}

    duration = 0.0
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", meta)
    if m:
        duration = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    width, height = 1280, 720
    v = re.search(r"Video:.*? (\d{2,6})x(\d{2,6})", meta)
    if v:
        width, height = int(v.group(1)), int(v.group(2))
    return {"duration": duration, "width": width, "height": height}


def main(argv: list) -> int:
    show_entries = ""
    out_format = "default"
    file_path = None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "-show_entries" and i + 1 < len(argv):
            show_entries = argv[i + 1]; i += 2; continue
        if a == "-of" and i + 1 < len(argv):
            out_format = argv[i + 1]; i += 2; continue
        if a.startswith("-of="):
            out_format = a[4:]; i += 1; continue
        if a == "-select_streams" and i + 1 < len(argv):
            i += 2; continue
        if a.startswith("-"):
            i += 1; continue
        file_path = a; i += 1

    if not file_path or not os.path.isfile(file_path):
        print(f"ffprobe-shim: no such file: {file_path}", file=sys.stderr)
        return 1

    info = _probe(file_path)

    if "stream=width,height" in show_entries:
        if "json" in out_format:
            print(json.dumps({"streams": [{"width": info["width"], "height": info["height"]}]}))
        else:  # csv / default
            print(f'{info["width"]},{info["height"]}')
    elif "json" in out_format:
        print(json.dumps({
            "format": {"duration": f'{info["duration"]:.6f}'},
            "streams": [{"width": info["width"], "height": info["height"]}],
        }))
    else:  # default=noprint_wrappers=1:nokey=1 -> 纯数字
        print(f'{info["duration"]:.6f}')
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
