"""Shared layout utilities for PSD layer split: QR detection, masks, coordinate mapping."""
from __future__ import annotations

from typing import Any, Dict, List, Tuple

from PIL import Image

from utils.logger import setup_logger

logger = setup_logger("psd_layout_utils")


def bbox_iou_pixels(a: Dict[str, int], b: Dict[str, int]) -> float:
    ix0 = max(a["x_min"], b["x_min"])
    iy0 = max(a["y_min"], b["y_min"])
    ix1 = min(a["x_max"], b["x_max"])
    iy1 = min(a["y_max"], b["y_max"])
    if ix1 <= ix0 or iy1 <= iy0:
        return 0.0
    inter = (ix1 - ix0) * (iy1 - iy0)
    area_a = max(1, (a["x_max"] - a["x_min"]) * (a["y_max"] - a["y_min"]))
    area_b = max(1, (b["x_max"] - b["x_min"]) * (b["y_max"] - b["y_min"]))
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def bbox_area_pixels(box: Dict[str, int]) -> int:
    return max(0, box["x_max"] - box["x_min"]) * max(0, box["y_max"] - box["y_min"])


def expand_square_bbox(
    bbox: Dict[str, int],
    canvas_w: int,
    canvas_h: int,
    *,
    quiet_ratio: float = 0.10,
) -> Dict[str, int]:
    x0, y0 = int(bbox["x_min"]), int(bbox["y_min"])
    x1, y1 = int(bbox["x_max"]), int(bbox["y_max"])
    bw, bh = max(1, x1 - x0), max(1, y1 - y0)
    side = int(max(bw, bh) * (1.0 + quiet_ratio * 2))
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    half = side / 2
    return {
        "x_min": int(max(0, cx - half)),
        "y_min": int(max(0, cy - half)),
        "x_max": int(min(canvas_w, cx + half)),
        "y_max": int(min(canvas_h, cy + half)),
    }


def bbox_from_quad(quad: Any, width: int, height: int, *, quiet_ratio: float = 0.10) -> Dict[str, int]:
    import numpy as np

    xs = quad[:, 0]
    ys = quad[:, 1]
    raw = {
        "x_min": int(max(0, xs.min())),
        "y_min": int(max(0, ys.min())),
        "x_max": int(min(width, xs.max())),
        "y_max": int(min(height, ys.max())),
    }
    return expand_square_bbox(raw, width, height, quiet_ratio=quiet_ratio)


def merge_qr_region_list(regions: List[Dict[str, Any]], width: int, height: int) -> List[Dict[str, Any]]:
    if not regions:
        return []
    merged: List[Dict[str, Any]] = []
    for region in sorted(regions, key=lambda r: bbox_area_pixels(r["bbox"]), reverse=True):
        bbox = expand_square_bbox(region["bbox"], width, height, quiet_ratio=0.08)
        item = {**region, "bbox": bbox}
        if any(bbox_iou_pixels(bbox, m["bbox"]) >= 0.35 for m in merged):
            continue
        merged.append(item)
    return merged[:3]


def detect_qr_regions(image: Image.Image) -> List[Dict[str, Any]]:
    try:
        import cv2
        import numpy as np
    except ImportError:
        return []

    width, height = image.size
    rgb = np.array(image.convert("RGB"))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    detector = cv2.QRCodeDetector()
    found: List[Dict[str, Any]] = []

    def _collect_from_gray(g: Any, scale: float) -> None:
        try:
            ok, points = detector.detect(g)
            if not ok or points is None:
                return
            quads = points if len(points.shape) == 3 else [points]
            inv = 1.0 / max(scale, 1e-6)
            for quad in quads:
                scaled = quad.astype(np.float32) * inv
                bbox = bbox_from_quad(scaled, width, height, quiet_ratio=0.10)
                if bbox_area_pixels(bbox) < 900:
                    continue
                found.append({"name": "二维码", "role": "qr", "bbox": bbox})
        except Exception:
            return

    for scale in (1.0, 0.75, 1.25):
        if abs(scale - 1.0) < 1e-3:
            g = gray
        else:
            g = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_LINEAR)
        _collect_from_gray(g, scale)

    if not found:
        bottom = gray[int(height * 0.68) :, :]
        thr = cv2.adaptiveThreshold(bottom, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 31, 5)
        contours, _ = cv2.findContours(thr, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        y0 = int(height * 0.68)
        for cnt in contours:
            x, y, w, h = cv2.boundingRect(cnt)
            if w < 40 or h < 40:
                continue
            ratio = w / max(h, 1)
            if 0.82 <= ratio <= 1.22 and w * h >= 2200:
                bbox = expand_square_bbox(
                    {"x_min": x, "y_min": y0 + y, "x_max": x + w, "y_max": y0 + y + h},
                    width,
                    height,
                    quiet_ratio=0.12,
                )
                found.append({"name": "二维码", "role": "qr", "bbox": bbox})

    merged = merge_qr_region_list(found, width, height)
    if merged:
        logger.info("[psd_layout] QR regions=%d", len(merged))
    return merged


def pixel_bbox_to_relative(bbox: Dict[str, int], width: int, height: int) -> Tuple[float, float, float, float]:
    x = bbox["x_min"] / max(width, 1)
    y = bbox["y_min"] / max(height, 1)
    w = (bbox["x_max"] - bbox["x_min"]) / max(width, 1)
    h = (bbox["y_max"] - bbox["y_min"]) / max(height, 1)
    return x, y, w, h


def expand_relative_bbox(
    x: float,
    y: float,
    w: float,
    h: float,
    *,
    padding: float = 0.10,
) -> Tuple[float, float, float, float]:
    pad_x = w * padding
    pad_y = h * padding
    nx = max(0.0, x - pad_x)
    ny = max(0.0, y - pad_y)
    nw = min(1.0 - nx, w + pad_x * 2)
    nh = min(1.0 - ny, h + pad_y * 2)
    return nx, ny, nw, nh


def relative_bbox_to_pixels(
    x: float,
    y: float,
    w: float,
    h: float,
    width: int,
    height: int,
) -> Tuple[int, int, int, int]:
    x0 = int(max(0, min(width - 1, x * width)))
    y0 = int(max(0, min(height - 1, y * height)))
    x1 = int(max(x0 + 1, min(width, (x + w) * width)))
    y1 = int(max(y0 + 1, min(height, (y + h) * height)))
    return x0, y0, x1, y1


def map_sub_bbox_to_canvas(
    sub_x: float,
    sub_y: float,
    sub_w: float,
    sub_h: float,
    crop_x: float,
    crop_y: float,
    crop_w: float,
    crop_h: float,
) -> Tuple[float, float, float, float]:
    """Map relative bbox inside crop back to full-canvas relative coords."""
    abs_x = crop_x + sub_x * crop_w
    abs_y = crop_y + sub_y * crop_h
    abs_w = sub_w * crop_w
    abs_h = sub_h * crop_h
    return abs_x, abs_y, abs_w, abs_h


def build_rect_mask_image(width: int, height: int, x0: int, y0: int, x1: int, y1: int) -> Image.Image:
    from PIL import ImageDraw

    mask = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(mask)
    draw.rectangle((x0, y0, x1, y1), fill=255)
    return mask
