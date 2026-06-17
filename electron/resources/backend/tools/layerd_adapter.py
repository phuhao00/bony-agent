"""LayerD adapter — ICCV 2025 paper-backed image-to-PSD decomposition.

References:
- LayerD: Decomposing Raster Graphic Designs into Layers (Suzuki et al., ICCV 2025)
  https://arxiv.org/abs/2509.25134
- Official implementation: https://github.com/CyberAgentAILab/LayerD
"""
from __future__ import annotations

import json
import os
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image, ImageFilter

from tools.media_common import OUTPUT_DIR
from utils.logger import setup_logger

logger = setup_logger("layerd_adapter")

_LAYERD_MODEL = None
_LAYERD_AVAILABLE: Optional[bool] = None
_LOAD_ERROR: Optional[str] = None
_WARMUP_AT: Optional[float] = None
_EAST_OCR = None
_EASYOCR_READER = None

_TYPE_LABELS = {
    "text": "文字",
    "image": "图片",
    "vector": "图形",
}

_TRANSFORMERS_MIN = "4.37.0"
_TRANSFORMERS_MAX = "4.48.0"

# Organizer: lower threshold helps OCR blocks match fragmented CCs on CJK posters.
_OVERLAP_THRESHOLD = 0.72
_EAST_CONF_THRESHOLD = 0.35
_EAST_NMS_THRESHOLD = 0.35
_EAST_MERGE_IOU = 0.45
_MIN_PANEL_ASPECT = 1.35
_PANEL_OVERLAP_RATIO = 0.05
_VISION_ONLY_MIN_BLOCKS = 6
_MAX_DRAFT_LAYERS = 28
_VISION_DEDUP_IOU = 0.35
_MIN_ICON_PX = 20
_QR_MAX_CANVAS_RATIO = 0.20


def _parse_version(ver: str) -> tuple:
    parts = []
    for token in (ver or "0").split("."):
        try:
            parts.append(int(token.split("+")[0].split("rc")[0]))
        except ValueError:
            parts.append(0)
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts[:3])


def _version_in_range(ver: str, min_ver: str, max_ver: str) -> bool:
    cur = _parse_version(ver)
    return _parse_version(min_ver) <= cur <= _parse_version(max_ver)


def _python_executable() -> str:
    return sys.executable


def _east_model_path() -> Path:
    env_path = os.environ.get("LAYERD_EAST_MODEL_PATH")
    if env_path:
        return Path(env_path)
    return Path.home() / ".cache" / "layerd" / "east_detector.pb"


def _detect_model_cache() -> Dict[str, Any]:
    home = Path.home()
    birefnet_dir = home / ".cache" / "huggingface" / "hub" / "models--cyberagent--layerd-birefnet"
    lama_file = home / ".cache" / "torch" / "hub" / "checkpoints" / "big-lama.pt"
    east_file = _east_model_path()
    return {
        "birefnet": {
            "name": "BiRefNet (matting)",
            "cached": birefnet_dir.exists(),
            "path": str(birefnet_dir) if birefnet_dir.exists() else None,
        },
        "lama": {
            "name": "LaMa (inpaint)",
            "cached": lama_file.is_file(),
            "path": str(lama_file) if lama_file.is_file() else None,
            "size_mb": round(lama_file.stat().st_size / (1024 * 1024), 1) if lama_file.is_file() else 0,
        },
        "east": {
            "name": "EAST (text detection)",
            "cached": east_file.is_file(),
            "path": str(east_file) if east_file.is_file() else None,
            "size_mb": round(east_file.stat().st_size / (1024 * 1024), 1) if east_file.is_file() else 0,
        },
    }


def is_layerd_available() -> bool:
    global _LAYERD_AVAILABLE
    if _LAYERD_AVAILABLE is not None:
        return _LAYERD_AVAILABLE
    try:
        import layerd  # noqa: F401
        import torch  # noqa: F401

        import transformers

        if not _version_in_range(transformers.__version__, _TRANSFORMERS_MIN, _TRANSFORMERS_MAX):
            _LAYERD_AVAILABLE = False
            return False
        _LAYERD_AVAILABLE = True
    except ImportError:
        _LAYERD_AVAILABLE = False
    return _LAYERD_AVAILABLE


def _select_matting_device() -> str:
    import torch

    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _round_to_32(value: int, *, minimum: int = 320, maximum: int = 1920) -> int:
    clamped = max(minimum, min(maximum, value))
    return int(clamped // 32) * 32


def _east_input_size(width: int, height: int) -> Tuple[int, int]:
    """Scale EAST input to preserve aspect ratio; larger = better text localization."""
    long_edge = max(width, height)
    scale = min(1.0, 1920 / max(long_edge, 1))
    iw = _round_to_32(int(width * scale))
    ih = _round_to_32(int(height * scale))
    return iw, ih


def _bbox_iou_pixels(
    a: Dict[str, int],
    b: Dict[str, int],
) -> float:
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


def _bbox_area_pixels(box: Dict[str, int]) -> int:
    return max(0, box["x_max"] - box["x_min"]) * max(0, box["y_max"] - box["y_min"])


def _bbox_intersection_area(a: Dict[str, int], b: Dict[str, int]) -> int:
    ix0 = max(a.get("x_min", 0), b.get("x_min", 0))
    iy0 = max(a.get("y_min", 0), b.get("y_min", 0))
    ix1 = min(a.get("x_max", 0), b.get("x_max", 0))
    iy1 = min(a.get("y_max", 0), b.get("y_max", 0))
    if ix1 <= ix0 or iy1 <= iy0:
        return 0
    return (ix1 - ix0) * (iy1 - iy0)


def _bbox_coverage_ratio(inner: Dict[str, int], outer: Dict[str, int]) -> float:
    """Fraction of *inner* bbox area lying inside *outer*."""
    inner_area = max(1, _bbox_area_pixels(inner))
    return _bbox_intersection_area(inner, outer) / inner_area


def _vision_block_priority(block: Dict[str, Any]) -> int:
    role = str(block.get("role") or block.get("type") or "")
    if role in {"hero", "subject", "replaceable_main"}:
        return 0
    return {"qr": 1, "text": 2, "image": 3, "icon": 4}.get(str(block.get("type")), 5)


def _dedupe_vision_layout(blocks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not blocks:
        return []
    ordered = sorted(
        blocks,
        key=lambda b: (_vision_block_priority(b), -_bbox_area_pixels(b.get("bbox") or {})),
    )
    kept: List[Dict[str, Any]] = []
    for block in ordered:
        bbox = block.get("bbox") or {}
        merged = False
        for idx, existing in enumerate(kept):
            if _bbox_iou_pixels(bbox, existing["bbox"]) >= _VISION_DEDUP_IOU:
                kept[idx] = {
                    **existing,
                    "bbox": _bbox_union(bbox, existing["bbox"]),
                    "name": existing.get("name") or block.get("name"),
                }
                merged = True
                break
        if not merged:
            kept.append(dict(block))
    logger.info("[layerd][diag] vision dedupe in=%d out=%d", len(blocks), len(kept))
    return kept


def _clamp_qr_bbox(
    bbox: Dict[str, int],
    canvas_w: int,
    canvas_h: int,
    *,
    max_ratio: float = _QR_MAX_CANVAS_RATIO,
) -> Dict[str, int]:
    """Prevent vision/CV QR boxes from swallowing half the poster."""
    canvas_min = min(canvas_w, canvas_h)
    max_side = max(48, int(canvas_min * max_ratio))
    x0, y0 = int(bbox["x_min"]), int(bbox["y_min"])
    x1, y1 = int(bbox["x_max"]), int(bbox["y_max"])
    bw, bh = max(1, x1 - x0), max(1, y1 - y0)
    side = min(max(bw, bh), max_side)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    half = side / 2
    return {
        "x_min": int(max(0, cx - half)),
        "y_min": int(max(0, cy - half)),
        "x_max": int(min(canvas_w, cx + half)),
        "y_max": int(min(canvas_h, cy + half)),
    }


def _log_region_summary(label: str, regions: List[Dict[str, Any]]) -> None:
    for index, region in enumerate(regions):
        bb = region.get("bbox") or region.get("box") or {}
        logger.info(
            "[layerd][diag] %s #%02d role=%s panel=%s source=%s area=%d box=%s name=%s",
            label,
            index,
            region.get("role"),
            region.get("panel"),
            region.get("source"),
            _bbox_area_pixels(bb),
            bb,
            str(region.get("name") or "")[:48],
        )


def _log_duplicate_pairs(
    label: str,
    regions: List[Dict[str, Any]],
    *,
    iou_thresh: float = 0.35,
) -> None:
    for i in range(len(regions)):
        for j in range(i + 1, len(regions)):
            bb_i = regions[i].get("bbox") or regions[i].get("box") or {}
            bb_j = regions[j].get("bbox") or regions[j].get("box") or {}
            iou = _bbox_iou_pixels(bb_i, bb_j)
            if iou >= iou_thresh:
                logger.warning(
                    "[layerd][diag] duplicate %s i=%d j=%d iou=%.2f %s / %s",
                    label,
                    i,
                    j,
                    iou,
                    regions[i].get("name"),
                    regions[j].get("name"),
                )


def _write_assembly_debug_snapshot(snapshot: Dict[str, Any]) -> None:
    try:
        root = Path(__file__).resolve().parent.parent.parent
        debug_dir = root / "storage" / "temp"
        debug_dir.mkdir(parents=True, exist_ok=True)
        path = debug_dir / f"layerd_debug_{int(time.time())}_{uuid.uuid4().hex[:8]}.json"
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(snapshot, handle, ensure_ascii=False, indent=2)
        logger.info("[layerd][diag] debug snapshot=%s", path)
    except Exception as exc:
        logger.warning("[layerd][diag] snapshot write failed: %s", exc)


def _cap_draft_elements(
    elements: List[Dict[str, Any]],
    *,
    max_layers: int = _MAX_DRAFT_LAYERS,
) -> List[Dict[str, Any]]:
    if len(elements) <= max_layers:
        return elements
    backgrounds = [e for e in elements if e.get("role") == "background"]
    rest = [e for e in elements if e.get("role") != "background"]
    priority = {"replaceable_main": 0, "qr": 1, "text": 2, "image": 3, "icon": 4}
    rest.sort(
        key=lambda e: (
            priority.get(str(e.get("role")), 5),
            -_bbox_area_pixels(e.get("box") or {}),
        ),
    )
    kept = backgrounds + rest[: max(0, max_layers - len(backgrounds))]
    logger.warning("[layerd][diag] capped draft layers %d -> %d", len(elements), len(kept))
    return kept


def _bbox_union(a: Dict[str, int], b: Dict[str, int]) -> Dict[str, int]:
    return {
        "x_min": min(a["x_min"], b["x_min"]),
        "y_min": min(a["y_min"], b["y_min"]),
        "x_max": max(a["x_max"], b["x_max"]),
        "y_max": max(a["y_max"], b["y_max"]),
    }


def _horizontal_overlap(a: Dict[str, int], b: Dict[str, int]) -> float:
    left = max(a["x_min"], b["x_min"])
    right = min(a["x_max"], b["x_max"])
    if right <= left:
        return 0.0
    return (right - left) / max(1, min(a["x_max"] - a["x_min"], b["x_max"] - b["x_min"]))


def _should_merge_ocr_line(a: Dict[str, Any], b: Dict[str, Any], canvas_h: int) -> bool:
    ba, bb = a["bbox"], b["bbox"]
    ha = ba["y_max"] - ba["y_min"]
    hb = bb["y_max"] - bb["y_min"]
    avg_h = max(10.0, (ha + hb) / 2)
    cy_a = (ba["y_min"] + ba["y_max"]) / 2
    cy_b = (bb["y_min"] + bb["y_max"]) / 2

    # Same text line only — never merge across lines (avoids giant inpaint masks).
    if abs(cy_a - cy_b) <= avg_h * 0.50:
        gap_x = max(0, max(ba["x_min"], bb["x_min"]) - min(ba["x_max"], bb["x_max"]))
        return gap_x <= avg_h * 2.8
    return False


def _bbox_center_x(box: Dict[str, int]) -> float:
    return (box["x_min"] + box["x_max"]) / 2


def _cluster_ocr_paragraphs(
    blocks: List[Dict[str, Any]],
    width: int,
    height: int,
) -> List[Dict[str, Any]]:
    """Merge fragmented OCR boxes into paragraph-level blocks for posters."""
    if not blocks:
        return []

    working = sorted(blocks, key=lambda b: (b["bbox"]["y_min"], b["bbox"]["x_min"]))
    groups: List[List[Dict[str, Any]]] = []

    for block in working:
        placed = False
        for group in groups:
            if any(_should_merge_ocr_line(block, member, height) for member in group):
                group.append(block)
                placed = True
                break
        if not placed:
            groups.append([block])

    merged: List[Dict[str, Any]] = []
    min_area = width * height * 0.00015
    for group in groups:
        bbox = group[0]["bbox"]
        for item in group[1:]:
            bbox = _bbox_union(bbox, item["bbox"])
        if _bbox_area_pixels(bbox) < min_area:
            continue
        texts = [str(g.get("text") or "").strip() for g in sorted(group, key=lambda x: (x["bbox"]["y_min"], x["bbox"]["x_min"]))]
        text = " ".join(t for t in texts if t)[:160]
        pad_x = max(4, int((bbox["x_max"] - bbox["x_min"]) * 0.05))
        pad_y = max(4, int((bbox["y_max"] - bbox["y_min"]) * 0.08))
        merged.append({
            "text": text,
            "bbox": {
                "x_min": max(0, bbox["x_min"] - pad_x),
                "y_min": max(0, bbox["y_min"] - pad_y),
                "x_max": min(width, bbox["x_max"] + pad_x),
                "y_max": min(height, bbox["y_max"] + pad_y),
            },
        })
    return merged


def _dedupe_ocr_blocks(blocks: List[Dict[str, Any]], *, iou_threshold: float = 0.55) -> List[Dict[str, Any]]:
    kept: List[Dict[str, Any]] = []
    for block in sorted(blocks, key=lambda b: _bbox_area_pixels(b["bbox"]), reverse=True):
        bbox = block.get("bbox") or {}
        if any(_bbox_iou_pixels(bbox, k["bbox"]) >= iou_threshold for k in kept):
            continue
        kept.append(block)
    kept.sort(key=lambda b: (b["bbox"]["y_min"], b["bbox"]["x_min"]))
    return kept


def _refine_ocr_blocks(
    blocks: List[Dict[str, Any]],
    width: int,
    height: int,
) -> List[Dict[str, Any]]:
    """Drop EAST noise, dedupe, cluster per layout panel."""
    canvas_area = max(1, width * height)
    filtered: List[Dict[str, Any]] = []
    for block in blocks:
        bbox = block.get("bbox") or {}
        if not bbox:
            continue
        text = str(block.get("text") or "").strip()
        area = _bbox_area_pixels(bbox)
        if not text and area < canvas_area * 0.00025:
            continue
        if area < canvas_area * 0.00008:
            continue
        filtered.append(block)

    deduped = _dedupe_ocr_blocks(filtered)

    aspect = width / max(height, 1)
    if aspect >= _MIN_PANEL_ASPECT:
        mid = width // 2
        left = [b for b in deduped if _bbox_center_x(b["bbox"]) < mid]
        right = [b for b in deduped if _bbox_center_x(b["bbox"]) >= mid]
        clustered = _cluster_ocr_paragraphs(left, width, height) + _cluster_ocr_paragraphs(
            right, width, height
        )
    else:
        clustered = _cluster_ocr_paragraphs(deduped, width, height)

    valid: List[Dict[str, Any]] = []
    for block in clustered:
        bb = block.get("bbox") or {}
        if bb.get("x_max", 0) - bb.get("x_min", 0) < 4:
            continue
        if bb.get("y_max", 0) - bb.get("y_min", 0) < 4:
            continue
        valid.append(block)
    clustered = valid

    clustered.sort(key=lambda b: (b["bbox"]["y_min"], b["bbox"]["x_min"]))
    logger.info(
        "[layerd] OCR refine raw=%d filtered=%d deduped=%d clustered=%d",
        len(blocks),
        len(filtered),
        len(deduped),
        len(clustered),
    )
    return clustered


def _detect_layout_panels(image: Image.Image) -> List[Tuple[Image.Image, int, str]]:
    """Split wide dual-panel posters (e.g. side-by-side fans) for per-region decomposition."""
    width, height = image.size
    aspect = width / max(height, 1)
    if aspect < _MIN_PANEL_ASPECT:
        return [(image, 0, "全图")]

    mid = width // 2
    overlap = max(16, int(width * _PANEL_OVERLAP_RATIO))
    left = image.crop((0, 0, min(width, mid + overlap), height))
    right = image.crop((max(0, mid - overlap), 0, width, height))
    logger.info("[layerd] dual-panel layout detected overlap=%d", overlap)
    return [
        (left, 0, "左幅"),
        (right, max(0, mid - overlap), "右幅"),
    ]


def _offset_element_box(elem: Dict[str, Any], dx: int, dy: int) -> Dict[str, Any]:
    if dx == 0 and dy == 0:
        return elem
    box = dict(elem.get("box") or {})
    if not box:
        return elem
    shifted = {
        **elem,
        "box": {
            "x_min": int(box.get("x_min", 0)) + dx,
            "y_min": int(box.get("y_min", 0)) + dy,
            "x_max": int(box.get("x_max", 0)) + dx,
            "y_max": int(box.get("y_max", 0)) + dy,
        },
    }
    panel = str(elem.get("panel") or "")
    if panel:
        shifted["panel"] = panel
    return shifted


def _merge_ocr_blocks(
    primary_blocks: List[Dict[str, Any]],
    supplemental_blocks: List[Dict[str, Any]],
    *,
    iou_threshold: float = _EAST_MERGE_IOU,
) -> List[Dict[str, Any]]:
    merged = list(primary_blocks)
    for block in supplemental_blocks:
        bbox = block["bbox"]
        if any(_bbox_iou_pixels(bbox, existing["bbox"]) >= iou_threshold for existing in merged):
            continue
        merged.append(block)
    merged.sort(key=lambda b: (b["bbox"]["y_min"], b["bbox"]["x_min"]))
    return merged


def _get_easyocr_reader():
    global _EASYOCR_READER
    if _EASYOCR_READER is not None:
        return _EASYOCR_READER
    try:
        import easyocr

        _EASYOCR_READER = easyocr.Reader(["ch_sim", "en"], gpu=False, verbose=False)
        return _EASYOCR_READER
    except Exception as exc:
        logger.warning("[layerd] EasyOCR init failed: %s", exc)
        return None


def _ocr_fragment_merge(a: Dict[str, Any], b: Dict[str, Any], canvas_h: int) -> bool:
    ba, bb = a["bbox"], b["bbox"]
    ha = ba["y_max"] - ba["y_min"]
    hb = bb["y_max"] - bb["y_min"]
    avg_h = max(8.0, (ha + hb) / 2)
    cy_a = (ba["y_min"] + ba["y_max"]) / 2
    cy_b = (bb["y_min"] + bb["y_max"]) / 2

    if abs(cy_a - cy_b) <= avg_h * 0.55:
        gap_x = max(0, max(ba["x_min"], bb["x_min"]) - min(ba["x_max"], bb["x_max"]))
        return gap_x <= avg_h * 2.8

    vertical_gap = min(abs(ba["y_min"] - bb["y_max"]), abs(bb["y_min"] - ba["y_max"]))
    if vertical_gap <= avg_h * 1.2 and _horizontal_overlap(ba, bb) >= 0.20:
        return True
    if vertical_gap <= canvas_h * 0.018 and _horizontal_overlap(ba, bb) >= 0.30:
        return True
    return False


def _cluster_ocr_unionfind(fragments: List[Dict[str, Any]], canvas_h: int) -> List[List[Dict[str, Any]]]:
    if not fragments:
        return []
    parent = list(range(len(fragments)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i: int, j: int) -> None:
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[rj] = ri

    for i in range(len(fragments)):
        for j in range(i + 1, len(fragments)):
            if _ocr_fragment_merge(fragments[i], fragments[j], canvas_h):
                union(i, j)

    groups: Dict[int, List[Dict[str, Any]]] = {}
    for idx, frag in enumerate(fragments):
        groups.setdefault(find(idx), []).append(frag)
    clustered = list(groups.values())
    clustered.sort(key=lambda g: min(f["bbox"]["y_min"] for f in g))
    return clustered


def _easyocr_text_blocks(image: Image.Image) -> List[Dict[str, Any]]:
    """EasyOCR with union-find paragraph clustering and polygon metadata."""
    import numpy as np

    reader = _get_easyocr_reader()
    if reader is None:
        return []

    width, height = image.size
    if width <= 0 or height <= 0:
        return []

    try:
        results = reader.readtext(np.array(image.convert("RGB")))
    except Exception as exc:
        logger.warning("[layerd] EasyOCR supplement failed: %s", exc)
        return []

    fragments: List[Dict[str, Any]] = []
    for item in results:
        if len(item) < 2:
            continue
        box, text = item[0], str(item[1]).strip()
        if not text:
            continue
        xs = [int(p[0]) for p in box]
        ys = [int(p[1]) for p in box]
        x0, x1 = max(0, min(xs)), min(width, max(xs))
        y0, y1 = max(0, min(ys)), min(height, max(ys))
        if x1 - x0 < 4 or y1 - y0 < 4:
            continue
        polygon = [{"x": int(p[0]), "y": int(p[1])} for p in box]
        fragments.append({
            "bbox": {"x_min": x0, "y_min": y0, "x_max": x1, "y_max": y1},
            "polygon": polygon,
            "text": text,
        })

    if not fragments:
        return []

    blocks: List[Dict[str, Any]] = []
    for group in _cluster_ocr_unionfind(fragments, height):
        x0 = min(f["bbox"]["x_min"] for f in group)
        y0 = min(f["bbox"]["y_min"] for f in group)
        x1 = max(f["bbox"]["x_max"] for f in group)
        y1 = max(f["bbox"]["y_max"] for f in group)
        rel_area = (x1 - x0) * (y1 - y0) / max(1, width * height)
        if rel_area < 0.00012:
            continue
        pad_x = max(4, int((x1 - x0) * 0.05))
        pad_y = max(4, int((y1 - y0) * 0.08))
        blocks.append({
            "text": " ".join(f["text"] for f in sorted(group, key=lambda g: g["bbox"]["x_min"]))[:160],
            "bbox": {
                "x_min": max(0, x0 - pad_x),
                "y_min": max(0, y0 - pad_y),
                "x_max": min(width, x1 + pad_x),
                "y_max": min(height, y1 + pad_y),
            },
            "polygons": [p for f in group for p in f.get("polygon", [])],
        })
    return blocks


def _build_ocr_result(image: Image.Image, *, use_easyocr_supplement: bool = True) -> Dict[str, Any]:
    """EasyOCR-primary for CJK posters; EAST only when EasyOCR finds too few blocks."""
    from layerd.ocr import build_ocr

    width, height = image.size
    input_w, input_h = _east_input_size(width, height)
    global _EAST_OCR

    easy_blocks = _easyocr_text_blocks(image) if use_easyocr_supplement else []
    blocks: List[Dict[str, Any]] = list(easy_blocks)

    if len(easy_blocks) < 6:
        try:
            if _EAST_OCR is None:
                logger.info("[layerd] loading EAST OCR input=%sx%s", input_w, input_h)
                _EAST_OCR = build_ocr(
                    "east",
                    device="cpu",
                    conf_threshold=_EAST_CONF_THRESHOLD,
                    nms_threshold=_EAST_NMS_THRESHOLD,
                    input_width=input_w,
                    input_height=input_h,
                )
            east_result = _EAST_OCR.infer(image)
            east_blocks = [dict(block) for block in east_result.get("blocks", [])]
            blocks = _merge_ocr_blocks(blocks, east_blocks, iou_threshold=0.55)
            logger.info("[layerd] OCR fallback east blocks=%d total=%d", len(east_blocks), len(blocks))
        except Exception as exc:
            logger.warning("[layerd] EAST OCR skipped: %s", exc)

    line_blocks = _refine_ocr_blocks(blocks, width, height)
    paragraph_blocks = line_blocks
    if len(easy_blocks) >= 6:
        paragraph_blocks = _dedupe_ocr_blocks(blocks, iou_threshold=0.48)
        if len(paragraph_blocks) > 28:
            paragraph_blocks = line_blocks
        logger.info(
            "[layerd] OCR easyocr-primary paragraphs=%d lines=%d",
            len(paragraph_blocks),
            len(line_blocks),
        )

    return {
        "image_size": (width, height),
        "blocks": paragraph_blocks,
        "line_blocks": line_blocks,
        "paragraph_blocks": paragraph_blocks,
        "metadata": {
            "east_input": (input_w, input_h),
            "easyocr_primary": len(easy_blocks) >= 6,
            "clustered": True,
        },
    }


def get_layerd_status(*, probe_load: bool = False) -> Dict[str, Any]:
    """Return LayerD engine readiness for UI / health checks."""
    global _LOAD_ERROR

    models = _detect_model_cache()
    package_installed = False
    transformers_version = ""
    transformers_ok = False
    torch_version = ""
    layerd_version = ""
    import_error = ""

    try:
        import layerd

        layerd_version = getattr(layerd, "__version__", "unknown")
        package_installed = True
    except ImportError as exc:
        import_error = str(exc)

    try:
        import torch

        torch_version = torch.__version__
    except ImportError as exc:
        import_error = import_error or str(exc)

    try:
        import transformers

        transformers_version = transformers.__version__
        transformers_ok = _version_in_range(
            transformers_version,
            _TRANSFORMERS_MIN,
            _TRANSFORMERS_MAX,
        )
    except ImportError as exc:
        import_error = import_error or str(exc)

    available = package_installed and transformers_ok and bool(torch_version)
    pipeline_loaded = _LAYERD_MODEL is not None
    ready = available and pipeline_loaded and _LOAD_ERROR is None

    vision_info: Dict[str, Any] = {}
    try:
        from tools.image_layer_split_tools import get_vision_layout_status

        vision_info = get_vision_layout_status()
    except Exception as exc:
        vision_info = {"ready": False, "message": str(exc)}

    status: Dict[str, Any] = {
        "engine": "layerd",
        "available": available,
        "ready": ready,
        "pipeline_loaded": pipeline_loaded,
        "ocr_enabled": True,
        "ocr_backends": ["east", "easyocr"],
        "vision": vision_info,
        "python": _python_executable(),
        "device": _select_matting_device() if torch_version else None,
        "package": {
            "layerd": layerd_version or None,
            "torch": torch_version or None,
            "transformers": transformers_version or None,
            "transformers_ok": transformers_ok,
            "transformers_required": f"{_TRANSFORMERS_MIN} ~ {_TRANSFORMERS_MAX}",
        },
        "models": models,
        "models_cached": all(m.get("cached") for m in models.values()),
        "warmup_at": _WARMUP_AT,
        "load_error": _LOAD_ERROR,
        "import_error": import_error or None,
        "paper": "LayerD (ICCV 2025)",
        "paper_url": "https://arxiv.org/abs/2509.25134",
        "install_hint": (
            "pip install git+https://github.com/CyberAgentAILab/LayerD.git "
            f'&& pip install "transformers>={_TRANSFORMERS_MIN},<={_TRANSFORMERS_MAX}"'
        ),
    }

    if not available:
        if not package_installed:
            status["message"] = "LayerD 未安装，当前将回退启发式拆层"
        elif not transformers_ok:
            status["message"] = (
                f"transformers 版本不兼容（当前 {transformers_version}，"
                f"需要 {_TRANSFORMERS_MIN}~{_TRANSFORMERS_MAX}）"
            )
        else:
            status["message"] = "LayerD 依赖未就绪"
    elif not pipeline_loaded:
        if status["models_cached"]:
            status["message"] = "模型已缓存，点击「预热引擎」或首次拆层时自动加载"
        else:
            status["message"] = "首次使用需下载 BiRefNet + LaMa + EAST 模型，请预热"
    elif ready:
        if vision_info.get("ready"):
            status["message"] = (
                f"LayerD + 通义视觉已就位（{vision_info.get('model', 'qwen-vl')}），可直接拆层"
            )
        else:
            status["message"] = (
                "LayerD 已就位；视觉语义布局未配置 Key，将仅用 OCR+启发式"
            )
    else:
        status["message"] = _LOAD_ERROR or "引擎状态未知"

    if probe_load and available and not pipeline_loaded:
        try:
            get_layerd_model()
            status["pipeline_loaded"] = _LAYERD_MODEL is not None
            status["ready"] = _LAYERD_MODEL is not None and _LOAD_ERROR is None
            status["warmup_at"] = _WARMUP_AT
            if status["ready"]:
                status["message"] = "LayerD 引擎已就位（含文字检测），可直接拆层"
        except Exception as exc:
            status["load_error"] = str(exc)
            status["message"] = f"模型加载失败: {exc}"

    return status


def warmup_layerd() -> Dict[str, Any]:
    """Preload LayerD matting/inpaint and EAST OCR weights."""
    global _WARMUP_AT, _LOAD_ERROR

    if not is_layerd_available():
        status = get_layerd_status()
        return {
            "success": False,
            "error": status.get("message") or "LayerD 不可用",
            **status,
        }

    started = time.time()
    try:
        _LOAD_ERROR = None
        get_layerd_model()
        # Pre-download EAST weights (no-op if cached).
        _build_ocr_result(Image.new("RGB", (640, 640), (255, 255, 255)), use_easyocr_supplement=False)
        _WARMUP_AT = time.time()
        elapsed = round(_WARMUP_AT - started, 2)
        status = get_layerd_status()
        logger.info("[layerd] warmup complete elapsed=%.2fs device=%s", elapsed, status.get("device"))
        return {
            "success": True,
            "elapsed_sec": elapsed,
            **status,
        }
    except Exception as exc:
        _LOAD_ERROR = str(exc)
        logger.error("[layerd] warmup failed: %s", exc, exc_info=True)
        status = get_layerd_status()
        return {
            "success": False,
            "error": str(exc),
            "elapsed_sec": round(time.time() - started, 2),
            **status,
        }


def get_layerd_model():
    """Lazy singleton for LayerD matting + inpaint stack."""
    global _LAYERD_MODEL, _LOAD_ERROR, _WARMUP_AT
    if _LAYERD_MODEL is not None:
        return _LAYERD_MODEL
    if not is_layerd_available():
        raise ImportError(
            "LayerD 未安装。请在后端 venv 中执行: "
            "pip install git+https://github.com/CyberAgentAILab/LayerD.git "
            f'&& pip install "transformers>={_TRANSFORMERS_MIN},<={_TRANSFORMERS_MAX}"'
        )
    from layerd.models.layerd import LayerD

    device = _select_matting_device()
    started = time.time()
    logger.info("[layerd] loading matting stack device=%s python=%s", device, _python_executable())
    try:
        _LAYERD_MODEL = LayerD(
            matting_hf_card="cyberagent/layerd-birefnet",
            matting_process_size=(1024, 1024),
            use_unblend=True,
            bg_refine=True,
            fg_refine=True,
            device=device,
        )
        _LOAD_ERROR = None
        _WARMUP_AT = time.time()
        logger.info("[layerd] matting stack ready elapsed=%.2fs", _WARMUP_AT - started)
    except Exception as exc:
        _LOAD_ERROR = str(exc)
        _LAYERD_MODEL = None
        raise
    return _LAYERD_MODEL


# Backward-compatible alias used by older code paths.
def get_layerd_pipeline():
    return get_layerd_model()


def _box_to_normalized(box: Dict[str, int], canvas_w: int, canvas_h: int) -> Dict[str, float]:
    x0 = int(box.get("x_min", 0))
    y0 = int(box.get("y_min", 0))
    x1 = int(box.get("x_max", canvas_w))
    y1 = int(box.get("y_max", canvas_h))
    return {
        "x": round(x0 / canvas_w, 4) if canvas_w else 0.0,
        "y": round(y0 / canvas_h, 4) if canvas_h else 0.0,
        "width": round(max(0, x1 - x0) / canvas_w, 4) if canvas_w else 0.0,
        "height": round(max(0, y1 - y0) / canvas_h, 4) if canvas_h else 0.0,
    }


def _is_full_canvas_element(box: Dict[str, int], canvas_w: int, canvas_h: int) -> bool:
    if canvas_w <= 0 or canvas_h <= 0:
        return False
    w = box.get("x_max", 0) - box.get("x_min", 0)
    h = box.get("y_max", 0) - box.get("y_min", 0)
    return w >= canvas_w * 0.98 and h >= canvas_h * 0.98


def _lookup_ocr_text(box: Dict[str, int], ocr_result: Optional[Dict[str, Any]]) -> str:
    if not ocr_result or not box:
        return ""
    best_text = ""
    best_iou = 0.0
    for block in ocr_result.get("blocks", []):
        block_bbox = block.get("bbox") or {}
        iou = _bbox_iou_pixels(box, block_bbox)
        if iou > best_iou:
            best_iou = iou
            best_text = str(block.get("text") or "").strip()
    return best_text if best_iou >= 0.25 else ""


def _element_display_name(
    elem: Dict[str, Any],
    index: int,
    *,
    ocr_result: Optional[Dict[str, Any]] = None,
) -> str:
    elem_type = str(elem.get("type") or "element")
    label = _TYPE_LABELS.get(elem_type, "元素")
    elem_id = elem.get("id", index)
    box = elem.get("box") or {}
    ocr_text = str(elem.get("text") or "").strip() or _lookup_ocr_text(box, ocr_result)
    if elem_type == "text" and ocr_text:
        compact = ocr_text.replace("\n", " ")[:16]
        return f"文字·{compact}" if compact else f"{label} {int(elem_id) + 1}"
    return f"{label} {int(elem_id) + 1}"


def _psd_safe_name(elem_type: str, index: int) -> str:
    prefix = {"text": "Text", "image": "Image", "vector": "Shape"}.get(elem_type, "Layer")
    return f"{prefix}_{index + 1:02d}"


def _detect_fan_circles(image: Image.Image) -> List[Dict[str, Any]]:
    """Detect circular fan/poster panels for mask clipping."""
    try:
        import cv2
        import numpy as np
    except ImportError:
        return []

    width, height = image.size
    rgb = np.array(image.convert("RGB"))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    blur = cv2.GaussianBlur(gray, (9, 9), 2)
    min_r = int(min(width, height) * 0.28)
    max_r = int(min(width, height) * 0.52)

    circles = cv2.HoughCircles(
        blur,
        cv2.HOUGH_GRADIENT,
        dp=1.2,
        minDist=int(width * 0.35),
        param1=90,
        param2=35,
        minRadius=min_r,
        maxRadius=max_r,
    )

    found: List[Dict[str, Any]] = []
    if circles is not None:
        for cx, cy, r in np.round(circles[0]).astype(int):
            if r < min_r:
                continue
            label = "左幅" if cx < width * 0.45 else "右幅" if cx > width * 0.55 else "全图"
            found.append({"cx": int(cx), "cy": int(cy), "r": int(r), "panel": label})

    found.sort(key=lambda c: c["cx"])
    if len(found) >= 2:
        logger.info("[layerd] fan circles detected=%d", len(found))
        return found[:2]

    # Fallback: dual-panel circular mask from aspect ratio
    if width / max(height, 1) >= _MIN_PANEL_ASPECT:
        r = int(min(height * 0.46, width * 0.24))
        cy = int(height * 0.46)
        found = [
            {"cx": width // 4, "cy": cy, "r": r, "panel": "左幅"},
            {"cx": width * 3 // 4, "cy": cy, "r": r, "panel": "右幅"},
        ]
        logger.info("[layerd] fan circles fallback dual-panel r=%d", r)
    return found


def _circle_mask_image(size: Tuple[int, int], circle: Dict[str, Any]) -> Image.Image:
    mask = Image.new("L", size, 0)
    from PIL import ImageDraw

    draw = ImageDraw.Draw(mask)
    cx, cy, r = circle["cx"], circle["cy"], circle["r"]
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=255)
    return mask


def _apply_panel_circle_mask(
    rgba: Image.Image,
    box: Dict[str, int],
    circles: List[Dict[str, Any]],
) -> Image.Image:
    import numpy as np

    if not circles:
        return rgba
    cx = (box.get("x_min", 0) + box.get("x_max", 0)) / 2
    circle = min(circles, key=lambda c: abs(c["cx"] - cx))
    mask = _circle_mask_image(rgba.size, circle)
    out = rgba.copy()
    alpha = np.array(out.getchannel("A"), dtype=np.float32)
    alpha *= np.array(mask, dtype=np.float32) / 255.0
    out.putalpha(Image.fromarray(alpha.astype(np.uint8)))
    return out


def _expand_square_bbox(
    bbox: Dict[str, int],
    canvas_w: int,
    canvas_h: int,
    *,
    quiet_ratio: float = 0.10,
) -> Dict[str, int]:
    """Expand QR bbox to square with quiet zone (white margin)."""
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


def _bbox_from_quad(quad: Any, width: int, height: int, *, quiet_ratio: float = 0.10) -> Dict[str, int]:
    import numpy as np

    xs = quad[:, 0]
    ys = quad[:, 1]
    raw = {
        "x_min": int(max(0, xs.min())),
        "y_min": int(max(0, ys.min())),
        "x_max": int(min(width, xs.max())),
        "y_max": int(min(height, ys.max())),
    }
    return _expand_square_bbox(raw, width, height, quiet_ratio=quiet_ratio)


def _merge_qr_region_list(regions: List[Dict[str, Any]], width: int, height: int) -> List[Dict[str, Any]]:
    if not regions:
        return []
    merged: List[Dict[str, Any]] = []
    for region in sorted(regions, key=lambda r: _bbox_area_pixels(r["bbox"]), reverse=True):
        bbox = _expand_square_bbox(region["bbox"], width, height, quiet_ratio=0.08)
        item = {**region, "bbox": bbox}
        if any(_bbox_iou_pixels(bbox, m["bbox"]) >= 0.35 for m in merged):
            continue
        merged.append(item)
    return merged[:3]


def _detect_qr_regions(image: Image.Image) -> List[Dict[str, Any]]:
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
                bbox = _bbox_from_quad(scaled, width, height, quiet_ratio=0.10)
                if _bbox_area_pixels(bbox) < 900:
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
                bbox = _expand_square_bbox(
                    {"x_min": x, "y_min": y0 + y, "x_max": x + w, "y_max": y0 + y + h},
                    width,
                    height,
                    quiet_ratio=0.12,
                )
                found.append({"name": "二维码", "role": "qr", "bbox": bbox})

    merged = _merge_qr_region_list(found, width, height)
    if merged:
        logger.info("[layerd] QR regions=%d", len(merged))
    return merged


def _detect_icon_regions(
    image: Image.Image,
    *,
    circles: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """Detect small circular/square service icons in poster footers."""
    try:
        import cv2
        import numpy as np
    except ImportError:
        return []

    width, height = image.size
    rgb = np.array(image.convert("RGB"))
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    # Gold / yellow icon accents
    gold = cv2.inRange(hsv, (10, 60, 120), (45, 255, 255))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    gold = cv2.morphologyEx(gold, cv2.MORPH_OPEN, kernel)

    contours, _ = cv2.findContours(gold, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    canvas_area = width * height
    icons: List[Dict[str, Any]] = []

    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)
        area = w * h
        if area < canvas_area * 0.00015 or area > canvas_area * 0.008:
            continue
        if y < height * 0.55:
            continue
        ratio = w / max(h, 1)
        if ratio < 0.55 or ratio > 1.8:
            continue
        pad = 3
        cx = x + w / 2
        panel = "左幅" if cx < width * 0.48 else "右幅"
        icons.append({
            "name": "服务图标",
            "role": "icon",
            "panel": panel,
            "bbox": {
                "x_min": max(0, x - pad),
                "y_min": max(0, y - pad),
                "x_max": min(width, x + w + pad),
                "y_max": min(height, y + h + pad),
            },
        })

    icons.sort(key=lambda i: (i["bbox"]["y_min"], i["bbox"]["x_min"]))
    # Dedupe overlapping icons
    kept: List[Dict[str, Any]] = []
    for icon in icons:
        if any(_bbox_iou_pixels(icon["bbox"], k["bbox"]) >= 0.4 for k in kept):
            continue
        kept.append(icon)

    logger.info("[layerd] icon regions=%d", len(kept))
    return kept[:12]


def _detect_replaceable_main_photos(
    image: Image.Image,
    panels: List[Tuple[Image.Image, int, str]],
) -> List[Dict[str, Any]]:
    """Per-panel main photo zones (excludes header/footer text bands) — 主图可换."""
    try:
        import cv2
        import numpy as np
    except ImportError:
        return []

    width, height = image.size
    regions: List[Dict[str, Any]] = []

    for _panel_img, x_offset, panel_label in panels:
        x0_band = x_offset
        x1_band = x_offset + _panel_img.size[0]
        band = np.array(image.crop((x0_band, 0, x1_band, height)).convert("RGB"))
        hsv = cv2.cvtColor(band, cv2.COLOR_RGB2HSV)
        ph = band.shape[0]

        white = cv2.inRange(hsv, (0, 0, 200), (180, 40, 255))
        dark_bg = cv2.inRange(hsv, (90, 40, 20), (140, 255, 120))
        ignore = cv2.bitwise_or(white, dark_bg)
        # Photo band: skip top title (~20%) and bottom contact bar (~25%)
        photo_mask = np.zeros((ph, band.shape[1]), dtype=np.uint8)
        photo_mask[int(ph * 0.18) : int(ph * 0.78), :] = 255
        foreground = cv2.bitwise_and(cv2.bitwise_not(ignore), photo_mask)

        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
        foreground = cv2.morphologyEx(foreground, cv2.MORPH_CLOSE, kernel, iterations=2)

        num, _, stats, _ = cv2.connectedComponentsWithStats(foreground, connectivity=8)
        panel_area = band.shape[0] * band.shape[1]
        panel_blobs: List[Dict[str, Any]] = []

        for idx in range(1, num):
            x, y, w, h, area = stats[idx]
            if area < panel_area * 0.02:
                continue
            if w < 50 or h < 50:
                continue
            pad = max(6, int(min(w, h) * 0.04))
            cy = y + h / 2
            if cy < ph * 0.22:
                name = "主图-顶部视觉"
            elif cy < ph * 0.55:
                name = "主图-中部摄影"
            else:
                name = "主图-下部配图"

            panel_blobs.append({
                "name": name,
                "role": "replaceable_main",
                "panel": panel_label,
                "area": area,
                "bbox": {
                    "x_min": int(x0_band + max(0, x - pad)),
                    "y_min": int(max(0, y - pad)),
                    "x_max": int(min(width, x0_band + x + w + pad)),
                    "y_max": int(min(height, y + h + pad)),
                },
            })

        panel_blobs.sort(key=lambda b: b["area"], reverse=True)
        if panel_blobs:
            regions.append(panel_blobs[0])

    logger.info("[layerd] replaceable main photos=%d", len(regions))
    return regions


def _detect_poster_photo_regions(image: Image.Image) -> List[Dict[str, Any]]:
    """Heuristic photo blobs for uniform-background posters (no LLM required)."""
    try:
        import cv2
        import numpy as np
    except ImportError:
        return []

    width, height = image.size
    rgb = np.array(image.convert("RGB"))
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)

    # Mask out near-white canvas and very dark blue background.
    white = cv2.inRange(hsv, (0, 0, 200), (180, 40, 255))
    dark_bg = cv2.inRange(hsv, (90, 40, 20), (140, 255, 120))
    ignore = cv2.bitwise_or(white, dark_bg)
    foreground = cv2.bitwise_not(ignore)

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    foreground = cv2.morphologyEx(foreground, cv2.MORPH_CLOSE, kernel, iterations=2)
    foreground = cv2.morphologyEx(foreground, cv2.MORPH_OPEN, kernel, iterations=1)

    num, labels, stats, _ = cv2.connectedComponentsWithStats(foreground, connectivity=8)
    canvas_area = width * height
    regions: List[Dict[str, Any]] = []

    for idx in range(1, num):
        x, y, w, h, area = stats[idx]
        if area < canvas_area * 0.012:
            continue
        if w < 40 or h < 40:
            continue
        aspect = w / max(h, 1)
        if aspect > 8 or aspect < 0.12:
            continue
        pad = max(4, int(min(w, h) * 0.03))
        regions.append({
            "name": "主视觉",
            "bbox": {
                "x_min": int(max(0, x - pad)),
                "y_min": int(max(0, y - pad)),
                "x_max": int(min(width, x + w + pad)),
                "y_max": int(min(height, y + h + pad)),
            },
            "description": "heuristic photo region",
        })

    regions.sort(key=lambda r: _bbox_area_pixels(r["bbox"]), reverse=True)
    logger.info("[layerd] heuristic photo regions=%d", len(regions))
    return regions[:8]


def _vision_image_regions(image: Image.Image, *, max_blocks: int = 14) -> List[Dict[str, Any]]:
    """Detect major photo/icon regions via vision model for poster layouts."""
    try:
        import uuid as _uuid

        from tools.image_layer_split_tools import _vision_detect_image_blocks

        temp_path = os.path.join(OUTPUT_DIR, f"layerd_vis_{_uuid.uuid4().hex[:10]}.png")
        image.convert("RGB").save(temp_path, "PNG")
        specs = _vision_detect_image_blocks(temp_path, max_image_blocks=max_blocks)
        width, height = image.size
        regions: List[Dict[str, Any]] = []
        for spec in specs:
            if spec.layer_type != "image":
                continue
            area = spec.width * spec.height
            if area < 0.004:
                continue
            regions.append({
                "name": spec.name or "图片块",
                "bbox": {
                    "x_min": int(spec.x * width),
                    "y_min": int(spec.y * height),
                    "x_max": int((spec.x + spec.width) * width),
                    "y_max": int((spec.y + spec.height) * height),
                },
                "description": spec.description,
            })
        logger.info("[layerd] vision image regions=%d", len(regions))
        return regions
    except Exception as exc:
        logger.warning("[layerd] vision image regions failed: %s", exc)
        return []


def _vision_semantic_layout(image: Image.Image, *, max_blocks: int = 22) -> List[Dict[str, Any]]:
    """Vision LLM semantic layout (LayerD + VLM hybrid) for poster understanding."""
    try:
        import uuid as _uuid

        from tools.image_layer_split_tools import _vision_layout_plan

        temp_path = os.path.join(OUTPUT_DIR, f"layerd_layout_{_uuid.uuid4().hex[:10]}.png")
        image.convert("RGB").save(temp_path, "PNG")
        plan = _vision_layout_plan(temp_path, max_blocks=max_blocks)
        width, height = image.size
        if not plan:
            regions_fb: List[Dict[str, Any]] = []
            for spec_region in _vision_image_regions(image, max_blocks=max_blocks):
                bb = spec_region["bbox"]
                regions_fb.append({
                    "name": spec_region.get("name") or "图片块",
                    "type": "image",
                    "role": "hero",
                    "bbox": bb,
                    "description": spec_region.get("description") or "",
                    "z_order": 5,
                })
            if regions_fb:
                logger.info("[layerd] vision layout fallback image-only=%d", len(regions_fb))
                return regions_fb

        regions: List[Dict[str, Any]] = []
        for block in plan:
            bbox = {
                "x_min": int(block["x"] * width),
                "y_min": int(block["y"] * height),
                "x_max": int((block["x"] + block["width"]) * width),
                "y_max": int((block["y"] + block["height"]) * height),
            }
            if _bbox_area_pixels(bbox) < width * height * 0.00012:
                continue
            regions.append({
                "name": block.get("name") or "元素",
                "type": block.get("type") or "image",
                "role": block.get("role") or block.get("type") or "image",
                "bbox": bbox,
                "description": block.get("description") or "",
                "z_order": int(block.get("z_order", 10)),
            })
        regions.sort(key=lambda r: (r.get("z_order", 10), r["bbox"]["y_min"]))
        logger.info("[layerd] vision semantic layout blocks=%d", len(regions))
        return regions
    except Exception as exc:
        logger.warning("[layerd] vision semantic layout failed: %s", exc)
        return []


def _ocr_blocks_inside_bbox(
    bbox: Dict[str, int],
    ocr_blocks: List[Dict[str, Any]],
    *,
    min_coverage: float = 0.55,
) -> str:
    """Match OCR *line* fragments whose center lies inside the vision text box."""
    matched: List[Tuple[int, int, str]] = []
    for block in ocr_blocks:
        bb = block.get("bbox") or {}
        if not bb:
            continue
        if _bbox_coverage_ratio(bb, bbox) < min_coverage:
            continue
        text = str(block.get("text") or "").strip()
        if not text:
            continue
        matched.append((bb.get("y_min", 0), bb.get("x_min", 0), text))
    matched.sort(key=lambda item: (item[0], item[1]))
    return " ".join(t for _, _, t in matched)[:160]


def _bbox_contains(outer: Dict[str, int], inner: Dict[str, int]) -> bool:
    cx = (inner.get("x_min", 0) + inner.get("x_max", 0)) / 2
    cy = (inner.get("y_min", 0) + inner.get("y_max", 0)) / 2
    return (
        outer.get("x_min", 0) <= cx <= outer.get("x_max", 0)
        and outer.get("y_min", 0) <= cy <= outer.get("y_max", 0)
    )


def _build_semantic_text_layers(
    source: Image.Image,
    ocr_result: Optional[Dict[str, Any]],
    panels: List[Tuple[Image.Image, int, str]],
    vision_layout: List[Dict[str, Any]],
    *,
    vision_only: bool = False,
) -> List[Dict[str, Any]]:
    """Coherent text layers: vision semantic zones first, OCR lines as fallback."""
    width, _height = source.size
    line_blocks: List[Dict[str, Any]] = []
    paragraph_blocks: List[Dict[str, Any]] = []
    if ocr_result:
        line_blocks = list(ocr_result.get("line_blocks") or ocr_result.get("blocks") or [])
        paragraph_blocks = list(
            ocr_result.get("paragraph_blocks") or line_blocks,
        )

    elements: List[Dict[str, Any]] = []
    covered_ocr: List[Dict[str, int]] = []
    next_id = 1

    vision_texts = [b for b in vision_layout if b.get("type") == "text"]
    for block in vision_texts:
        bbox = block["bbox"]
        panel = _panel_label_for_bbox(bbox, panels, width)
        ocr_text = _ocr_blocks_inside_bbox(bbox, line_blocks)
        name = block.get("name") or _text_layer_label(panel, ocr_text, next_id - 1)
        elem = _extract_source_crop_element(
            source,
            bbox,
            elem_id=next_id,
            panel=panel,
            name=name,
            role="text",
            elem_type="text",
            feather=True,
        )
        if elem:
            elem["text"] = ocr_text or block.get("description") or name
            elements.append(elem)
            covered_ocr.append(bbox)
            next_id += 1
            logger.info(
                "[layerd][diag] vision text #%d panel=%s ocr_len=%d name=%s",
                len(elements),
                panel,
                len(ocr_text),
                str(name)[:32],
            )

    if vision_only:
        logger.info(
            "[layerd] semantic text vision_only vision=%d total=%d (ocr fallback skipped)",
            len(vision_texts),
            len(elements),
        )
        return elements

    fallback_blocks = paragraph_blocks if paragraph_blocks else line_blocks
    ocr_added = 0
    for block in fallback_blocks:
        bbox = block.get("bbox") or {}
        if not bbox:
            continue
        if any(_bbox_iou_pixels(bbox, c) >= 0.38 for c in covered_ocr):
            continue
        if any(_bbox_iou_pixels(bbox, vt["bbox"]) >= 0.32 for vt in vision_texts):
            continue
        text = str(block.get("text") or "").strip()
        if not text:
            continue
        panel = _panel_label_for_bbox(bbox, panels, width)
        elem = _extract_source_crop_element(
            source,
            bbox,
            elem_id=next_id,
            panel=panel,
            name=_text_layer_label(panel, text, next_id - 1),
            role="text",
            elem_type="text",
            feather=True,
        )
        if elem:
            elem["text"] = text
            elements.append(elem)
            ocr_added += 1
            next_id += 1

    logger.info(
        "[layerd] semantic text layers vision=%d ocr_fallback=%d total=%d",
        len(vision_texts),
        ocr_added,
        len(elements),
    )
    return elements


def _dedupe_image_region_list(
    regions: List[Dict[str, Any]],
    panels: List[Tuple[Image.Image, int, str]],
) -> List[Dict[str, Any]]:
    deduped: List[Dict[str, Any]] = []
    for region in sorted(
        regions,
        key=lambda r: (
            0 if r.get("role") == "replaceable_main" else 1,
            -_bbox_area_pixels(r["bbox"]),
        ),
    ):
        bbox = region["bbox"]
        if any(_bbox_iou_pixels(bbox, k["bbox"]) >= 0.48 for k in deduped):
            continue
        deduped.append(region)

    panel_hero: Dict[str, bool] = {}
    limited: List[Dict[str, Any]] = []
    for region in deduped:
        if region.get("role") == "replaceable_main":
            panel = str(region.get("panel") or "全图")
            if panel_hero.get(panel):
                region = {**region, "role": "image"}
            else:
                panel_hero[panel] = True
        limited.append(region)
    return limited


def _resolve_hybrid_image_regions(
    source: Image.Image,
    panels: List[Tuple[Image.Image, int, str]],
    vision_layout: List[Dict[str, Any]],
    *,
    vision_only: bool = False,
) -> List[Dict[str, Any]]:
    """Fine-grained image/hero regions: VLM layout, optional heuristic supplement."""
    width, height = source.size
    canvas_area = max(1, width * height)
    regions: List[Dict[str, Any]] = []

    for block in vision_layout:
        if block.get("type") != "image":
            continue
        bbox = block["bbox"]
        role = str(block.get("role") or "image")
        if role in {"hero", "subject"} or _bbox_area_pixels(bbox) >= canvas_area * 0.04:
            role = "replaceable_main"
        regions.append({
            "name": block.get("name") or "图片块",
            "role": role,
            "panel": _panel_label_for_bbox(bbox, panels, width),
            "bbox": bbox,
            "source": "vision",
        })

    if vision_only:
        deduped = _dedupe_image_region_list(regions, panels)
        cap = 8 if len(panels) > 1 else 6
        logger.info(
            "[layerd] vision-only image regions=%d capped=%d",
            len(deduped),
            min(len(deduped), cap),
        )
        return deduped[:cap]

    for region in _detect_poster_photo_regions(source):
        bbox = region["bbox"]
        if any(_bbox_iou_pixels(bbox, r["bbox"]) >= 0.40 for r in regions):
            continue
        area = _bbox_area_pixels(bbox)
        role = "replaceable_main" if area >= canvas_area * 0.035 else "image"
        regions.append({
            **region,
            "role": role,
            "panel": _panel_label_for_bbox(bbox, panels, width),
            "source": "heuristic",
        })

    for region in _detect_replaceable_main_photos(source, panels):
        bbox = region["bbox"]
        if any(_bbox_iou_pixels(bbox, r["bbox"]) >= 0.45 for r in regions):
            continue
        regions.append({**region, "source": "panel-main"})

    decor = _pick_decorative_regions(source, panels, regions, max_total=6)
    for d in decor:
        if any(_bbox_iou_pixels(d["bbox"], r["bbox"]) >= 0.35 for r in regions):
            continue
        regions.append({**d, "source": "decor"})

    limited = _dedupe_image_region_list(regions, panels)
    cap = 10 if len(panels) > 1 else 8
    logger.info("[layerd] hybrid image regions=%d capped=%d", len(limited), min(len(limited), cap))
    return limited[:cap]


def _resolve_hybrid_qr_regions(
    source: Image.Image,
    vision_layout: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    width, height = source.size
    canvas_area = max(1, width * height)
    regions = list(_detect_qr_regions(source))
    for block in vision_layout:
        if block.get("type") != "qr":
            continue
        raw = block["bbox"]
        if _bbox_area_pixels(raw) > canvas_area * 0.06:
            logger.warning(
                "[layerd][diag] skip oversized vision QR area=%d name=%s",
                _bbox_area_pixels(raw),
                block.get("name"),
            )
            continue
        bbox = _clamp_qr_bbox(
            _expand_square_bbox(raw, width, height, quiet_ratio=0.08),
            width,
            height,
        )
        regions.append({"name": block.get("name") or "二维码", "role": "qr", "bbox": bbox, "source": "vision"})
    merged = _merge_qr_region_list(regions, width, height)
    clamped = [_clamp_qr_bbox(r["bbox"], width, height) for r in merged]
    for idx, region in enumerate(merged):
        region["bbox"] = clamped[idx]
    return merged


def _matting_extract_element(
    layerd_model: Any,
    source: Image.Image,
    bbox: Dict[str, int],
    *,
    elem_id: int,
    panel: str = "",
    name: str = "图片块",
    role: str = "image",
    full_canvas: bool = False,
    circles: Optional[List[Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    """Extract one image region with BiRefNet alpha matting."""
    import numpy as np
    from layerd.utils import apply_mask, crop_image_with_bbox

    width, height = source.size
    x0 = max(0, min(width - 1, int(bbox["x_min"])))
    y0 = max(0, min(height - 1, int(bbox["y_min"])))
    x1 = max(x0 + 1, min(width, int(bbox["x_max"])))
    y1 = max(y0 + 1, min(height, int(bbox["y_max"])))
    if x1 - x0 < 12 or y1 - y0 < 12:
        return None

    crop = source.crop((x0, y0, x1, y1))
    try:
        alpha = layerd_model.matting_model(crop)
    except Exception as exc:
        logger.warning("[layerd] matting crop failed: %s", exc)
        return None

    coverage = _matting_alpha_coverage(alpha)
    if coverage < 0.08:
        return None

    box = {"x_min": x0, "y_min": y0, "x_max": x1, "y_max": y1}

    # Sparse matting loses photo pixels — fall back to opaque source crop.
    if role == "replaceable_main" and coverage < 0.42:
        logger.info("[layerd] matting coverage low=%.2f using opaque crop", coverage)
        return _extract_source_crop_element(
            source,
            box,
            elem_id=elem_id,
            panel=panel,
            name=name,
            role=role,
            elem_type="image",
            feather=False,
            full_canvas=True,
        )

    alpha_u8 = np.clip(alpha * 255, 0, 255).astype(np.uint8)
    if role == "replaceable_main":
        import cv2
        alpha_u8 = cv2.GaussianBlur(alpha_u8, (5, 5), 0)

    crop_rgba = crop.convert("RGBA")
    crop_np = np.array(crop_rgba)
    crop_np[:, :, 3] = alpha_u8
    crop_rgba = Image.fromarray(crop_np)

    full = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    full.paste(crop_rgba, (x0, y0), crop_rgba)

    if full_canvas or role == "replaceable_main":
        layer_image = full
    else:
        mask = np.zeros((height, width), dtype=np.uint8)
        mask[y0:y1, x0:x1] = (alpha > 0.08).astype(np.uint8) * 255
        masked = apply_mask(full, mask)
        layer_image = crop_image_with_bbox(masked, box)

    return {
        "id": elem_id,
        "type": "image",
        "image": layer_image,
        "box": box,
        "panel": panel,
        "name": name,
        "role": role,
        "replaceable": role == "replaceable_main",
    }


def _opencv_inpaint_background(rgb: Any, mask_bool: Any) -> Image.Image:
    """Fast TELEA inpaint — less grey haze than LaMa on large poster photo zones."""
    import cv2
    import numpy as np

    h, w = rgb.shape[:2]
    inpaint_mask = (mask_bool.astype(np.uint8) * 255) if mask_bool.dtype != np.uint8 else mask_bool
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    radius = max(3, min(h, w) // 72)
    filled = cv2.inpaint(bgr, inpaint_mask, radius, cv2.INPAINT_TELEA)
    return Image.fromarray(cv2.cvtColor(filled, cv2.COLOR_BGR2RGB)).convert("RGBA")


def _build_inpainted_background(
    layerd_model: Any,
    source: Image.Image,
    exclude_mask: Any,
    circles: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Background layer with foreground regions inpainted — for 主图可换."""
    import numpy as np

    width, height = source.size
    rgb = np.array(source.convert("RGB"))
    mask = (np.array(exclude_mask) > 64).astype(bool)
    if not mask.any():
        bg_rgba = source.convert("RGBA")
    else:
        mask_ratio = float(mask.sum()) / max(1, width * height)
        # LaMa blurs large photo zones; TELEA preserves gradients better on posters.
        if mask_ratio > 0.12:
            bg_rgba = _opencv_inpaint_background(rgb, mask)
            logger.info("[layerd] background opencv inpaint mask_ratio=%.2f", mask_ratio)
        else:
            try:
                bg = layerd_model.inpaint_model(rgb, mask)
                bg_rgba = Image.fromarray(bg).convert("RGBA")
            except Exception as exc:
                logger.warning("[layerd] background LaMa inpaint failed: %s", exc)
                bg_rgba = _opencv_inpaint_background(rgb, mask)

    return {
        "id": 0,
        "type": "background",
        "image": bg_rgba,
        "box": {"x_min": 0, "y_min": 0, "x_max": width, "y_max": height},
        "panel": "",
        "name": "背景",
        "role": "background",
        "replaceable": False,
    }


def _build_foreground_exclude_mask(
    source: Image.Image,
    regions: List[Dict[str, Any]],
    ocr_result: Optional[Dict[str, Any]],
    *,
    vision_only: bool = False,
) -> Any:
    import numpy as np

    width, height = source.size
    mask = np.zeros((height, width), dtype=np.uint8)
    for region in regions:
        bb = region.get("bbox") or {}
        pad = 3 if vision_only else 0
        y0 = max(0, bb.get("y_min", 0) - pad)
        x0 = max(0, bb.get("x_min", 0) - pad)
        y1 = min(height, bb.get("y_max", 0) + pad)
        x1 = min(width, bb.get("x_max", 0) + pad)
        mask[y0:y1, x0:x1] = 255
    if not vision_only and ocr_result:
        for block in ocr_result.get("blocks", []):
            bb = block.get("bbox") or {}
            bw = max(1, bb.get("x_max", 0) - bb.get("x_min", 0))
            bh = max(1, bb.get("y_max", 0) - bb.get("y_min", 0))
            pad_x = max(6, int(bw * 0.06))
            pad_y = max(6, int(bh * 0.10))
            mask[
                max(0, bb.get("y_min", 0) - pad_y):min(height, bb.get("y_max", 0) + pad_y),
                max(0, bb.get("x_min", 0) - pad_x):min(width, bb.get("x_max", 0) + pad_x),
            ] = 255
    return mask


def _panel_label_for_bbox(
    bbox: Dict[str, int],
    panels: List[Tuple[Image.Image, int, str]],
    canvas_w: int,
) -> str:
    if len(panels) <= 1:
        return panels[0][2] if panels else "全图"
    cx = (bbox.get("x_min", 0) + bbox.get("x_max", 0)) / 2
    return "左幅" if cx < canvas_w / 2 else "右幅"


def _text_layer_label(panel: str, text: str, index: int = 0) -> str:
    panel_prefix = f"{panel}·" if panel else ""
    snippet = text.replace("\n", " ").strip()[:18]
    return f"{panel_prefix}文字·{snippet}" if snippet else f"{panel_prefix}文字{index + 1}"


def _extract_source_crop_element(
    source: Image.Image,
    bbox: Dict[str, int],
    *,
    elem_id: int,
    panel: str = "",
    name: str = "元素",
    role: str = "text",
    elem_type: str = "text",
    feather: bool = True,
    full_canvas: bool = False,
) -> Optional[Dict[str, Any]]:
    """Raster crop directly from source — preserves complete text/photo pixels."""
    width, height = source.size
    x0 = max(0, min(width - 1, int(bbox["x_min"])))
    y0 = max(0, min(height - 1, int(bbox["y_min"])))
    x1 = max(x0 + 1, min(width, int(bbox["x_max"])))
    y1 = max(y0 + 1, min(height, int(bbox["y_max"])))
    if x1 - x0 < 4 or y1 - y0 < 4:
        return None

    crop = source.crop((x0, y0, x1, y1)).convert("RGBA")
    if feather and elem_type == "text":
        blur_r = max(1, min(crop.size) // 48)
        if blur_r > 1:
            alpha = Image.new("L", crop.size, 255)
            crop.putalpha(alpha.filter(ImageFilter.GaussianBlur(blur_r)))

    box = {"x_min": x0, "y_min": y0, "x_max": x1, "y_max": y1}
    layer_image = crop
    if full_canvas:
        full = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        full.paste(crop, (x0, y0))
        layer_image = full

    return {
        "id": elem_id,
        "type": elem_type,
        "image": layer_image,
        "box": box,
        "panel": panel,
        "name": name,
        "role": role,
        "text": name if elem_type == "text" else "",
        "replaceable": role == "replaceable_main",
    }


def _build_text_layers_from_ocr(
    source: Image.Image,
    ocr_result: Optional[Dict[str, Any]],
    panels: List[Tuple[Image.Image, int, str]],
) -> List[Dict[str, Any]]:
    """Paragraph text layers from OCR bboxes — not LayerD decomposition fragments."""
    if not ocr_result:
        return []

    width, _height = source.size
    elements: List[Dict[str, Any]] = []
    line_blocks = ocr_result.get("line_blocks") or ocr_result.get("blocks") or []
    for index, block in enumerate(line_blocks):
        bbox = block.get("bbox") or {}
        if not bbox:
            continue
        text = str(block.get("text") or "").strip()
        panel = _panel_label_for_bbox(bbox, panels, width)
        elem = _extract_source_crop_element(
            source,
            bbox,
            elem_id=index + 1,
            panel=panel,
            name=_text_layer_label(panel, text, index),
            role="text",
            elem_type="text",
            feather=True,
        )
        if elem:
            elem["text"] = text
            elements.append(elem)

    logger.info("[layerd] text layers from OCR source crops=%d", len(elements))
    return elements


def _matting_alpha_coverage(alpha: Any) -> float:
    import numpy as np

    hard = alpha > 0.12
    if not np.any(hard):
        return 0.0
    return float(hard.sum()) / max(1, hard.size)


def _pick_decorative_regions(
    source: Image.Image,
    panels: List[Tuple[Image.Image, int, str]],
    main_regions: List[Dict[str, Any]],
    *,
    max_total: int = 4,
) -> List[Dict[str, Any]]:
    """Small header/decor blobs (e.g. airplane icons) not covered by main-photo zones."""
    width, height = source.size
    canvas_area = max(1, width * height)
    poster_regions = _detect_poster_photo_regions(source)
    kept: List[Dict[str, Any]] = []

    for region in poster_regions:
        bbox = region["bbox"]
        area = _bbox_area_pixels(bbox)
        if area < canvas_area * 0.0015 or area > canvas_area * 0.07:
            continue
        if any(_bbox_iou_pixels(bbox, m["bbox"]) >= 0.30 for m in main_regions):
            continue
        cy = (bbox["y_min"] + bbox["y_max"]) / 2
        if cy > height * 0.72:
            continue
        kept.append({
            **region,
            "role": "image",
            "panel": _panel_label_for_bbox(bbox, panels, width),
            "name": "装饰图",
        })

    kept.sort(key=lambda r: _bbox_area_pixels(r["bbox"]))
    return kept[:max_total]


def _extract_region_layer(
    source: Image.Image,
    region: Dict[str, Any],
    *,
    elem_id: int,
    circles: List[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """Raster extract for QR/icons (no matting)."""
    bbox = region["bbox"]
    width, height = source.size
    x0, y0 = int(bbox["x_min"]), int(bbox["y_min"])
    x1, y1 = int(bbox["x_max"]), int(bbox["y_max"])
    crop = source.crop((x0, y0, x1, y1)).convert("RGBA")
    full = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    full.paste(crop, (x0, y0))
    role = str(region.get("role") or "image")
    return {
        "id": elem_id,
        "type": "image",
        "image": full,
        "box": bbox,
        "panel": str(region.get("panel") or ""),
        "name": str(region.get("name") or "元素"),
        "role": role,
        "replaceable": False,
    }


def _assemble_design_draft_elements(
    source: Image.Image,
    base_elements: List[Dict[str, Any]],
    *,
    panels: List[Tuple[Image.Image, int, str]],
    ocr_result: Optional[Dict[str, Any]],
    include_ocr: bool,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Design-draft stack: background + replaceable mains + QR + text (no baked circle mask)."""
    layerd_model = get_layerd_model()
    design_mode = len(panels) > 1 or source.size[0] / max(source.size[1], 1) >= _MIN_PANEL_ASPECT

    stats: Dict[str, Any] = {
        "design_draft": design_mode,
        "circular_mask": False,
        "circles": 0,
        "replaceable_main": 0,
        "qr": 0,
        "icons": 0,
    }
    if not design_mode:
        return base_elements, stats

    vision_layout = _dedupe_vision_layout(_vision_semantic_layout(source, max_blocks=22))
    vision_only = len(vision_layout) >= _VISION_ONLY_MIN_BLOCKS
    type_counts: Dict[str, int] = {}
    for block in vision_layout:
        key = str(block.get("type") or "unknown")
        type_counts[key] = type_counts.get(key, 0) + 1
    logger.info(
        "[layerd][diag] assemble vision_blocks=%d vision_only=%s types=%s",
        len(vision_layout),
        vision_only,
        type_counts,
    )
    _log_region_summary("vision_layout", vision_layout)

    text_elems = (
        _build_semantic_text_layers(
            source,
            ocr_result,
            panels,
            vision_layout,
            vision_only=vision_only,
        )
        if include_ocr
        else []
    )
    image_regions = _resolve_hybrid_image_regions(
        source,
        panels,
        vision_layout,
        vision_only=vision_only,
    )
    qr_regions = _resolve_hybrid_qr_regions(source, vision_layout)
    _log_region_summary("image_regions", image_regions)
    _log_duplicate_pairs("image_regions", image_regions)

    icon_regions: List[Dict[str, Any]] = []
    for block in vision_layout:
        if block.get("type") != "icon":
            continue
        bb = block["bbox"]
        iw = bb["x_max"] - bb["x_min"]
        ih = bb["y_max"] - bb["y_min"]
        if iw < _MIN_ICON_PX or ih < _MIN_ICON_PX:
            logger.info(
                "[layerd][diag] skip tiny vision icon %dx%d name=%s",
                iw,
                ih,
                block.get("name"),
            )
            continue
        icon_regions.append({
            "name": block.get("name") or "服务图标",
            "role": "icon",
            "bbox": bb,
            "source": "vision",
        })
    if not icon_regions and not vision_only:
        icon_regions = [
            {"name": r.get("name", "服务图标"), "role": "icon", "bbox": r["bbox"], "source": "gold-detect"}
            for r in _detect_icon_regions(source)
            if (r["bbox"]["x_max"] - r["bbox"]["x_min"]) >= _MIN_ICON_PX
            and (r["bbox"]["y_max"] - r["bbox"]["y_min"]) >= _MIN_ICON_PX
        ][:6]
        logger.info("[layerd][diag] gold icon fallback count=%d", len(icon_regions))

    if vision_only:
        fg_regions = [{"bbox": b["bbox"], "role": b.get("type")} for b in vision_layout]
        mask_ocr = None
    else:
        fg_regions = list(image_regions) + list(qr_regions) + list(icon_regions)
        mask_ocr = {
            **(ocr_result or {}),
            "blocks": (ocr_result or {}).get("paragraph_blocks")
            or (ocr_result or {}).get("blocks")
            or [],
        }

    exclude_mask = _build_foreground_exclude_mask(
        source,
        fg_regions,
        mask_ocr,
        vision_only=vision_only,
    )
    import numpy as np

    width, height = source.size
    mask_ratio = float((np.array(exclude_mask) > 64).sum()) / max(1, width * height)
    logger.info(
        "[layerd][diag] exclude_mask_ratio=%.3f vision_only=%s fg_regions=%d",
        mask_ratio,
        vision_only,
        len(fg_regions),
    )
    if mask_ratio > 0.55:
        logger.warning(
            "[layerd][diag] high inpaint mask %.1f%% — background may look washed out",
            mask_ratio * 100,
        )
    background = _build_inpainted_background(layerd_model, source, exclude_mask, [])

    next_id = max((e.get("id", 0) for e in text_elems), default=0) + 1
    image_elems: List[Dict[str, Any]] = []
    replaceable_count = 0
    decor_count = 0
    icon_count = 0

    for region in image_regions:
        bbox = region["bbox"]
        panel = str(region.get("panel") or "")
        name = str(region.get("name") or "图片块")
        role = str(region.get("role") or "image")
        full_canvas = role == "replaceable_main"
        elem = _matting_extract_element(
            layerd_model,
            source,
            bbox,
            elem_id=next_id,
            panel=panel,
            name=name,
            role=role,
            full_canvas=full_canvas,
        )
        if elem is None:
            elem = _extract_source_crop_element(
                source,
                bbox,
                elem_id=next_id,
                panel=panel,
                name=name,
                role=role,
                elem_type="image",
                feather=False,
                full_canvas=full_canvas,
            )
        if elem:
            image_elems.append(elem)
            if role == "replaceable_main":
                replaceable_count += 1
            elif region.get("source") == "decor":
                decor_count += 1
            next_id += 1

    icon_elems: List[Dict[str, Any]] = []
    for region in icon_regions:
        if any(_bbox_iou_pixels(region["bbox"], e.get("box") or {}) >= 0.45 for e in image_elems):
            continue
        elem = _extract_source_crop_element(
            source,
            region["bbox"],
            elem_id=next_id,
            panel=_panel_label_for_bbox(region["bbox"], panels, source.size[0]),
            name=str(region.get("name") or "服务图标"),
            role="icon",
            elem_type="image",
            feather=False,
        )
        if elem:
            icon_elems.append(elem)
            icon_count += 1
            next_id += 1

    qr_elems: List[Dict[str, Any]] = []
    for region in qr_regions:
        elem = _extract_source_crop_element(
            source,
            region["bbox"],
            elem_id=next_id,
            panel=_panel_label_for_bbox(region["bbox"], panels, source.size[0]),
            name=str(region.get("name") or "二维码"),
            role="qr",
            elem_type="image",
            feather=False,
            full_canvas=False,
        )
        if elem:
            qr_elems.append(elem)
            next_id += 1

    final: List[Dict[str, Any]] = [background]
    final.extend(image_elems)
    final.extend(icon_elems)
    final.extend(qr_elems)
    final.extend(text_elems)
    final = _cap_draft_elements(final)

    stats.update({
        "replaceable_main": replaceable_count,
        "qr": len(qr_elems),
        "icons": icon_count,
        "decor": decor_count,
        "text_blocks": len(text_elems),
        "vision_layout": len(vision_layout),
        "vision_only": vision_only,
        "mask_ratio": round(mask_ratio, 4),
        "hybrid_pipeline": not vision_only,
    })
    logger.info("[layerd] design draft assembled total=%d stats=%s", len(final), stats)
    _write_assembly_debug_snapshot({
        "vision_only": vision_only,
        "type_counts": type_counts,
        "mask_ratio": mask_ratio,
        "stats": stats,
        "vision_layout": [
            {"name": b.get("name"), "type": b.get("type"), "bbox": b.get("bbox")}
            for b in vision_layout
        ],
        "image_regions": [
            {"name": r.get("name"), "role": r.get("role"), "source": r.get("source"), "bbox": r.get("bbox")}
            for r in image_regions
        ],
        "text_count": len(text_elems),
        "final_layers": len(final),
    })
    return final, stats


def _psd_layer_offset(
    image: Image.Image,
    box: Dict[str, int],
    canvas_size: Tuple[int, int],
    *,
    role: str,
) -> Tuple[Image.Image, int, int]:
    """Place layer at correct canvas position — never stretch crops to full canvas."""
    canvas_w, canvas_h = canvas_size
    rgba = image.convert("RGBA")
    if role in {"background", "replaceable_main"}:
        if rgba.size == (canvas_w, canvas_h):
            return rgba, 0, 0
    if rgba.size == (canvas_w, canvas_h):
        return rgba, 0, 0

    top = int(box.get("y_min", 0))
    left = int(box.get("x_min", 0))
    return rgba, top, left


def _write_design_draft_psd(
    path: str,
    elements: List[Dict[str, Any]],
    canvas_size: Tuple[int, int],
) -> None:
    try:
        from psd_tools import PSDImage
    except ImportError as exc:
        raise ImportError(
            "PSD 导出需要 psd-tools，请在 venv 中执行: pip install 'psd-tools>=1.10.0'"
        ) from exc

    canvas_w, canvas_h = canvas_size
    psd = PSDImage.new(mode="RGB", size=(canvas_w, canvas_h))

    for index, elem in enumerate(elements):
        image = elem.get("image")
        if image is None:
            continue
        role = str(elem.get("role") or elem.get("type") or "layer")
        box = elem.get("box") or {"x_min": 0, "y_min": 0, "x_max": canvas_w, "y_max": canvas_h}

        prefix = {
            "background": "BG",
            "replaceable_main": "Main",
            "qr": "QR",
            "icon": "Icon",
            "text": "Text",
            "image": "Image",
        }.get(role, "Layer")
        psd_name = f"{prefix}_{index + 1:02d}"

        layer_img, top, left = _psd_layer_offset(
            image, box, (canvas_w, canvas_h), role=role,
        )
        psd.create_pixel_layer(layer_img, name=psd_name, top=top, left=left)

    psd.save(path)


def _cleanup_image_elements(
    elements: List[Dict[str, Any]],
    canvas_w: int,
    canvas_h: int,
    *,
    max_image_layers: int = 14,
    min_area_ratio: float = 0.0012,
) -> List[Dict[str, Any]]:
    """Drop tiny CC fragments and cap image layer count for cleaner PSD."""
    canvas_area = max(1, canvas_w * canvas_h)
    kept: List[Dict[str, Any]] = []
    images: List[Dict[str, Any]] = []

    for elem in elements:
        if elem.get("type") not in {"image", "vector"}:
            kept.append(elem)
            continue
        box = elem.get("box") or {}
        area = _bbox_area_pixels(box)
        if area < canvas_area * min_area_ratio:
            continue
        images.append(elem)

    images.sort(key=lambda e: _bbox_area_pixels(e.get("box") or {}), reverse=True)
    kept.extend(images[:max_image_layers])
    logger.info(
        "[layerd] image cleanup kept=%d dropped=%d",
        min(len(images), max_image_layers),
        max(0, len(images) - max_image_layers),
    )
    return kept


def _supplement_image_elements(
    source: Image.Image,
    elements: List[Dict[str, Any]],
    *,
    min_expected: int = 3,
) -> List[Dict[str, Any]]:
    """Add vision+matting image layers when LayerD misses photos/icons."""
    image_elems = [e for e in elements if e.get("type") in {"image", "vector"}]
    if len(image_elems) >= min_expected:
        return elements

    regions = _vision_image_regions(source, max_blocks=16)
    if not regions:
        regions = _detect_poster_photo_regions(source)
    if not regions:
        return elements

    layerd_model = get_layerd_model()
    next_id = max((int(e.get("id", 0)) for e in elements), default=0) + 1
    added: List[Dict[str, Any]] = []

    for region in regions:
        bbox = region["bbox"]
        if any(
            e.get("type") in {"image", "vector"}
            and _bbox_iou_pixels(bbox, (e.get("box") or {})) >= 0.35
            for e in elements
        ):
            continue
        elem = _matting_extract_element(
            layerd_model,
            source,
            bbox,
            elem_id=next_id,
            name=str(region.get("name") or "图片块"),
        )
        if elem is None:
            continue
        added.append(elem)
        next_id += 1

    if added:
        logger.info("[layerd] vision matting supplement added=%d", len(added))
    return elements + added


def _run_layerd_decompose(
    source: Image.Image,
    *,
    max_iterations: int,
    include_ocr: bool,
) -> Tuple[Any, Dict[str, Any]]:
    """Manual LayerD pipeline with dual-panel + vision supplement for posters."""
    from layerd.classification import GradientAwareLabeler
    from layerd.pipeline import PipelineResult
    from layerd.postprocess import LayerOrganizer

    layerd_model = get_layerd_model()
    per_panel_iterations = max(4, min(12, int(max_iterations or 10)))
    panels = _detect_layout_panels(source)
    ocr_result = _build_ocr_result(source, use_easyocr_supplement=include_ocr) if include_ocr else None

    organizer = LayerOrganizer(
        overlap_threshold=_OVERLAP_THRESHOLD,
        labeler=GradientAwareLabeler(entropy_threshold=5.0, gradient_threshold=0.28),
    )

    all_elements: List[Dict[str, Any]] = []
    all_layers: List[Image.Image] = []
    raw_layer_count = 0
    panel_labels: List[str] = []

    logger.info(
        "[layerd] decompose start size=%s panels=%d iterations/panel=%s ocr=%s",
        source.size,
        len(panels),
        per_panel_iterations,
        include_ocr,
    )

    for panel_image, x_offset, panel_label in panels:
        panel_labels.append(panel_label)
        panel_layers = layerd_model.decompose(panel_image, max_iterations=per_panel_iterations)
        raw_layer_count += len(panel_layers)
        all_layers.extend(panel_layers)

        panel_ocr = None
        if ocr_result is not None:
            pw, ph = panel_image.size
            px1 = x_offset + pw
            panel_blocks = []
            for block in ocr_result.get("blocks", []):
                bb = block.get("bbox") or {}
                cx = (bb.get("x_min", 0) + bb.get("x_max", 0)) / 2
                if x_offset <= cx <= px1 + 8:
                    panel_blocks.append({
                        **block,
                        "bbox": {
                            "x_min": max(0, bb.get("x_min", 0) - x_offset),
                            "y_min": bb.get("y_min", 0),
                            "x_max": min(pw, bb.get("x_max", 0) - x_offset),
                            "y_max": bb.get("y_max", 0),
                        },
                    })
            panel_ocr = {"image_size": (pw, ph), "blocks": panel_blocks}

        panel_elements = organizer.organize(panel_layers, ocr_result=panel_ocr)
        for elem in panel_elements:
            shifted = _offset_element_box(dict(elem), x_offset, 0)
            shifted["panel"] = panel_label
            all_elements.append(shifted)

    canvas_w, canvas_h = source.size
    all_elements = _cleanup_image_elements(all_elements, canvas_w, canvas_h, max_image_layers=16)

    design_likely = len(panels) > 1 or source.size[0] / max(source.size[1], 1) >= _MIN_PANEL_ASPECT
    if not design_likely:
        min_images = 5 if len(panels) > 1 else 3
        all_elements = _supplement_image_elements(source, all_elements, min_expected=min_images)
    else:
        logger.info("[layerd][diag] skip vision matting supplement — design draft mode")

    all_elements, design_stats = _assemble_design_draft_elements(
        source,
        all_elements,
        panels=panels,
        ocr_result=ocr_result,
        include_ocr=include_ocr,
    )

    text_count = sum(1 for e in all_elements if e.get("type") == "text")
    image_count = sum(1 for e in all_elements if e.get("type") in {"image", "vector"})
    replaceable_count = sum(1 for e in all_elements if e.get("replaceable"))
    logger.info(
        "[layerd] organized elements=%d text=%d image/vector=%d replaceable=%d raw_layers=%d panels=%s",
        len(all_elements),
        text_count,
        image_count,
        replaceable_count,
        raw_layer_count,
        panel_labels,
    )

    meta = {
        "panels": panel_labels,
        "raw_layers": raw_layer_count,
        "text_blocks": text_count,
        "image_blocks": image_count,
        "draft_elements": all_elements,
        **design_stats,
    }

    return PipelineResult(
        elements=all_elements,
        layers=all_layers,
        ocr_result=ocr_result,
        canvas_size=source.size,
    ), meta


def split_with_layerd(
    source: Image.Image,
    *,
    max_iterations: int = 8,
    include_ocr: bool = True,
) -> Dict[str, Any]:
    """Decompose image using LayerD (ICCV 2025) with OCR-guided element organization."""
    if source.mode not in {"RGB", "RGBA"}:
        source = source.convert("RGB")

    result, run_meta = _run_layerd_decompose(
        source,
        max_iterations=max_iterations,
        include_ocr=include_ocr,
    )

    canvas_w, canvas_h = result.canvas_size
    layer_meta: List[Dict[str, Any]] = []
    psd_index = 0

    design_draft = bool(run_meta.get("design_draft"))
    draft_elements = run_meta.get("draft_elements") or list(result.elements)

    for elem in draft_elements:
        if not isinstance(elem, dict):
            elem = dict(elem)
        box = elem.get("box") or {}
        role = str(elem.get("role") or elem.get("type") or "layer")
        elem_type = str(elem.get("type") or "vector")

        if role == "background" or (
            not design_draft and _is_full_canvas_element(box, canvas_w, canvas_h)
        ):
            norm = {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0}
            layer_meta.append({
                "name": "背景",
                "psd_name": "BG_01",
                "type": "background",
                "description": "可编辑背景（主图区域已抠除）",
                "replaceable": False,
                **norm,
                "z_order": 0,
            })
            continue

        norm = _box_to_normalized(box, canvas_w, canvas_h)
        ocr_text = _lookup_ocr_text(box, result.ocr_result)
        panel = str(elem.get("panel") or "").strip()
        custom_name = str(elem.get("name") or "").strip()

        if role == "replaceable_main":
            display = f"{panel}·{custom_name}" if panel else custom_name or "主图"
            elem_type = "replaceable_main"
            desc = "主图可换 — 在 PSD 中直接替换此图层内容"
        elif role == "qr":
            display = f"{panel}·二维码" if panel else "二维码"
            elem_type = "qr"
            desc = "二维码图层"
        elif role == "icon":
            display = f"{panel}·{custom_name}" if panel else custom_name or "图标"
            elem_type = "icon"
            desc = "服务图标"
        else:
            base_name = _element_display_name(elem, psd_index, ocr_result=result.ocr_result)
            display = f"{panel}·{base_name}" if panel and panel != "全图" else base_name
            if elem.get("type") in {"image", "vector"} and custom_name:
                display = f"{panel}·{custom_name}" if panel and panel != "全图" else custom_name
            desc = (ocr_text or f"LayerD {elem_type} element")[:120]

        prefix = {
            "background": "BG",
            "replaceable_main": "Main",
            "qr": "QR",
            "icon": "Icon",
            "text": "Text",
        }.get(elem_type, _psd_safe_name(elem_type, psd_index).split("_")[0])

        layer_meta.append({
            "name": display,
            "psd_name": f"{prefix}_{psd_index + 1:02d}",
            "type": elem_type,
            "description": desc,
            "replaceable": bool(elem.get("replaceable")),
            **norm,
            "z_order": psd_index + 1,
        })
        psd_index += 1

    stem = f"layerd_{uuid.uuid4().hex[:10]}"
    out_path = os.path.join(OUTPUT_DIR, f"{stem}.psd")
    if design_draft:
        _write_design_draft_psd(out_path, draft_elements, result.canvas_size)
    else:
        result.save(out_path)

    filename = os.path.basename(out_path)
    text_count = sum(1 for m in layer_meta if m["type"] == "text")
    image_count = sum(
        1 for m in layer_meta
        if m["type"] in {"image", "vector", "replaceable_main", "qr", "icon"}
    )
    engine_status = get_layerd_status()
    ocr_blocks = len((result.ocr_result or {}).get("blocks", []))
    return {
        "success": True,
        "filename": filename,
        "local_path": out_path,
        "download_url": f"/api/media/{filename}",
        "format": "psd",
        "layer_count": len(layer_meta),
        "layers": layer_meta,
        "size_bytes": os.path.getsize(out_path) if os.path.isfile(out_path) else 0,
        "engine": "layerd",
        "analysis": {
            "engine": "layerd",
            "paper": "LayerD (ICCV 2025)",
            "paper_url": "https://arxiv.org/abs/2509.25134",
            "raw_layers": run_meta.get("raw_layers", len(result.layers)),
            "panels": run_meta.get("panels", ["全图"]),
            "elements": len(result.elements),
            "image_blocks": image_count,
            "text_blocks": text_count,
            "ocr_blocks": ocr_blocks,
            "iterations": max(4, min(12, int(max_iterations or 10))),
            "include_ocr": include_ocr,
            "design_draft": run_meta.get("design_draft", False),
            "circular_mask": run_meta.get("circular_mask", False),
            "replaceable_main": run_meta.get("replaceable_main", 0),
            "qr": run_meta.get("qr", 0),
            "icons": run_meta.get("icons", 0),
            "vision_layout": run_meta.get("vision_layout", 0),
            "hybrid_pipeline": run_meta.get("hybrid_pipeline", False),
            "device": engine_status.get("device"),
            "pipeline_loaded": True,
        },
    }
