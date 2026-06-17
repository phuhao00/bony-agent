"""Dream Engine — 记忆整合与梦境卡片生成。

流程：
  collect_window(since_iso) ← read_jsonl_rows 多文件（含 preference_signals.jsonl）
  generate_digest(events)   ← Python LLM（永远在 Python，不经 gRPC）
  dream_store.save_digest() ← atomic write + latest symlink
  apply_actions(actions)    ← confidence 降权（update_memory_metadata）
  emit_cards(cards)         ← append_event("dream_card") + dream_store.append_dream_card
  patch_companion()         ← mood + feedback（kind="dream"）

幂等保护：同日 meta.json status=ok 时跳过。
"""

from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from core.llm_provider import get_chat_llm as get_llm
from services.dream_store import get_dream_store
from services.learning_data_pipeline import append_event, read_jsonl_rows
from utils.logger import setup_logger

logger = setup_logger("dream_engine")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
EVOLUTION_DIR = PROJECT_ROOT / "storage" / "evolution"

# dream collect_window 扫描的文件（含 preference_signals.jsonl）
_COLLECT_FILES: List[Dict[str, Any]] = [
    {"path": EVOLUTION_DIR / "events.jsonl",             "kinds": {"chat_turn", "memory_recall", "tool_result", "reflection"}},
    {"path": EVOLUTION_DIR / "memory_usage.jsonl",       "kinds": None},
    {"path": EVOLUTION_DIR / "reflections.jsonl",        "kinds": None},
    {"path": EVOLUTION_DIR / "preference_signals.jsonl", "kinds": None},
    {"path": EVOLUTION_DIR / "memory_candidates.jsonl",  "kinds": None},
]

_DIGEST_SYSTEM_PROMPT = """你是一个内省AI助手，专注于分析用户的交互历史并生成有洞察力的记忆整合摘要。

请基于提供的交互事件，生成以下内容（JSON格式）：
1. summary: 简洁的整体摘要（≤300字），重点提炼关键模式和重要学习
2. companion_blurb: 给AI伴侣的一行提示（≤80字），用于伴侣问候语
3. cards: 3-5个洞察卡片列表，每张卡片包含：
   - id: UUID
   - title: 标题（≤30字）
   - body: 内容（≤150字）
   - action: 可选的建议行动（≤50字）
   - memory_refs: 相关记忆ID列表（可为空）
4. actions: 建议的自动应用动作列表，每项包含：
   - type: "lower_confidence" | "merge_candidate" | "promote_candidate"
   - memory_id: 目标记忆ID
   - reason: 简短理由

请确保输出是合法的JSON，不要包含任何其他内容。"""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


# ------------------------------------------------------------------ #
# 数据收集                                                              #
# ------------------------------------------------------------------ #

def collect_window(since_iso: Optional[str] = None) -> List[Dict[str, Any]]:
    """收集 since_iso 之后的学习事件（多文件）。"""
    if not since_iso:
        from datetime import timedelta
        since_dt = datetime.now(timezone.utc) - timedelta(hours=24)
        since_iso = since_dt.isoformat()

    all_rows: List[Dict[str, Any]] = []
    for spec in _COLLECT_FILES:
        path: Path = spec["path"]
        kinds: Optional[set] = spec["kinds"]
        if not path.exists():
            continue
        try:
            if kinds:
                for kind in kinds:
                    rows = read_jsonl_rows(path, since_iso=since_iso, kind=kind, limit=500)
                    all_rows.extend(rows)
            else:
                rows = read_jsonl_rows(path, since_iso=since_iso, limit=500)
                all_rows.extend(rows)
        except Exception as exc:
            logger.warning("[dream-engine] collect_window failed for %s: %s", path, exc)

    # 按时间排序
    all_rows.sort(key=lambda r: r.get("created_at") or r.get("timestamp") or "", reverse=False)
    logger.info("[dream-engine] collected %d events since %s", len(all_rows), since_iso)
    return all_rows


# ------------------------------------------------------------------ #
# LLM 生成 digest                                                       #
# ------------------------------------------------------------------ #

def generate_digest(events: List[Dict[str, Any]], date_str: str) -> Dict[str, Any]:
    """调用 LLM 生成 dream digest（永远在 Python 端执行）。"""
    import json

    if not events:
        logger.info("[dream-engine] no events, generating placeholder digest")
        return {
            "date": date_str,
            "summary": "今日无新增交互事件，记忆库保持稳定。",
            "companion_blurb": "今天比较平静，期待明天的新探索！",
            "cards": [],
            "actions": [],
        }

    # 构建 events 摘要（限制 token）
    event_lines: List[str] = []
    for ev in events[:100]:
        kind = ev.get("kind") or ev.get("type") or "event"
        summary = str(ev.get("summary") or ev.get("content") or "")[:200]
        ts = (ev.get("created_at") or ev.get("timestamp") or "")[:16]
        event_lines.append(f"[{ts}][{kind}] {summary}")
    events_text = "\n".join(event_lines)

    user_prompt = f"""请分析以下 {len(events)} 条交互记录（日期：{date_str}），生成记忆整合摘要：

{events_text}

请以JSON格式输出，包含 summary、companion_blurb、cards、actions 四个字段。"""

    try:
        llm = get_llm()
        from langchain_core.messages import HumanMessage, SystemMessage
        response = llm.invoke([
            SystemMessage(content=_DIGEST_SYSTEM_PROMPT),
            HumanMessage(content=user_prompt),
        ])
        content = str(response.content if hasattr(response, "content") else response)

        # 提取 JSON（兼容 markdown 代码块）
        content = content.strip()
        if content.startswith("```"):
            lines = content.split("\n")
            content = "\n".join(lines[1:-1]) if len(lines) > 2 else content

        digest = json.loads(content)
        digest["date"] = date_str

        # 规范化 cards：确保每张有 id
        for card in digest.get("cards") or []:
            if not card.get("id"):
                card["id"] = str(uuid.uuid4())
            card.setdefault("status", "pending")
            card.setdefault("created_at", _now_iso())

        logger.info(
            "[dream-engine] digest generated: cards=%d actions=%d",
            len(digest.get("cards") or []),
            len(digest.get("actions") or []),
        )
        return digest

    except Exception as exc:
        logger.error("[dream-engine] generate_digest LLM failed: %s", exc)
        return {
            "date": date_str,
            "summary": f"今日记忆整合（{len(events)} 条事件）——LLM 暂时不可用，保留原始数据。",
            "companion_blurb": "正在整合记忆，稍后为你带来洞察。",
            "cards": [],
            "actions": [],
            "_error": str(exc),
        }


# ------------------------------------------------------------------ #
# 应用动作                                                              #
# ------------------------------------------------------------------ #

def apply_actions(actions: List[Dict[str, Any]]) -> Dict[str, Any]:
    """执行 LLM 建议的记忆自动调整动作。"""
    from utils.vector_store import get_vector_store

    store = get_vector_store()
    applied = 0
    skipped = 0

    for action in actions or []:
        action_type = action.get("type") or ""
        memory_id = action.get("memory_id") or ""
        reason = action.get("reason") or ""

        if not memory_id:
            skipped += 1
            continue

        try:
            if action_type == "lower_confidence" and store:
                ok = store.update_memory_metadata(
                    memory_id,
                    {"confidence": 0.5, "dream_review": True, "dream_review_reason": reason},
                )
                if ok:
                    applied += 1
                    try:
                        append_event(
                            "dream_apply",
                            source="dream_engine",
                            action="lower_confidence",
                            summary=f"memory {memory_id[:8]}… confidence -> 0.5: {reason[:80]}",
                            metadata={"memory_id": memory_id, "action_type": action_type},
                        )
                    except Exception:
                        pass
                else:
                    skipped += 1
            else:
                logger.debug("[dream-engine] apply_actions: unknown type=%s, skip", action_type)
                skipped += 1
        except Exception as exc:
            logger.warning("[dream-engine] apply_actions failed for %s: %s", memory_id, exc)
            skipped += 1

    logger.info("[dream-engine] apply_actions applied=%d skipped=%d", applied, skipped)
    return {"applied": applied, "skipped": skipped}


# ------------------------------------------------------------------ #
# emit cards                                                           #
# ------------------------------------------------------------------ #

def emit_cards(cards: List[Dict[str, Any]], store: Any) -> int:
    """将 dream 卡片写入 dreams.jsonl 并记录 learning event。"""
    count = 0
    for card in cards or []:
        card_id = card.get("id") or str(uuid.uuid4())
        card["id"] = card_id
        card.setdefault("status", "pending")
        card.setdefault("created_at", _now_iso())
        try:
            store.append_dream_card(card)
            append_event(
                "dream_card",
                source="dream_engine",
                action="emit",
                summary=str(card.get("title") or "")[:100],
                metadata={"card_id": card_id, "has_action": bool(card.get("action"))},
            )
            count += 1
        except Exception as exc:
            logger.warning("[dream-engine] emit_cards failed for card %s: %s", card_id, exc)
    logger.info("[dream-engine] emitted %d dream cards", count)
    return count


# ------------------------------------------------------------------ #
# companion patch                                                       #
# ------------------------------------------------------------------ #

def patch_companion_for_dream(digest: Dict[str, Any], mood_label: str = "neutral") -> None:
    """更新伴侣状态：mood + feedback 卡片。"""
    try:
        from core.companion_state import patch_companion_state

        summary = (digest.get("summary") or "")[:200]
        blurb = (digest.get("companion_blurb") or "")[:80]

        patch_companion_state({
            "mood": {"label": mood_label, "intensity": 0.6},
            "append_feedback": {
                "kind": "dream",
                "text": blurb or summary,
            },
        })
        logger.info("[dream-engine] companion patched: mood=%s blurb=%s…", mood_label, blurb[:30])
    except Exception as exc:
        logger.warning("[dream-engine] patch_companion_for_dream failed: %s", exc)


# ------------------------------------------------------------------ #
# 主入口                                                                #
# ------------------------------------------------------------------ #

def run_daily(*, force: bool = False, since_iso: Optional[str] = None) -> Dict[str, Any]:
    """完整 daily dream 运行（含 LLM digest 生成）。幂等：同日已运行则跳过。"""
    t0 = time.monotonic()
    run_id = str(uuid.uuid4())
    date_str = _today_str()
    dream_store = get_dream_store()

    logger.info("[dream-engine] run_daily START run_id=%s date=%s force=%s", run_id, date_str, force)

    # 幂等检查
    if not force and dream_store.is_today_done(date_str):
        logger.info("[dream-engine] run_daily SKIPPED (already done today)")
        return {"status": "skipped", "date": date_str, "run_id": run_id}

    # 标记"进行中"以防并发重入
    patch_companion_for_dream({"summary": "", "companion_blurb": ""}, mood_label="dreaming")

    try:
        events = collect_window(since_iso)
        digest = generate_digest(events, date_str)
        dream_store.save_digest(date_str, digest)

        apply_result = apply_actions(digest.get("actions") or [])
        card_count = emit_cards(digest.get("cards") or [], dream_store)

        patch_companion_for_dream(digest, mood_label="neutral")

        # 使 prefetch_dream_digest 缓存失效
        try:
            from services.memory_coordinator import get_memory_coordinator
            get_memory_coordinator().invalidate_digest_cache()
        except Exception:
            pass

        duration_s = time.monotonic() - t0
        meta = {
            "run_id": run_id,
            "date": date_str,
            "status": "ok",
            "duration_s": round(duration_s, 2),
            "event_count": len(events),
            "card_count": card_count,
            "actions_applied": apply_result.get("applied", 0),
            "created_at": _now_iso(),
        }
        dream_store.save_meta(date_str, meta)

        try:
            append_event(
                "dream_run",
                source="dream_engine",
                action="run_daily",
                status="ok",
                summary=f"dream run OK: {card_count} cards, {apply_result.get('applied', 0)} actions",
                metadata=meta,
            )
        except Exception:
            pass

        logger.info(
            "[dream-engine] run_daily DONE date=%s duration=%.1fs cards=%d",
            date_str, duration_s, card_count,
        )
        return {"status": "ok", **meta}

    except Exception as exc:
        duration_s = time.monotonic() - t0
        patch_companion_for_dream({"summary": "", "companion_blurb": ""}, mood_label="neutral")
        meta = {
            "run_id": run_id,
            "date": date_str,
            "status": "failed",
            "duration_s": round(duration_s, 2),
            "error": str(exc),
            "created_at": _now_iso(),
        }
        try:
            dream_store.save_meta(date_str, meta)
        except Exception:
            pass
        try:
            append_event(
                "dream_run",
                source="dream_engine",
                action="run_daily",
                status="failed",
                summary=f"dream run FAILED: {exc}",
                metadata=meta,
            )
        except Exception:
            pass
        logger.error("[dream-engine] run_daily FAILED: %s", exc, exc_info=True)
        return {"status": "failed", **meta}


def run_light(*, since_iso: Optional[str] = None) -> Dict[str, Any]:
    """轻量运行（每 6 小时，无 LLM，只 collect + stats）。"""
    t0 = time.monotonic()
    date_str = _today_str()
    logger.info("[dream-engine] run_light START date=%s", date_str)

    try:
        events = collect_window(since_iso)
        duration_s = time.monotonic() - t0
        logger.info(
            "[dream-engine] run_light DONE events=%d duration=%.2fs",
            len(events), duration_s,
        )
        return {
            "status": "ok",
            "mode": "light",
            "event_count": len(events),
            "duration_s": round(duration_s, 2),
            "date": date_str,
        }
    except Exception as exc:
        logger.error("[dream-engine] run_light failed: %s", exc)
        return {"status": "failed", "mode": "light", "error": str(exc), "date": date_str}
