"""Per-element extraction and mask-driven background repair for PSD layer split."""
from __future__ import annotations

import io
import os
import uuid
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import requests
from PIL import Image, ImageFilter

from tools.image_edit_tools import resolve_image_reference, run_image_edit
from tools.image_layer_split_tools import (
    FOREGROUND_LAYER_TYPES,
    LayerSpec,
    _bbox_pixels,
    _display_layer_name,
    _extract_block_layer,
    _inpaint_background,
    _psd_layer_name,
)
from tools.image_tools import _dashscope_extract_image_url_from_output
from tools.media_common import OUTPUT_DIR, TEMP_DIR, _get_provider_api_key, dashscope_api_root
from tools.psd_layout_utils import build_rect_mask_image, relative_bbox_to_pixels
from utils.logger import setup_logger

logger = setup_logger("psd_element_extract")

_IMAGE_MATTING_PROMPT = (
    "仅保留画面中的{description}，移除其余所有内容，输出透明背景 PNG，边缘干净无白边。"
)
_BG_INPAINT_PROMPT = (
    "自然填充被移除的前景区域，保持原背景渐变、纹理和色调一致，不要添加新元素。"
)

_SUPPORTED_EDIT_MODELS = frozenset({
    "wan2.7-image-pro",
    "wan2.7-image",
    "qwen-image-2.0-pro",
    "qwen-image-edit-max",
    "qwen-image-edit-plus",
})


def _resolve_element_edit_model(*, high_quality: bool) -> str:
    override = (os.getenv("PSD_ELEMENT_EDIT_MODEL") or "").strip()
    if override:
        return override
    if high_quality:
        return "qwen-image-2.0-pro"
    return "wan2.7-image"


def _dashscope_edit_parameters(model_id: str, *, high_quality: bool) -> Dict[str, Any]:
    params: Dict[str, Any] = {"n": 1, "watermark": False}
    if model_id.startswith("wan2.7"):
        params["size"] = "2K"
        params["thinking_mode"] = high_quality
    elif model_id.startswith("qwen-image"):
        params["prompt_extend"] = True
    return params


def _call_dashscope_multimodal_edit(
    image_ref: str,
    prompt: str,
    *,
    model_id: str,
    high_quality: bool = False,
) -> str:
    api_key = _get_provider_api_key("alibaba")
    if not api_key:
        raise ValueError("未配置 DASHSCOPE_API_KEY 或 ALIBABA_API_KEY")

    url = f"{dashscope_api_root()}/services/aigc/multimodal-generation/generation"
    body = {
        "model": model_id,
        "input": {
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"image": image_ref},
                        {"text": prompt},
                    ],
                }
            ]
        },
        "parameters": _dashscope_edit_parameters(model_id, high_quality=high_quality),
    }
    resp = requests.post(
        url,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json=body,
        timeout=180,
    )
    data = resp.json() if resp.content else {}
    if resp.status_code >= 400:
        detail = data.get("message") or data.get("code") or resp.text or str(resp.status_code)
        raise RuntimeError(f"百炼图像编辑失败: {detail}")

    output = data.get("output") or data
    result_url = _dashscope_extract_image_url_from_output(output)
    if not result_url:
        raise RuntimeError(f"百炼未返回图片 URL: {list(output.keys()) if isinstance(output, dict) else output}")
    return result_url


def _download_rgba(url: str) -> Image.Image:
    resp = requests.get(url, timeout=120)
    resp.raise_for_status()
    return Image.open(io.BytesIO(resp.content)).convert("RGBA")


def _align_to_canvas(layer: Image.Image, canvas_size: Tuple[int, int]) -> Image.Image:
    if layer.size == canvas_size:
        return layer
    return layer.resize(canvas_size, Image.Resampling.LANCZOS)


def _paste_crop_on_canvas(
    source: Image.Image,
    crop_rgba: Image.Image,
    box: Tuple[int, int, int, int],
) -> Image.Image:
    width, height = source.size
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    x0, y0, x1, y1 = box
    target_w, target_h = x1 - x0, y1 - y0
    if crop_rgba.size != (target_w, target_h):
        crop_rgba = crop_rgba.resize((target_w, target_h), Image.Resampling.LANCZOS)
    canvas.paste(crop_rgba, (x0, y0), crop_rgba)
    return canvas


def _tight_text_alpha(crop: Image.Image) -> Image.Image:
    """Estimate text alpha from local background color variance."""
    rgba = crop.convert("RGBA")
    arr = np.array(rgba)
    rgb = arr[:, :, :3].astype(np.float32)
    # Background ≈ border median
    h, w = rgb.shape[:2]
    border = np.concatenate([
        rgb[0, :, :].reshape(-1, 3),
        rgb[-1, :, :].reshape(-1, 3),
        rgb[:, 0, :].reshape(-1, 3),
        rgb[:, -1, :].reshape(-1, 3),
    ], axis=0)
    bg = np.median(border, axis=0)
    dist = np.linalg.norm(rgb - bg, axis=2)
    threshold = max(12.0, float(dist.mean()) * 0.55)
    alpha = np.clip((dist - threshold * 0.35) / max(threshold, 1e-3) * 255, 0, 255).astype(np.uint8)
    alpha = Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(1))
    rgba.putalpha(alpha)
    return rgba


def _save_temp_crop(crop: Image.Image, prefix: str) -> str:
    temp_dir = os.path.join(TEMP_DIR, "psd_extract")
    os.makedirs(temp_dir, exist_ok=True)
    path = os.path.join(temp_dir, f"{prefix}_{uuid.uuid4().hex[:8]}.png")
    crop.save(path, "PNG")
    return path


def _extract_with_matting_api(
    crop: Image.Image,
    spec: LayerSpec,
    *,
    model_id: str,
    high_quality: bool,
) -> Optional[Image.Image]:
    crop_path = _save_temp_crop(crop, "matting")
    desc = spec.description or spec.name or "主体"
    prompt = _IMAGE_MATTING_PROMPT.format(description=desc)
    image_ref = resolve_image_reference(crop_path)
    result_url = _call_dashscope_multimodal_edit(
        image_ref,
        prompt,
        model_id=model_id,
        high_quality=high_quality,
    )
    return _download_rgba(result_url)


def extract_element_layer(
    source: Image.Image,
    spec: LayerSpec,
    *,
    high_quality: bool,
    model_id: str,
    api_stats: Dict[str, int],
) -> Image.Image:
    """Extract one foreground layer with type-specific strategy."""
    width, height = source.size
    if spec.layer_type == "background":
        return source.convert("RGBA")

    x0, y0, x1, y1 = _bbox_pixels(spec, width, height)
    crop = source.crop((x0, y0, x1, y1))

    if spec.layer_type in {"qr", "icon"}:
        return _extract_block_layer(source, spec)

    if spec.layer_type == "text":
        if high_quality:
            try:
                crop_path = _save_temp_crop(crop, "text")
                mask_path = _save_temp_crop(
                    build_rect_mask_image(crop.size[0], crop.size[1], 0, 0, crop.size[0], crop.size[1]),
                    "text_mask",
                )
                result = run_image_edit(
                    source_image_url=crop_path,
                    prompt="仅保留文字内容，背景完全透明",
                    mode="remove",
                    mask_image_url=mask_path,
                )
                api_stats["element_edit"] = api_stats.get("element_edit", 0) + 1
                if result.get("success") and result.get("local_paths"):
                    matting = Image.open(result["local_paths"][0]).convert("RGBA")
                    return _paste_crop_on_canvas(source, matting, (x0, y0, x1, y1))
            except Exception as exc:
                logger.warning("[psd_extract] text matting failed: %s", exc)
        tight = _tight_text_alpha(crop)
        return _paste_crop_on_canvas(source, tight, (x0, y0, x1, y1))

    if spec.layer_type in FOREGROUND_LAYER_TYPES:
        try:
            api_stats["element_matting"] = api_stats.get("element_matting", 0) + 1
            matting = _extract_with_matting_api(
                crop,
                spec,
                model_id=model_id,
                high_quality=high_quality,
            )
            if matting is not None:
                return _paste_crop_on_canvas(source, matting, (x0, y0, x1, y1))
        except Exception as exc:
            logger.warning("[psd_extract] image matting failed for %s: %s", spec.name, exc)

    return _extract_block_layer(source, spec)


def build_union_foreground_mask(
    source: Image.Image,
    layers: List[Tuple[LayerSpec, Image.Image]],
) -> np.ndarray:
    width, height = source.size
    mask = np.zeros((height, width), dtype=np.uint8)
    for spec, rgba in layers:
        if spec.layer_type == "background":
            continue
        alpha = np.array(rgba.getchannel("A"))
        mask = np.maximum(mask, alpha)
        x0, y0, x1, y1 = _bbox_pixels(spec, width, height)
        mask[y0:y1, x0:x1] = np.maximum(mask[y0:y1, x0:x1], 200)
    return mask


def _save_temp_mask(mask: np.ndarray, source: Image.Image) -> str:
    temp_dir = os.path.join(TEMP_DIR, "psd_extract")
    os.makedirs(temp_dir, exist_ok=True)
    path = os.path.join(temp_dir, f"union_mask_{uuid.uuid4().hex[:8]}.png")
    Image.fromarray(mask).save(path, "PNG")
    return path


def repair_background_layer(
    source: Image.Image,
    specs: List[LayerSpec],
    extracted_layers: List[Tuple[LayerSpec, Image.Image]],
    *,
    image_url: str,
    high_quality: bool,
    api_stats: Dict[str, int],
) -> Tuple[Image.Image, bool]:
    """TELEA inpaint base + optional wanx inpaint polish."""
    width, height = source.size
    union_mask = build_union_foreground_mask(source, extracted_layers)
    bg = _inpaint_background(source, union_mask)

    if not high_quality:
        return bg, True

    try:
        src_path = _save_temp_crop(source.convert("RGB"), "bg_src")
        mask_path = _save_temp_mask(union_mask, source)
        result = run_image_edit(
            source_image_url=src_path,
            prompt=_BG_INPAINT_PROMPT,
            mode="inpaint",
            mask_image_url=mask_path,
            strength=0.45,
        )
        api_stats["background_inpaint"] = api_stats.get("background_inpaint", 0) + 1
        if result.get("success") and result.get("local_paths"):
            polished = Image.open(result["local_paths"][0]).convert("RGBA")
            return _align_to_canvas(polished, (width, height)), True
    except Exception as exc:
        logger.warning("[psd_extract] background inpaint polish failed: %s", exc)

    return bg, True


def extract_all_layers(
    source: Image.Image,
    specs: List[LayerSpec],
    *,
    image_url: str,
    high_quality: bool,
) -> Tuple[List[Tuple[LayerSpec, Image.Image]], Dict[str, int]]:
    model_id = _resolve_element_edit_model(high_quality=high_quality)
    api_stats: Dict[str, int] = {"element_matting": 0, "element_edit": 0, "background_inpaint": 0}

    fg_specs = [s for s in specs if s.layer_type != "background"]
    extracted: List[Tuple[LayerSpec, Image.Image]] = []

    for spec in sorted(fg_specs, key=lambda s: (s.z_order, s.y, s.x)):
        rgba = extract_element_layer(
            source,
            spec,
            high_quality=high_quality,
            model_id=model_id,
            api_stats=api_stats,
        )
        extracted.append((spec, rgba))

    background_spec = next(
        (s for s in specs if s.layer_type == "background"),
        LayerSpec("背景", "background", 0, 0, 1, 1, z_order=0),
    )
    bg_rgba, generative = repair_background_layer(
        source,
        specs,
        extracted,
        image_url=image_url,
        high_quality=high_quality,
        api_stats=api_stats,
    )
    api_stats["generative_background"] = int(generative)

    stack: List[Tuple[LayerSpec, Image.Image]] = [(background_spec, bg_rgba)]
    stack.extend(extracted)
    return stack, api_stats


def stack_to_psd_layers(
    stack: List[Tuple[LayerSpec, Image.Image]],
) -> Tuple[List[Tuple[str, Image.Image]], List[Dict[str, Any]]]:
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
    return layer_images, layer_meta
