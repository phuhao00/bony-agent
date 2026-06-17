"""Map ChatPreferences to tool / agent augmentation flags."""

from __future__ import annotations

from typing import Any

from agents.chat_request import ChatPreferences
from agents.knowledge_scope import parse_knowledge_scope


def preferences_to_augment_flags(preferences: ChatPreferences) -> dict[str, Any]:
    knowledge_on = preferences.chat_knowledge_mode != "off"
    memory_on = preferences.chat_memory_recall
    web_on = preferences.online_search_mode != "off"
    scope = parse_knowledge_scope(preferences.chat_knowledge_scope)
    return {
        "with_memory": memory_on,
        "with_rag": knowledge_on,
        "with_web": web_on,
        "knowledge_scope": scope,
        "knowledge_mode": preferences.chat_knowledge_mode,
        "unbound_mode": preferences.chat_unbound_mode,
    }


def knowledge_scope_system_line(preferences: ChatPreferences) -> str:
    if preferences.chat_knowledge_mode == "off":
        return "Knowledge: do not call search_knowledge_base."
    if preferences.chat_knowledge_mode == "scoped":
        scope = preferences.chat_knowledge_scope or "all"
        if scope.startswith("doc:"):
            return f"Knowledge: search ONLY document id {scope[4:]} via search_knowledge_base."
        if scope.startswith("cat:"):
            return f"Knowledge: search ONLY category {scope[4:]} via search_knowledge_base."
    return "Knowledge: use search_knowledge_base when uploaded docs may answer the question."
