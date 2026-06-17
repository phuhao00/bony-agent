import logging
import os
from logging.handlers import RotatingFileHandler

def setup_logger(name: str = "agent_logger", log_file: str = None):
    """
    配置日志记录器，支持同时输出到文件和控制台。
    """
    if log_file is None:
        log_file = os.getenv("LOG_PATH", "agent.log")
    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)

    # 如果已经有 handler，就不再添加（避免重复日志）
    if logger.handlers:
        return logger

    # 1. 文件处理器 (自动轮转，最大 10MB，保留 5 个备份)
    file_handler = RotatingFileHandler(
        log_file, maxBytes=10*1024*1024, backupCount=5, encoding='utf-8'
    )
    file_formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    file_handler.setFormatter(file_formatter)

    # 2. 控制台处理器
    console_handler = logging.StreamHandler()
    console_formatter = logging.Formatter(
        '%(asctime)s - %(levelname)s - %(message)s'
    )
    console_handler.setFormatter(console_formatter)

    # 添加处理器
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)

    return logger
