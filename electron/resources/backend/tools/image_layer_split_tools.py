"""Split images into block-based PSD layers: each text block and image element on its own layer."""
from __future__ import annotations

import json
import os
import re
import uuid
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from PIL import Image, ImageFilter

from tools.image_edit_tools import _local_path_from_url, _read_bytes_from_local_path
from tools.image_export_tools import _fit_to_canvas, _load_pil_image
from tools.media_common import OUTPUT_DIR, TEMP_DIR
from tools.psd_layout_utils import (
    detect_qr_regions,
    expand_relative_bbox,
    map_sub_bbox_to_canvas,
    pixel_bbox_to_relative,
    relative_bbox_to_pixels,
)
from utils.logger import setup_logger

logger = setup_logger("image_layer_split_tools")

MAX_LAYERS = 20
MIN_TEXT_AREA_RATIO = 0.0008
MIN_IMAGE_AREA_RATIO = 0.006
IOU_DEDUP_THRESHOLD = 0.55
OCR_TEXT_OVERRIDE_IOU = 0.40
QR_OVERRIDE_IOU = 0.35

FOREGROUND_LAYER_TYPES = frozenset({
    "image", "subject", "decoration", "overlay", "qr", "icon",
})

_REFINE_BBOX_PROMPT = """你是版面精修专家。图中高亮区域是海报的一个局部裁剪。
请识别该裁剪内目标元素（{element_type}：{name}）的精确外接矩形。

只返回 JSON：
{{
  "x": 0.05, "y": 0.10, "width": 0.80, "height": 0.35
}}

坐标相对本裁剪图 0~1，紧贴目标外沿，不要包含过多背景。"""


def _layout_vision_max_edge() -> int:
    raw = (os.getenv("PSD_LAYOUT_VISION_MAX_EDGE") or "1920").strip()
    try:
        return max(640, min(4096, int(raw)))
    except ValueError:
        return 1920

_IMAGE_BLOCK_PROMPT = """你是版面分析专家。请识别图中所有「非文字」的独立图片块，用于导出 PSD 图层。
图片块包括：照片、人物抠图、产品图、插图、Logo、图标、贴纸、装饰图形。

请返回 JSON（最多 {max_image_blocks} 个图片块 + 1 个背景）：
{{
  "blocks": [
    {{
      "name": "产品图",
      "type": "image",
      "x": 0.12, "y": 0.18, "width": 0.35, "height": 0.42,
      "z_order": 2,
      "description": "中央产品摄影"
    }}
  ]
}}

字段说明：
- type: background（仅 1 个，全图 0,0,1,1）| image
- x,y,width,height: 相对坐标 0~1，矩形紧贴图片块外沿（可留约 2% 边距）
- z_order: 层级，数字越小越靠底层（背景=0）

严格要求：
1. 每个独立图片/照片/Logo 必须单独成块，禁止合并多个图片
2. 不要框选任何文字区域（文字会由 OCR 单独处理）
3. 图片块之间尽量不重叠（IoU < 25%）
4. 坐标务必准确，不要过大或过小
5. 只返回 JSON"""

_VISION_LAYOUT_PROMPT = """你是平面设计稿解构专家（思路参考 LayerD ICCV 2025：语义图层分解）。
请理解整张海报的视觉语义，规划可编辑 PSD 图层（双扇/多区块广告要左右分开标注）。

返回 JSON（最多 {max_blocks} 个非背景块）：
{{
  "blocks": [
    {{
      "name": "左扇-品牌主标题",
      "type": "text",
      "role": "title",
      "x": 0.12, "y": 0.04, "width": 0.30, "height": 0.08,
      "z_order": 10,
      "description": "金色主标题文字块"
    }},
    {{
      "name": "左扇-二维码",
      "type": "qr",
      "role": "qr",
      "x": 0.42, "y": 0.78, "width": 0.12, "height": 0.12,
      "z_order": 50,
      "description": "完整方形二维码含白色静区"
    }},
    {{
      "name": "左扇-飞机主视觉",
      "type": "image",
      "role": "hero",
      "x": 0.55, "y": 0.05, "width": 0.35, "height": 0.22,
      "z_order": 5,
      "description": "顶部飞机摄影图"
    }}
  ]
}}

type 取值：background | text | image | qr | icon
role 取值：background | title | subtitle | price | body | footer | hero | decor | qr | icon

严格要求：
1. 每个语义完整的文字区域单独一层（品牌标题、英文名、价格条、空运/海运标题、服务卖点行、底部联系方式、扫码文案等分开）
2. 每个独立照片/产品图/飞机/货轮/卡车/火车/仓库场景/装饰线条 必须单独 image 层，禁止合并
3. 每个二维码必须完整方形（含四周白色静区），单独 qr 层，role=qr
4. 小圆形/方形服务图标单独 icon 层
5. 坐标 0~1，紧贴外沿：文字留 3% 边距，二维码留 8% 静区，照片留 2% 边距
6. 不要框选纯背景渐变区域
7. 只返回 JSON"""


@dataclass
class LayerSpec:
    name: str
    layer_type: str
    x: float
    y: float
    width: float
    height: float
    description: str = ""
    z_order: int = 10


@dataclass
class _OcrFragment:
    x0: float
    y0: float
    x1: float
    y1: float
    text: str

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2

    @property
    def width(self) -> float:
        return self.x1 - self.x0

    @property
    def height(self) -> float:
        return self.y1 - self.y0


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _display_layer_name(name: str, index: int) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|]', "_", (name or "").strip())
    return cleaned[:48] or f"图层 {index + 1}"


def _psd_layer_name(spec: LayerSpec, index: int) -> str:
    prefix = {
        "background": "Background",
        "image": "Image",
        "text": "Text",
        "subject": "Image",
        "decoration": "Image",
        "qr": "QR",
        "icon": "Icon",
    }.get(spec.layer_type, "Layer")
    return f"{prefix}_{index + 1:02d}"


def _normalize_block_type(raw: str) -> str:
    value = (raw or "").strip().lower()
    if value == "background":
        return "background"
    if value in {"text", "title", "caption", "label", "subtitle", "body", "footer", "price"}:
        return "text"
    if value in {"qr", "qrcode", "二维码"}:
        return "qr"
    if value in {"icon", "icons", "图标"}:
        return "icon"
    return "image"


def _box_area(spec: LayerSpec) -> float:
    return max(0.0, spec.width) * max(0.0, spec.height)


def _bbox_pixels(spec: LayerSpec, width: int, height: int) -> Tuple[int, int, int, int]:
    x0 = int(spec.x * width)
    y0 = int(spec.y * height)
    x1 = int((spec.x + spec.width) * width)
    y1 = int((spec.y + spec.height) * height)
    x0 = max(0, min(width - 1, x0))
    y0 = max(0, min(height - 1, y0))
    x1 = max(x0 + 1, min(width, x1))
    y1 = max(y0 + 1, min(height, y1))
    return x0, y0, x1, y1


def _box_iou(a: LayerSpec, b: LayerSpec) -> float:
    ax2, ay2 = a.x + a.width, a.y + a.height
    bx2, by2 = b.x + b.width, b.y + b.height
    ix0, iy0 = max(a.x, b.x), max(a.y, b.y)
    ix1, iy1 = min(ax2, bx2), min(ay2, by2)
    if ix1 <= ix0 or iy1 <= iy0:
        return 0.0
    inter = (ix1 - ix0) * (iy1 - iy0)
    union = _box_area(a) + _box_area(b) - inter
    return inter / union if union > 0 else 0.0


def _refine_bbox(
    x: float,
    y: float,
    w: float,
    h: float,
    *,
    layer_type: str,
) -> Tuple[float, float, float, float]:
    if layer_type == "background":
        return 0.0, 0.0, 1.0, 1.0

    if layer_type == "qr":
        pad_ratio_x = 0.08
        pad_ratio_y = 0.08
    elif layer_type == "image":
        pad_ratio_x = 0.03
        pad_ratio_y = 0.04
    else:
        pad_ratio_x = 0.02
        pad_ratio_y = 0.025
    pad_x = max(0.008, w * pad_ratio_x)
    pad_y = max(0.008, h * pad_ratio_y)

    nx = _clamp01(x - pad_x)
    ny = _clamp01(y - pad_y)
    nw = _clamp01(min(1.0 - nx, w + pad_x * 2))
    nh = _clamp01(min(1.0 - ny, h + pad_y * 2))
    return nx, ny, nw, nh


def _parse_vision_blocks(payload: Any) -> List[LayerSpec]:
    if not isinstance(payload, dict):
        return []
    raw_blocks = payload.get("blocks") or payload.get("layers") or []
    if not isinstance(raw_blocks, list):
        return []

    specs: List[LayerSpec] = []
    for item in raw_blocks:
        if not isinstance(item, dict):
            continue
        layer_type = _normalize_block_type(str(item.get("type") or "image"))
        x = _clamp01(item.get("x", 0))
        y = _clamp01(item.get("y", 0))
        w = _clamp01(item.get("width", 0))
        h = _clamp01(item.get("height", 0))
        if layer_type == "background":
            x, y, w, h = 0.0, 0.0, 1.0, 1.0
        elif w <= 0 or h <= 0:
            continue
        else:
            x, y, w, h = _refine_bbox(x, y, w, h, layer_type=layer_type)

        z_order = int(item.get("z_order", 10) or 10)
        specs.append(
            LayerSpec(
                name=str(item.get("name") or "").strip(),
                layer_type=layer_type,
                x=x,
                y=y,
                width=w,
                height=h,
                description=str(item.get("description") or "").strip(),
                z_order=z_order,
            )
        )
    return specs


def get_vision_layout_status() -> Dict[str, Any]:
    """Diagnostics for VLM layout (DashScope / Qwen-VL / etc.)."""
    from core.llm_provider import get_api_key, get_provider_id, resolve_vision_credentials

    provider_id, model, key, cfg = resolve_vision_credentials()
    dash_key = bool((os.getenv("DASHSCOPE_API_KEY") or "").strip())
    ali_key = bool((os.getenv("ALIBABA_API_KEY") or "").strip())
    vision_provider = (os.getenv("LLM_VISION_PROVIDER") or "").strip() or None
    vision_model_override = (os.getenv("LLM_VISION_MODEL") or "").strip() or None

    ready = bool(key)
    message = "视觉语义布局已就绪（通义 Qwen-VL）" if ready else (
        "未配置视觉 API Key：请设置 DASHSCOPE_API_KEY 或 ALIBABA_API_KEY，"
        "并可选设置 LLM_VISION_PROVIDER=alibaba、LLM_VISION_MODEL=qwen-vl-max"
    )
    return {
        "ready": ready,
        "provider": provider_id,
        "provider_name": cfg.name,
        "model": model,
        "base_url": cfg.base_url,
        "api_key_configured": ready,
        "dashscope_key": dash_key,
        "alibaba_key": ali_key,
        "llm_provider": get_provider_id(),
        "vision_provider_override": vision_provider,
        "vision_model_override": vision_model_override,
        "message": message,
    }


def _image_to_vision_data_uri(image_path: str, *, max_edge: Optional[int] = None) -> str:
    """Encode image for Qwen-VL / DashScope; downscale very large posters."""
    import base64
    from io import BytesIO

    edge = max_edge if max_edge is not None else _layout_vision_max_edge()

    with Image.open(image_path) as img:
        img = img.convert("RGB")
        w, h = img.size
        longest = max(w, h)
        if longest > edge:
            scale = edge / float(longest)
            img = img.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)
        buf = BytesIO()
        img.save(buf, format="JPEG", quality=92)
        payload = buf.getvalue()
        mime = "image/jpeg"
    b64 = base64.b64encode(payload).decode("ascii")
    return f"data:{mime};base64,{b64}"


def _vision_chat_completion(
    image_path: str,
    prompt: str,
    *,
    max_tokens: int = 2400,
    label: str = "vision",
) -> tuple[str, Dict[str, Any]]:
    """Call vision model via resolve_vision_credentials (DashScope Qwen-VL aware)."""
    from openai import OpenAI
    from core.llm_provider import resolve_vision_credentials

    provider_id, model, key, cfg = resolve_vision_credentials()
    meta = {
        "provider": provider_id,
        "model": model,
        "base_url": cfg.base_url,
        "ok": False,
        "error": None,
    }
    if not key:
        meta["error"] = (
            "视觉 API Key 未配置；通义请设置 DASHSCOPE_API_KEY 或 ALIBABA_API_KEY"
        )
        logger.warning("[layer_split] %s skipped: %s", label, meta["error"])
        return "", meta

    data_uri = _image_to_vision_data_uri(image_path)
    try:
        client = OpenAI(api_key=key, base_url=cfg.base_url)
        resp = client.chat.completions.create(
            model=model,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": data_uri}},
                    {"type": "text", "text": prompt},
                ],
            }],
            max_tokens=max_tokens,
            temperature=0,
        )
        raw = (resp.choices[0].message.content or "").strip()
        meta["ok"] = bool(raw)
        logger.info(
            "[layer_split] %s provider=%s model=%s chars=%d",
            label,
            provider_id,
            model,
            len(raw),
        )
        return raw, meta
    except Exception as exc:
        meta["error"] = str(exc)
        logger.warning(
            "[layer_split] %s failed provider=%s model=%s: %s",
            label,
            provider_id,
            model,
            exc,
        )
        return "", meta


def _strip_markdown_json_fence(raw: str) -> str:
    text = (raw or "").strip()
    if not text.startswith("```"):
        return text
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```\s*$", "", text)
    return text.strip()


def _repair_truncated_json_object(raw: str) -> str:
    """Best-effort close for Qwen-VL responses cut off by max_tokens."""
    text = raw.strip()
    if not text:
        return text
    if text.endswith("}"):
        return text
    # Drop trailing incomplete key/value fragment
    text = re.sub(r',\s*"[^"]*"\s*:\s*"?[^"}\]]*$', "", text)
    text = re.sub(r',\s*\{[^}]*$', "", text)
    open_braces = text.count("{") - text.count("}")
    open_brackets = text.count("[") - text.count("]")
    text += "]" * max(0, open_brackets)
    text += "}" * max(0, open_braces)
    return text


def _parse_vision_json_payload(raw: str) -> Dict[str, Any]:
    if not raw:
        return {}
    cleaned = _strip_markdown_json_fence(raw)
    start = cleaned.find("{")
    if start < 0:
        return {}
    candidate = cleaned[start:]
    end = candidate.rfind("}")
    if end > 0:
        candidate = candidate[: end + 1]
    for attempt in (candidate, _repair_truncated_json_object(candidate)):
        try:
            payload = json.loads(attempt)
            if isinstance(payload, dict):
                return payload
        except json.JSONDecodeError:
            continue
    logger.warning("[layer_split] vision JSON parse failed preview=%s", cleaned[:200])
    return {}


def _vision_layout_plan(image_path: str, *, max_blocks: int = 24) -> List[Dict[str, Any]]:
    """Vision LLM semantic layout plan for text / image / qr / icon layers."""
    cap = max(4, min(MAX_LAYERS, int(max_blocks or 24)))
    prompt = _VISION_LAYOUT_PROMPT.format(max_blocks=cap)
    raw, meta = _vision_chat_completion(
        image_path,
        prompt,
        max_tokens=4096,
        label="vision_layout",
    )
    if not meta.get("ok"):
        return []

    payload = _parse_vision_json_payload(raw)
    blocks = payload.get("blocks") or []
    if not isinstance(blocks, list):
        logger.warning("[layer_split] vision layout empty JSON blocks model=%s", meta.get("model"))
        return []

    normalized: List[Dict[str, Any]] = []
    for item in blocks:
        if not isinstance(item, dict):
            continue
        block_type = _normalize_block_type(str(item.get("type") or "image"))
        if block_type == "background":
            continue
        x = _clamp01(float(item.get("x", 0)))
        y = _clamp01(float(item.get("y", 0)))
        w = _clamp01(float(item.get("width", 0.1)))
        h = _clamp01(float(item.get("height", 0.1)))
        nx, ny, nw, nh = _refine_bbox(x, y, w, h, layer_type=block_type)
        if nw * nh < 0.00015:
            continue
        normalized.append({
            "name": str(item.get("name") or "元素").strip()[:48],
            "type": block_type,
            "role": str(item.get("role") or block_type).strip().lower(),
            "x": nx,
            "y": ny,
            "width": nw,
            "height": nh,
            "description": str(item.get("description") or "").strip()[:120],
            "z_order": int(item.get("z_order", 10)),
        })
    normalized.sort(key=lambda b: (b.get("z_order", 10), b["y"], b["x"]))
    if len(normalized) > cap:
        normalized = normalized[:cap]
    logger.info(
        "[layer_split] vision layout provider=%s model=%s blocks=%d",
        meta.get("provider"),
        meta.get("model"),
        len(normalized),
    )
    return normalized


def _vision_detect_image_blocks(image_path: str, *, max_image_blocks: int = 10) -> List[LayerSpec]:
    cap = max(2, min(MAX_LAYERS - 2, int(max_image_blocks or 10)))
    prompt = _IMAGE_BLOCK_PROMPT.format(max_image_blocks=cap)
    raw, meta = _vision_chat_completion(
        image_path,
        prompt,
        max_tokens=1400,
        label="vision_image_blocks",
    )
    if not meta.get("ok"):
        return []

    payload = _parse_vision_json_payload(raw)
    specs = _parse_vision_blocks(payload)
    image_specs = [s for s in specs if s.layer_type == "image"]
    bg_specs = [s for s in specs if s.layer_type == "background"]
    logger.info(
        "[layer_split] vision image blocks provider=%s model=%s count=%d",
        meta.get("provider"),
        meta.get("model"),
        len(image_specs),
    )
    return bg_specs[:1] + image_specs


def _horizontal_overlap_ratio(a: _OcrFragment, b: _OcrFragment) -> float:
    left = max(a.x0, b.x0)
    right = min(a.x1, b.x1)
    if right <= left:
        return 0.0
    return (right - left) / max(1.0, min(a.width, b.width))


def _should_merge_fragments(a: _OcrFragment, b: _OcrFragment, canvas_h: float) -> bool:
    avg_h = max(8.0, (a.height + b.height) / 2)
    if abs(a.cy - b.cy) <= avg_h * 0.55:
        gap_x = max(0.0, max(a.x0, b.x0) - min(a.x1, b.x1))
        if gap_x <= avg_h * 2.5:
            return True

    vertical_gap = min(abs(a.y0 - b.y1), abs(b.y0 - a.y1))
    if vertical_gap <= avg_h * 1.6 and _horizontal_overlap_ratio(a, b) >= 0.12:
        return True

    if vertical_gap <= canvas_h * 0.02 and _horizontal_overlap_ratio(a, b) >= 0.35:
        return True
    return False


def _cluster_ocr_fragments(fragments: List[_OcrFragment], canvas_h: float) -> List[List[_OcrFragment]]:
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
            if _should_merge_fragments(fragments[i], fragments[j], canvas_h):
                union(i, j)

    groups: Dict[int, List[_OcrFragment]] = {}
    for idx, frag in enumerate(fragments):
        root = find(idx)
        groups.setdefault(root, []).append(frag)

    clustered = list(groups.values())
    clustered.sort(key=lambda g: min(f.cy for f in g))
    return clustered


def _guess_text_block_name(text: str, line_count: int, rel_height: float) -> str:
    compact = re.sub(r"\s+", "", text)
    if line_count == 1 and rel_height >= 0.045:
        return "主标题"
    if line_count == 1 and rel_height >= 0.028:
        return "副标题"
    if line_count == 1 and len(compact) <= 10:
        return f"文字·{compact[:6]}"
    if line_count == 1:
        return "单行文字"
    return f"正文块"


def _ocr_text_blocks(image_path: str) -> List[LayerSpec]:
    """Detect text blocks via OCR with paragraph-level clustering."""
    try:
        import easyocr
    except ImportError:
        return []

    try:
        reader = easyocr.Reader(["ch_sim", "en"], gpu=False, verbose=False)
        results = reader.readtext(image_path)
    except Exception as exc:
        logger.warning("[layer_split] OCR failed: %s", exc)
        return []

    with Image.open(image_path) as img:
        w, h = img.size

    fragments: List[_OcrFragment] = []
    for item in results:
        if len(item) < 2:
            continue
        box, text = item[0], str(item[1]).strip()
        if len(text) < 1:
            continue
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        x0, x1 = min(xs), max(xs)
        y0, y1 = min(ys), max(ys)
        if x1 - x0 < 4 or y1 - y0 < 4:
            continue
        fragments.append(_OcrFragment(x0=x0, y0=y0, x1=x1, y1=y1, text=text))

    if not fragments:
        return []

    groups = _cluster_ocr_fragments(fragments, float(h))
    specs: List[LayerSpec] = []
    for index, group in enumerate(groups):
        x0 = min(f.x0 for f in group)
        y0 = min(f.y0 for f in group)
        x1 = max(f.x1 for f in group)
        y1 = max(f.y1 for f in group)
        rel_w = (x1 - x0) / w
        rel_h = (y1 - y0) / h
        if rel_w * rel_h < MIN_TEXT_AREA_RATIO:
            continue

        nx, ny, nw, nh = _refine_bbox(
            x0 / w,
            y0 / h,
            rel_w,
            rel_h,
            layer_type="text",
        )
        joined = " ".join(f.text for f in sorted(group, key=lambda g: (g.cy, g.x0)))
        line_count = len(group)
        name = _guess_text_block_name(joined, line_count, rel_h)
        specs.append(
            LayerSpec(
                name=name,
                layer_type="text",
                x=nx,
                y=ny,
                width=nw,
                height=nh,
                description=joined[:80],
                z_order=100 + index,
            )
        )
    return specs


def _dedupe_blocks(
    blocks: List[LayerSpec],
    *,
    min_area: float,
    iou_threshold: float,
) -> List[LayerSpec]:
    candidates = [b for b in blocks if b.layer_type != "background" and _box_area(b) >= min_area]
    candidates.sort(key=lambda s: (_box_area(s), -s.z_order), reverse=True)

    kept: List[LayerSpec] = []
    for spec in candidates:
        if any(_box_iou(spec, prev) >= iou_threshold for prev in kept):
            continue
        kept.append(spec)
    return kept


def _remove_image_text_overlap(image_blocks: List[LayerSpec], text_blocks: List[LayerSpec]) -> List[LayerSpec]:
    if not text_blocks:
        return image_blocks

    cleaned: List[LayerSpec] = []
    for img in image_blocks:
        if any(_box_iou(img, txt) >= 0.45 for txt in text_blocks):
            logger.debug("[layer_split] drop image block overlapping text: %s", img.name)
            continue
        cleaned.append(img)
    return cleaned


def _vlm_plan_dicts_to_specs(blocks: List[Dict[str, Any]]) -> List[LayerSpec]:
    specs: List[LayerSpec] = []
    for item in blocks:
        if not isinstance(item, dict):
            continue
        layer_type = _normalize_block_type(str(item.get("type") or "image"))
        x = _clamp01(float(item.get("x", 0)))
        y = _clamp01(float(item.get("y", 0)))
        w = _clamp01(float(item.get("width", 0.1)))
        h = _clamp01(float(item.get("height", 0.1)))
        if layer_type == "background":
            continue
        nx, ny, nw, nh = _refine_bbox(x, y, w, h, layer_type=layer_type)
        if nw * nh < 0.00015:
            continue
        specs.append(
            LayerSpec(
                name=str(item.get("name") or "元素").strip()[:48],
                layer_type=layer_type,
                x=nx,
                y=ny,
                width=nw,
                height=nh,
                description=str(item.get("description") or "").strip()[:120],
                z_order=int(item.get("z_order", 10)),
            )
        )
    return specs


def _qr_region_to_spec(region: Dict[str, Any], canvas_size: Tuple[int, int]) -> LayerSpec:
    width, height = canvas_size
    bbox = region.get("bbox") or {}
    x, y, w, h = pixel_bbox_to_relative(bbox, width, height)
    return LayerSpec(
        name=str(region.get("name") or "二维码")[:48],
        layer_type="qr",
        x=_clamp01(x),
        y=_clamp01(y),
        width=_clamp01(w),
        height=_clamp01(h),
        description="OpenCV QR 检测",
        z_order=50,
    )


def _merge_text_blocks_vlm_ocr(
    vlm_texts: List[LayerSpec],
    ocr_texts: List[LayerSpec],
) -> List[LayerSpec]:
    if not ocr_texts:
        return vlm_texts
    if not vlm_texts:
        return ocr_texts

    merged: List[LayerSpec] = []
    used_ocr: set[int] = set()

    for vlm in vlm_texts:
        best_idx = -1
        best_iou = 0.0
        for idx, ocr in enumerate(ocr_texts):
            if idx in used_ocr:
                continue
            iou = _box_iou(vlm, ocr)
            if iou > best_iou:
                best_iou = iou
                best_idx = idx
        if best_idx >= 0 and best_iou >= OCR_TEXT_OVERRIDE_IOU:
            ocr = ocr_texts[best_idx]
            used_ocr.add(best_idx)
            merged.append(
                LayerSpec(
                    name=vlm.name or ocr.name,
                    layer_type="text",
                    x=ocr.x,
                    y=ocr.y,
                    width=ocr.width,
                    height=ocr.height,
                    description=ocr.description or vlm.description,
                    z_order=vlm.z_order,
                )
            )
        else:
            merged.append(vlm)

    for idx, ocr in enumerate(ocr_texts):
        if idx not in used_ocr:
            merged.append(ocr)
    return merged


def _merge_qr_blocks_vlm_cv(vlm_qrs: List[LayerSpec], cv_qrs: List[LayerSpec]) -> List[LayerSpec]:
    if not cv_qrs:
        return vlm_qrs
    merged = list(cv_qrs)
    for vlm in vlm_qrs:
        if any(_box_iou(vlm, cv) >= QR_OVERRIDE_IOU for cv in cv_qrs):
            continue
        if any(_box_iou(vlm, kept) >= IOU_DEDUP_THRESHOLD for kept in merged):
            continue
        merged.append(vlm)
    return merged


def _remove_blocks_overlapping_qr(blocks: List[LayerSpec], qr_blocks: List[LayerSpec]) -> List[LayerSpec]:
    if not qr_blocks:
        return blocks
    cleaned: List[LayerSpec] = []
    for block in blocks:
        if block.layer_type == "qr":
            cleaned.append(block)
            continue
        if any(_box_iou(block, qr) >= 0.45 for qr in qr_blocks):
            logger.debug("[layer_split] drop block overlapping QR: %s", block.name)
            continue
        cleaned.append(block)
    return cleaned


def _fuse_layout_blocks(
    source: Image.Image,
    image_path: str,
    *,
    include_ocr: bool,
    max_layers: int,
) -> Tuple[List[LayerSpec], Dict[str, Any]]:
    """Unified layout: VLM semantic plan + OCR text refine + OpenCV QR."""
    cap = max(3, min(MAX_LAYERS, int(max_layers or 12)))
    vlm_plan = _vision_layout_plan(image_path, max_blocks=max(4, cap - 1))
    vlm_specs = _vlm_plan_dicts_to_specs(vlm_plan)

    ocr_specs = _ocr_text_blocks(image_path) if include_ocr else []
    qr_regions = detect_qr_regions(source)
    cv_qr_specs = [_qr_region_to_spec(r, source.size) for r in qr_regions]

    vlm_texts = [s for s in vlm_specs if s.layer_type == "text"]
    vlm_qrs = [s for s in vlm_specs if s.layer_type == "qr"]
    image_specs = [s for s in vlm_specs if s.layer_type in {"image", "subject", "decoration", "overlay"}]
    icon_specs = [s for s in vlm_specs if s.layer_type == "icon"]

    merged_texts = _merge_text_blocks_vlm_ocr(vlm_texts, ocr_specs) if include_ocr else vlm_texts
    merged_qrs = _merge_qr_blocks_vlm_cv(vlm_qrs, cv_qr_specs)

    image_specs = _dedupe_blocks(image_specs, min_area=MIN_IMAGE_AREA_RATIO, iou_threshold=IOU_DEDUP_THRESHOLD)
    icon_specs = _dedupe_blocks(icon_specs, min_area=MIN_TEXT_AREA_RATIO, iou_threshold=IOU_DEDUP_THRESHOLD)
    image_specs = _remove_image_text_overlap(image_specs, merged_texts)
    image_specs = _remove_blocks_overlapping_qr(image_specs, merged_qrs)
    icon_specs = _remove_image_text_overlap(icon_specs, merged_texts)

    merged_texts = _dedupe_blocks(merged_texts, min_area=MIN_TEXT_AREA_RATIO, iou_threshold=0.65)
    merged_qrs = _dedupe_blocks(merged_qrs, min_area=MIN_TEXT_AREA_RATIO, iou_threshold=0.55)

    background = LayerSpec("背景", "background", 0, 0, 1, 1, z_order=0)
    fg_blocks = sorted(
        [*image_specs, *icon_specs, *merged_qrs],
        key=lambda s: (s.z_order, s.y, s.x),
    )
    text_blocks = sorted(merged_texts, key=lambda s: (s.z_order, s.y, s.x))

    reserved = 1 + len(fg_blocks) + len(text_blocks)
    if reserved > cap:
        overflow = reserved - cap
        if overflow <= len(text_blocks):
            text_blocks = text_blocks[: max(0, len(text_blocks) - overflow)]
        else:
            text_blocks = []
            fg_blocks = fg_blocks[: max(1, len(fg_blocks) - overflow)]

    specs = [background, *fg_blocks, *text_blocks]
    meta = {
        "vlm_blocks": len(vlm_plan),
        "ocr_blocks": len(ocr_specs),
        "qr_blocks": len(merged_qrs),
        "icon_blocks": len(icon_specs),
        "image_blocks": len(image_specs),
        "text_blocks": len(text_blocks),
    }
    return specs, meta


def _refine_single_block_bbox(
    image_path: str,
    spec: LayerSpec,
    *,
    crop_path: str,
    crop_box: Tuple[float, float, float, float],
) -> LayerSpec:
    prompt = _REFINE_BBOX_PROMPT.format(
        element_type=spec.layer_type,
        name=spec.name or "元素",
    )
    raw, meta = _vision_chat_completion(
        crop_path,
        prompt,
        max_tokens=512,
        label="bbox_refine",
    )
    if not meta.get("ok"):
        return spec
    payload = _parse_vision_json_payload(raw)
    if not payload:
        return spec
    sx = _clamp01(float(payload.get("x", spec.x)))
    sy = _clamp01(float(payload.get("y", spec.y)))
    sw = _clamp01(float(payload.get("width", spec.width)))
    sh = _clamp01(float(payload.get("height", spec.height)))
    if sw <= 0 or sh <= 0:
        return spec
    cx, cy, cw, ch = crop_box
    nx, ny, nw, nh = map_sub_bbox_to_canvas(sx, sy, sw, sh, cx, cy, cw, ch)
    nx, ny, nw, nh = _refine_bbox(nx, ny, nw, nh, layer_type=spec.layer_type)
    return LayerSpec(
        name=spec.name,
        layer_type=spec.layer_type,
        x=nx,
        y=ny,
        width=nw,
        height=nh,
        description=spec.description,
        z_order=spec.z_order,
    )


def _refine_layout_blocks_vlm(
    source: Image.Image,
    image_path: str,
    specs: List[LayerSpec],
    *,
    high_quality: bool,
) -> Tuple[List[LayerSpec], int]:
    """Second-pass VLM bbox refinement on cropped regions."""
    max_passes_raw = (os.getenv("PSD_MAX_REFINE_PASSES") or "8").strip()
    try:
        max_passes = max(1, min(20, int(max_passes_raw)))
    except ValueError:
        max_passes = 8

    width, height = source.size
    temp_dir = os.path.join(TEMP_DIR, "psd_refine")
    os.makedirs(temp_dir, exist_ok=True)

    background_idx = next((i for i, s in enumerate(specs) if s.layer_type == "background"), None)
    candidate_indices = [
        i for i, s in enumerate(specs)
        if s.layer_type in FOREGROUND_LAYER_TYPES or s.layer_type == "text"
    ]
    if not high_quality:
        candidate_indices = [
            i for i in candidate_indices
            if _box_area(specs[i]) > 0.08 or not (specs[i].description or "").strip()
        ]
    candidate_indices = candidate_indices[:max_passes]

    out = list(specs)
    refine_count = 0
    for idx in candidate_indices:
        spec = out[idx]
        cx, cy, cw, ch = expand_relative_bbox(spec.x, spec.y, spec.width, spec.height, padding=0.10)
        x0, y0, x1, y1 = relative_bbox_to_pixels(cx, cy, cw, ch, width, height)
        crop = source.crop((x0, y0, x1, y1))
        crop_path = os.path.join(temp_dir, f"refine_{idx}_{uuid.uuid4().hex[:8]}.jpg")
        crop.convert("RGB").save(crop_path, "JPEG", quality=92)
        out[idx] = _refine_single_block_bbox(
            image_path,
            spec,
            crop_path=crop_path,
            crop_box=(cx, cy, cw, ch),
        )
        refine_count += 1

    if background_idx is not None and background_idx < len(out):
        out[background_idx] = specs[background_idx]
    return out, refine_count


def _compose_layout_blocks(
    vision_blocks: List[LayerSpec],
    text_blocks: List[LayerSpec],
    *,
    include_ocr: bool,
    max_layers: int,
) -> List[LayerSpec]:
    background = next(
        (b for b in vision_blocks if b.layer_type == "background"),
        LayerSpec("背景", "background", 0, 0, 1, 1, z_order=0),
    )

    image_blocks = _dedupe_blocks(
        [b for b in vision_blocks if b.layer_type in {"image", "subject", "decoration", "overlay", "qr", "icon"}],
        min_area=MIN_IMAGE_AREA_RATIO,
        iou_threshold=IOU_DEDUP_THRESHOLD,
    )
    image_blocks = _remove_image_text_overlap(image_blocks, text_blocks if include_ocr else [])

    texts = list(text_blocks) if include_ocr else []
    texts = _dedupe_blocks(texts, min_area=MIN_TEXT_AREA_RATIO, iou_threshold=0.65)

    cap = max(3, min(MAX_LAYERS, int(max_layers or 12)))
    reserved = 1 + len(image_blocks) + len(texts)
    if reserved > cap:
        overflow = reserved - cap
        if overflow <= len(texts):
            texts = texts[: max(0, len(texts) - overflow)]
        else:
            texts = []
            image_blocks = image_blocks[: max(1, len(image_blocks) - (overflow - len(texts)))]

    image_blocks.sort(key=lambda s: (s.z_order, s.y))
    texts.sort(key=lambda s: (s.y, s.x))

    return [background, *image_blocks, *texts]


def _rect_mask(spec: LayerSpec, width: int, height: int) -> np.ndarray:
    mask = np.zeros((height, width), dtype=np.uint8)
    x0, y0, x1, y1 = _bbox_pixels(spec, width, height)
    mask[y0:y1, x0:x1] = 255
    return mask


def _inpaint_background(source: Image.Image, foreground_mask: np.ndarray) -> Image.Image:
    import cv2

    rgb = np.array(source.convert("RGB"))
    h, w = rgb.shape[:2]
    inpaint_mask = (foreground_mask > 64).astype(np.uint8)
    if not inpaint_mask.any():
        return source.convert("RGBA")

    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    radius = max(3, min(h, w) // 100)
    filled = cv2.inpaint(bgr, inpaint_mask, radius, cv2.INPAINT_TELEA)
    filled_rgb = cv2.cvtColor(filled, cv2.COLOR_BGR2RGB)
    return Image.fromarray(filled_rgb).convert("RGBA")


def _extract_block_layer(source: Image.Image, spec: LayerSpec) -> Image.Image:
    """Extract one block as a full-canvas layer with rectangular bounds."""
    width, height = source.size
    if spec.layer_type == "background":
        return source.convert("RGBA")

    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    x0, y0, x1, y1 = _bbox_pixels(spec, width, height)
    crop = source.crop((x0, y0, x1, y1)).convert("RGBA")

    feather = max(1, min(crop.size) // 32)
    alpha = Image.new("L", crop.size, 255)
    if feather > 1:
        alpha = alpha.filter(ImageFilter.GaussianBlur(feather))
    crop.putalpha(alpha)
    canvas.paste(crop, (x0, y0), crop)
    return canvas


def _build_layer_stack(
    source: Image.Image,
    specs: List[LayerSpec],
    *,
    background_rgba: Optional[Image.Image] = None,
) -> List[Tuple[LayerSpec, Image.Image]]:
    width, height = source.size
    background_spec = next(
        (s for s in specs if s.layer_type == "background"),
        LayerSpec("背景", "background", 0, 0, 1, 1, z_order=0),
    )
    image_specs = [s for s in specs if s.layer_type in FOREGROUND_LAYER_TYPES]
    text_specs = [s for s in specs if s.layer_type == "text"]

    fg_mask = np.zeros((height, width), dtype=np.uint8)
    for spec in [*image_specs, *text_specs]:
        fg_mask = np.maximum(fg_mask, _rect_mask(spec, width, height))

    if background_rgba is not None:
        bg_layer = background_rgba.convert("RGBA")
        if bg_layer.size != (width, height):
            bg_layer = bg_layer.resize((width, height), Image.Resampling.LANCZOS)
    else:
        bg_layer = _inpaint_background(source, fg_mask)

    layers: List[Tuple[LayerSpec, Image.Image]] = [
        (background_spec, bg_layer),
    ]

    for spec in sorted(image_specs, key=lambda s: (s.z_order, s.y, s.x)):
        layers.append((spec, _extract_block_layer(source, spec)))

    for spec in sorted(text_specs, key=lambda s: (s.z_order, s.y, s.x)):
        layers.append((spec, _extract_block_layer(source, spec)))

    if len(layers) == 1:
        fallback = LayerSpec("整图", "image", 0.05, 0.05, 0.9, 0.9, z_order=1)
        layers.append((fallback, _extract_block_layer(source, fallback)))

    return layers[:MAX_LAYERS]


# Backward-compatible helpers for tests
def _parse_layer_specs(payload: Any) -> List[LayerSpec]:
    return _parse_vision_blocks(payload)


def _merge_layer_specs(
    vision_specs: List[LayerSpec],
    ocr_specs: List[LayerSpec],
    *,
    include_ocr: bool,
) -> List[LayerSpec]:
    return _compose_layout_blocks(
        vision_specs,
        ocr_specs,
        include_ocr=include_ocr,
        max_layers=MAX_LAYERS,
    )


def _filter_layer_specs(specs: List[LayerSpec]) -> List[LayerSpec]:
    bg = [s for s in specs if s.layer_type == "background"]
    others = _dedupe_blocks(
        [s for s in specs if s.layer_type != "background"],
        min_area=MIN_TEXT_AREA_RATIO,
        iou_threshold=IOU_DEDUP_THRESHOLD,
    )
    return ([bg[0]] if bg else []) + others


def _group_ocr_text_layers(image_path: str) -> List[LayerSpec]:
    return _ocr_text_blocks(image_path)


def _vision_analyze_layers(image_path: str, *, max_layers: int = 6) -> List[LayerSpec]:
    return _vision_detect_image_blocks(image_path, max_image_blocks=max_layers)


def _extract_layer_rgba(source: Image.Image, spec: LayerSpec) -> Image.Image:
    return _extract_block_layer(source, spec)


def _write_multi_layer_psd(path: str, layers: List[Tuple[str, Image.Image]]) -> None:
    try:
        from psd_tools import PSDImage
    except ImportError as exc:
        raise ImportError(
            "PSD 导出需要 psd-tools，请在 venv 中执行: pip install 'psd-tools>=1.10.0'"
        ) from exc

    if not layers:
        raise ValueError("至少需要一个图层")

    canvas_w, canvas_h = layers[0][1].size
    psd = PSDImage.new(mode="RGB", size=(canvas_w, canvas_h))

    for name, image in layers:
        fitted = _fit_to_canvas(image.convert("RGBA"), canvas_w, canvas_h)
        psd.create_pixel_layer(fitted, name=name[:64], top=0, left=0)

    psd.save(path)


def _split_image_to_psd_heuristic(
    image_url: str,
    *,
    max_layers: int = 12,
    include_ocr: bool = True,
) -> Dict[str, Any]:
    """Legacy heuristic splitter (OCR + vision bbox). Used when LayerD unavailable."""
    try:
        source = _load_pil_image(image_url)
    except Exception as exc:
        return {"success": False, "error": str(exc)}

    local = _local_path_from_url(image_url)
    if not local or not os.path.isfile(local):
        stem = f"split_src_{uuid.uuid4().hex[:10]}"
        local = os.path.join(OUTPUT_DIR, f"{stem}.png")
        source.save(local, "PNG")

    vision_blocks = _vision_detect_image_blocks(
        local,
        max_image_blocks=max(4, int(max_layers) - 4),
    )
    text_blocks = _ocr_text_blocks(local) if include_ocr else []
    specs = _compose_layout_blocks(
        vision_blocks,
        text_blocks,
        include_ocr=include_ocr,
        max_layers=max_layers,
    )

    stack = _build_layer_stack(source, specs)
    layer_images: List[Tuple[str, Image.Image]] = []
    layer_meta: List[Dict[str, Any]] = []

    for index, (spec, rgba) in enumerate(stack):
        display_name = _display_layer_name(spec.name, index)
        psd_name = _psd_layer_name(spec, index)
        layer_images.append((psd_name, rgba))
        layer_meta.append({
            "name": display_name,
            "psd_name": psd_name,
            "type": spec.layer_type,
            "description": spec.description,
            "x": round(spec.x, 4),
            "y": round(spec.y, 4),
            "width": round(spec.width, 4),
            "height": round(spec.height, 4),
            "z_order": spec.z_order,
        })

    stem = f"layers_{uuid.uuid4().hex[:10]}"
    out_path = os.path.join(OUTPUT_DIR, f"{stem}.psd")
    try:
        _write_multi_layer_psd(out_path, layer_images)
    except Exception as exc:
        logger.error("[layer_split] PSD write failed: %s", exc, exc_info=True)
        return {"success": False, "error": f"PSD 生成失败: {exc}"}

    filename = os.path.basename(out_path)
    image_count = sum(1 for s in specs if s.layer_type in {"image", "subject", "decoration", "overlay"})
    text_count = sum(1 for s in specs if s.layer_type == "text")
    return {
        "success": True,
        "filename": filename,
        "local_path": out_path,
        "download_url": f"/api/media/{filename}",
        "format": "psd",
        "layer_count": len(layer_meta),
        "layers": layer_meta,
        "size_bytes": os.path.getsize(out_path) if os.path.isfile(out_path) else 0,
        "engine": "heuristic",
        "analysis": {
            "engine": "heuristic",
            "image_blocks": image_count,
            "text_blocks": text_count,
            "vision_blocks": len(vision_blocks),
            "ocr_blocks": len(text_blocks),
            "used_fallback": image_count == 0 and text_count == 0,
        },
    }


def get_split_psd_status() -> Dict[str, Any]:
    """Aggregate status for UI: DashScope-only layer split."""
    from tools.qwen_layered_adapter import get_qwen_layered_status

    qwen_status = get_qwen_layered_status()
    vision_status = get_vision_layout_status()
    qwen_ready = bool(qwen_status.get("ready"))

    return {
        "primary_engine": "dashscope-edit",
        "active_engine": "dashscope-edit" if qwen_ready else "unavailable",
        "qwen_layered": qwen_status,
        "vision": vision_status,
        "can_split": qwen_ready,
    }


def warmup_split_psd_engine() -> Dict[str, Any]:
    from tools.qwen_layered_adapter import warmup_qwen_layered

    return warmup_qwen_layered()


def split_image_to_psd(
    image_url: str,
    *,
    max_layers: int = 12,
    include_ocr: bool = True,
    high_quality: bool = False,
) -> Dict[str, Any]:
    """
    Split image into PSD layers via DashScope (百炼).

    Qwen-VL layout + Wan2.7 / Qwen-Image-2.0 generative background + foreground crops.
    """
    try:
        source = _load_pil_image(image_url)
    except Exception as exc:
        return {"success": False, "error": str(exc)}

    from tools.qwen_layered_adapter import is_qwen_layered_available, split_with_qwen_layered

    if not is_qwen_layered_available():
        return {
            "success": False,
            "error": "未配置 DASHSCOPE_API_KEY / ALIBABA_API_KEY，无法使用百炼拆层",
        }

    num_layers = max(3, min(10, int(max_layers or 8)))
    logger.info(
        "[layer_split] using DashScope layers=%s high_quality=%s",
        num_layers,
        high_quality,
    )
    return split_with_qwen_layered(
        source,
        image_url=image_url,
        max_layers=num_layers,
        include_ocr=include_ocr,
        high_quality=high_quality,
    )
