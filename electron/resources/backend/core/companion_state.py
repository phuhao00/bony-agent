"""
AI 伙伴长期状态：人格、偏好、情绪、成长与宠物占位（JSON 持久化，供陪伴页与后续 Agent 接入）。

存储路径：storage/companion/state.json（可用 CompanionStateStore 自定义路径便于测试）。
"""

from __future__ import annotations

import json
import threading
import time
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, List, Optional

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_STATE_PATH = PROJECT_ROOT / "storage" / "companion" / "state.json"
MAX_TOPICS = 32
MAX_MEMORY_TAGS = 64
MAX_FEEDBACK = 30
MOOD_PERMISSIONS = frozenset({"default", "auto_audit", "full_access"})
# 自动任务复盘曾错误写入 kind=reflection（整段助手输出）；档案 API 返回时剔除，避免伙伴档案出现无关长文/链接
_SKIP_PROFILE_FEEDBACK_KINDS = frozenset({"reflection"})


def _scrub_profile_feedback(entries: Any) -> List[Dict[str, Any]]:
    if not isinstance(entries, list):
        return []
    out: List[Dict[str, Any]] = []
    for x in entries:
        if not isinstance(x, dict):
            continue
        kind = str(x.get("kind") or "").strip()
        if kind in _SKIP_PROFILE_FEEDBACK_KINDS:
            continue
        out.append(x)
        if len(out) >= MAX_FEEDBACK:
            break
    return out


def _clamp_permission(raw: Any) -> Optional[str]:
    if raw is None:
        return None
    s = str(raw).strip()
    if s in MOOD_PERMISSIONS:
        return s
    return None


def _normalize_mood_dict(m: Dict[str, Any]) -> None:
    """Ensure mood.permission is always one of MOOD_PERMISSIONS."""
    p = _clamp_permission(m.get("permission"))
    m["permission"] = p if p is not None else "default"


def _default_state() -> Dict[str, Any]:
    now = time.time()
    return {
        "schema_version": 1,
        "updated_at": now,
        "persona": {
            "name": "小助手",
            "traits": "",
            "tone": "友好、简洁",
        },
        "preferences": {"topics": [], "avoid": []},
        "mood": {
            "label": "neutral",
            "note": "",
            "updated_at": 0.0,
            "permission": "default",
        },
        "growth": {
            "level": 1,
            "total_xp": 0,
            "title": "见习伙伴",
        },
        "pet": {
            "name": "",
            "species": "光灵",
            "stage": "young",
            "care_score": 0,
        },
        "memory_tag_ids": [],
        "recent_feedback": [],
    }


def _level_from_total_xp(total_xp: int) -> int:
    tx = max(0, int(total_xp))
    return min(99, 1 + tx // 100)


def _title_for_level(level: int) -> str:
    lv = max(1, min(99, int(level)))
    if lv < 5:
        return "见习伙伴"
    if lv < 15:
        return "同行者"
    if lv < 30:
        return "默契搭档"
    return "长期知己"


def _clamp_str(s: Any, max_len: int) -> str:
    t = "" if s is None else str(s).strip()
    return t[:max_len]


class CompanionStateStore:
    def __init__(self, path: Optional[Path] = None) -> None:
        self.path = path or DEFAULT_STATE_PATH
        self._lock = threading.RLock()

    def _ensure_file(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            data = _default_state()
            self._write_unlocked(data)

    def _read_unlocked(self) -> Dict[str, Any]:
        if not self.path.exists():
            return deepcopy(_default_state())
        try:
            with self.path.open("r", encoding="utf-8") as f:
                raw = json.load(f)
            if not isinstance(raw, dict):
                return deepcopy(_default_state())
            return raw
        except Exception:
            return deepcopy(_default_state())

    def _write_unlocked(self, data: Dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        tmp.replace(self.path)

    def get_state(self) -> Dict[str, Any]:
        with self._lock:
            self._ensure_file()
            base = _default_state()
            loaded = self._read_unlocked()
            merged = self._merge_defaults(base, loaded)
            merged = self._normalize_growth(merged)
            mood = merged.get("mood")
            if isinstance(mood, dict):
                _normalize_mood_dict(mood)
            merged["recent_feedback"] = _scrub_profile_feedback(merged.get("recent_feedback"))
            return merged

    @staticmethod
    def _merge_defaults(default: Dict[str, Any], loaded: Dict[str, Any]) -> Dict[str, Any]:
        out = deepcopy(default)
        for k, v in loaded.items():
            if k in out and isinstance(out[k], dict) and isinstance(v, dict):
                out[k] = {**out[k], **v}
            else:
                out[k] = v
        return out

    def patch_state(self, partial: Dict[str, Any]) -> Dict[str, Any]:
        with self._lock:
            self._ensure_file()
            cur = self._merge_defaults(_default_state(), self._read_unlocked())
            cur = self._normalize_growth(cur)
            title_override = ""
            if isinstance(partial, dict):
                title_override = _clamp_str(partial.get("growth_set_title"), 64)
            updated = self._apply_patch(cur, partial)
            updated["updated_at"] = time.time()
            updated = self._normalize_growth(updated)
            um = updated.get("mood")
            if isinstance(um, dict):
                _normalize_mood_dict(um)
            if title_override:
                updated.setdefault("growth", {})["title"] = title_override
            updated["recent_feedback"] = _scrub_profile_feedback(updated.get("recent_feedback"))
            self._write_unlocked(updated)
            return updated

    def _normalize_growth(self, data: Dict[str, Any]) -> Dict[str, Any]:
        g = data.get("growth")
        if not isinstance(g, dict):
            g = {}
        tx = g.get("total_xp")
        try:
            total_xp = max(0, int(tx if tx is not None else 0))
        except (TypeError, ValueError):
            total_xp = 0
        lv = _level_from_total_xp(total_xp)
        g["total_xp"] = total_xp
        g["level"] = lv
        g["title"] = _title_for_level(lv)
        data["growth"] = g
        return data

    def _apply_patch(self, cur: Dict[str, Any], partial: Dict[str, Any]) -> Dict[str, Any]:
        out = deepcopy(cur)
        if "persona" in partial and isinstance(partial["persona"], dict):
            p = out.setdefault("persona", {})
            src = partial["persona"]
            if "name" in src:
                p["name"] = _clamp_str(src.get("name"), 64) or p.get("name", "")
            if "traits" in src:
                p["traits"] = _clamp_str(src.get("traits"), 500)
            if "tone" in src:
                p["tone"] = _clamp_str(src.get("tone"), 500)

        if "preferences" in partial and isinstance(partial["preferences"], dict):
            pr = out.setdefault("preferences", {"topics": [], "avoid": []})
            src = partial["preferences"]
            if "topics" in src and isinstance(src["topics"], list):
                pr["topics"] = [
                    _clamp_str(x, 120) for x in src["topics"][:MAX_TOPICS] if str(x).strip()
                ]
            if "avoid" in src and isinstance(src["avoid"], list):
                pr["avoid"] = [
                    _clamp_str(x, 120) for x in src["avoid"][:MAX_TOPICS] if str(x).strip()
                ]

        if "mood" in partial and isinstance(partial["mood"], dict):
            m = out.setdefault("mood", {})
            src = partial["mood"]
            if "label" in src:
                m["label"] = _clamp_str(src.get("label"), 32) or "neutral"
            if "note" in src:
                m["note"] = _clamp_str(src.get("note"), 2000)
            if "permission" in src:
                p = _clamp_permission(src.get("permission"))
                if p is not None:
                    m["permission"] = p
            m["updated_at"] = time.time()
            _normalize_mood_dict(m)

        if "pet" in partial and isinstance(partial["pet"], dict):
            pet = out.setdefault("pet", {})
            src = partial["pet"]
            for key, maxlen in (("name", 64), ("species", 64), ("stage", 32)):
                if key in src:
                    pet[key] = _clamp_str(src.get(key), maxlen)
            if "care_score" in src:
                try:
                    pet["care_score"] = max(0, min(1_000_000, int(src["care_score"])))
                except (TypeError, ValueError):
                    pass
            if "care_score_delta" in src:
                try:
                    delta = int(src["care_score_delta"])
                    base = int(pet.get("care_score") or 0)
                    pet["care_score"] = max(0, min(1_000_000, base + delta))
                except (TypeError, ValueError):
                    pass
            # stage 随 care_score 自动升级（桌宠 Sidecar 视觉）
            try:
                score = int(pet.get("care_score") or 0)
                if score >= 200:
                    pet["stage"] = "evolved"
                elif score >= 50:
                    pet["stage"] = "teen"
                elif not pet.get("stage"):
                    pet["stage"] = "young"
            except (TypeError, ValueError):
                pass

        if "memory_tag_ids" in partial and isinstance(partial["memory_tag_ids"], list):
            tags: List[str] = []
            for x in partial["memory_tag_ids"][:MAX_MEMORY_TAGS]:
                t = _clamp_str(x, 128)
                if t:
                    tags.append(t)
            out["memory_tag_ids"] = tags

        if "growth_add_xp" in partial:
            try:
                add = max(0, min(500, int(partial["growth_add_xp"])))
            except (TypeError, ValueError):
                add = 0
            if add:
                g = out.setdefault("growth", {})
                tx0 = g.get("total_xp", 0)
                try:
                    base_xp = max(0, int(tx0))
                except (TypeError, ValueError):
                    base_xp = 0
                g["total_xp"] = base_xp + add

        if "append_feedback" in partial and isinstance(partial["append_feedback"], dict):
            fb = partial["append_feedback"]
            kind = _clamp_str(fb.get("kind"), 32) or "note"
            text = _clamp_str(fb.get("text"), 2000)
            if text:
                lst = out.setdefault("recent_feedback", [])
                if not isinstance(lst, list):
                    lst = []
                entry = {"at": time.time(), "kind": kind, "text": text}
                lst = [entry] + [x for x in lst if isinstance(x, dict)][: MAX_FEEDBACK - 1]
                out["recent_feedback"] = lst

        return out


companion_state_store = CompanionStateStore()

_STATE_CACHE: Dict[str, Any] | None = None
_STATE_CACHE_AT: float = 0.0
_STATE_CACHE_TTL_SEC = 2.0


def get_companion_state() -> Dict[str, Any]:
    global _STATE_CACHE, _STATE_CACHE_AT
    now = time.time()
    if _STATE_CACHE is not None and (now - _STATE_CACHE_AT) < _STATE_CACHE_TTL_SEC:
        return deepcopy(_STATE_CACHE)
    state = companion_state_store.get_state()
    _STATE_CACHE = state
    _STATE_CACHE_AT = now
    return deepcopy(state)


def patch_companion_state(partial: Dict[str, Any]) -> Dict[str, Any]:
    global _STATE_CACHE, _STATE_CACHE_AT
    updated = companion_state_store.patch_state(partial)
    _STATE_CACHE = updated
    _STATE_CACHE_AT = time.time()
    return updated
