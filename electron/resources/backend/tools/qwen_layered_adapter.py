"""百炼 DashScope 高精度 PSD 拆层：五阶段流水线编排。"""
from __future__ import annotations

import os
import uuid
from typing import Any, Dict, List

from PIL import Image

from tools.image_edit_tools import _local_path_from_url
from tools.image_layer_split_tools import (
    _fuse_layout_blocks,
    _refine_layout_blocks_vlm,
    _write_multi_layer_psd,
    get_vision_layout_status,
)
from tools.media_common import OUTPUT_DIR, _get_provider_api_key
from tools.psd_element_extract import extract_all_layers, stack_to_psd_layers
from utils.logger import setup_logger

logger = setup_logger("qwen_layered_adapter")

_PIPELINE_STAGES = ("detect", "refine", "extract", "background", "export")


def _dashscope_key_configured() -> bool:
    return bool(_get_provider_api_key("alibaba"))


def _resolve_dashscope_model(*, high_quality: bool) -> str:
    override = (os.getenv("QWEN_LAYERED_DASHSCOPE_MODEL") or "").strip()
    if override:
        return override
    element_override = (os.getenv("PSD_ELEMENT_EDIT_MODEL") or "").strip()
    if element_override:
        return element_override
    if high_quality:
        return "wan2.7-image-pro"
    return "wan2.7-image"


def is_qwen_layered_available() -> bool:
    return _dashscope_key_configured()


def get_qwen_layered_status() -> Dict[str, Any]:
    model = _resolve_dashscope_model(high_quality=False)
    ready = _dashscope_key_configured()
    vision = get_vision_layout_status()
    message = (
        f"百炼高精度拆层已就绪（{model} + Qwen-VL 语义布局）"
        if ready
        else "未配置 DASHSCOPE_API_KEY / ALIBABA_API_KEY"
    )
    return {
        "available": True,
        "ready": ready,
        "provider": "dashscope",
        "provider_name": "阿里百炼 DashScope",
        "model": model,
        "message": message,
        "dashscope_key": ready,
        "vision_ready": bool(vision.get("ready")),
        "vision_model": vision.get("model"),
        "estimated_seconds": "120–300" if ready else "—",
        "pipeline_stages": list(_PIPELINE_STAGES),
        "paper": "VLM 布局 + 逐元素抠图 + 掩膜背景修复",
        "paper_url": "https://help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference",
    }


def warmup_qwen_layered() -> Dict[str, Any]:
    status = get_qwen_layered_status()
    return {
        "success": status.get("ready", False),
        "ready": status.get("ready", False),
        "engine": "dashscope-edit",
        "message": status.get("message"),
        "error": None if status.get("ready") else status.get("message"),
    }


def split_with_qwen_layered(
    source: Image.Image,
    *,
    image_url: str,
    max_layers: int = 8,
    include_ocr: bool = True,
    high_quality: bool = False,
) -> Dict[str, Any]:
    """
    Five-stage precision pipeline:
    1. detect — VLM + OCR + QR fusion
    2. refine — VLM second-pass bbox
    3. extract — per-element DashScope matting
    4. background — TELEA + inpaint polish
    5. export — PSD write
    """
    if not _dashscope_key_configured():
        return {"success": False, "error": "未配置 DASHSCOPE_API_KEY / ALIBABA_API_KEY"}

    progress: List[Dict[str, str]] = []
    num_layers = max(3, min(10, int(max_layers or 8)))
    model_id = _resolve_dashscope_model(high_quality=high_quality)

    local = _local_path_from_url(image_url)
    if not local or not os.path.isfile(local):
        stem = f"split_src_{uuid.uuid4().hex[:10]}"
        local = os.path.join(OUTPUT_DIR, f"{stem}.png")
        source.save(local, "PNG")

    # Stage 1: detect + fuse
    progress.append({"stage": "detect", "status": "running"})
    specs, fuse_meta = _fuse_layout_blocks(
        source,
        local,
        include_ocr=include_ocr,
        max_layers=num_layers,
    )
    progress[-1]["status"] = "done"

    # Stage 2: bbox refine
    progress.append({"stage": "refine", "status": "running"})
    specs, refine_count = _refine_layout_blocks_vlm(
        source,
        local,
        specs,
        high_quality=high_quality,
    )
    progress[-1]["status"] = "done"

    # Stage 3+4: extract elements + background
    progress.append({"stage": "extract", "status": "running"})
    stack, api_stats = extract_all_layers(
        source,
        specs,
        image_url=image_url,
        high_quality=high_quality,
    )
    progress[-1]["status"] = "done"
    progress.append({"stage": "background", "status": "done"})

    layer_images, layer_meta = stack_to_psd_layers(stack)

    # Stage 5: export PSD
    progress.append({"stage": "export", "status": "running"})
    stem = f"dashscope_layers_{uuid.uuid4().hex[:10]}"
    out_path = os.path.join(OUTPUT_DIR, f"{stem}.psd")
    try:
        _write_multi_layer_psd(out_path, layer_images)
    except Exception as exc:
        logger.error("[dashscope-layer] PSD write failed: %s", exc, exc_info=True)
        return {"success": False, "error": f"PSD 生成失败: {exc}", "progress": progress}

    progress[-1]["status"] = "done"
    filename = os.path.basename(out_path)
    total_api_calls = sum(api_stats.values())

    return {
        "success": True,
        "filename": filename,
        "local_path": out_path,
        "download_url": f"/api/media/{filename}",
        "format": "psd",
        "layer_count": len(layer_meta),
        "layers": layer_meta,
        "size_bytes": os.path.getsize(out_path) if os.path.isfile(out_path) else 0,
        "engine": "dashscope-edit",
        "progress": progress,
        "analysis": {
            "engine": "dashscope-edit",
            "provider": "dashscope",
            "model": model_id,
            "high_quality": high_quality,
            "refined_blocks": refine_count,
            "api_calls": api_stats,
            "total_api_calls": total_api_calls,
            "generative_background": bool(api_stats.get("generative_background")),
            "canvas_width": source.size[0],
            "canvas_height": source.size[1],
            **fuse_meta,
        },
    }
