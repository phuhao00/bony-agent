"""CodeGraph integration — vendored submodule, Electron bundle, or npx fallback."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional

from utils.logger import setup_logger

logger = setup_logger("codegraph_service")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
CODEGRAPH_DIR = PROJECT_ROOT / ".codegraph"
CODEGRAPH_DB = CODEGRAPH_DIR / "codegraph.db"
CODEGRAPH_NPX_PACKAGE = "@colbymchenry/codegraph"
CODEGRAPH_SDK_SCRIPT = (
    PROJECT_ROOT / "scripts" / "codegraph_sdk.mjs"
    if (PROJECT_ROOT / "scripts" / "codegraph_sdk.mjs").is_file()
    else PROJECT_ROOT / "electron" / "resources" / "scripts" / "codegraph_sdk.mjs"
)
DEFAULT_CODEGRAPH_HOME = PROJECT_ROOT / "vendor" / "codegraph"


def _codegraph_home_candidates() -> List[Path]:
    """Search order: CODEGRAPH_HOME → vendor → electron bundle."""
    candidates: List[Path] = []
    raw = os.environ.get("CODEGRAPH_HOME", "").strip()
    if raw:
        candidates.append(Path(raw).expanduser())
    candidates.extend(
        [
            PROJECT_ROOT / "vendor" / "codegraph",
            PROJECT_ROOT / "codegraph",
        ]
    )
    seen: set[str] = set()
    unique: List[Path] = []
    for path in candidates:
        key = str(path.resolve()) if path.exists() else str(path)
        if key in seen:
            continue
        seen.add(key)
        unique.append(path)
    return unique


def _codegraph_home() -> Path:
    for path in _codegraph_home_candidates():
        resolved = path.expanduser().resolve()
        cli_js = resolved / "dist" / "bin" / "codegraph.js"
        sdk_js = resolved / "dist" / "index.js"
        if cli_js.is_file() or sdk_js.is_file():
            return resolved
    return DEFAULT_CODEGRAPH_HOME.expanduser().resolve()


def _local_codegraph_cli() -> Optional[str]:
    """Path to native checkout CLI (node dist/bin/codegraph.js)."""
    home = _codegraph_home()
    cli_js = home / "dist" / "bin" / "codegraph.js"
    if cli_js.is_file():
        return str(cli_js)
    return None


def _which_codegraph() -> Optional[str]:
    return shutil.which("codegraph")


def _which_node() -> Optional[str]:
    return shutil.which("node")


def _which_npx() -> Optional[str]:
    return shutil.which("npx")


def resolve_codegraph_cli_mode() -> Optional[str]:
    """
    Return CLI resolution mode:
    - local: CODEGRAPH_HOME checkout (node dist/bin/codegraph.js)
    - global: codegraph on PATH
    - npx: npx @colbymchenry/codegraph
    """
    if _local_codegraph_cli() and _which_node():
        return "local"
    if _which_codegraph():
        return "global"
    if _which_npx():
        return "npx"
    return None


def resolve_codegraph_argv(*args: str) -> List[str]:
    """
    Build argv for a codegraph subcommand.

    Priority: local CODEGRAPH_HOME checkout → global binary → npx package.
    """
    node = _which_node()
    local_cli = _local_codegraph_cli()
    if local_cli and node:
        logger.debug("[codegraph] resolve argv mode=local subcmd=%s", args[0] if args else "")
        return [node, local_cli, *args]

    global_cli = _which_codegraph()
    if global_cli:
        logger.debug("[codegraph] resolve argv mode=global subcmd=%s", args[0] if args else "")
        return [global_cli, *args]

    npx = _which_npx()
    if not npx:
        raise RuntimeError(
            "未找到 CodeGraph CLI（设置 CODEGRAPH_HOME 指向本地 checkout 并 npm run build，"
            "或安装 Node.js 18+ 使用 npx）：https://nodejs.org/"
        )

    logger.debug("[codegraph] resolve argv mode=npx subcmd=%s", args[0] if args else "")
    return [npx, "-y", CODEGRAPH_NPX_PACKAGE, *args]


def _run_cli_json(argv: List[str], *, timeout: int = 60) -> Any:
    proc = subprocess.run(
        argv,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if proc.returncode != 0 or not proc.stdout.strip():
        stderr = (proc.stderr or proc.stdout or "")[:500]
        raise RuntimeError(stderr or f"codegraph command failed rc={proc.returncode}")
    return json.loads(proc.stdout)


def _run_sdk(command: str, *args: str, timeout: int = 90) -> Any:
    """Invoke scripts/codegraph_sdk.mjs against native CodeGraph SDK."""
    node = _which_node()
    if not node or not CODEGRAPH_SDK_SCRIPT.is_file():
        raise RuntimeError("Node.js or codegraph_sdk.mjs not available")

    env = os.environ.copy()
    env.setdefault("CODEGRAPH_HOME", str(_codegraph_home()))

    proc = subprocess.run(
        [node, str(CODEGRAPH_SDK_SCRIPT), command, str(PROJECT_ROOT), *args],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
        env=env,
    )
    if proc.returncode != 0:
        stderr = (proc.stderr or proc.stdout or "")[:500]
        raise RuntimeError(stderr or f"codegraph sdk failed rc={proc.returncode}")
    if not proc.stdout.strip():
        return {}
    return json.loads(proc.stdout)


def is_cli_available() -> bool:
    return resolve_codegraph_cli_mode() is not None


def is_indexed() -> bool:
    return CODEGRAPH_DB.exists()


def get_codegraph_status() -> Dict[str, Any]:
    """Probe local CodeGraph index; CLI via local checkout, global, or npx."""
    mode = resolve_codegraph_cli_mode()
    home = _codegraph_home()
    if mode == "local":
        cli_path = str(home / "dist" / "bin" / "codegraph.js")
    elif mode == "global":
        cli_path = _which_codegraph()
    else:
        cli_path = _which_npx()

    base: Dict[str, Any] = {
        "cli_available": mode is not None,
        "cli_mode": mode,
        "cli_path": cli_path,
        "codegraph_home": str(home),
        "sdk_available": bool(_which_node() and (home / "dist" / "index.js").is_file()),
        "initialized": is_indexed(),
        "index_path": str(CODEGRAPH_DIR),
        "project_root": str(PROJECT_ROOT),
        "mcp_preset_id": "codegraph",
        "npx_package": CODEGRAPH_NPX_PACKAGE,
    }

    if not mode:
        base["status"] = "cli_missing"
        base["hint"] = (
            "./scripts/setup_codegraph.sh  # 初始化 vendor/codegraph 子模块并构建\n"
            "或安装 Node.js 18+ 使用 npx 兜底"
        )
        return base

    if not is_indexed():
        base["status"] = "not_indexed"
        if mode == "local":
            base["hint"] = f"node {cli_path} init {PROJECT_ROOT}"
        elif mode == "npx":
            base["hint"] = f"npx {CODEGRAPH_NPX_PACKAGE} init {PROJECT_ROOT}"
        else:
            base["hint"] = f"codegraph init {PROJECT_ROOT}"
        return base

    try:
        argv = resolve_codegraph_argv("status", str(PROJECT_ROOT), "-j")
        stats = _run_cli_json(argv)
        base.update(stats)
        base["status"] = "ready"
        logger.debug(
            "[codegraph] status ready mode=%s nodes=%s files=%s sdk=%s",
            mode,
            stats.get("nodeCount") or stats.get("nodes"),
            stats.get("fileCount") or stats.get("files"),
            base["sdk_available"],
        )
        return base
    except subprocess.TimeoutExpired:
        base["status"] = "timeout"
        logger.warning("[codegraph] status command timed out mode=%s", mode)
    except Exception as exc:
        base["status"] = "error"
        base["error"] = str(exc)
        logger.error("[codegraph] status probe error: %s", exc)

    return base


def run_codegraph_init(*, with_index: bool = True) -> Dict[str, Any]:
    """Initialize (and optionally index) CodeGraph for PROJECT_ROOT."""
    mode = resolve_codegraph_cli_mode()
    if not mode:
        return {"success": False, "error": "CodeGraph CLI not available"}

    args = ["init", str(PROJECT_ROOT)]
    if with_index:
        args.append("-i")

    logger.info("[codegraph] init start mode=%s index=%s path=%s", mode, with_index, PROJECT_ROOT)
    try:
        argv = resolve_codegraph_argv(*args)
        proc = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=600,
            check=False,
        )
        ok = proc.returncode == 0
        result = {
            "success": ok,
            "cli_mode": mode,
            "returncode": proc.returncode,
            "stdout": (proc.stdout or "")[-2000:],
            "stderr": (proc.stderr or "")[-2000:],
            "initialized": is_indexed(),
        }
        if ok:
            logger.info("[codegraph] init completed indexed=%s", result["initialized"])
        else:
            logger.warning("[codegraph] init failed rc=%s", proc.returncode)
            result["error"] = (proc.stderr or proc.stdout or "init failed")[:500]
        return result
    except subprocess.TimeoutExpired:
        logger.warning("[codegraph] init timed out")
        return {"success": False, "error": "init timed out (600s)"}
    except Exception as exc:
        logger.error("[codegraph] init error: %s", exc)
        return {"success": False, "error": str(exc)}


def build_init_command() -> str:
    mode = resolve_codegraph_cli_mode()
    if mode == "local":
        cli = _local_codegraph_cli()
        return f"node {cli} init {PROJECT_ROOT}"
    if mode == "global":
        return f"codegraph init {PROJECT_ROOT}"
    return f"npx {CODEGRAPH_NPX_PACKAGE} init {PROJECT_ROOT}"


def build_mcp_stdio_command() -> List[str]:
    """Argv for supergateway --stdio inner command."""
    return resolve_codegraph_argv("serve", "--mcp", "-p", str(PROJECT_ROOT))


def search_codegraph_symbols(query: str, *, limit: int = 16) -> List[Dict[str, Any]]:
    """Search symbols via native CodeGraph SDK (fallback: CLI query -j)."""
    q = (query or "").strip()
    if not q or not is_indexed():
        return []

    logger.debug("[codegraph] search symbols q=%s limit=%s", q, limit)

    try:
        rows = _run_sdk("search", q, str(min(limit, 32)))
        if isinstance(rows, list):
            logger.debug("[codegraph] search sdk hits=%s", len(rows))
            return rows[:limit]
    except Exception as exc:
        logger.debug("[codegraph] sdk search failed, trying CLI: %s", exc)

    try:
        argv = resolve_codegraph_argv(
            "query",
            q,
            "-j",
            "-p",
            str(PROJECT_ROOT),
            "--limit",
            str(min(limit, 32)),
        )
        data = _run_cli_json(argv)
        if not isinstance(data, list):
            return []
        out: List[Dict[str, Any]] = []
        for item in data:
            node = item.get("node") if isinstance(item, dict) else None
            if not isinstance(node, dict):
                continue
            out.append(
                {
                    "id": node.get("id"),
                    "kind": node.get("kind"),
                    "label": node.get("name"),
                    "name": node.get("name"),
                    "qualifiedName": node.get("qualifiedName"),
                    "filePath": node.get("filePath"),
                    "line": node.get("startLine"),
                    "score": item.get("score"),
                }
            )
        logger.debug("[codegraph] search cli hits=%s", len(out))
        return out[:limit]
    except Exception as exc:
        logger.warning("[codegraph] symbol search failed: %s", exc)
        return []


def build_codegraph_graph(
    *,
    symbol: Optional[str] = None,
    scope: Optional[str] = None,
    edge_kinds: Optional[List[str]] = None,
    hops: int = 1,
    max_nodes: int = 64,
) -> Dict[str, Any]:
    """Build UI subgraph via native CodeGraph SDK (getCallGraph / traverse)."""
    if not is_indexed():
        return {"nodes": [], "links": [], "error": "not_indexed"}

    kinds = edge_kinds or ["calls"]
    hops = max(0, min(hops, 3))
    max_nodes = max(8, min(max_nodes, 120))

    payload = {
        "symbol": symbol or "",
        "scope": scope or "backend/services",
        "hops": hops,
        "max_nodes": max_nodes,
        "edge_kinds": kinds,
    }

    logger.info(
        "[codegraph] build graph via sdk symbol=%s scope=%s kinds=%s hops=%s",
        symbol,
        scope,
        kinds,
        hops,
    )

    try:
        result = _run_sdk("graph", json.dumps(payload))
        if not isinstance(result, dict):
            return {"nodes": [], "links": [], "error": "invalid_sdk_response"}
        logger.debug(
            "[codegraph] sdk graph nodes=%s edges=%s",
            len(result.get("nodes") or []),
            len(result.get("links") or []),
        )
        return result
    except Exception as exc:
        logger.error("[codegraph] sdk graph failed: %s", exc)
        return {"nodes": [], "links": [], "error": str(exc)}
