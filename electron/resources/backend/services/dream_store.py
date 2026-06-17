"""dream 产物持久化：遵循 workflow_service.py 的 gRPC stub + file fallback 模式。

产物路径结构：
  storage/evolution/dream_runs/
    2026-05-31/
      digest.json   # {date, summary, companion_blurb, cards:[...], actions:[...]}
      meta.json     # {run_id, duration_s, card_count, status:"ok|failed|skipped"}
    latest -> 2026-05-31/   # Python os.symlink
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from utils.logger import setup_logger

logger = setup_logger("dream_store")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DREAM_RUNS_DIR = PROJECT_ROOT / "storage" / "evolution" / "dream_runs"


class DreamStore:
    """dream 产物持久化。优先调用 Rust gRPC WorkflowState（如可用），否则直接文件 IO。"""

    def _get_state_stub(self):
        """复用 workflow_service.py 的 stub 获取方式。"""
        try:
            from services.grpc_client import get_workflow_state_stub  # type: ignore
            return get_workflow_state_stub()
        except Exception:
            return None  # 无 Rust 时静默降级

    # ------------------------------------------------------------------ #
    # 路径帮助                                                              #
    # ------------------------------------------------------------------ #

    def _get_run_dir(self, date_str: str) -> Path:
        return DREAM_RUNS_DIR / date_str

    def _update_latest_symlink(self, date_str: str) -> None:
        latest = DREAM_RUNS_DIR / "latest"
        try:
            if latest.is_symlink() or latest.exists():
                latest.unlink()
            os.symlink(date_str, latest)
            logger.debug("[dream-store] latest symlink -> %s", date_str)
        except Exception as exc:
            logger.warning("[dream-store] Failed to update latest symlink: %s", exc)

    # ------------------------------------------------------------------ #
    # 公开 API                                                              #
    # ------------------------------------------------------------------ #

    def save_digest(self, date_str: str, digest: Dict[str, Any]) -> None:
        """原子写入 digest.json（tempfile + rename）。"""
        d = self._get_run_dir(date_str)
        d.mkdir(parents=True, exist_ok=True)
        tmp = d / "digest.json.tmp"
        try:
            tmp.write_text(json.dumps(digest, ensure_ascii=False, indent=2), encoding="utf-8")
            tmp.rename(d / "digest.json")
            self._update_latest_symlink(date_str)
            logger.info("[dream-store] digest saved: %s/digest.json", date_str)
        except Exception as exc:
            logger.error("[dream-store] save_digest failed: %s", exc)
            raise

    def save_meta(self, date_str: str, meta: Dict[str, Any]) -> None:
        """原子写入 meta.json。"""
        d = self._get_run_dir(date_str)
        d.mkdir(parents=True, exist_ok=True)
        tmp = d / "meta.json.tmp"
        try:
            tmp.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
            tmp.rename(d / "meta.json")
            logger.debug("[dream-store] meta saved: %s/meta.json", date_str)
        except Exception as exc:
            logger.error("[dream-store] save_meta failed: %s", exc)
            raise

    def load_digest(self, date_str: str = "latest") -> Optional[Dict[str, Any]]:
        if date_str == "latest":
            path = DREAM_RUNS_DIR / "latest" / "digest.json"
        else:
            path = self._get_run_dir(date_str) / "digest.json"
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.warning("[dream-store] load_digest failed: %s", exc)
            return None

    def load_meta(self, date_str: str = "latest") -> Optional[Dict[str, Any]]:
        if date_str == "latest":
            path = DREAM_RUNS_DIR / "latest" / "meta.json"
        else:
            path = self._get_run_dir(date_str) / "meta.json"
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.warning("[dream-store] load_meta failed: %s", exc)
            return None

    def is_today_done(self, date_str: str) -> bool:
        """检查当日是否已成功运行（幂等保护）。"""
        meta = self.load_meta(date_str)
        return bool(meta and meta.get("status") == "ok")

    def list_runs(self, limit: int = 30) -> List[Dict[str, Any]]:
        """列出最近 N 次 dream 运行的 meta 摘要。"""
        if not DREAM_RUNS_DIR.exists():
            return []
        runs = []
        for entry in sorted(DREAM_RUNS_DIR.iterdir(), reverse=True):
            if entry.name == "latest" or not entry.is_dir():
                continue
            meta = self.load_meta(entry.name)
            if meta:
                runs.append(meta)
            if len(runs) >= limit:
                break
        return runs

    def append_dream_card(self, card: Dict[str, Any]) -> None:
        """将单条 dream 卡片追加到 dreams.jsonl（独立流水文件）。"""
        dreams_file = PROJECT_ROOT / "storage" / "evolution" / "dreams.jsonl"
        dreams_file.parent.mkdir(parents=True, exist_ok=True)
        try:
            with dreams_file.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(card, ensure_ascii=False) + "\n")
        except Exception as exc:
            logger.error("[dream-store] append_dream_card failed: %s", exc)

    def load_dream_cards(
        self,
        *,
        limit: int = 50,
        since_iso: Optional[str] = None,
        status: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """读取 dreams.jsonl 中的卡片（最新在前）。"""
        dreams_file = PROJECT_ROOT / "storage" / "evolution" / "dreams.jsonl"
        if not dreams_file.exists():
            return []
        rows: List[Dict[str, Any]] = []
        try:
            with dreams_file.open("r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        card = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if since_iso:
                        ts = card.get("created_at") or card.get("timestamp") or ""
                        if ts < since_iso:
                            continue
                    if status and card.get("status") != status:
                        continue
                    rows.append(card)
        except Exception as exc:
            logger.error("[dream-store] load_dream_cards failed: %s", exc)
        rows.sort(key=lambda c: c.get("created_at") or "", reverse=True)
        return rows[:limit]

    def update_dream_card_status(self, card_id: str, new_status: str) -> bool:
        """更新 dreams.jsonl 中指定卡片的 status（act/dismiss）。全量重写。"""
        dreams_file = PROJECT_ROOT / "storage" / "evolution" / "dreams.jsonl"
        if not dreams_file.exists():
            return False
        updated = False
        lines: List[str] = []
        try:
            with dreams_file.open("r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.rstrip("\n")
                    if not line:
                        continue
                    try:
                        card = json.loads(line)
                        if card.get("id") == card_id:
                            card["status"] = new_status
                            updated = True
                        lines.append(json.dumps(card, ensure_ascii=False))
                    except json.JSONDecodeError:
                        lines.append(line)
            if updated:
                tmp = dreams_file.with_suffix(".tmp")
                tmp.write_text("\n".join(lines) + "\n", encoding="utf-8")
                tmp.rename(dreams_file)
        except Exception as exc:
            logger.error("[dream-store] update_dream_card_status failed: %s", exc)
            return False
        return updated


# 全局单例
_store: Optional[DreamStore] = None


def get_dream_store() -> DreamStore:
    global _store
    if _store is None:
        _store = DreamStore()
    return _store
