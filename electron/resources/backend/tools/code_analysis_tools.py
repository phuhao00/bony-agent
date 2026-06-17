"""Code analysis tools — CodeGraph symbols, call graphs, workspace file reads, text search."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Optional

from langchain.tools import tool

from utils.logger import setup_logger
from utils.workspace_root import PROJECT_ROOT, get_workspace_git_root

logger = setup_logger("code_analysis_tools")

MAX_READ_BYTES = 256 * 1024
MAX_READ_LINES = 400
MAX_SEARCH_LINES = 80
RG_TIMEOUT_SECONDS = 20


def _resolve_workspace_path(rel_path: str) -> Path:
    """Resolve a repo-relative path and ensure it stays under workspace root."""
    root = get_workspace_git_root()
    raw = (rel_path or "").strip().replace("\\", "/").lstrip("/")
    if not raw:
        raise ValueError("path is required")
    if ".." in raw.split("/"):
        raise ValueError("path must not contain '..'")
    target = (root / raw).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise ValueError("path is outside workspace root") from exc
    return target


def _format_symbol_hits(hits: list) -> str:
    if not hits:
        return "未找到匹配符号。"
    lines = []
    for item in hits:
        if not isinstance(item, dict):
            continue
        label = item.get("qualifiedName") or item.get("name") or item.get("label") or "?"
        kind = item.get("kind") or "?"
        file_path = item.get("filePath") or ""
        line = item.get("line") or item.get("startLine") or ""
        score = item.get("score")
        extra = f" (score={score})" if score is not None else ""
        loc = f"{file_path}:{line}" if file_path else ""
        lines.append(f"- [{kind}] {label} @ {loc}{extra}")
    return "\n".join(lines) if lines else "未找到匹配符号。"


@tool
def search_code_symbols(query: str, limit: int = 16) -> str:
    """
    在本地 CodeGraph 索引中搜索函数、类、模块等符号。
    适用于「谁定义了 X」「找某个类/函数」「符号在哪」类问题。
    若索引未初始化，会返回 init 指引。

    Args:
        query: 符号名、限定名或文件路径片段。
        limit: 返回条数上限（默认 16，最大 32）。
    """
    q = (query or "").strip()
    if not q:
        return "Error: query is required"

    from services.codegraph_service import (
        build_init_command,
        get_codegraph_status,
        is_indexed,
        search_codegraph_symbols,
    )

    status = get_codegraph_status()
    if not status.get("cli_available"):
        return (
            "CodeGraph CLI 不可用。请安装 Node.js 18+ 或设置 CODEGRAPH_HOME 指向本地 checkout。\n"
            f"提示: {status.get('hint', '')}"
        )
    if not is_indexed():
        return (
            "CodeGraph 尚未索引本仓库。请先初始化：\n"
            f"  {build_init_command()}\n"
            "或在 设置 → My Context → CodeGraph 中点击「初始化索引」。"
        )

    hits = search_codegraph_symbols(q, limit=min(max(int(limit), 1), 32))
    logger.info("[code_analysis] search_code_symbols q=%r hits=%d", q, len(hits))
    return _format_symbol_hits(hits)


@tool
def get_code_call_graph(
    symbol: str = "",
    scope: str = "backend",
    edge_kinds: str = "calls",
    hops: int = 1,
    max_nodes: int = 48,
) -> str:
    """
    获取代码调用/导入关系子图（基于 CodeGraph）。
    适用于「谁调用了 X」「X 依赖哪些模块」「调用链」类问题。

    Args:
        symbol: 中心符号名（可选；为空时按 scope 展开）。
        scope: 目录范围，如 backend/services、web/app。
        edge_kinds: 边类型，逗号分隔：calls,imports,contains（默认 calls）。
        hops: 展开跳数 0–2（默认 1）。
        max_nodes: 子图节点上限（默认 48）。
    """
    from services.codegraph_service import build_codegraph_graph, get_codegraph_status, is_indexed

    if not is_indexed():
        status = get_codegraph_status()
        return f"CodeGraph 未索引。{status.get('hint', '')}"

    kinds = [k.strip() for k in (edge_kinds or "calls").split(",") if k.strip()]
    graph = build_codegraph_graph(
        symbol=(symbol or "").strip() or None,
        scope=(scope or "").strip() or None,
        edge_kinds=kinds or ["calls"],
        hops=max(0, min(int(hops), 2)),
        max_nodes=max(8, min(int(max_nodes), 120)),
    )
    if graph.get("error"):
        return f"调用图构建失败: {graph['error']}"

    nodes = graph.get("nodes") or []
    links = graph.get("links") or []
    if not nodes:
        return "未找到匹配的调用图节点。可尝试调整 symbol/scope 或先 search_code_symbols。"

    node_lines = []
    for n in nodes[: min(len(nodes), 24)]:
        if not isinstance(n, dict):
            continue
        label = n.get("label") or n.get("name") or n.get("id")
        kind = n.get("kind") or "?"
        path = n.get("filePath") or n.get("path") or ""
        node_lines.append(f"- [{kind}] {label} ({path})")

    link_lines = []
    for link in links[: min(len(links), 32)]:
        if not isinstance(link, dict):
            continue
        src = link.get("source") or link.get("from")
        tgt = link.get("target") or link.get("to")
        kind = link.get("kind") or link.get("type") or "edge"
        link_lines.append(f"- {src} --{kind}--> {tgt}")

    parts = [
        f"节点数: {len(nodes)}，边数: {len(links)}",
        "",
        "节点:",
        "\n".join(node_lines) or "(无)",
    ]
    if link_lines:
        parts.extend(["", "关系:", "\n".join(link_lines)])
    return "\n".join(parts)


@tool
def read_workspace_file(
    path: str,
    start_line: int = 1,
    max_lines: int = 120,
) -> str:
    """
    读取工作区仓库内的源码文件（相对路径）。
    适用于代码审查、理解实现细节。

    Args:
        path: 相对仓库根的路径，如 backend/services/codegraph_service.py。
        start_line: 起始行号（从 1 开始，默认 1）。
        max_lines: 最多读取行数（默认 120，最大 400）。
    """
    try:
        target = _resolve_workspace_path(path)
    except ValueError as exc:
        return f"Error: {exc}"

    if not target.is_file():
        return f"Error: file not found: {path}"

    if target.stat().st_size > MAX_READ_BYTES:
        return (
            f"Error: file too large ({target.stat().st_size} bytes, "
            f"limit {MAX_READ_BYTES}).请缩小范围或使用 search_code_symbols。"
        )

    try:
        text = target.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        return f"Error reading file: {exc}"

    lines = text.splitlines()
    start = max(1, int(start_line))
    cap = max(1, min(int(max_lines), MAX_READ_LINES))
    end = min(len(lines), start + cap - 1)
    if start > len(lines):
        return f"Error: start_line {start} beyond file length ({len(lines)})"

    numbered = [f"{i:5d}| {lines[i - 1]}" for i in range(start, end + 1)]
    header = f"// {path} (lines {start}-{end} of {len(lines)})\n"
    return header + "\n".join(numbered)


@tool
def search_code_text(pattern: str, scope: str = "", max_results: int = 40) -> str:
    """
    在工作区源码中做文本/正则搜索（rg 优先，grep 兜底）。
    适用于 CodeGraph 无法覆盖的字符串搜索。

    Args:
        pattern: 搜索模式（传给 rg -F 或 grep -F，按字面量匹配）。
        scope: 可选相对目录，如 backend/agents。
        max_results: 最大结果行数（默认 40）。
    """
    pat = (pattern or "").strip()
    if not pat:
        return "Error: pattern is required"
    if len(pat) > 200:
        return "Error: pattern too long"

    root = get_workspace_git_root()
    search_dir = root
    if (scope or "").strip():
        try:
            search_dir = _resolve_workspace_path(scope.strip())
        except ValueError as exc:
            return f"Error: {exc}"
        if not search_dir.is_dir():
            return f"Error: scope is not a directory: {scope}"

    limit = max(1, min(int(max_results), MAX_SEARCH_LINES))
    rg = shutil.which("rg")
    grep = shutil.which("grep")

    try:
        if rg:
            proc = subprocess.run(
                [
                    rg,
                    "-n",
                    "--no-heading",
                    "-F",
                    pat,
                    "--glob",
                    "!node_modules",
                    "--glob",
                    "!.git",
                    "--glob",
                    "!venv",
                    "--glob",
                    "!storage",
                    str(search_dir),
                ],
                capture_output=True,
                text=True,
                timeout=RG_TIMEOUT_SECONDS,
                check=False,
            )
            out = (proc.stdout or "").strip()
            if not out and proc.returncode not in (0, 1):
                return f"rg failed: {(proc.stderr or '')[:300]}"
            lines = out.splitlines()[:limit] if out else []
        elif grep:
            proc = subprocess.run(
                ["grep", "-rn", "-F", pat, str(search_dir)],
                capture_output=True,
                text=True,
                timeout=RG_TIMEOUT_SECONDS,
                check=False,
            )
            out = (proc.stdout or "").strip()
            lines = out.splitlines()[:limit] if out else []
        else:
            return "Error: rg/grep not found on PATH"

        if not lines:
            return f"未找到匹配: {pat!r} (scope={scope or '.'})"

        rel_lines = []
        for line in lines:
            try:
                p = Path(line.split(":", 1)[0])
                rel = p.relative_to(root)
                rel_lines.append(line.replace(str(p), str(rel), 1))
            except (ValueError, IndexError):
                rel_lines.append(line)

        suffix = f"\n…（仅显示前 {limit} 条）" if len(out.splitlines()) > limit else ""
        return "\n".join(rel_lines) + suffix
    except subprocess.TimeoutExpired:
        return "Error: search timed out"
    except Exception as exc:
        logger.warning("[code_analysis] search_code_text failed: %s", exc)
        return f"Error: {exc}"


@tool
def init_codegraph_index(with_index: bool = True) -> str:
    """
    初始化本仓库的 CodeGraph 索引（首次使用或索引损坏时）。
    耗时可能达数分钟。

    Args:
        with_index: 是否同时执行全量索引（默认 True）。
    """
    from services.codegraph_service import run_codegraph_init

    result = run_codegraph_init(with_index=with_index)
    if result.get("success"):
        return json.dumps(
            {
                "success": True,
                "initialized": result.get("initialized"),
                "cli_mode": result.get("cli_mode"),
                "hint": "索引已就绪，可使用 search_code_symbols / get_code_call_graph。",
            },
            ensure_ascii=False,
        )
    return f"初始化失败: {result.get('error', 'unknown')}"


@tool
def run_python_linter(path: str = "backend") -> str:
    """
    对指定目录运行 ruff check（若已安装），辅助代码审查。
    仅报告问题，不自动修复。

    Args:
        path: 相对仓库根的目录，默认 backend。
    """
    try:
        target = _resolve_workspace_path(path)
    except ValueError as exc:
        return f"Error: {exc}"

    ruff = shutil.which("ruff")
    if not ruff:
        return "ruff 未安装。可执行: pip install ruff"

    try:
        proc = subprocess.run(
            [ruff, "check", str(target), "--output-format", "concise"],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        out = (proc.stdout or proc.stderr or "").strip()
        if not out:
            return f"ruff: 未发现问题 (path={path})"
        lines = out.splitlines()
        if len(lines) > 60:
            return "\n".join(lines[:60]) + f"\n…（共 {len(lines)} 条，已截断）"
        return out
    except subprocess.TimeoutExpired:
        return "Error: ruff timed out"
    except Exception as exc:
        return f"Error: {exc}"
