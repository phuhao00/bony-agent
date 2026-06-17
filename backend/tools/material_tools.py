"""
免版权素材工具 — 参考 MoneyPrinterTurbo 的 material 模块。

支持 Pexels / Pixabay 视频搜索与下载，按目标时长拼接素材列表。
无 API Key 或在线检索失败时，回退到 FFmpeg 本地合成 B-roll。
"""
from __future__ import annotations

import os
import random
import shutil
import subprocess
import uuid
from dataclasses import dataclass
from typing import List, Optional, Tuple
from urllib.parse import urlencode

import requests

from tools.media_common import TEMP_DIR
from utils.logger import setup_logger

logger = setup_logger("material_tools")

MATERIAL_CACHE_DIR = os.path.join(TEMP_DIR, "material_cache")
os.makedirs(MATERIAL_CACHE_DIR, exist_ok=True)

ASPECT_MAP = {
    "9:16": {"orientation": "portrait", "width": 1080, "height": 1920},
    "16:9": {"orientation": "landscape", "width": 1920, "height": 1080},
    "1:1": {"orientation": "square", "width": 1080, "height": 1080},
}


@dataclass
class MaterialItem:
    provider: str
    url: str
    duration: float
    local_path: str = ""


def _get_pexels_key() -> Optional[str]:
    key = os.getenv("PEXELS_API_KEY", "").strip()
    if key:
        return key
    keys = os.getenv("PEXELS_API_KEYS", "").strip()
    if keys:
        parts = [k.strip() for k in keys.replace(";", ",").split(",") if k.strip()]
        if parts:
            return random.choice(parts)
    return None


def _get_pixabay_key() -> Optional[str]:
    return os.getenv("PIXABAY_API_KEY", "").strip() or None


def has_stock_api_keys() -> Tuple[bool, bool]:
    return bool(_get_pexels_key()), bool(_get_pixabay_key())


def _pick_pexels_file(video_files: list, target_w: int, target_h: int) -> Optional[dict]:
    """优先精确比例，否则取最接近目标分辨率的文件。"""
    if not video_files:
        return None
    exact = [
        vf for vf in video_files
        if int(vf.get("width") or 0) == target_w and int(vf.get("height") or 0) == target_h
    ]
    if exact:
        return exact[0]
    scored = sorted(
        video_files,
        key=lambda vf: abs(int(vf.get("width") or 0) - target_w) + abs(int(vf.get("height") or 0) - target_h),
    )
    best = scored[0]
    if int(best.get("width") or 0) >= target_w * 0.45 and int(best.get("height") or 0) >= target_h * 0.45:
        return best
    return scored[0] if scored else None


def search_videos_pexels(
    search_term: str,
    aspect_ratio: str = "9:16",
    minimum_duration: int = 3,
    per_page: int = 15,
) -> List[MaterialItem]:
    api_key = _get_pexels_key()
    if not api_key:
        logger.warning("[material] PEXELS_API_KEY not configured")
        return []

    aspect = ASPECT_MAP.get(aspect_ratio, ASPECT_MAP["9:16"])
    params = {
        "query": search_term,
        "per_page": per_page,
        "orientation": aspect["orientation"],
    }
    url = f"https://api.pexels.com/videos/search?{urlencode(params)}"
    headers = {"Authorization": api_key}

    try:
        resp = requests.get(url, headers=headers, timeout=(20, 60))
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        logger.error("[material] pexels search failed term=%r err=%s", search_term, exc)
        return []

    items: List[MaterialItem] = []
    target_w, target_h = aspect["width"], aspect["height"]
    for video in data.get("videos", []):
        duration = float(video.get("duration") or 0)
        if duration < minimum_duration:
            continue
        vf = _pick_pexels_file(video.get("video_files") or [], target_w, target_h)
        if vf and vf.get("link"):
            items.append(
                MaterialItem(
                    provider="pexels",
                    url=vf.get("link", ""),
                    duration=duration,
                )
            )
    logger.info("[material] pexels term=%r found=%d", search_term, len(items))
    return items


def search_videos_pixabay(
    search_term: str,
    aspect_ratio: str = "9:16",
    minimum_duration: int = 3,
    per_page: int = 15,
) -> List[MaterialItem]:
    api_key = _get_pixabay_key()
    if not api_key:
        logger.warning("[material] PIXABAY_API_KEY not configured")
        return []

    aspect = ASPECT_MAP.get(aspect_ratio, ASPECT_MAP["9:16"])
    params = {
        "key": api_key,
        "q": search_term,
        "video_type": "film",
        "per_page": per_page,
        "orientation": aspect["orientation"],
    }
    url = f"https://pixabay.com/api/videos/?{urlencode(params)}"

    try:
        resp = requests.get(url, timeout=(20, 60))
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        logger.error("[material] pixabay search failed term=%r err=%s", search_term, exc)
        return []

    items: List[MaterialItem] = []
    for hit in data.get("hits", []):
        duration = float(hit.get("duration") or 0)
        if duration < minimum_duration:
            continue
        videos = hit.get("videos") or {}
        for quality in ("large", "medium", "small", "tiny"):
            info = videos.get(quality)
            if not info or not info.get("url"):
                continue
            w, h = int(info.get("width") or 0), int(info.get("height") or 0)
            if w >= aspect["width"] * 0.5 and h >= aspect["height"] * 0.5:
                items.append(
                    MaterialItem(
                        provider="pixabay",
                        url=info["url"],
                        duration=duration,
                    )
                )
                break
    logger.info("[material] pixabay term=%r found=%d", search_term, len(items))
    return items


def download_material(item: MaterialItem, task_dir: str) -> Optional[str]:
    if not item.url:
        return None
    filename = f"{item.provider}_{uuid.uuid4().hex[:8]}.mp4"
    local_path = os.path.join(task_dir, filename)
    try:
        with requests.get(item.url, stream=True, timeout=(30, 120)) as resp:
            resp.raise_for_status()
            with open(local_path, "wb") as f:
                for chunk in resp.iter_content(chunk_size=1024 * 256):
                    if chunk:
                        f.write(chunk)
        if os.path.exists(local_path) and os.path.getsize(local_path) > 0:
            item.local_path = local_path
            logger.debug("[material] downloaded %s", local_path)
            return local_path
    except Exception as exc:
        logger.warning("[material] download failed url=%s err=%s", item.url[:80], exc)
    return None


def search_materials(
    search_terms: List[str],
    source: str = "pexels",
    aspect_ratio: str = "9:16",
) -> List[MaterialItem]:
    seen_urls: set[str] = set()
    results: List[MaterialItem] = []

    def _collect(fn, provider: str) -> None:
        for term in search_terms:
            for item in fn(term, aspect_ratio=aspect_ratio):
                if item.url in seen_urls:
                    continue
                seen_urls.add(item.url)
                item.provider = provider
                results.append(item)

    if source == "pexels":
        _collect(search_videos_pexels, "pexels")
        if not results:
            _collect(search_videos_pixabay, "pixabay")
    else:
        _collect(search_videos_pixabay, "pixabay")
        if not results:
            _collect(search_videos_pexels, "pexels")

    random.shuffle(results)
    return results


def generate_synthetic_clips(
    target_duration: float,
    task_dir: str,
    aspect_ratio: str = "9:16",
    clip_duration: float = 3.0,
    search_terms: Optional[List[str]] = None,
) -> List[str]:
    """无在线素材时，用 FFmpeg lavfi 生成渐变 B-roll（无需 API Key）。"""
    if not shutil.which("ffmpeg"):
        raise RuntimeError("系统未安装 FFmpeg，无法生成本地素材")

    os.makedirs(task_dir, exist_ok=True)
    aspect = ASPECT_MAP.get(aspect_ratio, ASPECT_MAP["9:16"])
    w, h = aspect["width"], aspect["height"]

    palettes = [
        ("0x1a1a2e", "0x16213e", "0x0f3460"),
        ("0x2d132c", "0x801336", "0xc72c41"),
        ("0x0b525b", "0x006466", "0x4d194d"),
        ("0x1b262c", "0x0f4c75", "0x3282b8"),
        ("0x2b2d42", "0x8d99ae", "0xedf2f4"),
    ]
    terms = search_terms or ["创意", "短视频"]
    clip_count = max(2, int(target_duration / clip_duration) + 1)
    paths: List[str] = []

    for i in range(clip_count):
        c1, c2, c3 = palettes[i % len(palettes)]
        out = os.path.join(task_dir, f"synthetic_{i:03d}.mp4")
        cmd = [
            "ffmpeg", "-y",
            "-f", "lavfi",
            "-i", f"color=c={c2}:s={w}x{h}:d={clip_duration}",
            "-f", "lavfi",
            "-i", f"color=c={c3}:s={w}x{h}:d={clip_duration}",
            "-filter_complex",
            f"[0][1]blend=all_mode=overlay:all_opacity=0.55,scale={w}:{h}",
            "-t", str(clip_duration),
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-r", "24",
            out,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if result.returncode != 0 or not os.path.isfile(out):
            cmd_simple = [
                "ffmpeg", "-y",
                "-f", "lavfi",
                "-i", f"color=c={c1}:s={w}x{h}:d={clip_duration}",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "24",
                out,
            ]
            subprocess.run(cmd_simple, capture_output=True, check=False)
        if os.path.isfile(out):
            paths.append(out)

    if not paths:
        raise RuntimeError("本地合成素材生成失败")
    logger.info("[material] synthetic clips=%d target=%.1fs", len(paths), target_duration)
    return paths


def download_materials_for_duration(
    search_terms: List[str],
    target_duration: float,
    task_dir: str,
    source: str = "pexels",
    aspect_ratio: str = "9:16",
    clip_duration: float = 3.0,
) -> Tuple[List[str], str]:
    """搜索并下载足够覆盖 target_duration 的素材片段路径列表。

    Returns:
        (local_paths, material_mode) — material_mode 为 ``stock`` 或 ``synthetic``
    """
    os.makedirs(task_dir, exist_ok=True)
    items = search_materials(search_terms, source=source, aspect_ratio=aspect_ratio)

    if items:
        local_paths: List[str] = []
        accumulated = 0.0
        idx = 0
        max_attempts = max(len(items) * 3, 6)

        while accumulated < target_duration and idx < max_attempts:
            item = items[idx % len(items)]
            path = download_material(item, task_dir)
            idx += 1
            if not path:
                continue
            local_paths.append(path)
            accumulated += min(clip_duration, item.duration or clip_duration)

        if local_paths:
            logger.info(
                "[material] downloaded %d clips for target=%.1fs (online stock)",
                len(local_paths),
                target_duration,
            )
            return local_paths, "stock"

    has_pexels, has_pixabay = has_stock_api_keys()
    logger.warning(
        "[material] online stock unavailable source=%s pexels_key=%s pixabay_key=%s terms=%r — using synthetic fallback",
        source,
        has_pexels,
        has_pixabay,
        search_terms[:3],
    )
    paths = generate_synthetic_clips(
        target_duration=target_duration,
        task_dir=os.path.join(task_dir, "synthetic"),
        aspect_ratio=aspect_ratio,
        clip_duration=clip_duration,
        search_terms=search_terms,
    )
    return paths, "synthetic"
