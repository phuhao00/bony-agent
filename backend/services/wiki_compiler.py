"""Local markdown wiki compiler for durable, inspectable project knowledge.

The wiki layer complements RAG: raw sources remain immutable, while compiled
markdown pages accumulate summaries, links, provenance, and health signals that
agents and users can browse between sessions.
"""

from __future__ import annotations

import hashlib
import json
import re
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from services.learning_data_pipeline import append_event
from utils.logger import setup_logger
from utils.trace_store import get_trace

logger = setup_logger("wiki_compiler")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
WIKI_DIR = PROJECT_ROOT / "storage" / "wiki"

INDEX_FILE = "index.md"
LOG_FILE = "log.md"
FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)
WIKILINK_RE = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]")
_LOCK = threading.RLock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _trim(value: Any, limit: int) -> str:
    text = "" if value is None else str(value).strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "..."


def _stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)


def _hash(value: Any) -> str:
    return hashlib.sha256(_stable_json(value).encode("utf-8")).hexdigest()


def _slugify(value: str, fallback_prefix: str = "page") -> str:
    raw = (value or "").strip().lower()
    raw = re.sub(r"[^a-z0-9\u4e00-\u9fff_-]+", "-", raw)
    raw = re.sub(r"-+", "-", raw).strip("-_")
    if raw:
        return raw[:96]
    return f"{fallback_prefix}-{uuid.uuid4().hex[:10]}"


def _yaml_scalar(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    text = "" if value is None else str(value)
    return json.dumps(text, ensure_ascii=False)


def _frontmatter(metadata: Dict[str, Any]) -> str:
    lines = ["---"]
    for key in sorted(metadata):
        value = metadata[key]
        if isinstance(value, list):
            lines.append(f"{key}:")
            for item in value:
                lines.append(f"  - {_yaml_scalar(item)}")
        elif isinstance(value, dict):
            lines.append(f"{key}: {_yaml_scalar(_stable_json(value))}")
        else:
            lines.append(f"{key}: {_yaml_scalar(value)}")
    lines.append("---")
    return "\n".join(lines) + "\n\n"


def _parse_frontmatter(text: str) -> Dict[str, Any]:
    match = FRONTMATTER_RE.match(text)
    if not match:
        return {}
    metadata: Dict[str, Any] = {}
    current_key = ""
    current_list: List[str] = []
    for line in match.group(1).splitlines():
        if line.startswith("  - ") and current_key:
            current_list.append(_unquote(line[4:].strip()))
            metadata[current_key] = current_list
            continue
        current_key = ""
        current_list = []
        if ":" not in line:
            continue
        key, raw_value = line.split(":", 1)
        key = key.strip()
        raw_value = raw_value.strip()
        if not key:
            continue
        if raw_value == "":
            current_key = key
            current_list = []
            metadata[key] = current_list
        else:
            metadata[key] = _unquote(raw_value)
    return metadata


def _unquote(value: str) -> Any:
    if value in {"true", "false"}:
        return value == "true"
    try:
        return json.loads(value)
    except Exception:
        return value


def _body_without_frontmatter(text: str) -> str:
    return FRONTMATTER_RE.sub("", text, count=1)


def _page_path(page_id: str, *, wiki_dir: Optional[Path] = None) -> Path:
    root = wiki_dir or WIKI_DIR
    safe = page_id.strip().lstrip("/")
    if not safe.endswith(".md"):
        safe += ".md"
    path = (root / safe).resolve()
    root_resolved = root.resolve()
    if root_resolved not in path.parents and path != root_resolved:
        raise ValueError("page_id escapes wiki directory")
    return path


def ensure_wiki(*, wiki_dir: Optional[Path] = None) -> Path:
    root = wiki_dir or WIKI_DIR
    with _LOCK:
        for dirname in ("sources", "entities", "generated", "playbooks"):
            (root / dirname).mkdir(parents=True, exist_ok=True)
        index = root / INDEX_FILE
        if not index.exists():
            index.write_text("# Wiki Index\n\nNo compiled pages yet.\n", encoding="utf-8")
        log = root / LOG_FILE
        if not log.exists():
            log.write_text("# Wiki Log\n\n", encoding="utf-8")
    return root


def _write_page(page_id: str, title: str, body: str, metadata: Dict[str, Any], *, wiki_dir: Optional[Path] = None) -> Dict[str, Any]:
    root = ensure_wiki(wiki_dir=wiki_dir)
    path = _page_path(page_id, wiki_dir=root)
    path.parent.mkdir(parents=True, exist_ok=True)
    metadata = {
        "id": page_id,
        "title": title,
        "created_at": metadata.get("created_at") or _now_iso(),
        "updated_at": _now_iso(),
        **metadata,
    }
    text = _frontmatter(metadata) + body.strip() + "\n"
    path.write_text(text, encoding="utf-8")
    return _page_summary(path, wiki_dir=root)


def _append_log(action: str, title: str, page_id: str, *, wiki_dir: Optional[Path] = None, detail: str = "") -> None:
    root = ensure_wiki(wiki_dir=wiki_dir)
    line = f"## [{_today()}] {action} | {title}\n\n- Page: [[{page_id}|{title}]]"
    if detail:
        line += f"\n- Detail: {detail}"
    line += "\n\n"
    with (root / LOG_FILE).open("a", encoding="utf-8") as file:
        file.write(line)


def _entity_page(entity_type: str, name: str, *, wiki_dir: Optional[Path] = None) -> str:
    root = ensure_wiki(wiki_dir=wiki_dir)
    slug = _slugify(f"{entity_type}-{name}", fallback_prefix="entity")
    page_id = f"entities/{slug}"
    path = _page_path(page_id, wiki_dir=root)
    if not path.exists():
        title = str(name).replace("_", " ").replace("-", " ").title()
        body = f"# {title}\n\n- Entity type: `{entity_type}`\n\n## Mentions\n\n"
        _write_page(
            page_id,
            title,
            body,
            {
                "page_type": "entity",
                "entity_type": entity_type,
                "tags": ["entity", entity_type],
                "source_hash": _hash({"entity_type": entity_type, "name": name}),
                "source_refs": [],
            },
            wiki_dir=root,
        )
    return page_id


def _record_entity_mention(entity_page_id: str, source_page_id: str, source_title: str, *, wiki_dir: Optional[Path] = None) -> None:
    root = ensure_wiki(wiki_dir=wiki_dir)
    path = _page_path(entity_page_id, wiki_dir=root)
    text = path.read_text(encoding="utf-8") if path.exists() else ""
    mention = f"- [[{source_page_id}|{source_title}]]"
    if mention in text:
        return
    path.write_text(text.rstrip() + f"\n{mention}\n", encoding="utf-8")


def _source_refs_from_trace(trace: Dict[str, Any]) -> List[str]:
    trace_id = str(trace.get("id") or "")
    if not trace_id:
        return []
    return [f"storage/traces/{trace_id}.json"]


def _trace_entities(trace: Dict[str, Any]) -> List[Dict[str, str]]:
    metadata = trace.get("metadata") or {}
    entities: List[Dict[str, str]] = []
    for agent in metadata.get("completed_agents") or []:
        entities.append({"type": "agent", "name": str(agent)})
    if trace.get("kind"):
        entities.append({"type": "trace_kind", "name": str(trace.get("kind"))})
    for key in ("platform", "target_platform", "provider", "model"):
        if metadata.get(key):
            entities.append({"type": key, "name": str(metadata[key])})
    return _dedupe_entities(entities)


def _research_entities(artifact: Dict[str, Any]) -> List[Dict[str, str]]:
    entities: List[Dict[str, str]] = []
    query = artifact.get("query") or artifact.get("title") or "research"
    entities.append({"type": "topic", "name": str(query)})
    for item in artifact.get("items") or []:
        if isinstance(item, dict):
            host = item.get("source") or item.get("site") or item.get("domain")
            if host:
                entities.append({"type": "source", "name": str(host)})
    return _dedupe_entities(entities)


def _dedupe_entities(entities: Iterable[Dict[str, str]]) -> List[Dict[str, str]]:
    seen = set()
    out: List[Dict[str, str]] = []
    for entity in entities:
        etype = (entity.get("type") or "entity").strip()[:64]
        name = (entity.get("name") or "").strip()[:160]
        if not name:
            continue
        key = (etype.casefold(), name.casefold())
        if key in seen:
            continue
        seen.add(key)
        out.append({"type": etype, "name": name})
    return out


def compile_trace_to_wiki(trace_id: str, *, title: Optional[str] = None, tags: Optional[List[str]] = None, wiki_dir: Optional[Path] = None) -> Dict[str, Any]:
    trace = get_trace(trace_id)
    if not trace:
        return {"success": False, "error": "trace not found", "trace_id": trace_id}

    root = ensure_wiki(wiki_dir=wiki_dir)
    title = title or f"Trace {trace_id[:8]} {trace.get('kind') or ''}".strip()
    slug = _slugify(f"{_today()}-{trace_id[:8]}-{trace.get('kind') or 'trace'}", fallback_prefix="trace")
    page_id = f"generated/traces/{slug}"
    entities = _trace_entities(trace)
    entity_links = [_entity_page(entity["type"], entity["name"], wiki_dir=root) for entity in entities]
    final_response = _trim(trace.get("final_response") or trace.get("error") or trace.get("input") or "", 3000)
    events = trace.get("events") or []

    body_lines = [
        f"# {title}",
        "",
        "## Summary",
        "",
        final_response or "No final response recorded.",
        "",
        "## Provenance",
        "",
        f"- Trace id: `{trace_id}`",
        f"- Status: `{trace.get('status') or 'unknown'}`",
        f"- Source hash: `{_hash(trace)}`",
        "",
        "## Linked Entities",
        "",
    ]
    body_lines.extend(f"- [[{page}|{entities[i]['name']}]]" for i, page in enumerate(entity_links))
    body_lines.extend(["", "## Event Preview", ""])
    if events:
        for event in events[-10:]:
            body_lines.append(f"- `{event.get('timestamp', '')}` {event.get('type') or event.get('action') or 'event'}: {_trim(event, 220)}")
    else:
        body_lines.append("No trace events recorded.")

    page = _write_page(
        page_id,
        title,
        "\n".join(body_lines),
        {
            "page_type": "trace",
            "trace_id": trace_id,
            "trace_kind": trace.get("kind", ""),
            "trace_status": trace.get("status", ""),
            "tags": ["trace", *(tags or [])],
            "source_hash": _hash(trace),
            "source_refs": _source_refs_from_trace(trace),
            "entity_links": entity_links,
        },
        wiki_dir=root,
    )
    for entity_page in entity_links:
        _record_entity_mention(entity_page, page_id, title, wiki_dir=root)
    _append_log("compile_trace", title, page_id, wiki_dir=root, detail=f"trace_id={trace_id}")
    rebuild_index(wiki_dir=root)
    _append_compile_event("trace", page_id, title, source_ref=trace_id)
    return {"success": True, "page": page, "entities": entity_links}


def compile_research_artifact_to_wiki(artifact: Dict[str, Any], *, title: Optional[str] = None, tags: Optional[List[str]] = None, wiki_dir: Optional[Path] = None) -> Dict[str, Any]:
    if not isinstance(artifact, dict) or not artifact:
        return {"success": False, "error": "artifact is required"}
    root = ensure_wiki(wiki_dir=wiki_dir)
    title = title or str(artifact.get("title") or artifact.get("query") or "Research Artifact")[:160]
    slug = _slugify(f"{_today()}-{title}", fallback_prefix="research")
    page_id = f"sources/research/{slug}"
    entities = _research_entities(artifact)
    entity_links = [_entity_page(entity["type"], entity["name"], wiki_dir=root) for entity in entities]
    source_hash = _hash(artifact)
    items = artifact.get("items") or []

    body_lines = [
        f"# {title}",
        "",
        "## Summary",
        "",
        _trim(artifact.get("summary") or artifact.get("text") or "No summary recorded.", 4000),
        "",
        "## Linked Entities",
        "",
    ]
    body_lines.extend(f"- [[{page}|{entities[i]['name']}]]" for i, page in enumerate(entity_links))
    body_lines.extend(["", "## Sources", ""])
    if items:
        for item in items[:20]:
            if isinstance(item, dict):
                label = _trim(item.get("title") or item.get("url") or item, 180)
                url = item.get("url") or ""
                body_lines.append(f"- {label}{f' ({url})' if url else ''}")
    else:
        body_lines.append("No source items recorded.")

    page = _write_page(
        page_id,
        title,
        "\n".join(body_lines),
        {
            "page_type": "research",
            "tags": ["research", *(tags or [])],
            "source_hash": source_hash,
            "source_refs": [str(artifact.get("id") or source_hash[:16])],
            "entity_links": entity_links,
        },
        wiki_dir=root,
    )
    for entity_page in entity_links:
        _record_entity_mention(entity_page, page_id, title, wiki_dir=root)
    _append_log("compile_research", title, page_id, wiki_dir=root, detail=f"source_hash={source_hash[:16]}")
    rebuild_index(wiki_dir=root)
    _append_compile_event("research", page_id, title, source_ref=source_hash[:16])
    return {"success": True, "page": page, "entities": entity_links}


def compile_text_to_wiki(content: str, *, title: str, page_type: str = "note", tags: Optional[List[str]] = None, metadata: Optional[Dict[str, Any]] = None, wiki_dir: Optional[Path] = None) -> Dict[str, Any]:
    content = (content or "").strip()
    if not content:
        return {"success": False, "error": "content is required"}
    root = ensure_wiki(wiki_dir=wiki_dir)
    title = (title or "Wiki Note").strip()[:160]
    normalized_type = _slugify(page_type or "note", fallback_prefix="note")
    slug = _slugify(f"{_today()}-{title}", fallback_prefix="note")
    page_id = f"generated/{normalized_type}/{slug}"
    source_hash = _hash({"title": title, "content": content, "metadata": metadata or {}})
    page = _write_page(
        page_id,
        title,
        f"# {title}\n\n{content}",
        {
            "page_type": normalized_type,
            "tags": [normalized_type, *(tags or [])],
            "source_hash": source_hash,
            "source_refs": [],
            **(metadata or {}),
        },
        wiki_dir=root,
    )
    _append_log("compile_text", title, page_id, wiki_dir=root, detail=f"source_hash={source_hash[:16]}")
    rebuild_index(wiki_dir=root)
    _append_compile_event("text", page_id, title, source_ref=source_hash[:16])
    return {"success": True, "page": page, "entities": []}


def _append_compile_event(source_type: str, page_id: str, title: str, *, source_ref: str = "") -> None:
    try:
        append_event(
            "agent_trace",
            source="wiki_compiler",
            action=f"compile_{source_type}",
            status="ok",
            summary=f"Compiled wiki page: {title}",
            artifact_ref=f"storage/wiki/{page_id}.md",
            metadata={"page_id": page_id, "source_ref": source_ref},
        )
    except Exception as exc:
        logger.warning("Failed to append wiki compile event: %s", exc)


def _page_summary(path: Path, *, wiki_dir: Optional[Path] = None) -> Dict[str, Any]:
    root = wiki_dir or WIKI_DIR
    text = path.read_text(encoding="utf-8")
    metadata = _parse_frontmatter(text)
    body = _body_without_frontmatter(text)
    page_id = path.relative_to(root).with_suffix("").as_posix()
    title = str(metadata.get("title") or _first_heading(body) or page_id)
    summary = _first_paragraph(body)
    return {
        "id": page_id,
        "title": title,
        "page_type": metadata.get("page_type") or "page",
        "summary": summary,
        "path": path.relative_to(PROJECT_ROOT).as_posix() if PROJECT_ROOT in path.resolve().parents else path.as_posix(),
        "updated_at": metadata.get("updated_at") or "",
        "tags": metadata.get("tags") or [],
        "source_hash": metadata.get("source_hash") or "",
        "source_refs": metadata.get("source_refs") or [],
        "metadata": metadata,
    }


def _first_heading(body: str) -> str:
    for line in body.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return ""


def _first_paragraph(body: str) -> str:
    for block in body.split("\n\n"):
        text = block.strip()
        if text and not text.startswith("#") and not text.startswith("---"):
            return _trim(re.sub(r"\s+", " ", text), 240)
    return ""


def list_pages(*, wiki_dir: Optional[Path] = None) -> List[Dict[str, Any]]:
    root = ensure_wiki(wiki_dir=wiki_dir)
    pages: List[Dict[str, Any]] = []
    for path in root.rglob("*.md"):
        if path.name in {INDEX_FILE, LOG_FILE}:
            continue
        try:
            pages.append(_page_summary(path, wiki_dir=root))
        except Exception as exc:
            logger.warning("Skipping wiki page %s: %s", path, exc)
    pages.sort(key=lambda item: (item.get("page_type") or "", item.get("title") or ""))
    return pages


def read_page(page_id: str, *, wiki_dir: Optional[Path] = None) -> Dict[str, Any]:
    root = ensure_wiki(wiki_dir=wiki_dir)
    path = _page_path(page_id, wiki_dir=root)
    if not path.exists():
        return {"success": False, "error": "page not found", "page_id": page_id}
    text = path.read_text(encoding="utf-8")
    return {"success": True, "page": _page_summary(path, wiki_dir=root), "content": text}


def rebuild_index(*, wiki_dir: Optional[Path] = None) -> Dict[str, Any]:
    root = ensure_wiki(wiki_dir=wiki_dir)
    pages = list_pages(wiki_dir=root)
    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for page in pages:
        grouped.setdefault(str(page.get("page_type") or "page"), []).append(page)
    lines = ["# Wiki Index", "", "This file is generated by `services.wiki_compiler`.", ""]
    for page_type in sorted(grouped):
        lines.extend([f"## {page_type.replace('_', ' ').title()}", ""])
        for page in grouped[page_type]:
            summary = page.get("summary") or "No summary."
            lines.append(f"- [[{page['id']}|{page['title']}]] - {summary}")
        lines.append("")
    (root / INDEX_FILE).write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    return {"success": True, "count": len(pages), "index": (root / INDEX_FILE).as_posix()}


def build_graph(*, wiki_dir: Optional[Path] = None) -> Dict[str, Any]:
    root = ensure_wiki(wiki_dir=wiki_dir)
    pages = list_pages(wiki_dir=root)
    page_ids = {page["id"] for page in pages}
    nodes = [
        {
            "id": page["id"],
            "name": page["title"],
            "type": page.get("page_type") or "page",
            "summary": page.get("summary") or "",
        }
        for page in pages
    ]
    links: List[Dict[str, str]] = []
    seen = set()
    for page in pages:
        path = _page_path(page["id"], wiki_dir=root)
        text = path.read_text(encoding="utf-8")
        for target, _label in WIKILINK_RE.findall(text):
            target_id = target.strip().lstrip("/").removesuffix(".md")
            if target_id not in page_ids or target_id == page["id"]:
                continue
            key = (page["id"], target_id)
            if key in seen:
                continue
            seen.add(key)
            links.append({"source": page["id"], "target": target_id, "relation": "links_to"})
    return {"nodes": nodes, "links": links}


def lint_wiki(*, wiki_dir: Optional[Path] = None) -> Dict[str, Any]:
    root = ensure_wiki(wiki_dir=wiki_dir)
    pages = list_pages(wiki_dir=root)
    page_ids = {page["id"] for page in pages}
    inbound = {page_id: 0 for page_id in page_ids}
    issues: List[Dict[str, str]] = []

    if not (root / INDEX_FILE).exists():
        issues.append({"severity": "error", "page_id": INDEX_FILE, "message": "index.md is missing"})
    if not (root / LOG_FILE).exists():
        issues.append({"severity": "error", "page_id": LOG_FILE, "message": "log.md is missing"})

    for page in pages:
        path = _page_path(page["id"], wiki_dir=root)
        text = path.read_text(encoding="utf-8")
        metadata = page.get("metadata") or {}
        if not metadata:
            issues.append({"severity": "warning", "page_id": page["id"], "message": "missing frontmatter"})
        if page.get("page_type") not in {"entity"} and not page.get("source_hash"):
            issues.append({"severity": "warning", "page_id": page["id"], "message": "missing source_hash"})
        for target, _label in WIKILINK_RE.findall(text):
            target_id = target.strip().lstrip("/").removesuffix(".md")
            if target_id not in page_ids:
                issues.append({"severity": "error", "page_id": page["id"], "message": f"broken wikilink: {target_id}"})
            else:
                inbound[target_id] += 1

    for page in pages:
        if page.get("page_type") != "entity" and inbound.get(page["id"], 0) == 0:
            issues.append({"severity": "info", "page_id": page["id"], "message": "orphan page has no inbound wiki links"})

    return {
        "success": True,
        "valid": not any(issue["severity"] == "error" for issue in issues),
        "issues": issues,
        "stats": {"page_count": len(pages), "issue_count": len(issues)},
    }