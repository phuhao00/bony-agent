"""
图片精准编辑工具 — 局部重绘、指令编辑、物体移除、扩图

主供应商: 通义万相 wanx2.1-imageedit (DashScope)
兜底: Google Gemini multimodal (instruction 模式)
"""
from __future__ import annotations

import base64
import io
import mimetypes
import os
import re
import uuid
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

import requests
from langchain.tools import tool
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps

from tools.media_common import (
    OUTPUT_DIR,
    PROJECT_ROOT,
    TEMP_DIR,
    UPLOAD_DIR,
    _get_provider_api_key,
    dashscope_submit_async,
    dashscope_wait_task,
    download_file,
)
from tools.memory_tools import save_generation_to_memory
from utils.logger import setup_logger

logger = setup_logger("image_edit_tools")

VALID_MODES = frozenset({
    "instruction",
    "inpaint",
    "remove",
    "outpaint",
    "style_global",
    "style_local",
    "watermark",
    "upscale",
    "colorize",
    "sketch",
    "cartoon",
    "reference",
})

WAN25_I2I_MODEL = "wan2.5-i2i-preview"
MAX_WAN25_IMAGES = 3
MAX_REFERENCE_IMAGES = MAX_WAN25_IMAGES - 1  # source counts as 图1

MODE_TO_FUNCTION: Dict[str, str] = {
    "instruction": "description_edit",
    "inpaint": "description_edit_with_mask",
    "remove": "description_edit_with_mask",
    "outpaint": "expand",
    "style_global": "stylization_all",
    "style_local": "stylization_local",
    "watermark": "remove_watermark",
    "upscale": "super_resolution",
    "colorize": "colorization",
    "sketch": "doodle",
    "cartoon": "control_cartoon_feature",
}

REMOVE_PROMPT = "移除涂抹区域的内容，并用周围背景自然填充，保持画面自然连贯"

MODE_DEFAULT_PROMPTS: Dict[str, str] = {
    "remove": REMOVE_PROMPT,
    "watermark": "去除图像中的文字水印",
    "upscale": "图像超分",
}

ADD_SUBJECT_TERMS = (
    "加一", "加个", "加上", "加到", "添加", "放一", "放个", "插入", "新增",
    "add a", "add an", "insert", "place a", "put a",
)
PLACEMENT_TERMS = (
    "左上", "右上", "左下", "右下", "中间", "中央", "前景", "背景", "旁边",
    "图片上", "画面上", "on the image", "in the image", "foreground", "background",
)

WATERMARK_AREA_PROMPT = (
    "去除涂抹区域中的文字、水印、Logo 或二维码，"
    "用周围背景自然填充，保持色彩与纹理连贯，不要留下涂抹痕迹。"
)

MODES_REQUIRING_MASK = frozenset({"inpaint", "remove"})
MODES_REQUIRING_PROMPT = frozenset({
    "instruction",
    "inpaint",
    "outpaint",
    "style_global",
    "style_local",
    "colorize",
    "sketch",
    "cartoon",
    "reference",
})

WAN25_ONLY_MODES = frozenset({"reference"})

VALID_REFERENCE_INTENTS = frozenset({
    "replace_material",
    "preserve_shape",
    "recompose_layout",
    "style_transfer",
    "partial_replace",
})

REFERENCE_INTENT_CONSTRAINTS: Dict[str, str] = {
    "replace_material": (
        "【素材替换】将参考图（图2及之后）中的素材用于替换图1中的对应内容。"
        "硬性约束：必须严格保持图1的轮廓、形状、姿态、透视、比例与整体布局不变；"
        "仅替换被指定的物体/区域，未提及部分保持原样，边缘融合自然。"
    ),
    "preserve_shape": (
        "【保形换肤】仅改变图1的表面材质、颜色、纹理与光影细节。"
        "硬性约束：所有物体的形状边界、位置、大小、布局完全锁定，不得改变轮廓与构图。"
    ),
    "partial_replace": (
        "【指定替换】按用户指定的图1目标区域/物体，用参考图素材进行替换。"
        "约束：未替换区域尽量保持原形状与位置；替换区域与周围光影、透视一致。"
    ),
    "style_transfer": (
        "【风格参考】仅参考图2及之后的色调、画风、氛围与质感。"
        "硬性约束：图1的主体形状、内容元素、位置与布局必须保持不变，只改变视觉风格。"
    ),
    "recompose_layout": (
        "【布局重组】从参考图中提取素材元素，允许重新排列位置、调整构图与前后景层次。"
        "约束：提取的素材应来自参考图，整体画面协调自然；图1可作为构图基础或画布。"
    ),
}

REFERENCE_ROLE_HINTS: Dict[str, str] = {
    "material": "作为素材来源（物体/配件/纹理/材质）",
    "style": "作为风格与色调参考",
    "background": "作为背景或环境场景参考",
    "subject": "作为主体造型或角色参考",
}


def compose_reference_prompt(
    *,
    intent: str = "replace_material",
    user_prompt: str = "",
    reference_target: str = "",
    reference_roles: Optional[List[str]] = None,
    ref_count: int = 1,
) -> str:
    """Build structured prompt for wan2.5 / Gemini reference editing."""
    resolved_intent = intent if intent in VALID_REFERENCE_INTENTS else "replace_material"
    parts = [REFERENCE_INTENT_CONSTRAINTS[resolved_intent], "图1 为待编辑原图。"]

    roles = reference_roles or []
    role_lines: list[str] = []
    for idx in range(min(ref_count, MAX_REFERENCE_IMAGES)):
        role = (roles[idx] if idx < len(roles) else "material").strip().lower()
        hint = REFERENCE_ROLE_HINTS.get(role, REFERENCE_ROLE_HINTS["material"])
        role_lines.append(f"图{idx + 2}：{hint}")

    if role_lines:
        parts.append("参考图用途：" + "；".join(role_lines))

    target = (reference_target or "").strip()
    if target:
        parts.append(f"图1 处理目标：{target}")

    detail = (user_prompt or "").strip()
    if detail:
        parts.append(f"补充要求：{detail}")
    elif not target:
        parts.append("请按上述约束完成编辑，输出完整图片。")

    return "\n".join(parts)


def compose_inpaint_reference_prompt(user_prompt: str = "") -> str:
    """Prompt for Gemini fallback after composite paste."""
    parts = [
        "图1 是已把参考素材粘贴进蒙版区域的图片。",
        "图2 是编辑蒙版：白色=需融合优化的区域，黑色=必须保持不变的区域。",
        "【局部融合】仅在白色蒙版内优化粘贴内容：消除接缝与色差，统一光照、透视、清晰度与原图画风，"
        "使替换区域自然融入。黑色区域像素不得改变。",
    ]
    detail = (user_prompt or "").strip()
    if detail:
        parts.append(f"补充要求：{detail}")
    else:
        parts.append("输出完整编辑后的图片，替换区域清晰自然。")
    return "\n".join(parts)


def compose_inpaint_refine_prompt(user_prompt: str = "") -> str:
    """Prompt for Wanx mask inpaint after reference composite."""
    parts = [
        "对蒙版白色区域内的替换内容进行精细融合：消除粘贴边缘、色差与模糊，"
        "统一光照、透视、清晰度与整体画风，使替换区域像原图自然一部分。"
        "蒙版黑色区域必须完全保持不变。",
    ]
    detail = (user_prompt or "").strip()
    if detail:
        parts.append(detail)
    return "\n".join(parts)


MODES_WITH_STRENGTH = frozenset({"instruction", "style_global"})


def _mode_requires_mask(mode: str) -> bool:
    return mode in MODES_REQUIRING_MASK


def _watermark_uses_mask(watermark_mode: str, mask_image_url: str) -> bool:
    mode = (watermark_mode or "auto").strip().lower()
    if mode == "area":
        return True
    if mode == "auto" and (mask_image_url or "").strip():
        return True
    return False


def compose_watermark_prompt(
    user_prompt: str = "",
    *,
    target_text: str = "",
    watermark_mode: str = "auto",
) -> str:
    """Build DashScope prompt for watermark removal modes."""
    mode = (watermark_mode or "auto").strip().lower()
    extra = (user_prompt or "").strip()
    target = (target_text or "").strip()

    if mode == "area":
        base = WATERMARK_AREA_PROMPT
    elif mode == "text" and target:
        base = (
            f"【局部文字消除】仅去除图片中出现的文字「{target}」"
            f"（含包含该词的完整词句），用周围背景纹理自然修复被去除的文字区域。"
            f"【硬性约束】严禁改变飞机、车辆、图标、二维码、边框等任何非目标文字内容；"
            f"严禁替换成其他图片或素材；严禁添加新文字或新物体；"
            f"除目标文字外全图必须与原图保持一致。"
        )
    elif target:
        base = f"去除图像中的文字水印：{target}"
    else:
        base = MODE_DEFAULT_PROMPTS["watermark"]

    if extra and extra not in base:
        return f"{base}。{extra}"
    return base


def _resolve_watermark_edit_strength(watermark_mode: str, strength: float) -> float:
    """Text-targeted watermark removal needs low strength to avoid whole-image redraw."""
    if (watermark_mode or "").strip().lower() == "text":
        if strength >= 0.5:
            return 0.35
        return max(0.2, min(0.45, float(strength)))
    return strength


def _fetch_ocr_blocks_inline(image_path: str) -> List[Dict[str, Any]]:
    """Run OCR in-process via services/ocr when gRPC is unavailable."""
    try:
        import sys

        ocr_dir = os.path.join(PROJECT_ROOT, "services", "ocr")
        if ocr_dir not in sys.path:
            sys.path.insert(0, ocr_dir)
        from engine import get_engine  # type: ignore

        result = get_engine().run(image_path=image_path, languages=["ch_sim", "en"])
        blocks: List[Dict[str, Any]] = []
        for item in result.blocks:
            blocks.append({
                "text": (item.text or "").strip(),
                "x": float(item.bbox.x),
                "y": float(item.bbox.y),
                "width": float(item.bbox.width),
                "height": float(item.bbox.height),
            })
        return [b for b in blocks if b["text"]]
    except Exception as exc:
        logger.warning("[ImageEdit] inline OCR failed: %s", exc)
        return []


def _fetch_ocr_blocks(image_path: str) -> List[Dict[str, Any]]:
    """Return OCR text blocks with normalized bbox (0-1)."""
    blocks = _fetch_ocr_blocks_grpc(image_path)
    if blocks:
        return blocks
    return _fetch_ocr_blocks_inline(image_path)


def _fetch_ocr_blocks_grpc(image_path: str) -> List[Dict[str, Any]]:
    """Return OCR text blocks with normalized bbox (0-1) via gRPC OCR service."""
    try:
        from generated.mediaagent import common_pb2, ocr_pb2  # type: ignore
        from services.grpc_client import get_ocr_stub

        stub = get_ocr_stub()
        if stub is None:
            return []

        req = ocr_pb2.OCRRequest(languages=["ch_sim", "en"], detect_layout=True)
        if os.path.isfile(image_path):
            try:
                data, _ = _read_bytes_from_local_path(image_path)
                req.image_data = data
            except Exception:
                req.image_path = str(image_path)
        else:
            req.image_path = str(image_path)

        resp = stub.ExtractText(req, timeout=120)
        if resp.status != common_pb2.TASK_STATUS_COMPLETED:
            logger.warning("[ImageEdit] OCR gRPC status=%s", resp.status)
            return []
        blocks: List[Dict[str, Any]] = []
        for item in resp.blocks:
            bb = item.bbox
            blocks.append({
                "text": (item.text or "").strip(),
                "x": float(bb.x),
                "y": float(bb.y),
                "width": float(bb.width),
                "height": float(bb.height),
            })
        return [b for b in blocks if b["text"]]
    except Exception as exc:
        logger.warning("[ImageEdit] OCR blocks fetch failed: %s", exc)
        return []


def _normalize_match_text(text: str) -> str:
    """Normalize OCR text for fuzzy substring matching."""
    cleaned = re.sub(r"[\s\u3000·•|/\\\-_.,，。!！?？:：;；'\"“”‘’（）()【】\[\]<>《》]", "", text or "")
    return cleaned.lower()


def _expand_search_targets(target: str, *, include_aliases: bool = False) -> List[str]:
    """Exact target by default; optional pinyin/English aliases (e.g. 一泽达 → YIZEDA)."""
    t = (target or "").strip()
    if not t:
        return []
    out: List[str] = [t]
    if include_aliases:
        try:
            from pypinyin import Style, lazy_pinyin

            if any("\u4e00" <= c <= "\u9fff" for c in t):
                joined = "".join(lazy_pinyin(t, style=Style.NORMAL))
                if joined:
                    out.append(joined.upper())
                    out.append(joined.lower())
                    out.append(joined.capitalize())
        except ImportError:
            logger.debug("[ImageEdit] pypinyin not installed, skip romanization aliases")
        if re.search(r"[a-zA-Z]", t):
            out.extend([t.upper(), t.lower()])
    seen: set[str] = set()
    uniq: List[str] = []
    for item in out:
        key = item.lower()
        if key not in seen:
            seen.add(key)
            uniq.append(item)
    return uniq


def _looks_like_watermark_target(text: str) -> bool:
    """True when user prompt looks like literal watermark text, not an instruction."""
    t = (text or "").strip()
    if not t or len(t) > 24:
        return False
    if re.search(r"[，。！？；：,.!?;:]", t):
        return False
    if t.count(" ") > 3:
        return False
    return True


def _resolve_watermark_routing(
    watermark_mode: str,
    watermark_text: str,
    user_prompt: str,
    mask_image_url: str = "",
    *,
    include_aliases: bool = False,
) -> Tuple[str, str, str, bool]:
    """Return (effective_mode, target_text, remaining_prompt, include_aliases)."""
    mode = (watermark_mode or "auto").strip().lower()
    target = (watermark_text or "").strip()
    extra = (user_prompt or "").strip()

    if mode == "area":
        return mode, target, extra, include_aliases

    if mode == "text":
        effective_target = target or (_looks_like_watermark_target(extra) and extra) or ""
        if target and extra and extra != target:
            return "text", effective_target, extra, include_aliases
        remaining = "" if effective_target and effective_target == extra else extra
        return "text", effective_target, remaining, include_aliases

    if (mask_image_url or "").strip():
        return "area", target, extra, include_aliases

    candidate = target or (_looks_like_watermark_target(extra) and extra) or ""
    if candidate:
        logger.info("[ImageEdit] auto watermark → local text mode for %r", candidate)
        remaining = "" if candidate == extra else extra
        return "text", candidate, remaining, include_aliases

    return "auto", "", extra, include_aliases


def _target_matches_text(target: str, text: str) -> bool:
    if not target or not text:
        return False
    if target in text:
        return True
    if target.lower() in text.lower():
        return True
    norm_target = _normalize_match_text(target)
    norm_text = _normalize_match_text(text)
    if norm_target and norm_target in norm_text:
        return True
    if len(target) >= 2 and text.startswith(target[1:]):
        return True
    return False


def _resolve_target_span(text: str, target: str) -> Optional[Tuple[int, int]]:
    """Return (start_index, match_length) within text for target or OCR-truncated forms."""
    if not text or not target:
        return None
    idx = text.find(target)
    if idx >= 0:
        return idx, len(target)
    lower_text = text.lower()
    lower_target = target.lower()
    idx = lower_text.find(lower_target)
    if idx >= 0:
        return idx, len(target)
    norm_text = _normalize_match_text(text)
    norm_target = _normalize_match_text(target)
    if norm_target and norm_target in norm_text:
        nidx = norm_text.find(norm_target)
        start_ratio = nidx / max(1, len(norm_text))
        end_ratio = (nidx + len(norm_target)) / max(1, len(norm_text))
        start = int(round(start_ratio * len(text)))
        end = int(round(end_ratio * len(text)))
        return start, max(1, end - start)
    if len(target) >= 2 and text.startswith(target[1:]):
        return 0, len(target[1:])
    return None


def _box_from_span(
    text: str,
    span_start: int,
    span_len: int,
    box: Dict[str, float],
    *,
    full_target_len: int,
) -> Dict[str, float]:
    """Map character span inside OCR line to normalized sub-box."""
    if not text:
        return dict(box)
    start_ratio = span_start / max(1, len(text))
    end_ratio = (span_start + span_len) / max(1, len(text))
    partial = {
        "x": box["x"] + box["width"] * start_ratio,
        "y": box["y"],
        "width": box["width"] * max(0.04, end_ratio - start_ratio),
        "height": box["height"],
    }
    if span_start == 0 and span_len < full_target_len:
        char_w = partial["width"] / max(1, span_len)
        missing = min(full_target_len - span_len, 1)
        partial["x"] = max(0.0, partial["x"] - char_w * missing)
        partial["width"] = partial["width"] + char_w * missing
    return partial


def _box_iou(a: Dict[str, float], b: Dict[str, float]) -> float:
    ax2 = a["x"] + a["width"]
    ay2 = a["y"] + a["height"]
    bx2 = b["x"] + b["width"]
    by2 = b["y"] + b["height"]
    ix0 = max(a["x"], b["x"])
    iy0 = max(a["y"], b["y"])
    ix1 = min(ax2, bx2)
    iy1 = min(ay2, by2)
    if ix1 <= ix0 or iy1 <= iy0:
        return 0.0
    inter = (ix1 - ix0) * (iy1 - iy0)
    area_a = a["width"] * a["height"]
    area_b = b["width"] * b["height"]
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def _dedupe_text_boxes(
    boxes: List[Dict[str, float]],
    *,
    iou_threshold: float = 0.35,
) -> List[Dict[str, float]]:
    if len(boxes) <= 1:
        return boxes
    ordered = sorted(boxes, key=lambda b: (b["y"], b["x"]))
    kept: List[Dict[str, float]] = []
    for box in ordered:
        if any(_box_iou(box, prev) > iou_threshold for prev in kept):
            continue
        kept.append(box)
    return kept


def _validate_text_removal_boxes(
    boxes: List[Dict[str, float]],
    *,
    max_single_ratio: float = 0.12,
    max_total_ratio: float = 0.35,
) -> List[Dict[str, float]]:
    """Reject oversized boxes that would trigger whole-image redraw."""
    valid: List[Dict[str, float]] = []
    total_area = 0.0
    for box in boxes:
        area = float(box["width"]) * float(box["height"])
        if area <= 0:
            continue
        if area > max_single_ratio:
            logger.warning("[ImageEdit] skip oversized text box area=%.3f", area)
            continue
        if box["width"] > 0.92 or box["height"] > 0.35:
            logger.warning("[ImageEdit] skip full-width/height text box")
            continue
        valid.append(box)
        total_area += area
    if total_area > max_total_ratio:
        logger.warning("[ImageEdit] total text box area too large: %.3f", total_area)
        return []
    return valid


def _merge_normalized_boxes(boxes: List[Dict[str, float]]) -> List[Dict[str, float]]:
    if not boxes:
        return []
    x0 = min(b["x"] for b in boxes)
    y0 = min(b["y"] for b in boxes)
    x1 = max(b["x"] + b["width"] for b in boxes)
    y1 = max(b["y"] + b["height"] for b in boxes)
    return [{"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0}]


def _locate_target_in_ocr_blocks(
    blocks: List[Dict[str, Any]],
    target_text: str,
    *,
    include_aliases: bool = False,
) -> List[Dict[str, float]]:
    """Find all normalized bboxes for every occurrence of target_text."""
    target = (target_text or "").strip()
    if not target or not blocks:
        return []

    search_targets = _expand_search_targets(target, include_aliases=include_aliases)
    matched: List[Dict[str, float]] = []

    for block in blocks:
        text = block.get("text") or ""
        for alias in search_targets:
            span = _resolve_target_span(text, alias)
            if span is None:
                continue
            start, length = span
            matched.append(
                _box_from_span(
                    text,
                    start,
                    length,
                    block,
                    full_target_len=max(len(alias), len(target)),
                )
            )
            break

    if matched:
        return _dedupe_text_boxes(matched)

    ordered = sorted(blocks, key=lambda b: (b.get("y", 0.0), b.get("x", 0.0)))
    for alias in search_targets:
        combined = "".join(b.get("text") or "" for b in ordered)
        idx = combined.find(alias)
        norm_combined = _normalize_match_text(combined)
        norm_alias = _normalize_match_text(alias)
        if idx < 0 and norm_alias:
            idx = norm_combined.find(norm_alias)
        if idx < 0:
            continue
        match_len = len(alias) if alias in combined else len(norm_alias)
        end = idx + match_len
        cursor = 0
        hit_blocks: List[Dict[str, Any]] = []
        for block in ordered:
            text = block.get("text") or ""
            block_start = cursor
            block_end = cursor + len(text)
            if block_end > idx and block_start < end:
                hit_blocks.append(block)
            cursor = block_end
        if not hit_blocks:
            continue
        if len(hit_blocks) == 1:
            only = hit_blocks[0]
            text = only.get("text") or ""
            span = _resolve_target_span(text, alias)
            if span:
                start, length = span
                matched.append(
                    _box_from_span(text, start, length, only, full_target_len=len(alias))
                )
            else:
                matched.append(_merge_normalized_boxes([only])[0])
        else:
            matched.extend(_merge_normalized_boxes(hit_blocks))

    return _dedupe_text_boxes(matched)


def _estimate_partial_box(text: str, target: str, box: Dict[str, float]) -> Dict[str, float]:
    """Estimate a sub-box when target is only part of an OCR line."""
    span = _resolve_target_span(text, target)
    if span is None:
        return dict(box)
    start, length = span
    return _box_from_span(text, start, length, box, full_target_len=len(target))


def _vision_locate_text_boxes(image_path: str, target_text: str) -> List[Dict[str, float]]:
    """Vision-model fallback when OCR service is unavailable."""
    import json

    from core.llm_provider import (
        default_vision_model_for_provider,
        get_api_key,
        get_provider_id,
        get_vision_model,
        is_vision_capable_model,
    )

    provider_id = get_provider_id()
    api_key = get_api_key(provider_id)
    if not api_key:
        return []

    model = get_vision_model(provider_id)
    if not is_vision_capable_model(model):
        model = default_vision_model_for_provider(provider_id)

    data, mime = _read_bytes_from_local_path(image_path)
    b64 = base64.b64encode(data).decode("ascii")
    data_uri = f"data:{mime};base64,{b64}"
    prompt = (
        f"在图片中找到所有包含文字「{target_text}」或其英文/拼音变体的区域（每一处都要列出）。"
        "仅返回 JSON：{\"regions\":[{\"x\":0.0,\"y\":0.0,\"width\":0.0,\"height\":0.0}]}。"
        "x/y 为左上角，width/height 为宽高，均为相对图片宽高的 0~1 小数。"
        "若无匹配返回 {\"regions\":[]}。"
    )

    try:
        from openai import OpenAI
        from core.llm_provider import get_provider_config

        cfg = get_provider_config()
        client = OpenAI(api_key=api_key, base_url=cfg.base_url)
        resp = client.chat.completions.create(
            model=model,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": data_uri}},
                    {"type": "text", "text": prompt},
                ],
            }],
            max_tokens=400,
            temperature=0,
        )
        raw = (resp.choices[0].message.content or "").strip()
        start = raw.find("{")
        end = raw.rfind("}")
        if start < 0 or end <= start:
            return []
        payload = json.loads(raw[start:end + 1])
        regions = payload.get("regions") or []
        out: List[Dict[str, float]] = []
        for region in regions:
            if not isinstance(region, dict):
                continue
            x = float(region.get("x", 0))
            y = float(region.get("y", 0))
            w = float(region.get("width", 0))
            h = float(region.get("height", 0))
            if w > 0 and h > 0:
                out.append({"x": x, "y": y, "width": w, "height": h})
        return out
    except Exception as exc:
        logger.warning("[ImageEdit] vision text locate failed: %s", exc)
        return []


def _render_text_removal_mask(
    width: int,
    height: int,
    boxes: List[Dict[str, float]],
    *,
    padding_ratio: float = 0.008,
) -> Image.Image:
    """Build L-mode mask: white = regions to inpaint."""
    mask = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(mask)
    pad_px = max(1, int(min(width, height) * 0.002))
    for box in boxes:
        px = max(0.0, box["x"] - box["width"] * padding_ratio)
        py = max(0.0, box["y"] - box["height"] * padding_ratio * 0.5)
        pw = min(1.0 - px, box["width"] * (1 + padding_ratio * 2))
        ph = min(1.0 - py, box["height"] * (1 + padding_ratio))
        x0 = int(px * width) - pad_px
        y0 = int(py * height) - pad_px
        x1 = int((px + pw) * width) + pad_px
        y1 = int((py + ph) * height) + pad_px
        draw.rectangle(
            [max(0, x0), max(0, y0), min(width, x1), min(height, y1)],
            fill=255,
        )
    return mask.filter(ImageFilter.GaussianBlur(1))


def _local_inpaint_rows(source: Image.Image, mask_l: Image.Image) -> Image.Image:
    """Row-wise gradient fill — safe fallback without generative AI."""
    import numpy as np

    arr = np.array(source.convert("RGB"))
    mask = np.array(mask_l.convert("L")) > 128
    if not mask.any():
        return source
    h, w = mask.shape
    ys = np.where(mask.any(axis=1))[0]
    if len(ys) == 0:
        return source
    for y in ys:
        cols = np.where(mask[y])[0]
        if len(cols) == 0:
            continue
        left_x = int(cols[0]) - 1
        while left_x >= 0 and mask[y, left_x]:
            left_x -= 1
        right_x = int(cols[-1]) + 1
        while right_x < w and mask[y, right_x]:
            right_x += 1
        if left_x < 0 or right_x >= w:
            up = y - 1
            while up >= 0 and mask[up, cols[0]]:
                up -= 1
            down = y + 1
            while down < h and mask[down, cols[0]]:
                down += 1
            if up >= 0 and down < h:
                up_color = arr[up, cols].mean(axis=0)
                down_color = arr[down, cols].mean(axis=0)
                for x in cols:
                    t = (y - up) / max(1, (down - up))
                    arr[y, x] = (up_color * (1 - t) + down_color * t).astype(np.uint8)
            continue
        left_color = arr[y, left_x].astype(np.float32)
        right_color = arr[y, right_x].astype(np.float32)
        for x in cols:
            t = (x - left_x) / max(1, (right_x - left_x))
            arr[y, x] = (left_color * (1 - t) + right_color * t).astype(np.uint8)
    return Image.fromarray(arr)


def _soft_blend_mask_edges(
    original: Image.Image,
    filled: Image.Image,
    mask_l: Image.Image,
    *,
    blur: int = 3,
) -> Image.Image:
    """Feather only the mask boundary so fills do not look like hard rectangles."""
    feather = mask_l.filter(ImageFilter.GaussianBlur(max(1, blur)))
    return Image.composite(filled.convert("RGB"), original.convert("RGB"), feather)


def _is_likely_foreground_text_pixel(rgb) -> bool:
    """Skip gold/white text when sampling background."""
    r, g, b = (float(rgb[0]), float(rgb[1]), float(rgb[2]))
    maxc = max(r, g, b)
    minc = min(r, g, b)
    if maxc < 80:
        return False
    return (maxc - minc) > 35 and maxc > 110


def _sample_background_along_row(arr, y: int, x: int, mask, direction: int):
    """Walk horizontally away from x until a non-mask, non-text pixel is found."""
    import numpy as np

    h, w = arr.shape[:2]
    cx = x
    for _ in range(48):
        cx += direction
        if cx < 0 or cx >= w:
            return None
        if mask[y, cx]:
            continue
        px = arr[y, cx]
        if _is_likely_foreground_text_pixel(px):
            continue
        return px.astype(np.float32)
    return None


def _sample_background_along_col(arr, x: int, y: int, mask, direction: int):
    """Walk vertically away from y until a non-mask, non-text pixel is found."""
    import numpy as np

    h, w = arr.shape[:2]
    cy = y
    for _ in range(48):
        cy += direction
        if cy < 0 or cy >= h:
            return None
        if mask[cy, x]:
            continue
        px = arr[cy, x]
        if _is_likely_foreground_text_pixel(px):
            continue
        return px.astype(np.float32)
    return None


def _add_local_texture_noise(
    original,
    filled,
    mask,
    *,
    ring: int = 8,
):
    """Match background grain from pixels around the mask."""
    import numpy as np

    h, w = mask.shape
    ring_pixels: list[np.ndarray] = []
    for y in range(h):
        y0 = max(0, y - ring)
        y1 = min(h, y + ring + 1)
        for x in range(w):
            if mask[y, x]:
                continue
            if mask[y0:y1, max(0, x - ring):min(w, x + ring + 1)].any():
                ring_pixels.append(original[y, x])
    if len(ring_pixels) < 12:
        return filled
    samples = np.stack(ring_pixels, axis=0)
    std = float(max(1.2, samples.std(axis=0).mean()))
    noise = np.random.default_rng(42).normal(0.0, std * 0.35, filled.shape)
    out = filled.astype(np.float32)
    out[mask] = np.clip(out[mask] + noise[mask], 0, 255)
    return out.astype(np.uint8)


def _local_inpaint_text_regions(source: Image.Image, mask_l: Image.Image) -> Image.Image:
    """Deterministic text removal — extrapolate background, never generative AI."""
    import numpy as np

    orig = np.array(source.convert("RGB"))
    arr = orig.astype(np.float32)
    mask = np.array(mask_l.convert("L")) > 128
    if not mask.any():
        return source

    h, w = arr.shape[:2]

    for x in range(w):
        col_ys = np.where(mask[:, x])[0]
        if len(col_ys) == 0:
            continue

        top_color = _sample_background_along_col(arr, x, int(col_ys[0]), mask, -1)
        bot_color = _sample_background_along_col(arr, x, int(col_ys[-1]), mask, 1)

        for y in col_ys:
            if top_color is not None and bot_color is not None:
                span = int(col_ys[-1]) - int(col_ys[0]) + 3
                t = (y - (int(col_ys[0]) - 1)) / max(1, span)
                arr[y, x] = top_color * (1.0 - t) + bot_color * t
            elif top_color is not None:
                arr[y, x] = top_color
            elif bot_color is not None:
                arr[y, x] = bot_color

    filled = _add_local_texture_noise(orig, arr.clip(0, 255).astype(np.uint8), mask)
    return _soft_blend_mask_edges(source, Image.fromarray(filled), mask_l, blur=2)


def _ensure_local_image_for_ocr(source_image_url: str) -> str:
    local = _local_path_from_url(source_image_url)
    if local and os.path.isfile(local):
        return local
    img = _load_rgba_image(source_image_url)
    return _save_temp_rgba_image(img, "ocr_src")


def _ocr_locate_text_boxes(
    image_path: str,
    target_text: str,
    *,
    include_aliases: bool = False,
) -> List[Dict[str, float]]:
    blocks = _fetch_ocr_blocks(image_path)
    boxes: List[Dict[str, float]] = []
    if blocks:
        boxes = _locate_target_in_ocr_blocks(
            blocks, target_text, include_aliases=include_aliases
        )
        boxes = _validate_text_removal_boxes(boxes)
        if boxes:
            logger.info(
                "[ImageEdit] OCR matched %d box(es) for %r blocks=%d",
                len(boxes),
                target_text,
                len(blocks),
            )
            return boxes
        logger.warning(
            "[ImageEdit] OCR found %d blocks but no match for %r: %s",
            len(blocks),
            target_text,
            [b.get("text", "")[:24] for b in blocks[:8]],
        )

    logger.info("[ImageEdit] OCR locate miss for %r, trying vision bbox", target_text)
    vision_boxes = _validate_text_removal_boxes(
        _vision_locate_text_boxes(image_path, target_text)
    )
    return vision_boxes


def _edit_watermark_by_text(
    *,
    source_image_url: str,
    target_text: str,
    user_prompt: str,
    model_id: str,
    n: int = 1,
    seed: Optional[int] = None,
    include_aliases: bool = False,
) -> Dict[str, Any]:
    """Locate target text via OCR and remove it with local inpaint (no generative AI)."""
    del model_id, n, seed, user_prompt  # local path only
    target = (target_text or "").strip()
    if not target:
        return {"success": False, "error": "请填写要去掉的水印文字"}

    try:
        image_path = _ensure_local_image_for_ocr(source_image_url)
        source_img = _load_rgba_image(source_image_url)
    except Exception as exc:
        return {"success": False, "error": f"无法读取原图: {exc}"}

    boxes = _ocr_locate_text_boxes(image_path, target, include_aliases=include_aliases)
    if not boxes:
        return {
            "success": False,
            "error": (
                f"未在图片中识别到包含「{target}」的文字。"
                "请检查输入是否正确，或改用「指定区域」手动涂抹水印位置。"
                "（若首次使用 OCR，请重启后端以加载 EasyOCR）"
            ),
        }

    mask_l = _render_text_removal_mask(source_img.width, source_img.height, boxes)
    coverage = _mask_coverage_ratio(mask_l)
    logger.info("[ImageEdit] watermark text mask coverage=%.1f%% boxes=%d", coverage * 100, len(boxes))
    if coverage > 0.55:
        return {
            "success": False,
            "error": "目标文字区域过大，请改用「指定区域」精确涂抹，或缩短要匹配的文字。",
        }

    try:
        result_img = _local_inpaint_text_regions(source_img, mask_l)
    except Exception as exc:
        logger.warning("[ImageEdit] local text inpaint failed: %s", exc, exc_info=True)
        return {"success": False, "error": f"本地文字修复失败: {exc}"}

    local_path = _save_output_rgba_image(result_img, "wm_text")
    fname = os.path.basename(local_path)
    url = f"/api/media/{fname}"
    return {
        "success": True,
        "local_path": local_path,
        "local_paths": [local_path],
        "urls": [url],
        "url": url,
        "model": "local-inpaint",
    }


def _watermark_dashscope_function(watermark_mode: str, mask_ref: str) -> str:
    wm = (watermark_mode or "auto").strip().lower()
    if mask_ref:
        return "description_edit_with_mask"
    if wm == "text":
        return "description_edit"
    return "remove_watermark"


def _resolve_prompt(mode: str, prompt: str) -> str:
    text = (prompt or "").strip()
    if text:
        return text
    return MODE_DEFAULT_PROMPTS.get(mode, "")


def _looks_like_add_subject_request(prompt: str) -> bool:
    text = (prompt or "").strip().lower()
    if not text:
        return False
    return any(term in text for term in ADD_SUBJECT_TERMS)


def _enhance_instruction_prompt(prompt: str) -> str:
    """Make object insertion prompts explicit enough for image-edit models."""
    text = (prompt or "").strip()
    if not _looks_like_add_subject_request(text):
        return text

    placement_hint = (
        "如果用户没有明确位置，请把新增主体放在画面下方偏右的前景空处，"
        "不要遮挡主要人物脸部、武器和关键动作。"
        if not any(term in text.lower() for term in PLACEMENT_TERMS)
        else "严格遵守用户描述的位置。"
    )
    ip_hint = (
        "若模型无法精确复现受保护角色名称，请生成用户所指角色的安全近似："
        "粉色卡通小猪、圆鼻子、红色小裙子、儿童动画风格。"
        if "小猪佩奇" in text or "peppa" in text.lower()
        else ""
    )

    parts = [
        "这是一项【新增主体】图片编辑任务，不是风格润色。",
        f"用户原始指令：{text}",
        "必须在原图中真实新增该主体，让它看起来属于原场景：有合理遮挡、阴影、透视、光照和色温。",
        placement_hint,
        "保持原图已有主体、构图、背景、人物身份和未提及区域不变。",
    ]
    if ip_hint:
        parts.append(ip_hint)
    return "\n".join(parts)


def validate_edit_request(
    mode: str,
    prompt: str,
    mask_image_url: str = "",
    reference_image_urls: Optional[List[str]] = None,
    reference_target: str = "",
    watermark_mode: str = "auto",
    watermark_text: str = "",
) -> Optional[str]:
    """Return error message if invalid, else None."""
    if mode not in VALID_MODES:
        return f"不支持的编辑模式: {mode}，可选: {', '.join(sorted(VALID_MODES))}"
    if _mode_requires_mask(mode) and not (mask_image_url or "").strip():
        return f"模式 '{mode}' 需要提供 mask_image_url（涂抹区域图）"
    if mode == "watermark":
        wm_mode = (watermark_mode or "auto").strip().lower()
        if wm_mode not in ("auto", "area", "text"):
            return "watermark_mode 可选: auto | area | text"
        if wm_mode == "area" and not (mask_image_url or "").strip():
            return "去水印「指定区域」模式需要先涂抹要去水印的区域"
        if wm_mode == "text" and not (watermark_text or prompt or "").strip():
            return "去水印「指定文字」模式需要填写要去掉的文字内容"
    if mode == "inpaint":
        inpaint_refs = [u.strip() for u in (reference_image_urls or []) if (u or "").strip()]
        if len(inpaint_refs) > 1:
            return "局部重绘的参考图替换最多支持 1 张参考图"
    if mode in MODES_REQUIRING_PROMPT and mode != "reference" and not (prompt or "").strip():
        if mode == "inpaint":
            refs = [u.strip() for u in (reference_image_urls or []) if (u or "").strip()]
            if refs:
                return None
        return f"模式 '{mode}' 需要提供 prompt 描述"
    if mode == "reference":
        refs = [u.strip() for u in (reference_image_urls or []) if (u or "").strip()]
        if not refs:
            return "模式 'reference' 需要至少 1 张参考图（reference_image_urls）"
        if len(refs) > MAX_REFERENCE_IMAGES:
            return (
                f"参考图模式最多支持 {MAX_REFERENCE_IMAGES} 张参考图"
                f"（图1 为原图，共最多 {MAX_WAN25_IMAGES} 张）"
            )
        if not (prompt or "").strip() and not (reference_target or "").strip():
            return "参考图模式需要提供编辑描述（prompt）或替换目标（reference_target）"
        return None
    return None


def _guess_mime(path: str) -> str:
    mime, _ = mimetypes.guess_type(path)
    return mime or "image/png"


def _read_bytes_from_local_path(path: str) -> Tuple[bytes, str]:
    with open(path, "rb") as f:
        data = f.read()
    return data, _guess_mime(path)


def _local_path_from_url(url: str) -> Optional[str]:
    """Resolve various URL/path forms to a local filesystem path."""
    url = (url or "").strip()
    if not url:
        return None

    if url.startswith("data:"):
        return None

    if url.startswith("http://") or url.startswith("https://"):
        # /uploads/ or /api/media/ in absolute URL
        for marker, base_dir in (
            ("/uploads/", UPLOAD_DIR),
            ("/api/media/", OUTPUT_DIR),
            ("/media/", OUTPUT_DIR),
        ):
            if marker in url:
                fname = url.split(marker, 1)[1].split("?")[0].split("#")[0]
                local = os.path.join(base_dir, os.path.basename(fname))
                if os.path.isfile(local):
                    return local
        return None

    if url.startswith("/api/media/"):
        fname = url.replace("/api/media/", "").split("?")[0]
        local = os.path.join(OUTPUT_DIR, os.path.basename(fname))
        return local if os.path.isfile(local) else None

    if url.startswith("/uploads/"):
        fname = url.replace("/uploads/", "").split("?")[0]
        local = os.path.join(UPLOAD_DIR, os.path.basename(fname))
        return local if os.path.isfile(local) else None

    if "storage/outputs/" in url.replace("\\", "/"):
        parts = re.split(r"storage[/\\]outputs[/\\]", url.replace("\\", "/"), maxsplit=1)
        if len(parts) == 2:
            fname = parts[1].split("?")[0].split("#")[0]
            local = os.path.join(OUTPUT_DIR, os.path.basename(fname))
            return local if os.path.isfile(local) else None

    if "storage/uploads/" in url.replace("\\", "/"):
        parts = re.split(r"storage[/\\]uploads[/\\]", url.replace("\\", "/"), maxsplit=1)
        if len(parts) == 2:
            fname = parts[1].split("?")[0].split("#")[0]
            local = os.path.join(UPLOAD_DIR, os.path.basename(fname))
            return local if os.path.isfile(local) else None

    if os.path.isabs(url) and os.path.isfile(url):
        return url

    rel = url.lstrip("./")
    for base in (OUTPUT_DIR, UPLOAD_DIR, PROJECT_ROOT):
        candidate = os.path.join(base, rel) if base != PROJECT_ROOT else os.path.join(PROJECT_ROOT, rel)
        if os.path.isfile(candidate):
            return candidate

    return None


def _to_data_uri(image_bytes: bytes, mime: str) -> str:
    b64 = base64.b64encode(image_bytes).decode("ascii")
    return f"data:{mime};base64,{b64}"


def resolve_image_reference(url: str) -> str:
    """
    Resolve image reference to DashScope-accepted form: data URI (preferred) or public URL.
    """
    url = (url or "").strip()
    if not url:
        raise ValueError("图片 URL 不能为空")

    if url.startswith("data:"):
        return url

    local = _local_path_from_url(url)
    if local:
        data, mime = _read_bytes_from_local_path(local)
        return _to_data_uri(data, mime)

    if url.startswith("http://") or url.startswith("https://"):
        try:
            with urllib.request.urlopen(url, timeout=30) as resp:
                data = resp.read()
                mime = resp.headers.get_content_type() if hasattr(resp, "headers") else "image/jpeg"
            if not mime or mime == "application/octet-stream":
                mime = _guess_mime(url)
            return _to_data_uri(data, mime)
        except Exception as exc:
            public_base = (os.getenv("PUBLIC_BACKEND_URL") or "").strip().rstrip("/")
            if public_base and not url.startswith(public_base):
                pass
            raise ValueError(f"无法读取图片 URL: {exc}") from exc

    raise ValueError(f"无法解析图片路径: {url}")


def _extract_edit_result_urls(output: Dict[str, Any]) -> list[str]:
    urls: list[str] = []
    for item in output.get("results") or []:
        if isinstance(item, dict) and item.get("url"):
            urls.append(str(item["url"]))
    if urls:
        return urls
    for choice in output.get("choices") or []:
        msg = choice.get("message") or {}
        for part in msg.get("content") or []:
            if isinstance(part, dict) and part.get("image"):
                u = part["image"]
                if isinstance(u, str) and u.startswith("http"):
                    urls.append(u)
    return urls


def _extract_edit_result_url(output: Dict[str, Any]) -> str:
    urls = _extract_edit_result_urls(output)
    return urls[0] if urls else ""


def _build_dashscope_edit_body(
    *,
    model_id: str,
    mode: str,
    prompt: str,
    source_ref: str,
    mask_ref: str = "",
    expand_top: float = 1.0,
    expand_bottom: float = 1.0,
    expand_left: float = 1.0,
    expand_right: float = 1.0,
    strength: float = 0.5,
    n: int = 1,
    seed: Optional[int] = None,
    upscale_factor: int = 2,
    is_sketch: bool = False,
    watermark_mode: str = "auto",
) -> Dict[str, Any]:
    function = MODE_TO_FUNCTION[mode]
    if mode == "watermark":
        function = _watermark_dashscope_function(watermark_mode, mask_ref)
    inp: Dict[str, Any] = {
        "function": function,
        "prompt": prompt,
        "base_image_url": source_ref,
    }
    if mode == "watermark" and mask_ref:
        inp["mask_image_url"] = mask_ref
    elif _mode_requires_mask(mode):
        inp["mask_image_url"] = mask_ref

    params: Dict[str, Any] = {"n": max(1, min(4, int(n or 1)))}
    if seed is not None:
        params["seed"] = int(seed)

    wm = (watermark_mode or "auto").strip().lower()
    if mode in MODES_WITH_STRENGTH or (mode == "watermark" and wm == "text"):
        params["strength"] = max(0.0, min(1.0, float(strength)))

    if mode == "outpaint":
        for key, val in (
            ("top_scale", expand_top),
            ("bottom_scale", expand_bottom),
            ("left_scale", expand_left),
            ("right_scale", expand_right),
        ):
            if val and float(val) > 1.0:
                params[key] = float(val)

    if mode == "upscale":
        params["upscale_factor"] = max(1, min(4, int(upscale_factor or 2)))

    if mode == "sketch":
        params["is_sketch"] = bool(is_sketch)

    return {"model": model_id, "input": inp, "parameters": params}


def _edit_via_dashscope(
    *,
    model_id: str,
    mode: str,
    prompt: str,
    source_image_url: str,
    mask_image_url: str = "",
    expand_top: float = 1.0,
    expand_bottom: float = 1.0,
    expand_left: float = 1.0,
    expand_right: float = 1.0,
    strength: float = 0.5,
    n: int = 1,
    seed: Optional[int] = None,
    upscale_factor: int = 2,
    is_sketch: bool = False,
    watermark_mode: str = "auto",
) -> Dict[str, Any]:
    source_ref = resolve_image_reference(source_image_url)
    mask_ref = resolve_image_reference(mask_image_url) if mask_image_url else ""
    edit_strength = strength
    if mode == "watermark":
        edit_strength = _resolve_watermark_edit_strength(watermark_mode, strength)

    body = _build_dashscope_edit_body(
        model_id=model_id,
        mode=mode,
        prompt=prompt,
        source_ref=source_ref,
        mask_ref=mask_ref,
        expand_top=expand_top,
        expand_bottom=expand_bottom,
        expand_left=expand_left,
        expand_right=expand_right,
        strength=edit_strength,
        n=n,
        seed=seed,
        upscale_factor=upscale_factor,
        is_sketch=is_sketch,
        watermark_mode=watermark_mode,
    )

    submit = dashscope_submit_async("services/aigc/image2image/image-synthesis", body)
    if not submit.get("ok"):
        return {"success": False, "error": submit.get("error", "DashScope 提交失败")}

    task_id = submit["task_id"]
    logger.info("[ImageEdit] DashScope task=%s mode=%s model=%s", task_id, mode, model_id)

    wait = dashscope_wait_task(task_id, label="wanx-image-edit", interval=3.0, max_wait=900)
    if not wait.get("ok"):
        return {"success": False, "error": wait.get("error", "DashScope 任务失败")}

    out = wait.get("output") or {}
    result_urls = _extract_edit_result_urls(out)
    if not result_urls:
        return {"success": False, "error": f"未返回图片 URL: {out}"}

    local_paths: list[str] = []
    for idx, result_url in enumerate(result_urls):
        suffix = f"_{idx + 1}" if len(result_urls) > 1 else ""
        local_path = download_file(result_url, f"{suffix}.png", "image")
        if local_path:
            local_paths.append(local_path)

    if not local_paths:
        return {"success": False, "error": "下载编辑结果失败"}

    return {
        "success": True,
        "url": result_urls[0],
        "urls": result_urls,
        "local_path": local_paths[0],
        "local_paths": local_paths,
        "model": model_id,
    }


def _edit_via_gemini_instruction(source_image_url: str, prompt: str) -> Dict[str, Any]:
    """Gemini multimodal fallback for instruction-only edits."""
    api_key = _get_provider_api_key("google")
    if not api_key:
        return {"success": False, "error": "未配置 GOOGLE_API_KEY，无法使用 Gemini 兜底"}

    from core.media_models import get_current_media_model

    selected = get_current_media_model("image")
    model_id = selected.get("model_id") or "gemini-2.0-flash-preview-image-generation"
    if "imagen" in model_id.lower():
        model_id = "gemini-2.0-flash-preview-image-generation"

    local = _local_path_from_url(source_image_url)
    if local:
        img_bytes, mime = _read_bytes_from_local_path(local)
    elif source_image_url.startswith("http"):
        with urllib.request.urlopen(source_image_url, timeout=30) as resp:
            img_bytes = resp.read()
            mime = resp.headers.get_content_type() or "image/jpeg"
    elif source_image_url.startswith("data:"):
        header, b64 = source_image_url.split(",", 1)
        mime = header.split(";")[0].replace("data:", "")
        img_bytes = base64.b64decode(b64)
    else:
        return {"success": False, "error": "Gemini 兜底无法解析源图"}

    b64 = base64.b64encode(img_bytes).decode("ascii")
    edit_prompt = (
        f"请根据以下指令编辑这张图片，保持未提及部分尽量不变，输出编辑后的完整图片。\n\n"
        f"编辑指令：{prompt}"
    )

    api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_id}:generateContent"
    resp = requests.post(
        api_url,
        headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
        json={
            "contents": [{
                "parts": [
                    {"text": edit_prompt},
                    {"inline_data": {"mime_type": mime, "data": b64}},
                ]
            }],
            "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]},
        },
        timeout=120,
    )
    if resp.status_code >= 400:
        return {"success": False, "error": f"Gemini HTTP {resp.status_code}: {resp.text[:300]}"}

    data = resp.json()
    from tools.image_tools import save_base64_image

    for candidate in data.get("candidates", []):
        for part in candidate.get("content", {}).get("parts", []):
            inline = part.get("inlineData") or part.get("inline_data")
            if inline and inline.get("data"):
                mt = inline.get("mimeType") or inline.get("mime_type") or "image/png"
                data_uri = f"data:{mt};base64,{inline['data']}"
                local_path = save_base64_image(data_uri, prompt)
                if local_path:
                    return {"success": True, "local_path": local_path, "model": model_id}

    return {"success": False, "error": "Gemini 未返回图片数据"}


def _load_image_bytes_for_gemini(source_image_url: str) -> Tuple[bytes, str]:
    local = _local_path_from_url(source_image_url)
    if local:
        return _read_bytes_from_local_path(local)
    if source_image_url.startswith("http"):
        with urllib.request.urlopen(source_image_url, timeout=30) as resp:
            img_bytes = resp.read()
            mime = resp.headers.get_content_type() or "image/jpeg"
        return img_bytes, mime
    if source_image_url.startswith("data:"):
        header, b64 = source_image_url.split(",", 1)
        mime = header.split(";")[0].replace("data:", "")
        return base64.b64decode(b64), mime
    raise ValueError("Gemini 兜底无法解析图片")


def _load_rgba_image(url: str) -> Image.Image:
    local = _local_path_from_url(url)
    if local and os.path.isfile(local):
        data, mime = _read_bytes_from_local_path(local)
    else:
        data, mime = _load_image_bytes_for_gemini(url)
    if len(data) < 64:
        raise ValueError(f"图片数据过小或无效: {url[:80]}")
    try:
        img = Image.open(io.BytesIO(data)).convert("RGBA")
    except Exception as exc:
        raise ValueError(f"无法解析图片 ({mime}): {exc}") from exc
    if img.width < 2 or img.height < 2:
        raise ValueError("图片尺寸无效")
    return img


def _mask_luminance(mask: Image.Image, size: Tuple[int, int]) -> Image.Image:
    """Normalize mask to binary L: white/opaque = replace region."""
    m = mask.resize(size, Image.Resampling.NEAREST)
    if m.mode == "L":
        lum = m
    else:
        rgb = m.convert("RGB")
        r, g, b = rgb.split()
        lum = ImageChops.lighter(ImageChops.lighter(r, g), b)
    return lum.point(lambda p: 255 if p > 16 else 0, mode="L")


def _save_output_rgba_image(image: Image.Image, prefix: str = "inpaint_replace") -> str:
    """Save final edit result under storage/outputs."""
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    filename = f"{prefix}_{uuid.uuid4().hex[:10]}.png"
    filepath = os.path.join(OUTPUT_DIR, filename)
    image.convert("RGB").save(filepath, "PNG", optimize=True)
    logger.info("[ImageEdit] saved output: %s", filepath)
    return filepath


def _build_edge_blend_mask(mask_l: Image.Image, *, band: int = 12) -> Image.Image:
    """White ring around mask boundary for optional edge-only AI blend."""
    from PIL import ImageChops

    band = max(4, min(32, int(band)))
    size = max(3, band | 1)
    dilated = mask_l.filter(ImageFilter.MaxFilter(size))
    eroded = mask_l.filter(ImageFilter.MinFilter(size))
    edge = ImageChops.subtract(dilated, eroded)
    if edge.getbbox() is None:
        return mask_l.filter(ImageFilter.GaussianBlur(4))
    return edge


def _save_temp_rgba_image(image: Image.Image, prefix: str = "inpaint_comp") -> str:
    os.makedirs(TEMP_DIR, exist_ok=True)
    path = os.path.join(TEMP_DIR, f"{prefix}_{uuid.uuid4().hex[:10]}.png")
    image.convert("RGBA").save(path, "PNG")
    return path


def _mask_coverage_ratio(mask_l: Image.Image) -> float:
    pixels = list(mask_l.getdata())
    if not pixels:
        return 0.0
    white = sum(1 for p in pixels if p > 128)
    return white / len(pixels)


def _fit_reference_in_bbox(
    reference: Image.Image,
    box_w: int,
    box_h: int,
    *,
    fit_mode: str = "contain",
) -> Image.Image:
    """
    Scale/crop reference to fit the mask bounding box.
    - contain: full reference visible, letterboxed inside bbox (preserve aspect)
    - cover: fill bbox, crop overflow (preserve aspect)
    """
    ref = reference.convert("RGBA")
    rw, rh = ref.size
    box_w = max(1, box_w)
    box_h = max(1, box_h)
    if fit_mode == "cover":
        fitted = ImageOps.fit(ref, (box_w, box_h), method=Image.Resampling.LANCZOS)
        return fitted.convert("RGBA")

    scale = min(box_w / rw, box_h / rh)
    new_w = max(1, round(rw * scale))
    new_h = max(1, round(rh * scale))
    ref_scaled = ref.resize((new_w, new_h), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (box_w, box_h), (0, 0, 0, 0))
    ox = (box_w - new_w) // 2
    oy = (box_h - new_h) // 2
    canvas.paste(ref_scaled, (ox, oy))
    return canvas


def composite_reference_into_mask(
    source: Image.Image,
    mask: Image.Image,
    reference: Image.Image,
    *,
    feather: int = 4,
    fit_mode: str = "contain",
    max_coverage: float = 0.72,
) -> Image.Image:
    """Paste reference into source, scaled to mask bbox and clipped by mask shape."""
    source_rgba = source.convert("RGBA")
    width, height = source_rgba.size
    mask_bin = _mask_luminance(mask, (width, height))
    bbox = mask_bin.getbbox()
    if not bbox:
        raise ValueError("蒙版为空，请先涂抹要替换的区域")

    coverage = _mask_coverage_ratio(mask_bin)
    x0, y0, x1, y1 = bbox
    box_w = max(1, x1 - x0)
    box_h = max(1, y1 - y0)
    logger.info(
        "[ImageEdit] mask bbox=%s coverage=%.1f%% fit=%s box=%sx%s source=%sx%s",
        bbox,
        coverage * 100,
        fit_mode,
        box_w,
        box_h,
        width,
        height,
    )
    if coverage > max_coverage:
        raise ValueError(
            f"蒙版覆盖面积过大（{coverage * 100:.0f}%），请只涂抹需要替换的局部区域"
        )

    ref_box = _fit_reference_in_bbox(
        reference,
        box_w,
        box_h,
        fit_mode=fit_mode,
    )

    ref_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    ref_layer.paste(ref_box, (x0, y0), ref_box if fit_mode == "contain" else None)

    blend_mask = mask_bin
    if feather > 0:
        blend_mask = mask_bin.filter(ImageFilter.GaussianBlur(max(1, feather)))

    if fit_mode == "contain":
        ref_alpha = ref_layer.split()[3]
        blend_mask = ImageChops.multiply(blend_mask, ref_alpha)

    out = Image.composite(ref_layer, source_rgba, blend_mask)

    if not _composite_has_changes(source_rgba, out, mask_bin):
        raise ValueError("参考图未能贴入选区，请检查蒙版是否覆盖目标区域")

    return out


def _composite_has_changes(
    before: Image.Image,
    after: Image.Image,
    mask_l: Image.Image,
    *,
    min_mean_diff: float = 12.0,
) -> bool:
    """Sample masked pixels to verify paste actually changed the image."""
    before_rgb = before.convert("RGB")
    after_rgb = after.convert("RGB")
    w, h = mask_l.size
    step = max(1, min(w, h) // 64)
    diffs: list[float] = []
    for y in range(0, h, step):
        for x in range(0, w, step):
            if mask_l.getpixel((x, y)) < 128:
                continue
            p0 = before_rgb.getpixel((x, y))
            p1 = after_rgb.getpixel((x, y))
            diffs.append(sum(abs(a - b) for a, b in zip(p0, p1)) / 3.0)
    if not diffs:
        return False
    return sum(diffs) / len(diffs) >= min_mean_diff


def _edit_via_gemini_inpaint_composite(
    *,
    composite_image_url: str,
    mask_image_url: str,
    prompt: str,
) -> Dict[str, Any]:
    """Gemini refine: composite (with pasted ref) + mask."""
    api_key = _get_provider_api_key("google")
    if not api_key:
        return {"success": False, "error": "未配置 GOOGLE_API_KEY"}

    from core.media_models import get_current_media_model

    selected = get_current_media_model("image")
    model_id = selected.get("model_id") or "gemini-2.0-flash-preview-image-generation"
    if "imagen" in model_id.lower():
        model_id = "gemini-2.0-flash-preview-image-generation"

    edit_prompt = prompt or compose_inpaint_reference_prompt()
    parts: list[Dict[str, Any]] = [{"text": edit_prompt}]
    try:
        for url in [composite_image_url, mask_image_url]:
            img_bytes, mime = _load_image_bytes_for_gemini(url)
            b64 = base64.b64encode(img_bytes).decode("ascii")
            parts.append({"inline_data": {"mime_type": mime, "data": b64}})
    except ValueError as exc:
        return {"success": False, "error": str(exc)}

    api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_id}:generateContent"
    resp = requests.post(
        api_url,
        headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
        json={
            "contents": [{"parts": parts}],
            "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]},
        },
        timeout=180,
    )
    if resp.status_code >= 400:
        return {"success": False, "error": f"Gemini HTTP {resp.status_code}: {resp.text[:300]}"}

    data = resp.json()
    from tools.image_tools import save_base64_image

    for candidate in data.get("candidates", []):
        for part in candidate.get("content", {}).get("parts", []):
            inline = part.get("inlineData") or part.get("inline_data")
            if inline and inline.get("data"):
                mt = inline.get("mimeType") or inline.get("mime_type") or "image/png"
                data_uri = f"data:{mt};base64,{inline['data']}"
                local_path = save_base64_image(data_uri, edit_prompt[:80])
                if local_path:
                    return {"success": True, "local_path": local_path, "model": model_id}

    return {"success": False, "error": "Gemini 未返回图片数据"}


def compose_inpaint_edge_blend_prompt(user_prompt: str = "") -> str:
    parts = [
        "图1 已完成局部贴图。图2 白色区域仅为贴图边缘过渡带。",
        "仅在白色边缘带内做轻微融合，消除接缝；贴图主体与原图其他区域必须保持不动，"
        "禁止添加文字、乱码或任何新物体。",
    ]
    if (user_prompt or "").strip():
        parts.append(f"补充：{user_prompt.strip()}")
    return "\n".join(parts)


def _edit_inpaint_reference_replace(
    *,
    source_image_url: str,
    mask_image_url: str,
    reference_image_urls: List[str],
    user_prompt: str,
    model_id: str,
    n: int = 1,
    seed: Optional[int] = None,
    strength: float = 0.5,
    ai_blend: bool = False,
) -> Dict[str, Any]:
    """
    Local reference replace: paste reference into mask (deterministic), optional edge AI blend.
    """
    ref_url = reference_image_urls[0]

    try:
        source_img = _load_rgba_image(source_image_url)
        mask_img = _load_rgba_image(mask_image_url)
        ref_img = _load_rgba_image(ref_url)
        logger.info(
            "[ImageEdit] inpaint ref paste dims source=%sx%s mask=%sx%s ref=%sx%s",
            source_img.width,
            source_img.height,
            mask_img.width,
            mask_img.height,
            ref_img.width,
            ref_img.height,
        )
        composite = composite_reference_into_mask(
            source_img,
            mask_img,
            ref_img,
            feather=2,
            fit_mode="contain",
        )
        mask_l = _mask_luminance(mask_img, source_img.size)
        out_path = _save_output_rgba_image(composite)
        logger.info("[ImageEdit] inpaint ref direct paste: %s", out_path)
    except Exception as exc:
        logger.warning("[ImageEdit] composite failed: %s", exc, exc_info=True)
        return {"success": False, "error": f"参考图贴入失败: {exc}"}

    if not ai_blend:
        return {
            "success": True,
            "local_path": out_path,
            "local_paths": [out_path],
            "url": "",
            "urls": [],
            "model": "local-paste",
        }

    edge_mask_path = _save_temp_rgba_image(
        _build_edge_blend_mask(mask_l).convert("RGBA"),
        prefix="inpaint_edge",
    )
    edge_prompt = compose_inpaint_edge_blend_prompt(user_prompt)

    if _get_provider_api_key("google"):
        result = _edit_via_gemini_inpaint_composite(
            composite_image_url=out_path,
            mask_image_url=edge_mask_path,
            prompt=edge_prompt,
        )
        if result.get("success") and result.get("local_path"):
            try:
                gemini_img = Image.open(result["local_path"]).convert("RGBA")
                if _composite_has_changes(composite, gemini_img, mask_l, min_mean_diff=4.0):
                    return result
                logger.warning("[ImageEdit] Gemini edge blend unchanged, using paste result")
            except Exception as exc:
                logger.warning("[ImageEdit] Gemini result verify failed: %s", exc)
        else:
            logger.warning("[ImageEdit] Gemini edge blend failed: %s", result.get("error"))

    # AI blend failed or unavailable — still return clean paste result
    return {
        "success": True,
        "local_path": out_path,
        "local_paths": [out_path],
        "url": "",
        "urls": [],
        "model": "local-paste",
    }


def _build_wan25_reference_body(
    *,
    prompt: str,
    source_ref: str,
    reference_refs: List[str],
    n: int = 1,
    seed: Optional[int] = None,
) -> Dict[str, Any]:
    images = [source_ref] + list(reference_refs)
    params: Dict[str, Any] = {"n": max(1, min(4, int(n or 1)))}
    if seed is not None:
        params["seed"] = int(seed)
    return {
        "model": WAN25_I2I_MODEL,
        "input": {
            "prompt": prompt,
            "images": images[:MAX_WAN25_IMAGES],
        },
        "parameters": params,
    }


def _edit_via_wan25_reference(
    *,
    prompt: str,
    source_image_url: str,
    reference_image_urls: List[str],
    n: int = 1,
    seed: Optional[int] = None,
) -> Dict[str, Any]:
    source_ref = resolve_image_reference(source_image_url)
    reference_refs = [
        resolve_image_reference(url)
        for url in reference_image_urls[:MAX_REFERENCE_IMAGES]
    ]

    body = _build_wan25_reference_body(
        prompt=prompt,
        source_ref=source_ref,
        reference_refs=reference_refs,
        n=n,
        seed=seed,
    )

    submit = dashscope_submit_async("services/aigc/image2image/image-synthesis", body)
    if not submit.get("ok"):
        return {"success": False, "error": submit.get("error", "DashScope 提交失败")}

    task_id = submit["task_id"]
    logger.info(
        "[ImageEdit] Wan25 reference task=%s refs=%s",
        task_id,
        len(reference_refs),
    )

    wait = dashscope_wait_task(task_id, label="wan25-i2i-reference", interval=3.0, max_wait=900)
    if not wait.get("ok"):
        return {"success": False, "error": wait.get("error", "DashScope 任务失败")}

    out = wait.get("output") or {}
    result_urls = _extract_edit_result_urls(out)
    if not result_urls:
        return {"success": False, "error": f"未返回图片 URL: {out}"}

    local_paths: list[str] = []
    for idx, result_url in enumerate(result_urls):
        suffix = f"_{idx + 1}" if len(result_urls) > 1 else ""
        local_path = download_file(result_url, f"{suffix}.png", "image")
        if local_path:
            local_paths.append(local_path)

    if not local_paths:
        return {"success": False, "error": "下载编辑结果失败"}

    return {
        "success": True,
        "url": result_urls[0],
        "urls": result_urls,
        "local_path": local_paths[0],
        "local_paths": local_paths,
        "model": WAN25_I2I_MODEL,
    }


def _edit_via_gemini_reference(
    source_image_url: str,
    reference_image_urls: List[str],
    prompt: str,
) -> Dict[str, Any]:
    """Gemini multimodal fallback for reference-based edits."""
    api_key = _get_provider_api_key("google")
    if not api_key:
        return {"success": False, "error": "未配置 GOOGLE_API_KEY，无法使用 Gemini 兜底"}

    from core.media_models import get_current_media_model

    selected = get_current_media_model("image")
    model_id = selected.get("model_id") or "gemini-2.0-flash-preview-image-generation"
    if "imagen" in model_id.lower():
        model_id = "gemini-2.0-flash-preview-image-generation"

    ref_labels = "、".join(f"图{i + 2}" for i in range(len(reference_image_urls)))
    edit_prompt = (
        f"图1 是待编辑的原图，{ref_labels} 是参考图。\n"
        f"{prompt}\n\n"
        f"请输出编辑后的完整图片。"
    )

    parts: list[Dict[str, Any]] = [{"text": edit_prompt}]
    try:
        for url in [source_image_url, *reference_image_urls]:
            img_bytes, mime = _load_image_bytes_for_gemini(url)
            b64 = base64.b64encode(img_bytes).decode("ascii")
            parts.append({"inline_data": {"mime_type": mime, "data": b64}})
    except ValueError as exc:
        return {"success": False, "error": str(exc)}

    api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_id}:generateContent"
    resp = requests.post(
        api_url,
        headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
        json={
            "contents": [{"parts": parts}],
            "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]},
        },
        timeout=180,
    )
    if resp.status_code >= 400:
        return {"success": False, "error": f"Gemini HTTP {resp.status_code}: {resp.text[:300]}"}

    data = resp.json()
    from tools.image_tools import save_base64_image

    for candidate in data.get("candidates", []):
        for part in candidate.get("content", {}).get("parts", []):
            inline = part.get("inlineData") or part.get("inline_data")
            if inline and inline.get("data"):
                mt = inline.get("mimeType") or inline.get("mime_type") or "image/png"
                data_uri = f"data:{mt};base64,{inline['data']}"
                local_path = save_base64_image(data_uri, prompt)
                if local_path:
                    return {"success": True, "local_path": local_path, "model": model_id}

    return {"success": False, "error": "Gemini 未返回图片数据"}


def _format_edit_success_text(
    *,
    mode: str,
    provider_name: str,
    model_used: str,
    local_paths: list[str],
    urls: list[str],
) -> str:
    lines = [
        "✅ 图片编辑成功！",
        "",
        f"**模式:** {mode}",
        f"**供应商:** {provider_name}",
        f"**Model:** {model_used}",
    ]
    if local_paths:
        lines.append("")
        for idx, local_path in enumerate(local_paths, start=1):
            display_path = f"./storage/outputs/{os.path.basename(local_path)}"
            prefix = f"**结果 {idx}:** " if len(local_paths) > 1 else "**本地路径:** "
            lines.append(f"{prefix}{display_path}")
            lines.append(f"**直接显示:** {local_path}")
    elif urls:
        lines.append("")
        for idx, url in enumerate(urls, start=1):
            prefix = f"**URL {idx}:** " if len(urls) > 1 else "**URL:** "
            lines.append(f"{prefix}{url}")
    return "\n".join(lines)


def run_image_edit(
    *,
    source_image_url: str,
    prompt: str = "",
    mode: str = "instruction",
    mask_image_url: str = "",
    reference_image_urls: Optional[List[str]] = None,
    reference_intent: str = "replace_material",
    reference_target: str = "",
    reference_roles: Optional[List[str]] = None,
    expand_top: float = 1.0,
    expand_bottom: float = 1.0,
    expand_left: float = 1.0,
    expand_right: float = 1.0,
    strength: float = 0.5,
    n: int = 1,
    seed: Optional[int] = None,
    upscale_factor: int = 2,
    is_sketch: bool = False,
    inpaint_ai_blend: bool = False,
    watermark_mode: str = "auto",
    watermark_text: str = "",
    watermark_text_include_aliases: bool = False,
) -> Dict[str, Any]:
    """Run image edit and return structured result for API callers."""
    from core.media_models import get_current_media_model

    mode = (mode or "instruction").strip().lower()
    user_prompt = (prompt or "").strip()
    refs = [u.strip() for u in (reference_image_urls or []) if (u or "").strip()]
    wm_mode = (watermark_mode or "auto").strip().lower()
    wm_text = (watermark_text or "").strip()
    wm_aliases = bool(watermark_text_include_aliases)

    if mode == "watermark":
        wm_mode, wm_text, user_prompt, wm_aliases = _resolve_watermark_routing(
            wm_mode,
            wm_text,
            user_prompt,
            mask_image_url,
            include_aliases=wm_aliases,
        )

    err = validate_edit_request(
        mode,
        user_prompt,
        mask_image_url,
        refs,
        reference_target,
        wm_mode,
        wm_text,
    )
    if err:
        return {"success": False, "error": err}

    if mode == "watermark":
        prompt = compose_watermark_prompt(
            user_prompt,
            target_text=wm_text,
            watermark_mode=wm_mode,
        )
    else:
        prompt = _resolve_prompt(mode, user_prompt)
        if mode == "instruction":
            prompt = _enhance_instruction_prompt(prompt)
            if _looks_like_add_subject_request(user_prompt):
                strength = max(float(strength or 0.5), 0.86)

    effective_prompt = prompt
    if mode == "reference":
        effective_prompt = compose_reference_prompt(
            intent=reference_intent,
            user_prompt=prompt,
            reference_target=reference_target,
            reference_roles=reference_roles,
            ref_count=len(refs),
        )
        prompt = effective_prompt

    selected = get_current_media_model("image_edit")
    model_id = selected.get("model_id") or "wanx2.1-imageedit"
    model_name = selected.get("name") or model_id
    provider_name = selected.get("provider") or "alibaba"

    logger.info(
        "[ImageEdit] mode=%s model=%s source=%s prompt=%s n=%s refs=%s intent=%s wm=%s",
        mode,
        model_id,
        source_image_url[:80],
        prompt[:80],
        n,
        len(refs),
        reference_intent if mode == "reference" else "-",
        wm_mode if mode == "watermark" else "-",
    )

    result: Dict[str, Any] = {"success": False, "error": "unknown"}

    if mode == "watermark" and wm_mode == "text":
        result = _edit_watermark_by_text(
            source_image_url=source_image_url,
            target_text=wm_text,
            user_prompt=user_prompt,
            model_id=model_id,
            n=n,
            seed=seed,
            include_aliases=wm_aliases,
        )
        model_name = result.get("model", "local-inpaint")
        provider_name = "local" if model_name == "local-inpaint" else "alibaba"
    elif mode == "inpaint" and refs:
        logger.info("[ImageEdit] inpaint reference replace refs=%s", len(refs))
        result = _edit_inpaint_reference_replace(
            source_image_url=source_image_url,
            mask_image_url=mask_image_url,
            reference_image_urls=refs[:1],
            user_prompt=prompt,
            model_id=model_id,
            n=n,
            seed=seed,
            strength=strength,
            ai_blend=inpaint_ai_blend,
        )
        model_name = result.get("model", model_id)
        if result.get("model") == "local-paste":
            provider_name = "local"
        else:
            provider_name = "google" if "gemini" in str(result.get("model", "")).lower() else "alibaba"
    elif mode in WAN25_ONLY_MODES:
        if _get_provider_api_key("alibaba"):
            try:
                result = _edit_via_wan25_reference(
                    prompt=prompt,
                    source_image_url=source_image_url,
                    reference_image_urls=refs,
                    n=n,
                    seed=seed,
                )
            except Exception as exc:
                logger.warning("[ImageEdit] Wan25 reference failed: %s", exc, exc_info=True)
                result = {"success": False, "error": str(exc)}
        if not result.get("success"):
            logger.info("[ImageEdit] Falling back to Gemini for reference mode")
            result = _edit_via_gemini_reference(source_image_url, refs, prompt)
            if result.get("success") and result.get("local_path"):
                result["local_paths"] = [result["local_path"]]
                result["urls"] = [result.get("url", "")]
        model_name = result.get("model", WAN25_I2I_MODEL)
        provider_name = "alibaba" if result.get("model") == WAN25_I2I_MODEL else "google"
    elif selected.get("available", True) and _get_provider_api_key("alibaba"):
        try:
            result = _edit_via_dashscope(
                model_id=model_id,
                mode=mode,
                prompt=prompt,
                source_image_url=source_image_url,
                mask_image_url=mask_image_url,
                expand_top=expand_top,
                expand_bottom=expand_bottom,
                expand_left=expand_left,
                expand_right=expand_right,
                strength=strength,
                n=n,
                seed=seed,
                upscale_factor=upscale_factor,
                is_sketch=is_sketch,
                watermark_mode=wm_mode if mode == "watermark" else "auto",
            )
        except Exception as exc:
            logger.warning("[ImageEdit] DashScope failed: %s", exc, exc_info=True)
            result = {"success": False, "error": str(exc)}

        if not result.get("success") and mode == "instruction":
            logger.info("[ImageEdit] Falling back to Gemini for instruction mode")
            result = _edit_via_gemini_instruction(source_image_url, prompt)
            if result.get("success") and result.get("local_path"):
                result["local_paths"] = [result["local_path"]]
                result["urls"] = [result.get("url", "")]

    if not result.get("success"):
        return {
            "success": False,
            "error": result.get("error", "unknown"),
            "mode": mode,
            "model": model_name,
        }

    local_paths = list(result.get("local_paths") or [])
    if not local_paths and result.get("local_path"):
        local_paths = [result["local_path"]]
    urls = list(result.get("urls") or [])
    if not urls and result.get("url"):
        urls = [result["url"]]
    model_used = result.get("model", model_name)

    try:
        save_generation_to_memory(prompt or mode, urls[0] if urls else local_paths[0], "image_edit")
    except Exception as mem_err:
        logger.warning("Failed to save edit to memory: %s", mem_err)

    text = _format_edit_success_text(
        mode=mode,
        provider_name=provider_name,
        model_used=model_used,
        local_paths=local_paths,
        urls=urls,
    )
    return {
        "success": True,
        "result": text,
        "mode": mode,
        "model": model_used,
        "provider": provider_name,
        "local_paths": local_paths,
        "urls": urls,
    }


@tool
def edit_image(
    source_image_url: str,
    prompt: str = "",
    mode: str = "instruction",
    mask_image_url: str = "",
    reference_image_urls: Optional[List[str]] = None,
    reference_intent: str = "replace_material",
    reference_target: str = "",
    reference_roles: Optional[List[str]] = None,
    expand_top: float = 1.0,
    expand_bottom: float = 1.0,
    expand_left: float = 1.0,
    expand_right: float = 1.0,
    strength: float = 0.5,
    n: int = 1,
    seed: Optional[int] = None,
    upscale_factor: int = 2,
    is_sketch: bool = False,
) -> str:
    """
    精准编辑已有图片。支持多种模式:
    - instruction: 整图按文字指令修改
    - inpaint: 局部重绘（需 mask + prompt；可选 1 张参考图做局部图片替换）
    - remove: 移除涂抹区域（需 mask）
    - outpaint: 四向扩图
    - style_global / style_local: 全局/局部风格化
    - watermark: 去文字水印
    - upscale: 图像超分（upscale_factor 1-4）
    - colorize: 黑白上色
    - sketch: 线稿生图（is_sketch 表示输入是否已是线稿）
    - cartoon: 参考卡通形象生图
    - reference: 参考 1-2 张参考图编辑原图（图1=原图，图2起=参考）

    Args:
        source_image_url: 原图 URL 或 /api/media/ 路径
        prompt: 编辑描述
        mode: 见上方模式列表
        mask_image_url: 涂抹区域图（白=编辑区，黑=保留区）
        reference_image_urls: 参考图 URL 列表，仅 reference 模式（最多 2 张）
        expand_top/bottom/left/right: 扩图比例，仅 outpaint
        strength: 修改强度 0-1，instruction/style_global
        n: 生成张数 1-4
        seed: 随机种子（可选）
        upscale_factor: 放大倍数 1-4，仅 upscale
        is_sketch: 输入是否为线稿，仅 sketch
    """
    outcome = run_image_edit(
        source_image_url=source_image_url,
        prompt=prompt,
        mode=mode,
        mask_image_url=mask_image_url,
        reference_image_urls=reference_image_urls,
        reference_intent=reference_intent,
        reference_target=reference_target,
        reference_roles=reference_roles,
        expand_top=expand_top,
        expand_bottom=expand_bottom,
        expand_left=expand_left,
        expand_right=expand_right,
        strength=strength,
        n=n,
        seed=seed,
        upscale_factor=upscale_factor,
        is_sketch=is_sketch,
    )
    if not outcome.get("success"):
        model_name = outcome.get("model", "unknown")
        return f"❌ 图片编辑失败 ({model_name}): {outcome.get('error', 'unknown')}"
    return outcome["result"]


def save_mask_bytes(content: bytes, filename: str = "") -> str:
    """Save mask PNG to storage/temp and return absolute path."""
    os.makedirs(TEMP_DIR, exist_ok=True)
    name = filename or f"mask_{os.urandom(4).hex()}.png"
    if not name.endswith(".png"):
        name += ".png"
    path = os.path.join(TEMP_DIR, name)
    with open(path, "wb") as f:
        f.write(content)
    return path
