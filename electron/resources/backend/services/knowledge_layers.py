"""Knowledge layer taxonomy for separating memory, RAG, sessions, skills, and feedback."""

from __future__ import annotations

from typing import Any, Dict, Optional

VALID_LAYERS = {
    "user_profile": {
        "description": "Stable user preferences, identity-light profile facts, tone/style preferences.",
        "prompt_visible": True,
        "primary_store": "context_memory",
    },
    "agent_memory": {
        "description": "Reusable project facts, environment lessons, and durable agent working memory.",
        "prompt_visible": True,
        "primary_store": "context_memory",
    },
    "episodic_session": {
        "description": "Single-session traces, turns, and task logs for search or replay.",
        "prompt_visible": False,
        "primary_store": "trace_or_learning_events",
    },
    "procedural_skill": {
        "description": "Reusable procedures, playbooks, and skill-like operational knowledge.",
        "prompt_visible": False,
        "primary_store": "skills_or_playbooks",
    },
    "domain_knowledge_rag": {
        "description": "Documents and domain material that belong in RAG, not long-term prompt memory.",
        "prompt_visible": False,
        "primary_store": "rag_index",
    },
    "feedback_signal": {
        "description": "Votes, comments, approvals, rejections, and user feedback outcomes.",
        "prompt_visible": False,
        "primary_store": "evolution_signals",
    },
    "tool_telemetry": {
        "description": "Tool success, latency, failure, usage, cost, and runtime telemetry.",
        "prompt_visible": False,
        "primary_store": "learning_events",
    },
    "dream_digest": {
        "description": "Dream engine daily digest summaries and insight cards. Not injected into prompts directly.",
        "prompt_visible": False,
        "primary_store": "dream_runs",
    },
}

ALIASES = {
    "profile": "user_profile",
    "preference": "user_profile",
    "preferences": "user_profile",
    "user": "user_profile",
    "fact": "agent_memory",
    "memory": "agent_memory",
    "project": "agent_memory",
    "reflection": "agent_memory",
    "task_reflection": "agent_memory",
    "session": "episodic_session",
    "trace": "episodic_session",
    "history": "episodic_session",
    "skill": "procedural_skill",
    "playbook": "procedural_skill",
    "procedure": "procedural_skill",
    "rag": "domain_knowledge_rag",
    "document": "domain_knowledge_rag",
    "knowledge": "domain_knowledge_rag",
    "feedback": "feedback_signal",
    "signal": "feedback_signal",
    "telemetry": "tool_telemetry",
    "tool": "tool_telemetry",
}


def normalize_layer(layer: Optional[str]) -> str:
    raw = (layer or "").strip().lower()
    if raw in VALID_LAYERS:
        return raw
    return ALIASES.get(raw, "agent_memory")


def classify_knowledge_layer(content: str = "", metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    metadata = metadata or {}
    explicit = metadata.get("knowledge_layer") or metadata.get("layer")
    if explicit:
        layer = normalize_layer(str(explicit))
        return {"layer": layer, "reason": "explicit", **VALID_LAYERS[layer]}

    memory_type = str(metadata.get("type") or metadata.get("memory_type") or "").strip().lower()
    source = str(metadata.get("source") or "").strip().lower()
    text = (content or "").lower()

    if source in {"feedback", "signal"} or memory_type in {"feedback", "signal", "vote"}:
        layer = "feedback_signal"
        reason = "feedback_source"
    elif source in {"tool", "telemetry"} or memory_type in {"tool_call", "tool_result", "telemetry"}:
        layer = "tool_telemetry"
        reason = "telemetry_source"
    elif source in {"rag", "knowledge", "document"} or memory_type in {"rag", "document", "knowledge"}:
        layer = "domain_knowledge_rag"
        reason = "rag_source"
    elif memory_type in {"skill", "playbook", "procedure"}:
        layer = "procedural_skill"
        reason = "procedural_type"
    elif source in {"trace", "history", "session"} or memory_type in {"session", "trace", "history", "chat_turn"}:
        layer = "episodic_session"
        reason = "episodic_source"
    elif memory_type in {"preference", "profile", "user_profile"} or any(keyword in text for keyword in ["用户喜欢", "用户偏好", "我喜欢", "我希望"]):
        layer = "user_profile"
        reason = "preference_signal"
    else:
        layer = normalize_layer(memory_type or None)
        reason = "default_or_type_alias"

    return {"layer": layer, "reason": reason, **VALID_LAYERS[layer]}


def ensure_knowledge_metadata(content: str, metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    enriched = dict(metadata or {})
    classification = classify_knowledge_layer(content, enriched)
    enriched["knowledge_layer"] = classification["layer"]
    enriched["knowledge_layer_reason"] = classification["reason"]
    enriched["prompt_visible"] = bool(classification["prompt_visible"])
    enriched["primary_store"] = classification["primary_store"]
    return enriched


def is_prompt_visible_layer(layer: Optional[str]) -> bool:
    normalized = normalize_layer(layer)
    return bool(VALID_LAYERS[normalized]["prompt_visible"])


def taxonomy() -> Dict[str, Any]:
    return {"layers": VALID_LAYERS, "aliases": ALIASES}
