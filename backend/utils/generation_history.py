"""
生成记录管理器

用于保存和检索所有生成的内容（脚本、文案、图片、视频等）
"""

import json
import os
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional
from utils.logger import setup_logger

logger = setup_logger("generation_history")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
STORAGE_DIR = PROJECT_ROOT / "storage"
STORAGE_DIR.mkdir(parents=True, exist_ok=True)
GENERATION_HISTORY_FILE = STORAGE_DIR / "generation_history.json"
LEGACY_GENERATION_HISTORY_FILE = PROJECT_ROOT / "backend" / "generation_history.json"

_lock = threading.RLock()


def _read_history_file(path: Path) -> List[Dict[str, Any]]:
    with path.open("r", encoding="utf-8") as file:
        history = json.load(file)
        return history if isinstance(history, list) else []


def load_generation_history() -> List[Dict[str, Any]]:
    """加载生成历史记录"""
    with _lock:
        source = GENERATION_HISTORY_FILE
        if not source.exists() and LEGACY_GENERATION_HISTORY_FILE.exists():
            source = LEGACY_GENERATION_HISTORY_FILE
        if not source.exists():
            return []

        try:
            return _read_history_file(source)
        except Exception as e:
            logger.error(f"Failed to load generation history: {e}")
            return []


def save_generation_history(history: List[Dict[str, Any]]):
    """保存生成历史记录"""
    with _lock:
        try:
            tmp_path = GENERATION_HISTORY_FILE.with_suffix(".json.tmp")
            with tmp_path.open("w", encoding="utf-8") as file:
                json.dump(history, file, ensure_ascii=False, indent=2)
            os.replace(tmp_path, GENERATION_HISTORY_FILE)
        except Exception as e:
            logger.error(f"Failed to save generation history: {e}")


def add_generation_record(
    record_type: str,
    prompt: str,
    result: str,
    metadata: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    添加一条生成记录
    
    Args:
        record_type: 记录类型 (script/copywriting/image/video)
        prompt: 用户输入的提示词
        result: 生成的结果
        metadata: 额外的元数据
    
    Returns:
        新创建的记录
    """
    record = {
        "id": str(uuid.uuid4()),
        "type": record_type,
        "prompt": prompt,
        "result": result,
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "metadata": metadata or {}
    }

    with _lock:
        history = load_generation_history()

        # 插入到开头（最新的在前面）
        history.insert(0, record)

        # 限制历史记录数量（最多保留100条）
        if len(history) > 100:
            history = history[:100]

        save_generation_history(history)
    logger.info(f"Added generation record: type={record_type}, id={record['id']}")
    
    return record


def get_generation_history(
    record_type: Optional[str] = None,
    limit: int = 50
) -> List[Dict[str, Any]]:
    """
    获取生成历史记录
    
    Args:
        record_type: 过滤类型（可选）
        limit: 返回数量限制
    
    Returns:
        历史记录列表
    """
    history = load_generation_history()
    
    if record_type:
        history = [r for r in history if r.get("type") == record_type]
    
    return history[:limit]


def delete_generation_record(record_id: str) -> bool:
    """
    删除单条生成记录
    
    Args:
        record_id: 记录ID
    
    Returns:
        是否删除成功
    """
    with _lock:
        history = load_generation_history()
        original_length = len(history)

        history = [r for r in history if r.get("id") != record_id]

        if len(history) < original_length:
            save_generation_history(history)
            logger.info(f"Deleted generation record: id={record_id}")
            return True
    
    logger.warning(f"Record not found: id={record_id}")
    return False


def clear_generation_history():
    """清除所有生成历史"""
    save_generation_history([])
    logger.info("Generation history cleared")
