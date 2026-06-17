"""从截图/录屏/GIF 分析软件缺陷，生成 TAPD 缺陷表单字段。"""

from __future__ import annotations

import base64
import json
import re
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import Any, Optional

from utils.logger import setup_logger

logger = setup_logger("tapd_bug_analyze")

PROJECT_ROOT = Path(__file__).parent.parent.parent
TEMP_DIR = PROJECT_ROOT / "storage" / "temp" / "tapd_analyze"

_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}
_VIDEO_EXTS = {".mp4", ".mov", ".webm", ".avi", ".mkv"}
_MIME = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
}
_VALID_PRIORITIES = {"urgent", "high", "medium", "low"}

_VISION_PROMPT = (
    "你是资深 QA 工程师，从软件截图或录屏帧中识别缺陷。"
    "只输出一个 JSON 对象，不要解释、不要 markdown 代码块。字段：\n"
    '- title: 简短缺陷标题（20字以内）\n'
    "- description: 完整缺陷描述，用中文，结构包含："
    "【问题概述】【复现步骤】【实际结果】【期望结果】【补充说明】；"
    "步骤用有序列表；不可见的信息（版本号、账号等）填「待补充」，不要编造\n"
    '- priority: 优先级，只能是 urgent、high、medium、low 之一\n'
    "- confidence: 0~1 置信度\n"
    "若图片中看不出明显缺陷，仍尽量描述可见的 UI/错误信息，priority 设为 medium。"
)

_MERGE_PROMPT = (
    "你是资深 QA，以下是同一条缺陷的多份分析结果（可能包含 UI 截图/录屏分析与 HAR 网络抓包分析）。"
    "请合并为一条完整缺陷报告，把界面表现与接口/网络证据关联起来。"
    "只输出一个 JSON 对象，不要 markdown。字段：title, description, priority, confidence。"
    "description 保持【问题概述】【复现步骤】【实际结果】【期望结果】【补充说明】结构；"
    "网络证据写入【实际结果】或【补充说明】中的「网络证据」小节。"
    "priority 取各结果中最高的（urgent > high > medium > low）。"
)


def _parse_json(text: str) -> dict:
    if not text:
        return {}
    s = text.strip()
    s = re.sub(r"^```(?:json)?\s*", "", s)
    s = re.sub(r"\s*```$", "", s)
    try:
        return json.loads(s)
    except Exception:
        m = re.search(r"\{.*\}", s, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                return {}
    return {}


def _norm_priority(raw: Any) -> str:
    if not raw:
        return "medium"
    s = str(raw).strip().lower()
    if s in _VALID_PRIORITIES:
        return s
    mapping = {
        "紧急": "urgent",
        "高": "high",
        "中": "medium",
        "低": "low",
        "p0": "urgent",
        "p1": "high",
        "p2": "medium",
        "p3": "low",
    }
    return mapping.get(s, "medium")


def _is_image(filename: str, content_type: str) -> bool:
    ct = (content_type or "").lower()
    if ct.startswith("image/"):
        return True
    ext = Path(filename).suffix.lower()
    return ext in _IMAGE_EXTS


def _is_video(filename: str, content_type: str) -> bool:
    ct = (content_type or "").lower()
    if ct.startswith("video/"):
        return True
    ext = Path(filename).suffix.lower()
    return ext in _VIDEO_EXTS


def _video_duration_sec(video_path: Path) -> float:
    try:
        cmd = [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(video_path),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode == 0 and result.stdout.strip():
            return max(0.1, float(result.stdout.strip()))
    except Exception as e:
        logger.warning("ffprobe duration failed: %s", e)
    return 1.0


def _extract_video_frames(video_path: Path, out_dir: Path, count: int = 3) -> list[Path]:
    if not shutil.which("ffmpeg"):
        logger.warning("ffmpeg not available, trying first frame only")
        count = 1

    duration = _video_duration_sec(video_path)
    if count <= 1:
        ratios = [0.0]
    else:
        ratios = [0.0, 0.5, 0.9][:count]

    frames: list[Path] = []
    for i, ratio in enumerate(ratios):
        ts = max(0.0, duration * ratio)
        out = out_dir / f"frame_{i:02d}.jpg"
        cmd = [
            "ffmpeg",
            "-y",
            "-ss",
            f"{ts:.3f}",
            "-i",
            str(video_path),
            "-frames:v",
            "1",
            "-q:v",
            "2",
            str(out),
        ]
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=60,
            )
            if result.returncode == 0 and out.exists() and out.stat().st_size > 0:
                frames.append(out)
        except Exception as e:
            logger.warning("ffmpeg frame extract failed at %.2fs: %s", ts, e)

    if not frames and shutil.which("ffmpeg"):
        out = out_dir / "frame_fallback.jpg"
        cmd = [
            "ffmpeg",
            "-y",
            "-i",
            str(video_path),
            "-frames:v",
            "1",
            "-q:v",
            "2",
            str(out),
        ]
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            if result.returncode == 0 and out.exists():
                frames.append(out)
        except Exception as e:
            logger.warning("ffmpeg fallback frame failed: %s", e)

    return frames


def _image_to_data_uri(path: Path) -> str:
    ext = path.suffix.lower()
    mime = _MIME.get(ext, "image/jpeg")
    b64 = base64.b64encode(path.read_bytes()).decode()
    return f"data:{mime};base64,{b64}"


def _call_vision_json(
    image_paths: list[Path],
    extra_context: str = "",
) -> dict[str, Any]:
    from openai import OpenAI
    from core.llm_provider import resolve_vision_credentials

    provider_id, model, key, cfg = resolve_vision_credentials()
    if not key:
        return {
            "ok": False,
            "error": (
                "视觉模型 API Key 未配置。"
                "通义 Qwen 请设置 ALIBABA_API_KEY 或 DASHSCOPE_API_KEY，"
                "或在设置中将 LLM_VISION_PROVIDER 设为 alibaba。"
            ),
        }

    if not image_paths:
        return {"ok": False, "error": "没有可分析的图片帧"}

    content: list[dict[str, Any]] = []
    for p in image_paths:
        if p.exists():
            content.append(
                {"type": "image_url", "image_url": {"url": _image_to_data_uri(p)}}
            )

    prompt = _VISION_PROMPT
    if extra_context.strip():
        prompt += f"\n\n补充上下文：{extra_context.strip()}"

    content.append({"type": "text", "text": prompt})

    try:
        client = OpenAI(api_key=key, base_url=cfg.base_url)
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": content}],
            max_tokens=2000,
            temperature=0,
        )
        raw = resp.choices[0].message.content or ""
        logger.info(
            "[tapd] vision provider=%s model=%s raw=%s",
            provider_id,
            model,
            repr(raw[:120]),
        )
        parsed = _parse_json(raw)
        if not parsed.get("title") and not parsed.get("description"):
            return {
                "ok": False,
                "error": "模型未能解析出有效缺陷信息，请重试或手动填写",
                "raw": raw,
                "model": model,
            }
        return {
            "ok": True,
            "title": str(parsed.get("title") or "待补充缺陷标题").strip()[:120],
            "description": str(parsed.get("description") or "").strip(),
            "priority": _norm_priority(parsed.get("priority")),
            "confidence": parsed.get("confidence"),
            "model": model,
            "raw": raw,
        }
    except Exception as e:
        logger.error("vision analyze failed: %s", e, exc_info=True)
        return {"ok": False, "error": f"视觉分析失败：{str(e)[:200]}"}


def _merge_analyses(partials: list[dict[str, Any]]) -> dict[str, Any]:
    if not partials:
        return {"ok": False, "error": "没有分析结果"}
    if len(partials) == 1:
        return partials[0]

    from langchain_core.messages import HumanMessage, SystemMessage
    from core.llm_provider import get_chat_llm

    payload = json.dumps(
        [
            {
                "title": p.get("title"),
                "description": p.get("description"),
                "priority": p.get("priority"),
            }
            for p in partials
        ],
        ensure_ascii=False,
        indent=2,
    )
    try:
        llm = get_chat_llm(temperature=0)
        resp = llm.invoke(
            [
                SystemMessage(content=_MERGE_PROMPT),
                HumanMessage(content=f"请合并以下分析结果：\n{payload}"),
            ]
        )
        raw = resp.content if hasattr(resp, "content") else str(resp)
        parsed = _parse_json(str(raw))
        if parsed.get("title") or parsed.get("description"):
            return {
                "ok": True,
                "title": str(parsed.get("title") or partials[0].get("title", "")).strip(),
                "description": str(
                    parsed.get("description") or partials[0].get("description", "")
                ).strip(),
                "priority": _norm_priority(parsed.get("priority") or partials[0].get("priority")),
                "confidence": parsed.get("confidence"),
                "model": partials[0].get("model"),
            }
    except Exception as e:
        logger.warning("merge via LLM failed, using first result: %s", e)

    priority_rank = {"urgent": 4, "high": 3, "medium": 2, "low": 1}
    best = max(partials, key=lambda p: priority_rank.get(str(p.get("priority")), 0))
    descriptions = [str(p.get("description") or "").strip() for p in partials if p.get("description")]
    merged_desc = best.get("description") or ""
    if len(descriptions) > 1:
        merged_desc = "\n\n---\n\n".join(descriptions)
    return {
        "ok": True,
        "title": str(best.get("title") or "待补充缺陷标题").strip(),
        "description": merged_desc,
        "priority": _norm_priority(best.get("priority")),
        "confidence": best.get("confidence"),
        "model": best.get("model"),
    }


def _analyze_single_file(
    content: bytes,
    filename: str,
    content_type: str,
    work_dir: Path,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """分析单个附件，返回 (analysis_result, analyzed_meta)。"""
    safe_name = Path(filename).name or "upload.bin"
    src = work_dir / safe_name
    src.write_bytes(content)

    if _is_image(safe_name, content_type):
        result = _call_vision_json([src], extra_context=f"来源文件：{safe_name}")
        meta = {"filename": safe_name, "kind": "image"}
        return result, meta

    if _is_video(safe_name, content_type):
        frame_dir = work_dir / f"frames_{uuid.uuid4().hex[:8]}"
        frame_dir.mkdir(parents=True, exist_ok=True)
        frames = _extract_video_frames(src, frame_dir)
        if not frames:
            return (
                {"ok": False, "error": f"无法从视频 {safe_name} 提取帧（需安装 ffmpeg）"},
                {"filename": safe_name, "kind": "video", "frames": 0},
            )
        ctx = f"来源：录屏视频 {safe_name}，共 {len(frames)} 帧（按时间顺序）"
        result = _call_vision_json(frames, extra_context=ctx)
        meta = {"filename": safe_name, "kind": "video", "frames": len(frames)}
        return result, meta

    from services.tapd_har_analyze import analyze_har_bytes, is_har_file

    if is_har_file(safe_name, content_type, content):
        return analyze_har_bytes(content, filename=safe_name)

    return (
        {"ok": False, "error": f"不支持的文件类型：{safe_name}"},
        {"filename": safe_name, "kind": "unknown"},
    )


def analyze_bug_media(
    file_payloads: list[tuple[bytes, str, str]],
) -> dict[str, Any]:
    """
    分析多个附件，返回 TAPD 缺陷表单字段。

    Args:
        file_payloads: [(content, filename, content_type), ...]

    Returns:
        { ok, title?, description?, priority?, confidence?, model?, analyzed?, error? }
    """
    if not file_payloads:
        return {"ok": False, "error": "请至少上传一个附件（截图/录屏/HAR）"}

    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    session_dir = TEMP_DIR / uuid.uuid4().hex
    session_dir.mkdir(parents=True, exist_ok=True)

    partials: list[dict[str, Any]] = []
    analyzed_meta: list[dict[str, Any]] = []
    errors: list[str] = []

    try:
        for content, filename, content_type in file_payloads:
            if not content:
                continue
            file_dir = session_dir / uuid.uuid4().hex[:8]
            file_dir.mkdir(parents=True, exist_ok=True)
            result, meta = _analyze_single_file(content, filename, content_type, file_dir)
            analyzed_meta.append(meta)
            if result.get("ok"):
                partials.append(result)
            else:
                errors.append(str(result.get("error") or f"{filename} 分析失败"))

        if not partials:
            return {
                "ok": False,
                "error": errors[0] if errors else "未能从附件中识别缺陷",
                "analyzed": analyzed_meta,
            }

        merged = _merge_analyses(partials)
        if not merged.get("ok"):
            return {**merged, "analyzed": analyzed_meta}

        return {
            "ok": True,
            "title": merged.get("title"),
            "description": merged.get("description"),
            "priority": merged.get("priority", "medium"),
            "confidence": merged.get("confidence"),
            "model": merged.get("model"),
            "analyzed": analyzed_meta,
            "partial_errors": errors or None,
        }
    finally:
        try:
            shutil.rmtree(session_dir, ignore_errors=True)
        except Exception:
            pass
