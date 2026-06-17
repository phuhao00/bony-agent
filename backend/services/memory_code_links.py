"""Link memory content to code entities (paths, symbols) + optional CodeGraph."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from utils.logger import setup_logger

logger = setup_logger("memory_code_links")

PROJECT_ROOT = Path(__file__).resolve().parents[2]

_PATH_RE = re.compile(
    r"(?:`([^`]+\.(?:py|ts|tsx|js|jsx|rs|go|md))`"
    r"|(?:^|[\s(])([\w./-]+/(?:backend|web|src|tests)/[\w./-]+\.(?:py|ts|tsx|js|jsx|rs|go)))",
    re.MULTILINE,
)
_SYMBOL_RE = re.compile(
    r"\b([A-Z][a-zA-Z0-9_]+(?:Agent|Service|Panel|Tool|Client|Coordinator))\b"
    r"|\b((?:search|save|get)_[a-z_]+)\b"
    r"|\b([a-z_]+_tools?)\b",
)
_FILE_EXT_RE = re.compile(
    r"(?:backend|web|src|tests)/[\w./-]+\.(?:py|ts|tsx|js|jsx|rs|go)",
)


def extract_code_refs(content: str) -> List[Dict[str, Any]]:
    """Regex-based extraction of file paths and symbol-like tokens from memory text."""
    refs: List[Dict[str, Any]] = []
    seen: set[str] = set()

    for match in _PATH_RE.finditer(content or ""):
        path = (match.group(1) or match.group(2) or "").strip()
        if path and path not in seen:
            seen.add(path)
            refs.append({"kind": "file", "label": path, "path": path})

    for match in _FILE_EXT_RE.finditer(content or ""):
        path = match.group(0).strip()
        if path not in seen:
            seen.add(path)
            refs.append({"kind": "file", "label": path, "path": path})

    for match in _SYMBOL_RE.finditer(content or ""):
        symbol = match.group(1) or match.group(2) or match.group(3) or ""
        symbol = symbol.strip()
        if len(symbol) < 4 or symbol in seen:
            continue
        seen.add(symbol)
        refs.append({"kind": "symbol", "label": symbol, "symbol": symbol})

    return refs[:24]


def _codegraph_query(symbol: str) -> List[Dict[str, Any]]:
    try:
        from services.codegraph_service import is_indexed, search_codegraph_symbols

        if not is_indexed():
            return []
        hits = search_codegraph_symbols(symbol, limit=8)
        out: List[Dict[str, Any]] = []
        for node in hits:
            if not isinstance(node, dict):
                continue
            out.append(
                {
                    "kind": node.get("kind", "symbol"),
                    "label": node.get("qualifiedName") or node.get("name") or node.get("label") or symbol,
                    "path": node.get("filePath") or node.get("file") or node.get("path") or "",
                    "line": node.get("line") or node.get("startLine"),
                    "source": "codegraph",
                }
            )
        return out
    except Exception as exc:
        logger.debug("[memory_code_links] codegraph query failed: %s", exc)
        return []


def resolve_memory_code_entities(
    content: str,
    metadata: Optional[Dict[str, Any]] = None,
    *,
    use_codegraph: bool = True,
) -> List[Dict[str, Any]]:
    """Merge metadata refs, regex extraction, and optional CodeGraph lookup."""
    entities: List[Dict[str, Any]] = []
    seen: set[str] = set()
    meta = metadata or {}

    for key in ("code_refs", "artifact_ref", "path_scope", "file_path", "module"):
        val = meta.get(key)
        if isinstance(val, str) and val.strip():
            label = val.strip()
            if label not in seen:
                seen.add(label)
                entities.append({"kind": "file", "label": label, "path": label, "source": "metadata"})
        elif isinstance(val, list):
            for item in val:
                if isinstance(item, str) and item.strip() and item not in seen:
                    seen.add(item)
                    entities.append({"kind": "file", "label": item, "path": item, "source": "metadata"})

    for ref in extract_code_refs(content):
        key = ref.get("label", "")
        if key and key not in seen:
            seen.add(key)
            ref["source"] = "content"
            entities.append(ref)

    if use_codegraph:
        for ref in list(entities):
            if ref.get("kind") == "symbol":
                for cg in _codegraph_query(str(ref.get("label", ""))):
                    label = cg.get("label", "")
                    if label and label not in seen:
                        seen.add(label)
                        entities.append(cg)

    return entities[:32]
