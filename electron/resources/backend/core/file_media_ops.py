"""File and image media operations for System Assistant (within My Computer roots)."""

from __future__ import annotations

import hashlib
import shutil
import subprocess
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image, ImageDraw, ImageFont, ImageOps

from utils.logger import setup_logger

logger = setup_logger("file_media_ops")

IMAGE_EXTENSIONS = frozenset(
    {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic", ".tiff", ".tif"}
)
MAX_IMAGES_PER_JOB = 200
MAX_SLIDESHOW_IMAGES = 60
HASH_CHUNK_BYTES = 256 * 1024
EXIF_DATETIME_TAGS = (36867, 306)  # DateTimeOriginal, DateTime
EXIF_ORIENTATION_TAG = 274
AUDIO_EXTENSIONS = frozenset({".mp3", ".m4a", ".wav", ".aac", ".flac", ".ogg"})


class FileMediaOpsError(ValueError):
    pass


def is_image_path(path: Path) -> bool:
    return path.suffix.lower() in IMAGE_EXTENSIONS and path.is_file()


def _file_content_hash(path: Path) -> str:
    digest = hashlib.md5()
    size = path.stat().st_size
    digest.update(str(size).encode("utf-8"))
    with path.open("rb") as fh:
        digest.update(fh.read(HASH_CHUNK_BYTES))
    return digest.hexdigest()


def _exif_datetime(path: Path) -> Optional[float]:
    try:
        with Image.open(path) as im:
            exif = im.getexif()
            if not exif:
                return None
            for tag in EXIF_DATETIME_TAGS:
                raw = exif.get(tag)
                if not raw:
                    continue
                try:
                    return datetime.strptime(str(raw), "%Y:%m:%d %H:%M:%S").timestamp()
                except ValueError:
                    continue
    except Exception:
        return None
    return None


def _apply_exif_orientation(im: Image.Image, path: Path) -> Image.Image:
    try:
        with Image.open(path) as src:
            exif = src.getexif()
            if not exif:
                return im
            orientation = exif.get(EXIF_ORIENTATION_TAG)
            if orientation in {3, 6, 8}:
                return ImageOps.exif_transpose(im)
    except Exception:
        pass
    return im


def _apply_watermark(
    im: Image.Image,
    text: str,
    *,
    position: str = "bottom_right",
) -> Image.Image:
    text = (text or "").strip()
    if not text:
        return im
    rgba = im.convert("RGBA")
    overlay = Image.new("RGBA", rgba.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    font_size = max(16, min(rgba.size) // 32)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", font_size)
    except OSError:
        font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    margin = 12
    if position == "bottom_left":
        xy = (margin, rgba.size[1] - th - margin)
    elif position == "top_right":
        xy = (rgba.size[0] - tw - margin, margin)
    elif position == "top_left":
        xy = (margin, margin)
    elif position == "center":
        xy = ((rgba.size[0] - tw) // 2, (rgba.size[1] - th) // 2)
    else:
        xy = (rgba.size[0] - tw - margin, rgba.size[1] - th - margin)
    draw.rectangle(
        (xy[0] - 6, xy[1] - 4, xy[0] + tw + 6, xy[1] + th + 4),
        fill=(0, 0, 0, 120),
    )
    draw.text(xy, text, fill=(255, 255, 255, 230), font=font)
    return Image.alpha_composite(rgba, overlay)


def collect_images(
    root: Path,
    *,
    recursive: bool = True,
    limit: int = MAX_IMAGES_PER_JOB,
) -> List[Dict[str, Any]]:
    if not root.exists() or not root.is_dir():
        raise FileMediaOpsError("路径不是有效目录")
    images: List[Dict[str, Any]] = []
    iterator = root.rglob("*") if recursive else root.iterdir()
    for item in iterator:
        if not is_image_path(item):
            continue
        try:
            stat = item.stat()
        except OSError:
            continue
        exif_ts = _exif_datetime(item)
        images.append(
            {
                "name": item.name,
                "path": str(item),
                "size": stat.st_size,
                "modified_at": stat.st_mtime,
                "exif_date": exif_ts,
                "content_hash": _file_content_hash(item),
                "extension": item.suffix.lower(),
            }
        )
        if len(images) >= limit:
            break
    images.sort(key=lambda x: x["name"].lower())
    return images


def _size_bucket(size: int) -> str:
    if size < 500 * 1024:
        return "Small"
    if size < 2 * 1024 * 1024:
        return "Medium"
    return "Large"


def build_image_organize_moves(
    images: List[Dict[str, Any]],
    root: Path,
    *,
    mode: str = "by_format",
) -> List[Dict[str, str]]:
    moves: List[Dict[str, str]] = []
    for img in images:
        src = Path(img["path"])
        if mode == "by_exif_date":
            ts = img.get("exif_date") or img.get("modified_at") or time.time()
            subdir = f"ByExifDate/{datetime.fromtimestamp(ts).strftime('%Y-%m')}"
        elif mode == "by_date":
            ts = img.get("modified_at") or time.time()
            subdir = f"ByDate/{datetime.fromtimestamp(ts).strftime('%Y-%m')}"
        elif mode == "by_size":
            subdir = f"BySize/{_size_bucket(int(img.get('size') or 0))}"
        else:
            ext = (img.get("extension") or src.suffix.lower()).lstrip(".") or "other"
            subdir = f"Images/{ext.upper()}"
        dest = root / subdir / src.name
        if str(dest) == str(src):
            continue
        moves.append({"source": str(src), "dest": str(dest), "category": subdir})
    return moves


def preview_image_organize(
    root_path: str,
    *,
    mode: str = "by_format",
    recursive: bool = True,
) -> Dict[str, Any]:
    root = Path(root_path).expanduser().resolve()
    images = collect_images(root, recursive=recursive)
    moves = build_image_organize_moves(images, root, mode=mode)
    return {
        "root_path": str(root),
        "mode": mode,
        "image_count": len(images),
        "move_count": len(moves),
        "moves": moves[:100],
        "images": images[:20],
    }


def preview_compress_images(
    root_path: str,
    *,
    quality: int = 80,
    max_width: int = 1920,
    output_subdir: str = "Compressed",
    recursive: bool = True,
) -> Dict[str, Any]:
    root = Path(root_path).expanduser().resolve()
    images = collect_images(root, recursive=recursive)
    quality = max(10, min(int(quality), 95))
    max_width = max(320, min(int(max_width), 4096))
    out_dir = root / output_subdir
    items: List[Dict[str, Any]] = []
    total_saved_estimate = 0
    for img in images:
        src = Path(img["path"])
        if output_subdir and output_subdir in src.parts:
            continue
        rel = src.relative_to(root)
        dest = out_dir / rel
        dest = dest.with_suffix(".jpg")
        size = int(img.get("size") or 0)
        estimate = max(0, int(size * (1 - quality / 100) * 0.6))
        total_saved_estimate += estimate
        items.append(
            {
                "source": str(src),
                "dest": str(dest),
                "original_size": size,
                "estimated_saved_bytes": estimate,
            }
        )
    return {
        "root_path": str(root),
        "quality": quality,
        "max_width": max_width,
        "output_subdir": output_subdir,
        "image_count": len(items),
        "estimated_saved_bytes": total_saved_estimate,
        "items": items[:100],
    }


def _compress_one(
    src: Path,
    dest: Path,
    *,
    quality: int,
    max_width: int,
) -> Dict[str, Any]:
    dest.parent.mkdir(parents=True, exist_ok=True)
    original_size = src.stat().st_size
    with Image.open(src) as im:
        im = im.convert("RGB")
        w, h = im.size
        if w > max_width:
            ratio = max_width / w
            im = im.resize((max_width, max(1, int(h * ratio))), Image.Resampling.LANCZOS)
        im.save(dest, format="JPEG", quality=quality, optimize=True)
    new_size = dest.stat().st_size
    return {
        "source": str(src),
        "dest": str(dest),
        "original_size": original_size,
        "compressed_size": new_size,
        "saved_bytes": max(0, original_size - new_size),
    }


def apply_compress_images(
    root_path: str,
    *,
    quality: int = 80,
    max_width: int = 1920,
    output_subdir: str = "Compressed",
    recursive: bool = True,
    limit: int = 50,
) -> Dict[str, Any]:
    preview = preview_compress_images(
        root_path,
        quality=quality,
        max_width=max_width,
        output_subdir=output_subdir,
        recursive=recursive,
    )
    applied: List[Dict[str, Any]] = []
    errors: List[str] = []
    for item in (preview.get("items") or [])[:limit]:
        try:
            applied.append(
                _compress_one(
                    Path(item["source"]),
                    Path(item["dest"]),
                    quality=int(preview["quality"]),
                    max_width=int(preview["max_width"]),
                )
            )
        except Exception as exc:
            errors.append(f"{item.get('source')}: {exc}")
    total_saved = sum(a.get("saved_bytes", 0) for a in applied)
    return {
        "applied_count": len(applied),
        "saved_bytes": total_saved,
        "items": applied[:50],
        "errors": errors,
        "output_dir": str(Path(root_path) / output_subdir),
    }


def preview_dedupe_images(
    root_path: str,
    *,
    output_subdir: str = "Duplicates",
    recursive: bool = True,
) -> Dict[str, Any]:
    root = Path(root_path).expanduser().resolve()
    images = collect_images(root, recursive=recursive)
    groups: Dict[str, List[Dict[str, Any]]] = {}
    for img in images:
        if output_subdir and output_subdir in Path(img["path"]).parts:
            continue
        groups.setdefault(str(img.get("content_hash")), []).append(img)
    duplicate_groups = [g for g in groups.values() if len(g) > 1]
    moves: List[Dict[str, str]] = []
    for group in duplicate_groups:
        sorted_group = sorted(group, key=lambda x: (len(x["path"]), x["path"]))
        keeper = sorted_group[0]
        group_id = (keeper.get("content_hash") or "unknown")[:8]
        for dup in sorted_group[1:]:
            src = Path(dup["path"])
            dest = root / output_subdir / group_id / src.name
            moves.append(
                {
                    "source": str(src),
                    "dest": str(dest),
                    "category": f"duplicate:{group_id}",
                    "keeper": keeper["path"],
                }
            )
    return {
        "root_path": str(root),
        "image_count": len(images),
        "duplicate_group_count": len(duplicate_groups),
        "duplicate_file_count": len(moves),
        "move_count": len(moves),
        "moves": moves[:100],
        "groups": [
            {
                "hash": g[0].get("content_hash"),
                "keeper": g[0]["path"],
                "duplicates": [x["path"] for x in g[1:]],
            }
            for g in duplicate_groups[:20]
        ],
        "output_subdir": output_subdir,
    }


def apply_dedupe_images(
    root_path: str,
    *,
    moves: List[Dict[str, str]],
    limit: int = 50,
) -> Dict[str, Any]:
    applied: List[Dict[str, Any]] = []
    errors: List[str] = []
    for move in moves[:limit]:
        try:
            dest = Path(move["dest"])
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(move["source"], move["dest"])
            applied.append({"source": move["source"], "dest": move["dest"]})
        except Exception as exc:
            errors.append(f"{move.get('source')}: {exc}")
    return {
        "applied_count": len(applied),
        "items": applied[:50],
        "errors": errors,
        "output_dir": str(Path(root_path) / "Duplicates"),
    }


def preview_edit_images(
    root_path: str,
    *,
    rotate: int = 0,
    max_width: int = 0,
    output_format: str = "",
    output_subdir: str = "Edited",
    recursive: bool = True,
    auto_orient: bool = False,
    watermark_text: str = "",
    watermark_position: str = "bottom_right",
) -> Dict[str, Any]:
    root = Path(root_path).expanduser().resolve()
    images = collect_images(root, recursive=recursive)
    fmt = (output_format or "").lower().lstrip(".")
    if fmt and fmt not in {"jpg", "jpeg", "png", "webp"}:
        raise FileMediaOpsError(f"不支持的输出格式: {output_format}")
    out_dir = root / output_subdir
    items: List[Dict[str, Any]] = []
    for img in images:
        src = Path(img["path"])
        if output_subdir and output_subdir in src.parts:
            continue
        rel = src.relative_to(root)
        dest = out_dir / rel
        if fmt:
            dest = dest.with_suffix(f".{fmt}")
        items.append(
            {
                "source": str(src),
                "dest": str(dest),
                "rotate": rotate,
                "max_width": max_width or None,
                "format": fmt or src.suffix.lower().lstrip("."),
                "auto_orient": auto_orient,
                "watermark_text": watermark_text or None,
            }
        )
    return {
        "root_path": str(root),
        "rotate": rotate,
        "max_width": max_width or None,
        "output_format": fmt or "keep",
        "output_subdir": output_subdir,
        "auto_orient": auto_orient,
        "watermark_text": watermark_text or None,
        "watermark_position": watermark_position,
        "image_count": len(items),
        "items": items[:100],
    }


def _edit_one(
    src: Path,
    dest: Path,
    *,
    rotate: int,
    max_width: int,
    output_format: str,
    auto_orient: bool = False,
    watermark_text: str = "",
    watermark_position: str = "bottom_right",
) -> Dict[str, Any]:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(src) as im:
        if auto_orient:
            im = _apply_exif_orientation(im, src)
        if rotate in {90, 180, 270}:
            im = im.rotate(-rotate, expand=True)
        if max_width > 0:
            w, h = im.size
            if w > max_width:
                ratio = max_width / w
                im = im.resize((max_width, max(1, int(h * ratio))), Image.Resampling.LANCZOS)
        fmt = (output_format or dest.suffix.lower().lstrip(".")).upper()
        save_kwargs: Dict[str, Any] = {}
        if fmt in {"JPG", "JPEG"}:
            im = im.convert("RGB")
            fmt = "JPEG"
            save_kwargs["quality"] = 90
        elif fmt == "PNG":
            im = im.convert("RGBA")
        elif fmt == "WEBP":
            save_kwargs["quality"] = 90
        else:
            fmt = "PNG"
            im = im.convert("RGBA")
        if watermark_text:
            im = _apply_watermark(im, watermark_text, position=watermark_position)
        im.save(dest, format=fmt, **save_kwargs)
    return {"source": str(src), "dest": str(dest)}


def apply_edit_images(
    root_path: str,
    *,
    rotate: int = 0,
    max_width: int = 0,
    output_format: str = "",
    output_subdir: str = "Edited",
    recursive: bool = True,
    limit: int = 50,
    auto_orient: bool = False,
    watermark_text: str = "",
    watermark_position: str = "bottom_right",
) -> Dict[str, Any]:
    preview = preview_edit_images(
        root_path,
        rotate=rotate,
        max_width=max_width,
        output_format=output_format,
        output_subdir=output_subdir,
        recursive=recursive,
        auto_orient=auto_orient,
        watermark_text=watermark_text,
        watermark_position=watermark_position,
    )
    applied: List[Dict[str, Any]] = []
    errors: List[str] = []
    for item in (preview.get("items") or [])[:limit]:
        try:
            applied.append(
                _edit_one(
                    Path(item["source"]),
                    Path(item["dest"]),
                    rotate=int(preview.get("rotate") or 0),
                    max_width=int(preview.get("max_width") or 0),
                    output_format=str(preview.get("output_format") or ""),
                    auto_orient=bool(preview.get("auto_orient")),
                    watermark_text=str(preview.get("watermark_text") or ""),
                    watermark_position=str(preview.get("watermark_position") or "bottom_right"),
                )
            )
        except Exception as exc:
            errors.append(f"{item.get('source')}: {exc}")
    return {
        "applied_count": len(applied),
        "items": applied[:50],
        "errors": errors,
        "output_dir": str(Path(root_path) / output_subdir),
    }


def _sort_images_for_video(images: List[Dict[str, Any]], sort_by: str) -> List[Dict[str, Any]]:
    if sort_by == "exif_date":
        return sorted(
            images,
            key=lambda x: (x.get("exif_date") is None, x.get("exif_date") or 0, x["name"].lower()),
        )
    if sort_by == "name":
        return sorted(images, key=lambda x: x["name"].lower())
    return images


def preview_images_to_video(
    root_path: str,
    *,
    duration_per_image: float = 3.0,
    fps: int = 30,
    width: int = 1280,
    height: int = 720,
    recursive: bool = True,
    sort_by: str = "name",
    audio_path: str = "",
) -> Dict[str, Any]:
    if not shutil.which("ffmpeg"):
        raise FileMediaOpsError("系统未安装 FFmpeg，无法制作视频")
    root = Path(root_path).expanduser().resolve()
    images = _sort_images_for_video(
        collect_images(root, recursive=recursive, limit=MAX_SLIDESHOW_IMAGES),
        sort_by,
    )
    if len(images) < 2:
        raise FileMediaOpsError("至少需要 2 张图片才能制作幻灯片视频")
    output_name = f"slideshow_{uuid.uuid4().hex[:8]}.mp4"
    output_path = root / "Slideshows" / output_name
    total_duration = len(images) * max(0.5, float(duration_per_image))
    audio_note = None
    if audio_path:
        audio = Path(audio_path).expanduser().resolve()
        if not audio.exists() or audio.suffix.lower() not in AUDIO_EXTENSIONS:
            raise FileMediaOpsError("背景音乐须为登记目录内的 mp3/m4a/wav/aac/flac/ogg 文件")
        audio_note = str(audio)
    return {
        "root_path": str(root),
        "image_count": len(images),
        "images": [i["path"] for i in images[:20]],
        "duration_per_image": duration_per_image,
        "fps": fps,
        "resolution": f"{width}x{height}",
        "sort_by": sort_by,
        "audio_path": audio_note,
        "has_bgm": bool(audio_note),
        "estimated_duration_sec": round(total_duration, 1),
        "output_path": str(output_path),
    }


def create_slideshow_video(
    root_path: str,
    *,
    duration_per_image: float = 3.0,
    fps: int = 30,
    width: int = 1280,
    height: int = 720,
    recursive: bool = True,
    output_path: Optional[str] = None,
    sort_by: str = "name",
    audio_path: str = "",
) -> Dict[str, Any]:
    if not shutil.which("ffmpeg"):
        raise FileMediaOpsError("系统未安装 FFmpeg，无法制作视频")
    preview = preview_images_to_video(
        root_path,
        duration_per_image=duration_per_image,
        fps=fps,
        width=width,
        height=height,
        recursive=recursive,
        sort_by=sort_by,
        audio_path=audio_path,
    )
    root = Path(root_path).expanduser().resolve()
    images = _sort_images_for_video(
        collect_images(root, recursive=recursive, limit=MAX_SLIDESHOW_IMAGES),
        sort_by,
    )
    out = Path(output_path) if output_path else Path(preview["output_path"])
    out.parent.mkdir(parents=True, exist_ok=True)
    temp_dir = root / "Slideshows" / f"_tmp_{uuid.uuid4().hex[:8]}"
    temp_dir.mkdir(parents=True, exist_ok=True)
    scale_vf = (
        f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2"
    )
    clips: List[str] = []
    try:
        for i, img in enumerate(images):
            clip_path = temp_dir / f"clip_{i:03d}.mp4"
            cmd = [
                "ffmpeg",
                "-y",
                "-loop",
                "1",
                "-i",
                img["path"],
                "-c:v",
                "libx264",
                "-t",
                str(max(0.5, float(duration_per_image))),
                "-pix_fmt",
                "yuv420p",
                "-vf",
                scale_vf,
                "-r",
                str(max(1, min(int(fps), 60))),
                str(clip_path),
            ]
            completed = subprocess.run(cmd, capture_output=True, text=True, check=False)
            if completed.returncode != 0 or not clip_path.exists():
                raise FileMediaOpsError(
                    f"FFmpeg 处理图片失败: {img['name']} — {(completed.stderr or '')[:300]}"
                )
            clips.append(str(clip_path))
        if len(clips) < 2:
            raise FileMediaOpsError("有效图片片段不足")
        concat_file = temp_dir / "concat.txt"
        with concat_file.open("w", encoding="utf-8") as fh:
            for clip in clips:
                fh.write(f"file '{clip}'\n")
        video_only = temp_dir / "video_only.mp4"
        merge_cmd = [
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_file),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(video_only),
        ]
        completed = subprocess.run(merge_cmd, capture_output=True, text=True, check=False)
        if completed.returncode != 0 or not video_only.exists():
            raise FileMediaOpsError(f"视频合成失败: {(completed.stderr or '')[:400]}")
        bgm = preview.get("audio_path")
        if bgm:
            mux_cmd = [
                "ffmpeg",
                "-y",
                "-i",
                str(video_only),
                "-i",
                bgm,
                "-c:v",
                "copy",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-shortest",
                str(out),
            ]
            completed = subprocess.run(mux_cmd, capture_output=True, text=True, check=False)
            if completed.returncode != 0 or not out.exists():
                raise FileMediaOpsError(f"背景音乐合成失败: {(completed.stderr or '')[:400]}")
        else:
            shutil.move(str(video_only), str(out))
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
    return {
        "success": True,
        "output_path": str(out),
        "image_count": len(images),
        "duration_sec": preview.get("estimated_duration_sec"),
        "resolution": preview.get("resolution"),
        "has_bgm": bool(preview.get("has_bgm")),
        "sort_by": sort_by,
    }
