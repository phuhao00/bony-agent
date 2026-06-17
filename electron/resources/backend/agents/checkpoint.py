"""LangGraph checkpointer backed by storage/checkpoints/langgraph.db."""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any, Optional

from utils.logger import setup_logger

logger = setup_logger("graph_checkpoint")

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_CHECKPOINT_DIR = _PROJECT_ROOT / "storage" / "checkpoints"
_CHECKPOINT_DB = _CHECKPOINT_DIR / "langgraph.db"

_saver: Any = None
_checkpointer_cm: Any = None
_lock = threading.RLock()


def get_checkpoint_db_path() -> Path:
    _CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)
    return _CHECKPOINT_DB


def _memory_saver():
    from langgraph.checkpoint.memory import MemorySaver

    return MemorySaver()


async def setup_checkpointer() -> Any:
    """Initialize AsyncSqliteSaver (FastAPI startup). Rebuild graphs after this."""
    global _saver, _checkpointer_cm
    with _lock:
        if _checkpointer_cm is not None:
            return _saver
        db_path = get_checkpoint_db_path()
        try:
            from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

            _checkpointer_cm = AsyncSqliteSaver.from_conn_string(str(db_path))
            _saver = await _checkpointer_cm.__aenter__()
            logger.info("[checkpoint] AsyncSqliteSaver ready at %s", db_path)
        except Exception as exc:
            logger.warning("[checkpoint] AsyncSqliteSaver setup failed (%s), using MemorySaver", exc)
            _saver = _memory_saver()
        return _saver


async def shutdown_checkpointer() -> None:
    global _saver, _checkpointer_cm
    with _lock:
        if _checkpointer_cm is not None:
            try:
                await _checkpointer_cm.__aexit__(None, None, None)
            except Exception as exc:
                logger.warning("[checkpoint] shutdown error: %s", exc)
        _saver = None
        _checkpointer_cm = None


def get_checkpointer():
    """Return async-capable checkpointer (MemorySaver until startup completes)."""
    global _saver
    with _lock:
        if _saver is None:
            _saver = _memory_saver()
            logger.info("[checkpoint] interim MemorySaver (await setup_checkpointer on startup)")
        return _saver


def graph_run_config(thread_id: str, *, recursion_limit: int = 20) -> dict:
    return {
        "configurable": {"thread_id": thread_id},
        "recursion_limit": recursion_limit,
    }
