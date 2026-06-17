"""
Logo motion generation wrapper for nolangz/pixel2motion.

Vendored scripts live in backend/tools/pixel2motion/.
This module turns a raster logo into a motion-ready SVG + standalone animated HTML,
plus a frame strip for QA. It requires Chrome/Chromium and optionally Playwright.

License: pixel2motion is MIT licensed; see backend/tools/pixel2motion/LICENSE.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Any, Optional
from xml.etree import ElementTree as ET

import requests
from langchain.tools import tool
from openai import OpenAI

from core.llm_provider import PROVIDERS, get_api_key, get_provider_id
from tools.media_common import OUTPUT_DIR, is_safe_fetch_url
from utils.logger import setup_logger

logger = setup_logger("logo_motion_tools")

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
PIXEL2MOTION_DIR = Path(__file__).resolve().parent / "pixel2motion"
STORAGE_TMP = PROJECT_ROOT / "storage" / "tmp"
STORAGE_TMP.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def _find_chrome() -> str:
    candidates = [
        os.environ.get("CHROME_BIN", ""),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "google-chrome",
        "chromium",
        "chromium-browser",
    ]
    for cand in candidates:
        if not cand:
            continue
        if Path(cand).exists():
            return cand
        found = shutil.which(cand)
        if found:
            return found
    raise RuntimeError("未找到 Chrome/Chromium。请设置 CHROME_BIN 环境变量或安装 Chromium。")


def _local_path_from_url(url: str) -> Optional[str]:
    """Resolve an /api/media/<file> or /uploads/<file> URL to a local path."""
    if not url:
        return None
    url = url.strip().split("?")[0]
    if url.startswith("/api/media/"):
        filename = url[len("/api/media/") :]
        return str(PROJECT_ROOT / "storage" / "outputs" / filename)
    if url.startswith("/media/"):
        filename = url[len("/media/") :]
        return str(PROJECT_ROOT / "storage" / "outputs" / filename)
    if url.startswith("/uploads/"):
        filename = url[len("/uploads/") :]
        return str(PROJECT_ROOT / "storage" / "uploads" / filename)
    # Also accept full URLs pointing at our own backend/frontend media endpoints
    lower = url.lower()
    for prefix in ("/api/media/", "/media/", "/uploads/"):
        idx = lower.find(prefix)
        if idx != -1:
            filename = url[idx + len(prefix) :]
            if prefix in ("/api/media/", "/media/"):
                return str(PROJECT_ROOT / "storage" / "outputs" / filename)
            return str(PROJECT_ROOT / "storage" / "uploads" / filename)
    return None


def _resolve_source_image(url: str) -> str:
    """Return a local file path for the source image, downloading if necessary."""
    stripped = (url or "").strip().split("?")[0]

    # Absolute local file path
    if stripped.startswith("/") and Path(stripped).is_file():
        return stripped

    local = _local_path_from_url(stripped)
    if local and Path(local).exists():
        return local

    # Relative API paths are internal endpoints; fetch from the backend itself.
    if stripped.startswith(("/api/media/", "/media/", "/uploads/")):
        backend = os.environ.get("BACKEND_URL", "http://localhost:8000").rstrip("/")
        if stripped.startswith("/api/media/"):
            remote_url = f"{backend}/media/{stripped[len('/api/media/'):]}"
        elif stripped.startswith("/media/"):
            remote_url = f"{backend}{stripped}"
        else:
            remote_url = f"{backend}{stripped}"
        resp = requests.get(remote_url, timeout=60)
        resp.raise_for_status()
        return _save_bytes_to_tmp(resp.content, resp.headers.get("Content-Type", ""))

    if not is_safe_fetch_url(url):
        raise ValueError(f"不安全的图片 URL: {url}")
    resp = requests.get(url, timeout=60)
    resp.raise_for_status()
    return _save_bytes_to_tmp(resp.content, resp.headers.get("Content-Type", ""))


def _save_bytes_to_tmp(content: bytes, content_type: str) -> str:
    ext = ".png"
    lower = (content_type or "").lower()
    if "jpeg" in lower or "jpg" in lower:
        ext = ".jpg"
    elif "webp" in lower:
        ext = ".webp"
    elif "gif" in lower:
        ext = ".gif"
    tmp_path = STORAGE_TMP / f"logo_motion_src_{uuid.uuid4().hex}{ext}"
    tmp_path.write_bytes(content)
    return str(tmp_path)


def _copy_to_outputs(local_path: str, prefix: str = "logo_motion") -> str:
    """Copy a local artifact to storage/outputs and return its filename."""
    src = Path(local_path)
    if not src.exists():
        raise FileNotFoundError(local_path)
    dst_name = f"{prefix}_{uuid.uuid4().hex}{src.suffix}"
    dst = PROJECT_ROOT / "storage" / "outputs" / dst_name
    shutil.copy2(src, dst)
    return dst_name


def _run_script(
    script_name: str,
    args: list[str],
    cwd: Path,
    timeout: int = 300,
    env: Optional[dict[str, str]] = None,
) -> tuple[str, str, int]:
    """Run a pixel2motion script as a subprocess and return stdout, stderr, rc."""
    script = PIXEL2MOTION_DIR / script_name
    if not script.exists():
        raise FileNotFoundError(f"pixel2motion script not found: {script}")
    cmd = [sys.executable, str(script), *args]
    merged_env = {
        **os.environ,
        # Avoid Playwright/Chrome fork-safety issues on macOS
        "OBJC_DISABLE_INITIALIZE_FORK_SAFETY": "YES",
        **(env or {}),
    }
    logger.info("[logo_motion] run %s in %s", " ".join(cmd), cwd)
    proc = subprocess.run(
        cmd,
        cwd=str(cwd),
        env=merged_env,
        capture_output=True,
        text=True,
        timeout=timeout,
        # Isolate the child to prevent inherited FDs from parent's event loops
        start_new_session=True,
    )
    if proc.returncode != 0:
        logger.warning(
            "[logo_motion] %s failed rc=%s\nstdout=%s\nstderr=%s",
            script_name,
            proc.returncode,
            proc.stdout,
            proc.stderr,
        )
    return proc.stdout, proc.stderr, proc.returncode


def _clean_subprocess_stderr(stderr: str) -> str:
    """Remove known noisy macOS/Playwright fork warnings from subprocess stderr."""
    lines = stderr.splitlines()
    filtered: list[str] = []
    for line in lines:
        if "ev_poll_posix.cc" in line and "FD from fork parent still in poll list" in line:
            continue
        if line.strip():
            filtered.append(line)
    return "\n".join(filtered)


def _sanitize_motion_css(css: str) -> str:
    """Strip markdown fences and any prefers-reduced-motion media queries.

    The pixel2motion showcase HTML wraps CSS in its own accessibility media
    query, so injected CSS must not contain prefers-reduced-motion blocks.
    """
    text = css.strip()
    text = re.sub(r"^```(?:css)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```\s*$", "", text)
    text = _strip_prefers_reduced_motion_blocks(text)
    return text.strip()


def _strip_prefers_reduced_motion_blocks(css: str) -> str:
    """Remove every @media block that mentions prefers-reduced-motion.

    Uses a brace counter so nested rules are removed correctly even when LLM
    output contains complex selectors or keyframes.
    """
    pattern = re.compile(r"@media\s*\(\s*prefers-reduced-motion", re.IGNORECASE)
    result: list[str] = []
    i = 0
    while i < len(css):
        match = pattern.search(css, i)
        if not match:
            result.append(css[i:])
            break
        result.append(css[i : match.start()])
        # Find opening brace and skip to matching closing brace
        brace_start = css.find("{", match.end())
        if brace_start == -1:
            # Malformed; discard rest
            i = len(css)
            break
        depth = 1
        j = brace_start + 1
        in_string = False
        string_char = ""
        while j < len(css) and depth > 0:
            ch = css[j]
            if in_string:
                if ch == "\\" and j + 1 < len(css):
                    j += 2
                    continue
                if ch == string_char:
                    in_string = False
            else:
                if ch in ('"', "'"):
                    in_string = True
                    string_char = ch
                elif ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
            j += 1
        i = j
    return "".join(result)


def _read_svg_paths(svg_path: Path) -> list[dict[str, Any]]:
    """Extract path elements from an SVG for LLM analysis."""
    try:
        tree = ET.parse(svg_path)
        root = tree.getroot()
        ns = {"svg": "http://www.w3.org/2000/svg"}
        paths = []
        for i, elem in enumerate(root.iter("{http://www.w3.org/2000/svg}path")):
            d = elem.get("d", "")
            fill = elem.get("fill", "")
            paths.append({"index": i, "d": d[:120], "fill": fill})
            if len(paths) >= 24:
                break
        return paths
    except Exception as exc:
        logger.warning("[logo_motion] failed to parse SVG paths: %s", exc)
        return []


def _inject_ids_into_svg(svg_path: Path) -> None:
    """Add id attributes to SVG path elements so CSS can target them."""
    try:
        ns = {"svg": "http://www.w3.org/2000/svg"}
        ET.register_namespace("", "http://www.w3.org/2000/svg")
        tree = ET.parse(svg_path)
        root = tree.getroot()
        counter = 0
        for elem in root.iter("{http://www.w3.org/2000/svg}path"):
            if not elem.get("id"):
                counter += 1
                elem.set("id", f"p2m-path-{counter}")
        tree.write(svg_path, encoding="utf-8", xml_declaration=True)
    except Exception as exc:
        logger.warning("[logo_motion] failed to inject SVG ids: %s", exc)


# ---------------------------------------------------------------------------
# LLM motion authoring
# ---------------------------------------------------------------------------

def _author_motion_css(
    svg_path: Path,
    source_path: str,
    motion_brief: str,
    style: str,
    duration_ms: int,
    output_dir: Path,
) -> Path:
    """Use the configured LLM to write motion.css for the traced SVG."""
    css_path = output_dir / "motion.css"
    paths_info = _read_svg_paths(svg_path)
    svg_preview = svg_path.read_text(encoding="utf-8")[:3000]

    style_hints = {
        "subtle": "柔和、克制、优雅的淡入和轻微位移，适合高端品牌",
        "energetic": "活泼、有弹性、缩放和弹跳感，适合年轻品牌",
        "cinematic": "电影感、大气、缓慢推进、景深和层次 reveal",
        "loop": "无缝循环、节奏稳定、适合作为网页背景或加载动画",
        "reveal": "线条描绘、stroke-dashoffset 绘制效果、层层揭开",
    }

    system_prompt = """你是一位 Logo 动画 choreographer。请根据用户提供的 SVG、源图和动画需求，
输出一段完整的 CSS 动画代码，用于驱动该 Logo 的 HTML 展示。

要求：
1. 只输出 CSS 代码，不要 Markdown 代码块标记，不要解释。
2. CSS 应该作用于 SVG 内的元素，使用已经注入的 id 选择器如 #p2m-path-1, #p2m-path-2，
   以及子选择器如 #logo-root svg > g > path:nth-child(1)。
3. 使用 @keyframes 定义动画，总时长控制在用户指定的 duration_ms 内。
4. 包含初始状态（opacity:0 或 transform 等）和结束状态。
5. 不要包含 prefers-reduced-motion 媒体查询；展示 HTML 已经在外层做了无障碍包装。
6. 若用户未指定，默认使用 opacity + transform 组合， staggered delay 让元素依次出现。
"""

    user_prompt = f"""源图路径：{source_path}
SVG 预览（前 3000 字符）：
{svg_preview}

路径摘要（共 {len(paths_info)} 个 path）：
{json.dumps(paths_info, ensure_ascii=False, indent=2)}

动画需求：{motion_brief}
风格：{style_hints.get(style, style)}
总时长：{duration_ms}ms

请输出 motion.css 代码。"""

    try:
        pid = get_provider_id()
        key = get_api_key(pid)
        if not key:
            # fallback to alibaba
            pid = "alibaba"
            key = get_api_key(pid)
        cfg = PROVIDERS.get(pid) or PROVIDERS["alibaba"]
        model = cfg.default_model

        client = OpenAI(api_key=key, base_url=cfg.base_url)
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.7,
            max_tokens=4096,
        )
        css = resp.choices[0].message.content or ""
        css = _sanitize_motion_css(css)
        # Final safety check: the showcase builder rejects any CSS that still
        # contains a prefers-reduced-motion media query.
        if "@media" in css.lower() and "prefers-reduced-motion" in css.lower():
            logger.warning("[logo_motion] LLM CSS still contains prefers-reduced-motion after sanitization; using fallback")
            css = _fallback_motion_css(duration_ms)
        if not css.strip():
            css = _fallback_motion_css(duration_ms)
        css_path.write_text(css, encoding="utf-8")
        logger.info("[logo_motion] authored motion.css %d bytes", len(css))
    except Exception as exc:
        logger.warning("[logo_motion] LLM motion authoring failed: %s; using fallback CSS", exc)
        css_path.write_text(_fallback_motion_css(duration_ms), encoding="utf-8")
    return css_path


def _fallback_motion_css(duration_ms: int) -> str:
    step = int(duration_ms / 5)
    return f"""/* Fallback motion css */
#logo-root svg > g > path {{
  opacity: 0;
  transform: translateY(12px) scale(0.96);
  transform-origin: center;
  animation: p2m-fade-in {duration_ms}ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
}}
#logo-root svg > g > path:nth-child(1) {{ animation-delay: 0ms; }}
#logo-root svg > g > path:nth-child(2) {{ animation-delay: {step}ms; }}
#logo-root svg > g > path:nth-child(3) {{ animation-delay: {step * 2}ms; }}
#logo-root svg > g > path:nth-child(4) {{ animation-delay: {step * 3}ms; }}
#logo-root svg > g > path:nth-child(5) {{ animation-delay: {step * 4}ms; }}
@keyframes p2m-fade-in {{
  to {{ opacity: 1; transform: translateY(0) scale(1); }}
}}
"""


# ---------------------------------------------------------------------------
# Public tools
# ---------------------------------------------------------------------------

def _trace_logo_to_svg_local(source_path: str) -> dict[str, Any]:
    job_id = uuid.uuid4().hex[:12]
    work_dir = STORAGE_TMP / f"pixel2motion_{job_id}"
    work_dir.mkdir(parents=True, exist_ok=True)

    outputs_dir = work_dir / "outputs"
    outputs_dir.mkdir(parents=True, exist_ok=True)

    stdout, stderr, rc = _run_script(
        "raster_logo_trace.py",
        [source_path, "--out", str(outputs_dir), "--colors", "6", "--simplify", "1.1"],
        cwd=work_dir,
        timeout=120,
    )
    if rc != 0:
        detail = _clean_subprocess_stderr(stderr) or stdout or f"return code {rc}"
        return {"success": False, "error": f"SVG 描摹失败: {detail}"}

    svg_candidates = list(outputs_dir.glob("*.svg")) + list(work_dir.glob("*.svg"))
    if not svg_candidates:
        return {"success": False, "error": "未找到生成的 SVG 文件"}
    svg_path = svg_candidates[0]

    # Inject ids so CSS can target paths
    _inject_ids_into_svg(svg_path)

    # Overlay QA
    overlay_png = outputs_dir / "overlay.png"
    render_png = outputs_dir / "final_render.png"
    metrics_json = outputs_dir / "fit_metrics.json"
    _, stderr2, rc2 = _run_script(
        "render_overlay.py",
        [
            str(svg_path),
            source_path,
            "--out",
            str(overlay_png),
            "--render-out",
            str(render_png),
            "--report",
            str(metrics_json),
        ],
        cwd=work_dir,
        timeout=120,
    )
    metrics: dict[str, Any] = {}
    if rc2 == 0 and metrics_json.exists():
        try:
            metrics = json.loads(metrics_json.read_text(encoding="utf-8"))
        except Exception:
            pass

    return {
        "success": True,
        "svg_path": str(svg_path),
        "overlay_path": str(overlay_png) if overlay_png.exists() else None,
        "render_path": str(render_png) if render_png.exists() else None,
        "metrics": metrics,
        "work_dir": str(work_dir),
    }


@tool
def trace_logo_to_svg(source_image_url: str) -> str:
    """
    将栅格 Logo 图片转换为可动画的 SVG，并返回拟合质量报告。

    Args:
        source_image_url: Logo 图片 URL，支持 /api/media/、/uploads/ 或 http(s) 链接。

    Returns:
        SVG 路径和拟合指标文本。
    """
    try:
        source_path = _resolve_source_image(source_image_url)
        result = _trace_logo_to_svg_local(source_path)
        if not result.get("success"):
            return f"❌ Logo 转 SVG 失败: {result.get('error')}"

        svg_filename = _copy_to_outputs(result["svg_path"], prefix="logo_motion_svg")
        overlay_filename = ""
        if result.get("overlay_path"):
            overlay_filename = _copy_to_outputs(result["overlay_path"], prefix="logo_motion_overlay")
        render_filename = ""
        if result.get("render_path"):
            render_filename = _copy_to_outputs(result["render_path"], prefix="logo_motion_render")

        metrics = result.get("metrics", {})
        lines = [
            "✅ Logo 已转为 SVG",
            f"SVG: /api/media/{svg_filename}",
        ]
        if render_filename:
            lines.append(f"渲染图: /api/media/{render_filename}")
        if overlay_filename:
            lines.append(f"拟合叠加图: /api/media/{overlay_filename}")
        if metrics:
            lines.append(f"IoU: {metrics.get('iou', 'N/A')}  src_only={metrics.get('src_only_px')}  render_only={metrics.get('render_only_px')}")
        return "\n".join(lines)
    except Exception as exc:
        logger.error("[logo_motion] trace_logo_to_svg error: %s", exc, exc_info=True)
        return f"❌ Logo 转 SVG 异常: {exc}"


def _generate_logo_motion_local(
    source_path: str,
    motion_brief: str,
    style: str,
    duration_ms: int,
) -> dict[str, Any]:
    trace_result = _trace_logo_to_svg_local(source_path)
    if not trace_result.get("success"):
        return trace_result

    work_dir = Path(trace_result["work_dir"])
    svg_path = Path(trace_result["svg_path"])
    outputs_dir = work_dir / "outputs"
    outputs_dir.mkdir(parents=True, exist_ok=True)

    css_path = _author_motion_css(
        svg_path,
        source_path,
        motion_brief,
        style,
        duration_ms,
        work_dir,
    )

    html_path = work_dir / "logo_motion.html"
    _, stderr3, rc3 = _run_script(
        "animate_svg_showcase.py",
        [
            str(svg_path),
            "--css",
            str(css_path),
            "--out",
            str(html_path),
            "--title",
            "Logo Motion",
            "--duration-hint",
            str(duration_ms),
        ],
        cwd=work_dir,
        timeout=120,
    )
    if rc3 != 0 or not html_path.exists():
        detail = _clean_subprocess_stderr(stderr3) or f"return code {rc3}"
        return {"success": False, "error": f"生成动画 HTML 失败: {detail}"}
    if html_path.stat().st_size < 200:
        return {"success": False, "error": f"生成的动画 HTML 文件异常（{html_path.stat().st_size} 字节），请重试或换一张图片"}

    # Frame capture (best effort; Playwright may not be installed)
    frames_dir = outputs_dir / "motion_frames"
    strip_path = outputs_dir / "motion_strip.png"
    times = ",".join(str(int(t)) for t in [0, int(duration_ms * 0.2), int(duration_ms * 0.5), int(duration_ms * 0.8), duration_ms])
    report_path = outputs_dir / "capture_report.json"
    try:
        _, stderr4, rc4 = _run_script(
            "capture_motion_frames.py",
            [
                str(html_path),
                "--times",
                times,
                "--out",
                str(frames_dir),
                "--strip",
                str(strip_path),
                "--compare-final",
                str(trace_result.get("render_path") or ""),
                "--report",
                str(report_path),
            ],
            cwd=work_dir,
            timeout=180,
        )
        if rc4 != 0:
            logger.warning("[logo_motion] frame capture skipped: %s", stderr4)
    except Exception as exc:
        logger.warning("[logo_motion] frame capture failed: %s", exc)

    return {
        "success": True,
        "svg_path": str(svg_path),
        "html_path": str(html_path),
        "css_path": str(css_path),
        "render_path": trace_result.get("render_path"),
        "overlay_path": trace_result.get("overlay_path"),
        "strip_path": str(strip_path) if strip_path.exists() else None,
        "frames_dir": str(frames_dir) if frames_dir.exists() else None,
        "metrics": trace_result.get("metrics", {}),
        "work_dir": str(work_dir),
    }


@tool
def generate_logo_motion(
    source_image_url: str,
    motion_brief: str = "让 Logo 优雅地淡入并带有轻微的向上浮动感",
    style: str = "subtle",
    duration_ms: int = 1500,
) -> str:
    """
    将 Logo 图片转换为带 CSS 动画的独立 HTML，可预览、下载和发布。

    Args:
        source_image_url: Logo 图片 URL，支持 /api/media/、/uploads/ 或 http(s) 链接。
        motion_brief: 动画创意描述，例如 "线条依次描绘出现，科技感"。
        style: 动画风格，可选 subtle / energetic / cinematic / loop / reveal。
        duration_ms: 动画总时长，默认 1500ms。

    Returns:
        产物 URL 和指标的文本摘要。
    """
    try:
        source_path = _resolve_source_image(source_image_url)
        result = _generate_logo_motion_local(
            source_path,
            motion_brief,
            style,
            duration_ms,
        )
        if not result.get("success"):
            return f"❌ Logo 动画生成失败: {result.get('error')}"

        html_filename = _copy_to_outputs(result["html_path"], prefix="logo_motion")
        svg_filename = _copy_to_outputs(result["svg_path"], prefix="logo_motion_svg")
        css_filename = _copy_to_outputs(result["css_path"], prefix="logo_motion_css")

        render_filename = ""
        if result.get("render_path"):
            render_filename = _copy_to_outputs(result["render_path"], prefix="logo_motion_render")
        strip_filename = ""
        if result.get("strip_path"):
            strip_filename = _copy_to_outputs(result["strip_path"], prefix="logo_motion_strip")

        metrics = result.get("metrics", {})
        lines = [
            "✅ Logo 动画已生成",
            f"预览 HTML: /api/media/{html_filename}",
            f"SVG: /api/media/{svg_filename}",
            f"CSS: /api/media/{css_filename}",
        ]
        if render_filename:
            lines.append(f"静态渲染: /api/media/{render_filename}")
        if strip_filename:
            lines.append(f"帧序列胶片条: /api/media/{strip_filename}")
        if metrics:
            lines.append(f"拟合 IoU: {metrics.get('iou', 'N/A')}")
        lines.append("提示：打开预览 HTML 可在浏览器中交互播放、慢放或查看分镜。")
        return "\n".join(lines)
    except Exception as exc:
        logger.error("[logo_motion] generate_logo_motion error: %s", exc, exc_info=True)
        return f"❌ Logo 动画生成异常: {exc}"


def run_trace_logo_to_svg(source_image_url: str) -> dict[str, Any]:
    """Programmatic entry used by the API endpoint for SVG tracing."""
    try:
        source_path = _resolve_source_image(source_image_url)
        result = _trace_logo_to_svg_local(source_path)
        if not result.get("success"):
            return {"success": False, "error": result.get("error", "未知错误")}

        svg_filename = _copy_to_outputs(result["svg_path"], prefix="logo_motion_svg")
        out: dict[str, Any] = {
            "success": True,
            "svg_url": f"/api/media/{svg_filename}",
            "metrics": result.get("metrics", {}),
        }
        if result.get("overlay_path"):
            out["overlay_url"] = f"/api/media/{_copy_to_outputs(result['overlay_path'], prefix='logo_motion_overlay')}"
        if result.get("render_path"):
            out["render_url"] = f"/api/media/{_copy_to_outputs(result['render_path'], prefix='logo_motion_render')}"
        return out
    except Exception as exc:
        logger.error("[logo_motion] run_trace_logo_to_svg error: %s", exc, exc_info=True)
        return {"success": False, "error": str(exc)}


def run_logo_motion(
    source_image_url: str,
    motion_brief: str = "让 Logo 优雅地淡入并带有轻微的向上浮动感",
    style: str = "subtle",
    duration_ms: int = 1500,
) -> dict[str, Any]:
    """Programmatic entry used by the API endpoint; returns structured output."""
    try:
        source_path = _resolve_source_image(source_image_url)
        result = _generate_logo_motion_local(
            source_path,
            motion_brief,
            style,
            duration_ms,
        )
        if not result.get("success"):
            return {"success": False, "error": result.get("error", "未知错误")}

        html_filename = _copy_to_outputs(result["html_path"], prefix="logo_motion")
        svg_filename = _copy_to_outputs(result["svg_path"], prefix="logo_motion_svg")
        css_filename = _copy_to_outputs(result["css_path"], prefix="logo_motion_css")

        out: dict[str, Any] = {
            "success": True,
            "html_url": f"/api/media/{html_filename}",
            "svg_url": f"/api/media/{svg_filename}",
            "css_url": f"/api/media/{css_filename}",
            "metrics": result.get("metrics", {}),
        }
        if result.get("render_path"):
            out["render_url"] = f"/api/media/{_copy_to_outputs(result['render_path'], prefix='logo_motion_render')}"
        if result.get("strip_path"):
            out["strip_url"] = f"/api/media/{_copy_to_outputs(result['strip_path'], prefix='logo_motion_strip')}"
        if result.get("frames_dir"):
            out["frames_url_prefix"] = "/api/media/"
        return out
    except Exception as exc:
        logger.error("[logo_motion] run_logo_motion error: %s", exc, exc_info=True)
        return {"success": False, "error": str(exc)}
