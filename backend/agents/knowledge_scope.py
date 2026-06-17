"""Knowledge scope parsing (mirrors web/lib/knowledge-scope.ts)."""

from __future__ import annotations

from typing import Optional


def parse_knowledge_scope(scope: str) -> dict[str, str]:
    s = (scope or "all").strip()
    if s.startswith("cat:"):
        category = s[4:].strip()
        return {"category": category} if category else {}
    if s.startswith("doc:"):
        doc_id = s[4:].strip()
        return {"doc_id": doc_id} if doc_id else {}
    return {}
