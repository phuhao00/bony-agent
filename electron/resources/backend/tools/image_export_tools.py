"""Export edited images to PNG, JPEG, or layered PSD."""
from __future__ import annotations

import io
import os
import uuid
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image

from tools.image_edit_tools import _local_path_from_url, _read_bytes_from_local_path
from tools.media_common import OUTPUT_DIR, PROJECT_ROOT
from utils.logger import setup_logger

logger = setup_logger("image_export_tools")

VALID_EXPORT_FORMATS = frozenset({"png", "jpeg", "jpg", "psd"})


def _load_pil_image(url: str) -> Image.Image:
    url = (url or "").strip()
    if not url:
        raise ValueError("图片 URL 不能为空")

    local = _local_path_from_url(url)
    if local:
        data, _ = _read_bytes_from_local_path(local)
        return Image.open(io.BytesIO(data)).convert("RGBA")

    if url.startswith("http://") or url.startswith("https://"):
        import urllib.request

        with urllib.request.urlopen(url, timeout=60) as resp:
            data = resp.read()
        return Image.open(io.BytesIO(data)).convert("RGBA")

    raise ValueError(f"无法解析图片路径: {url}")


def _fit_to_canvas(image: Image.Image, canvas_w: int, canvas_h: int) -> Image.Image:
    if image.size == (canvas_w, canvas_h):
        return image
    fitted = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    fitted.paste(image.convert("RGBA"), (0, 0))
    return fitted


def _write_psd(
    path: str,
    *,
    result: Image.Image,
    source: Optional[Image.Image] = None,
    mask: Optional[Image.Image] = None,
) -> None:
    try:
        from psd_tools import PSDImage
    except ImportError as exc:
        raise ImportError(
            "PSD 导出需要 psd-tools，请在 backend/.venv 中执行: pip install 'psd-tools>=1.10.0'"
        ) from exc

    canvas_w, canvas_h = result.size
    psd = PSDImage.new(mode="RGB", size=(canvas_w, canvas_h))

    result_rgb = _fit_to_canvas(result, canvas_w, canvas_h).convert("RGB")
    psd.create_pixel_layer(result_rgb, name="Edited", top=0, left=0)

    if source is not None:
        source_rgb = _fit_to_canvas(source, canvas_w, canvas_h).convert("RGB")
        psd.create_pixel_layer(source_rgb, name="Original", top=0, left=0)

    if mask is not None:
        mask_layer = _fit_to_canvas(mask, canvas_w, canvas_h).convert("RGB")
        psd.create_pixel_layer(mask_layer, name="Mask", top=0, left=0)

    psd.save(path)


def export_image_file(
    image_url: str,
    export_format: str,
    *,
    source_image_url: str = "",
    mask_image_url: str = "",
    jpeg_quality: int = 92,
) -> Dict[str, Any]:
    """
    Export an image to png/jpeg/psd and save under storage/outputs.

    PSD exports include layers: Edited (+ Original / Mask when URLs provided).
    """
    fmt = (export_format or "png").strip().lower()
    if fmt == "jpg":
        fmt = "jpeg"
    if fmt not in VALID_EXPORT_FORMATS:
        return {
            "success": False,
            "error": f"不支持的格式: {export_format}，可选: png, jpeg, psd",
        }

    try:
        result_img = _load_pil_image(image_url)
    except Exception as exc:
        return {"success": False, "error": str(exc)}

    stem = f"export_{uuid.uuid4().hex[:10]}"
    ext = "jpg" if fmt == "jpeg" else fmt
    out_path = os.path.join(OUTPUT_DIR, f"{stem}.{ext}")

    try:
        if fmt == "png":
            result_img.save(out_path, "PNG", optimize=True)
        elif fmt == "jpeg":
            quality = max(1, min(100, int(jpeg_quality or 92)))
            result_img.convert("RGB").save(
                out_path,
                "JPEG",
                quality=quality,
                optimize=True,
            )
        else:
            source_img: Optional[Image.Image] = None
            mask_img: Optional[Image.Image] = None
            if (source_image_url or "").strip():
                try:
                    source_img = _load_pil_image(source_image_url)
                except Exception as exc:
                    logger.warning("PSD export: skip source layer: %s", exc)
            if (mask_image_url or "").strip():
                try:
                    mask_img = _load_pil_image(mask_image_url)
                except Exception as exc:
                    logger.warning("PSD export: skip mask layer: %s", exc)
            _write_psd(
                out_path,
                result=result_img,
                source=source_img,
                mask=mask_img,
            )
    except Exception as exc:
        logger.error("Export failed: %s", exc, exc_info=True)
        return {"success": False, "error": f"导出失败: {exc}"}

    filename = os.path.basename(out_path)
    size_bytes = os.path.getsize(out_path) if os.path.isfile(out_path) else 0
    return {
        "success": True,
        "filename": filename,
        "local_path": out_path,
        "download_url": f"/api/media/{filename}",
        "format": fmt,
        "size_bytes": size_bytes,
    }
