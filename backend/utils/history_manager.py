import json
import os
import logging
from typing import List, Dict, Any

# 初始化日志
logger = logging.getLogger("history_manager")

HISTORY_FILE = "chat_history.json"

def load_history() -> List[Dict[str, Any]]:
    """
    从本地 JSON 文件加载聊天记录。
    如果文件不存在或格式错误，返回空列表。
    """
    if not os.path.exists(HISTORY_FILE):
        logger.info("No history file found. Starting with empty history.")
        return []
    
    try:
        with open(HISTORY_FILE, "r", encoding="utf-8") as f:
            history = json.load(f)
            if isinstance(history, list):
                logger.info(f"Loaded {len(history)} messages from history file.")
                return history
            else:
                logger.warning("History file format incorrect. Expected a list.")
                return []
    except Exception as e:
        logger.error(f"Failed to load history: {e}")
        return []

def save_history(messages: List[Dict[str, Any]]):
    """
    将聊天记录保存到本地 JSON 文件。
    """
    try:
        with open(HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump(messages, f, ensure_ascii=False, indent=2)
        logger.info(f"Saved {len(messages)} messages to history file.")
    except Exception as e:
        logger.error(f"Failed to save history: {e}")

def clear_history():
    """
    清除本地历史记录文件。
    """
    if os.path.exists(HISTORY_FILE):
        try:
            os.remove(HISTORY_FILE)
            logger.info("History file deleted.")
        except Exception as e:
            logger.error(f"Failed to delete history file: {e}")
