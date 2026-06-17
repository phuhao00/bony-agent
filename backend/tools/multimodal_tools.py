"""
多模态工具集 — 对话中可调用的 4 个 LangChain 工具
- parse_document   : 解析 PDF/DOCX/TXT 等文档（调用 Rust 服务）
- ocr_image        : OCR 识别图片文字（调用 Python OCR 服务）
- analyze_video    : 提取视频元数据 + 关键帧时间戳（调用 Rust 服务）
- index_directory  : 索引本地目录并可选注入 RAG（调用 Go 服务）

当 gRPC 服务不可用时，工具会优雅降级：
  - parse_document → 用 LlamaIndex SimpleDirectoryReader 本地解析
  - ocr_image      → 返回提示信息，不崩溃
  - analyze_video  → 调用 ffprobe subprocess 获取基础元数据
  - index_directory → 用 os.walk 本地索引
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import Optional

from langchain.tools import tool
from utils.logger import setup_logger

logger = setup_logger("multimodal_tools")

PROJECT_ROOT = Path(__file__).parent.parent.parent
STORAGE_DIR = PROJECT_ROOT / "storage"


def _extracted_text_quality_poor(body: str, min_chars: int = 80) -> bool:
    """
    Rust 极简 PDF 流抽取 + from_utf8_lossy 易产生乱码却仍返回成功。
    用于判定是否应降级到 PyMuPDF / pypdf / 逐页 OCR。
    """
    s = (body or "").strip()
    if len(s) < 12:
        return True
    if s.count("\ufffd") / len(s) > 0.02:
        return True
    bad_ctrl = sum(1 for c in s if ord(c) < 32 and c not in "\t\n\r")
    if bad_ctrl / len(s) > 0.04:
        return True
    legible = sum(
        1
        for c in s
        if c.isalnum()
        or ("\u4e00" <= c <= "\u9fff")
        or c in "，。；：？！""''（）【】《》、·…—－,"
    )
    ratio = legible / len(s)
    if len(s) >= min_chars and ratio < 0.12:
        return True
    if len(s) < min_chars:
        return ratio < 0.28
    return False


def _pdf_text_pymupdf(path: Path, max_pages: int = 50) -> str:
    try:
        import fitz  # PyMuPDF
    except ImportError:
        return ""
    chunks: list[str] = []
    doc = None
    total_pages = 0
    try:
        doc = fitz.open(str(path))
        total_pages = doc.page_count
        for i in range(min(total_pages, max_pages)):
            page = doc[i]
            t = (page.get_text("text") or "").strip()
            if t:
                chunks.append(f"--- 第 {i + 1} 页 ---\n{t}")
    except Exception as e:
        logger.warning("_pdf_text_pymupdf: failed path=%s err=%s", path.name, e)
        return ""
    finally:
        if doc is not None:
            try:
                doc.close()
            except Exception:
                pass
    if not chunks:
        return ""
    return f"页数: {total_pages}\n" + "\n".join(chunks)


def _pdf_text_pypdf_body(path: Path, max_pages: int = 50) -> str:
    """仅正文块（带页眉），不含外层 [文档:] 摘要行。"""
    try:
        from pypdf import PdfReader

        reader = PdfReader(str(path))
        total_pages = len(reader.pages)
        chunks: list[str] = []
        for i, pg in enumerate(reader.pages[:max_pages]):
            t = (pg.extract_text() or "").strip()
            if t:
                chunks.append(f"--- 第 {i + 1} 页 ---\n{t}")
        if not chunks:
            return ""
        return f"页数: {total_pages}\n" + "\n".join(chunks)
    except Exception as e:
        logger.warning("_pdf_text_pypdf_body: failed path=%s err=%s", path.name, e)
        return ""


# ──────────────────────────────────────────────────────────
# 1. parse_document
# ──────────────────────────────────────────────────────────
@tool
def parse_document(file_path: str, extract_tables: bool = True) -> str:
    """
    解析文档文件（PDF、DOCX、TXT、Markdown、CSV、JSON、HTML），
    提取全文和结构化内容（含表格）。

    Args:
        file_path: 文档的绝对路径或相对于 storage/ 的路径
        extract_tables: 是否提取表格（默认 True）

    Returns:
        提取的全文内容，包含页码信息；失败时返回错误信息
    """
    path = _resolve_path(file_path)
    if not path.exists():
        logger.error("parse_document: file not found  input=%s resolved=%s", file_path, path)
        return f"[错误] 文件不存在: {file_path}"

    file_size = path.stat().st_size
    logger.info("parse_document START  path=%s  ext=%s  size=%d bytes  extract_tables=%s",
                path, path.suffix, file_size, extract_tables)

    # ── 尝试 gRPC Rust 服务 ───────────────────────────────
    try:
        from services.grpc_client import get_document_stub
        from generated.mediaagent import document_pb2, common_pb2  # type: ignore

        stub = get_document_stub()
        if stub is not None:
            logger.debug("parse_document: gRPC stub acquired, sending ParseDocument request")
            req = document_pb2.DocumentRequest(
                file_path=str(path),
                extract_tables=extract_tables,
                request_id=f"doc_{path.stem}",
            )
            resp = stub.ParseDocument(req, timeout=60)
            logger.debug("parse_document: gRPC response status=%s pages=%d",
                         resp.status, len(resp.pages))
            if resp.status == common_pb2.TASK_STATUS_COMPLETED:
                parts = [f"[文档: {resp.metadata.file_name}]",
                         f"格式: {resp.metadata.format}  页数: {resp.metadata.page_count}",
                         ""]
                for page in resp.pages[:50]:  # 最多 50 页
                    parts.append(f"--- 第 {page.page_number} 页 ---")
                    parts.append(page.text)
                result = "\n".join(parts)
                body_for_q = "\n".join(page.text for page in resp.pages[:50])
                if not (body_for_q or "").strip() or _extracted_text_quality_poor(body_for_q):
                    logger.warning(
                        "parse_document: gRPC text empty or low quality, local fallback path=%s",
                        path.name,
                    )
                    return _fallback_parse_document(path)
                logger.info("parse_document: gRPC OK  pages=%d  chars=%d",
                            len(resp.pages), len(result))
                return result
            else:
                logger.warning("parse_document: gRPC returned non-completed status=%s", resp.status)
        else:
            logger.debug("parse_document: gRPC document stub not available")
    except Exception as e:
        logger.warning("parse_document: gRPC failed, falling back to local parser  error=%s", e, exc_info=True)

    # ── 降级：本地解析 ────────────────────────────────────
    logger.info("parse_document: using local fallback for %s", path.name)
    return _fallback_parse_document(path)


def _fallback_parse_document(path: Path) -> str:
    # Fast path: plain-text formats — just read directly
    _PLAIN_EXTS = {".txt", ".md", ".csv", ".json", ".xml", ".html", ".htm", ".yaml", ".yml", ".log"}
    if path.suffix.lower() in _PLAIN_EXTS:
        logger.debug("_fallback_parse_document: plain-text fast path for %s", path.name)
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
            truncated = len(text) > 50_000
            if truncated:
                text = text[:50_000] + "\n... [已截断, 共 " + str(len(text)) + " 字符]"
            logger.info("_fallback_parse_document: plain-text OK  chars=%d truncated=%s", len(text), truncated)
            return f"[文件: {path.name}]\n{text}"
        except Exception as e:
            logger.error("_fallback_parse_document: plain-text read failed  path=%s  error=%s", path, e)
            return f"[错误] 文本文件读取失败: {e}"

    if path.suffix.lower() == ".pdf":
        logger.debug("_fallback_parse_document: PDF PyMuPDF / pypdf / OCR for %s", path.name)
        body = _pdf_text_pymupdf(path)
        if body and not _extracted_text_quality_poor(body):
            result = f"[文档: {path.name}]\n格式: PDF\n{body}"
            logger.info("_fallback_parse_document: PyMuPDF OK chars=%d", len(result))
            return result
        body = _pdf_text_pypdf_body(path)
        if body and not _extracted_text_quality_poor(body):
            result = f"[文档: {path.name}]\n格式: PDF\n{body}"
            logger.info("_fallback_parse_document: pypdf OK chars=%d", len(result))
            return result
        logger.info("_fallback_parse_document: trying PDF page OCR for %s", path.name)
        ocr_body = _pdf_render_pages_ocr(path)
        if ocr_body.strip():
            result = f"[文档: {path.name}]\n格式: PDF（逐页 OCR）\n{ocr_body}"
            logger.info("_fallback_parse_document: PDF OCR OK chars=%d", len(result))
            return result
        logger.warning("_fallback_parse_document: PDF extract+pypdf+OCR yielded nothing usable for %s", path.name)

    # General fallback via LlamaIndex
    logger.debug("_fallback_parse_document: trying LlamaIndex SimpleDirectoryReader for %s", path.name)
    try:
        from llama_index.core import SimpleDirectoryReader
        docs = SimpleDirectoryReader(input_files=[str(path)]).load_data()
        if not docs:
            logger.warning("_fallback_parse_document: LlamaIndex returned 0 docs for %s", path.name)
            return f"[警告] 文件内容为空: {path.name}"
        texts = [f"--- 节点 {i+1} ---\n{d.text}" for i, d in enumerate(docs[:50])]
        result = f"[文档: {path.name}]\n" + "\n".join(texts)
        logger.info("_fallback_parse_document: LlamaIndex OK  docs=%d  chars=%d", len(docs), len(result))
        return result
    except Exception as e:
        logger.error("_fallback_parse_document: all fallbacks failed  path=%s  error=%s", path, e)
        return f"[错误] 文档解析失败: {e}"


# ──────────────────────────────────────────────────────────
# 2. ocr_image
# ──────────────────────────────────────────────────────────
@tool
def ocr_image(image_path: str, languages: Optional[list] = None) -> str:
    """
    对图片执行 OCR 文字识别，支持中英日韩等多语言。

    Args:
        image_path: 图片文件路径（PNG/JPG/WebP/GIF）
        languages:  语言列表，如 ["ch_sim", "en"]（默认自动检测中英）

    Returns:
        识别出的文字内容；识别失败时返回错误信息
    """
    if languages is None:
        languages = ["ch_sim", "en"]

    path = _resolve_path(image_path)
    if not path.exists():
        logger.error("ocr_image: file not found  input=%s resolved=%s", image_path, path)
        return f"[错误] 图片不存在: {image_path}"

    file_size = path.stat().st_size
    logger.info("ocr_image START  path=%s  ext=%s  size=%d bytes  langs=%s",
                path, path.suffix, file_size, languages)

    # ── 尝试 gRPC OCR 服务 ────────────────────────────────
    try:
        from services.grpc_client import get_ocr_stub
        from generated.mediaagent import ocr_pb2, common_pb2  # type: ignore

        stub = get_ocr_stub()
        if stub is not None:
            logger.debug("ocr_image: gRPC OCR stub acquired, sending ExtractText request")
            req = ocr_pb2.OCRRequest(
                image_path=str(path),
                languages=languages,
                detect_tables=True,
            )
            resp = stub.ExtractText(req, timeout=30)
            logger.debug("ocr_image: gRPC response status=%s blocks=%d",
                         resp.status, len(resp.blocks))
            if resp.status == common_pb2.TASK_STATUS_COMPLETED and resp.full_text:
                logger.info("ocr_image: gRPC OCR OK  confidence=%.2f  lang=%s  chars=%d",
                            resp.avg_confidence, resp.detected_language, len(resp.full_text))
                return (
                    f"[OCR 结果: {path.name}]\n"
                    f"置信度: {resp.avg_confidence:.2f}  检测语言: {resp.detected_language}\n\n"
                    + resp.full_text
                )
            else:
                logger.warning("ocr_image: gRPC OCR returned status=%s full_text_empty=%s",
                               resp.status, not resp.full_text)
        else:
            logger.debug("ocr_image: gRPC OCR stub not available, will use vision LLM")
    except Exception as e:
        logger.warning("ocr_image: gRPC failed, falling back to vision LLM  error=%s", e, exc_info=True)

    logger.info("ocr_image: falling back to vision LLM for %s", path.name)
    return _fallback_vision_llm(path, languages)


def _vision_llm_refusal(text: str) -> bool:
    """文本模型收到 image_url 时常回复「无法看图」类话术。"""
    s = (text or "").strip().lower()
    if not s:
        return False
    needles = (
        "无法直接查看",
        "无法查看",
        "不能查看",
        "无法看到",
        "无法访问图片",
        "看不到图片",
        "cannot view",
        "can't view",
        "unable to view",
        "cannot see the image",
        "can't see the image",
        "do not have the ability to view",
        "unable to access the image",
    )
    return any(n in s for n in needles)


def _call_vision_llm_api(
    path: Path,
    languages: Optional[list],
    vision_model: str,
) -> str:
    import base64
    from openai import OpenAI
    from core.llm_provider import get_provider_id, get_api_key, get_provider_config

    provider_id = get_provider_id()
    key = get_api_key(provider_id)
    if not key:
        raise RuntimeError("视觉 LLM API Key 未配置")

    cfg = get_provider_config()
    ext = path.suffix.lower()
    _MIME = {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
        ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp",
    }
    mime = _MIME.get(ext, "image/jpeg")

    with open(path, "rb") as fh:
        b64 = base64.b64encode(fh.read()).decode()

    lang_hint = ""
    if languages:
        lang_map = {"ch_sim": "中文", "ch_tra": "繁中文", "en": "英文",
                    "ja": "日文", "ko": "韩文"}
        names = [lang_map.get(l, l) for l in languages]
        lang_hint = f"（重点识别语言：{', '.join(names)}）"

    client = OpenAI(api_key=key, base_url=cfg.base_url)
    resp = client.chat.completions.create(
        model=vision_model,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
                {
                    "type": "text",
                    "text": (
                        "请详细描述并提取这张图片中的所有内容，包括文字、图表、数据、符号等。"
                        "如果有文字请完整地提取出来。"
                        f"{lang_hint}"
                    ),
                },
            ],
        }],
        max_tokens=2000,
    )
    return resp.choices[0].message.content or ""


def _fallback_vision_llm(path: Path, languages: Optional[list] = None) -> str:
    """当 OCR 服务不可用时，用视觉 LLM 直接理解图片内容。"""
    try:
        from core.llm_provider import (
            get_provider_id,
            get_api_key,
            get_vision_model,
            default_vision_model_for_provider,
            is_vision_capable_model,
        )

        provider_id = get_provider_id()
        key = get_api_key(provider_id)
        logger.debug("_fallback_vision_llm: provider=%s key_set=%s", provider_id, bool(key))
        if not key:
            logger.warning("_fallback_vision_llm: no API key for provider=%s, cannot process image", provider_id)
            return "[提示] 图片内容无法提取（OCR服务未启动，视觉LLM API Key未配置）"

        vision_model = get_vision_model(provider_id)
        if not is_vision_capable_model(vision_model):
            vision_model = default_vision_model_for_provider(provider_id)

        logger.info(
            "_fallback_vision_llm: using model=%s  path=%s  size=%d bytes",
            vision_model, path.name, path.stat().st_size,
        )

        text = _call_vision_llm_api(path, languages, vision_model)

        if _vision_llm_refusal(text):
            fallback = default_vision_model_for_provider(provider_id)
            if fallback != vision_model:
                logger.warning(
                    "Vision model %s refused image (%s); retrying with %s",
                    vision_model,
                    path.name,
                    fallback,
                )
                text = _call_vision_llm_api(path, languages, fallback)
                vision_model = fallback

        logger.info("Vision LLM fallback OK path=%s model=%s chars=%d", path.name, vision_model, len(text))
        return f"[图片视觉理解: {path.name}  model={vision_model}]\n{text}"

    except Exception as e:
        logger.error("_fallback_vision_llm: failed  path=%s  error=%s", path.name, e, exc_info=True)
        return f"[提示] 图片内容提取失败（OCR未启动，视觉LLM错误: {e}）"


def _is_ocr_unavailable_message(text: str) -> bool:
    """OCR / 视觉模型不可用时的占位话术，不能当作有效正文。"""
    s = (text or "").strip()
    if not s:
        return True
    needles = (
        "[提示]",
        "无法提取",
        "OCR服务未启动",
        "视觉LLM API Key未配置",
        "图片内容提取失败",
    )
    return any(n in s for n in needles)


def _ocr_pdf_page_image(img_path: Path, page_no: int) -> str:
    r = ocr_image.invoke({"image_path": str(img_path), "languages": ["ch_sim", "en"]})
    if not isinstance(r, str):
        return ""
    body = r.strip()
    if not body or _is_ocr_unavailable_message(body):
        return ""
    return f"--- 第 {page_no} 页 (OCR) ---\n{body}"


def _pdf_render_pages_ocr(path: Path, max_pages: int = 15) -> str:
    """将 PDF 页渲染为位图后走 ocr_image（gRPC / 视觉模型），用于扫描件或无效字体编码。"""
    try:
        import fitz  # PyMuPDF
    except ImportError:
        return ""
    from concurrent.futures import ThreadPoolExecutor, as_completed

    tmp_root = STORAGE_DIR / "temp" / "pdf_ocr" / uuid.uuid4().hex
    page_jobs: list[tuple[int, Path]] = []
    doc = None
    try:
        tmp_root.mkdir(parents=True, exist_ok=True)
        doc = fitz.open(str(path))
        n = min(doc.page_count, max_pages)
        zoom = fitz.Matrix(1.25, 1.25)
        for i in range(n):
            page = doc[i]
            pix = page.get_pixmap(matrix=zoom, alpha=False)
            img_path = tmp_root / f"page_{i + 1:03d}.jpg"
            pix.save(str(img_path), jpg_quality=85)
            page_jobs.append((i + 1, img_path))
    except Exception as e:
        logger.warning("_pdf_render_pages_ocr: failed path=%s err=%s", path.name, e)
        return ""
    finally:
        if doc is not None:
            try:
                doc.close()
            except Exception:
                pass

    if not page_jobs:
        shutil.rmtree(tmp_root, ignore_errors=True)
        return ""

    chunks_by_page: dict[int, str] = {}
    workers = min(3, len(page_jobs))
    try:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {
                pool.submit(_ocr_pdf_page_image, img_path, page_no): page_no
                for page_no, img_path in page_jobs
            }
            for fut in as_completed(futures):
                page_no = futures[fut]
                try:
                    chunk = fut.result()
                except Exception as ex:
                    logger.warning(
                        "_pdf_render_pages_ocr: page %s failed path=%s err=%s",
                        page_no,
                        path.name,
                        ex,
                    )
                    continue
                if chunk:
                    chunks_by_page[page_no] = chunk
    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)

    if not chunks_by_page:
        return ""
    return "\n".join(chunks_by_page[i] for i in sorted(chunks_by_page))


def extract_pdf_text_for_rag(
    path: Path, *, max_pages: int = 50, allow_ocr: bool = True
) -> str:
    """为 RAG 索引提取 PDF 正文：PyMuPDF → pypdf →（可选）逐页 OCR。"""
    body = _pdf_text_pymupdf(path, max_pages=max_pages)
    if body and not _extracted_text_quality_poor(body):
        return body
    body = _pdf_text_pypdf_body(path, max_pages=max_pages)
    if body and not _extracted_text_quality_poor(body):
        return body
    if not allow_ocr:
        logger.debug("extract_pdf_text_for_rag: skip OCR (fast mode) for %s", path.name)
        return body or ""
    logger.info("extract_pdf_text_for_rag: text layer empty, OCR fallback for %s", path.name)
    return _pdf_render_pages_ocr(path, max_pages=max_pages)


# ──────────────────────────────────────────────────────────
# 3. analyze_video
# ──────────────────────────────────────────────────────────
@tool
def analyze_video(video_path: str, max_frames: int = 10) -> str:
    """
    分析视频文件，提取时长、编码、轨道信息和关键帧时间戳。

    Args:
        video_path: 视频文件路径（MP4/MOV/WebM/MKV）
        max_frames: 最多提取的关键帧数量（默认 10）

    Returns:
        视频元数据 JSON + 关键帧时间戳列表；失败时返回错误信息
    """
    path = _resolve_path(video_path)
    if not path.exists():
        logger.error("analyze_video: file not found  input=%s resolved=%s", video_path, path)
        return f"[错误] 视频不存在: {video_path}"

    file_size = path.stat().st_size
    logger.info("analyze_video START  path=%s  ext=%s  size=%d bytes  max_frames=%d",
                path, path.suffix, file_size, max_frames)

    # ── 尝试 gRPC Rust 服务 ───────────────────────────────
    try:
        from services.grpc_client import get_video_stub
        from generated.mediaagent import video_pb2, common_pb2  # type: ignore

        stub = get_video_stub()
        if stub is not None:
            logger.debug("analyze_video: gRPC stub acquired, sending ExtractKeyFrames request")
            req = video_pb2.VideoRequest(
                file_path=str(path),
                max_frames=max_frames,
            )
            resp = stub.ExtractKeyFrames(req, timeout=60)
            logger.debug("analyze_video: gRPC response status=%s frames=%d",
                         resp.status, len(resp.frames))
            if resp.status == common_pb2.TASK_STATUS_COMPLETED:
                meta = resp.metadata
                lines = [
                    f"[视频: {path.name}]",
                    f"容器: {meta.container}  时长: {meta.duration_ms/1000:.1f}s",
                    f"文件大小: {meta.file_size/1024/1024:.1f} MB",
                    f"关键帧时间戳(ms): {[f.timestamp_ms for f in resp.frames]}",
                ]
                result = "\n".join(lines)
                logger.info("analyze_video: gRPC OK  duration_ms=%d  frames=%d",
                            meta.duration_ms, len(resp.frames))
                return result
            else:
                logger.warning("analyze_video: gRPC returned non-completed status=%s", resp.status)
        else:
            logger.debug("analyze_video: gRPC video stub not available, will use ffprobe")
    except Exception as e:
        logger.warning("analyze_video: gRPC failed, falling back to ffprobe  error=%s", e, exc_info=True)

    logger.info("analyze_video: using ffprobe fallback for %s", path.name)
    return _fallback_analyze_video(path)


def _fallback_analyze_video(path: Path) -> str:
    logger.debug("_fallback_analyze_video: running ffprobe on %s", path.name)
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json",
             "-show_streams", "-show_format", str(path)],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            logger.error("_fallback_analyze_video: ffprobe exited %d  stderr=%s",
                         result.returncode, result.stderr[:300])
            return f"[错误] ffprobe 失败: {result.stderr[:200]}"
        data = json.loads(result.stdout)
        fmt = data.get("format", {})
        streams = data.get("streams", [])
        lines = [
            f"[视频: {path.name}]",
            f"时长: {float(fmt.get('duration', 0)):.1f}s  "
            f"大小: {int(fmt.get('size', 0))/1024/1024:.1f}MB",
        ]
        for s in streams:
            codec = s.get("codec_name", "?")
            ctype = s.get("codec_type", "?")
            if ctype == "video":
                lines.append(f"视频轨: {codec} {s.get('width')}x{s.get('height')} "
                             f"@ {s.get('r_frame_rate', '?')} fps")
            elif ctype == "audio":
                lines.append(f"音频轨: {codec} {s.get('sample_rate')}Hz")
        result = "\n".join(lines)
        logger.info("_fallback_analyze_video: ffprobe OK  duration=%.1fs  streams=%d",
                    float(fmt.get('duration', 0)), len(streams))
        return result
    except FileNotFoundError:
        logger.warning("_fallback_analyze_video: ffprobe not installed")
        return "[提示] ffprobe 未安装，且 gRPC 解析服务不可用"
    except Exception as e:
        logger.error("_fallback_analyze_video: failed  path=%s  error=%s", path, e)
        return f"[错误] 视频分析失败: {e}"


# ──────────────────────────────────────────────────────────
# 4. index_directory
# ──────────────────────────────────────────────────────────
@tool
def index_directory(
    directory_path: str,
    extensions: Optional[list] = None,
    recursive: bool = True,
    ingest_to_rag: bool = False,
) -> str:
    """
    索引本地目录，列出文件清单并可选提取文本内容。
    可将文档批量注入 RAG 知识库。

    Args:
        directory_path: 要索引的目录路径
        extensions:     文件扩展名过滤，如 [".pdf", ".txt"]（None = 全部）
        recursive:      是否递归子目录（默认 True）
        ingest_to_rag:  是否将文档注入 RAG 知识库（默认 False）

    Returns:
        文件清单摘要；ingest_to_rag=True 时包含入库结果
    """
    path = _resolve_path(directory_path)
    if not path.exists() or not path.is_dir():
        logger.error("index_directory: path not found or not a directory  input=%s resolved=%s",
                     directory_path, path)
        return f"[错误] 目录不存在: {directory_path}"

    logger.info("index_directory START  path=%s  exts=%s  recursive=%s  rag=%s",
                path, extensions, recursive, ingest_to_rag)

    # ── 尝试 gRPC Go 服务 ──────────────────────────────────
    try:
        from services.grpc_client import get_directory_stub
        from generated.mediaagent import directory_pb2  # type: ignore

        stub = get_directory_stub()
        if stub is not None:
            logger.debug("index_directory: gRPC stub acquired, streaming IndexDirectory")
            req = directory_pb2.IndexRequest(
                root_path=str(path),
                extensions=extensions or [],
                recursive=recursive,
                extract_text=True,
            )
            entries = []
            for progress in stub.IndexDirectory(req, timeout=120):
                if progress.is_done:
                    logger.info("index_directory: gRPC OK  found=%d  indexed=%d",
                                progress.files_found, progress.files_indexed)
                    summary = (
                        f"[目录索引完成: {path}]\n"
                        f"发现文件: {progress.files_found}  "
                        f"已索引: {progress.files_indexed}"
                    )
                    if ingest_to_rag and entries:
                        rag_result = _ingest_to_rag(entries)
                        summary += f"\n{rag_result}"
                    return summary
                if progress.current_file:
                    entries.append(progress.current_file)
        else:
            logger.debug("index_directory: gRPC directory stub not available, will use os.walk")
    except Exception as e:
        logger.warning("index_directory: gRPC failed, falling back to os.walk  error=%s", e, exc_info=True)

    logger.info("index_directory: using os.walk fallback for %s", path)
    return _fallback_index_directory(path, extensions, recursive, ingest_to_rag)


def _fallback_index_directory(
    path: Path,
    extensions: Optional[list],
    recursive: bool,
    ingest_to_rag: bool,
) -> str:
    ext_set = set(extensions or [])
    files = []

    if recursive:
        for root, _, fnames in os.walk(path):
            for fname in fnames:
                fpath = Path(root) / fname
                if not ext_set or fpath.suffix.lower() in ext_set:
                    files.append(str(fpath))
    else:
        files = [
            str(f) for f in path.iterdir()
            if f.is_file() and (not ext_set or f.suffix.lower() in ext_set)
        ]

    logger.info("_fallback_index_directory: os.walk found %d files in %s", len(files), path)

    summary = (
        f"[目录索引: {path}]\n"
        f"共发现 {len(files)} 个文件"
    )
    if files[:20]:
        preview = "\n".join(f"  {f}" for f in files[:20])
        if len(files) > 20:
            preview += f"\n  ... 以及 {len(files)-20} 个文件"
        summary += f"\n{preview}"

    if ingest_to_rag and files:
        rag_result = _ingest_to_rag(files)
        summary += f"\n{rag_result}"

    return summary


def _ingest_to_rag(file_paths: list) -> str:
    try:
        from utils.rag_manager import get_rag_manager  # type: ignore
        rag = get_rag_manager()
        result = rag.ingest_documents(file_paths)
        return f"[RAG 入库] 成功: {result.get('documents_added', 0)} 个文档"
    except Exception as e:
        return f"[RAG 入库失败] {e}"


# ── 路径解析工具 ──────────────────────────────────────────
def _resolve_path(p: str) -> Path:
    path = Path(p)
    if path.is_absolute():
        return path
    # 相对路径：先尝试 storage/，再尝试项目根
    for base in [STORAGE_DIR, PROJECT_ROOT]:
        candidate = base / p
        if candidate.exists():
            return candidate
    return path  # 原样返回，让调用方处理不存在的情况
