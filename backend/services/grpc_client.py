"""
gRPC 客户端池
懒加载 channel，服务不可用时优雅降级返回 None
"""
from __future__ import annotations

import logging
import os
from typing import Optional

import grpc

from utils.logger import setup_logger

logger = setup_logger("grpc_client")

# ── 地址配置（环境变量覆盖）──────────────────────────────────
OCR_ADDR       = os.getenv("OCR_SERVICE_ADDR", "localhost:50051")
PARSER_ADDR    = os.getenv("PARSER_SERVICE_ADDR", "localhost:50052")
DIRECTORY_ADDR = os.getenv("DIRECTORY_SERVICE_ADDR", "localhost:50053")

MAX_MSG_MB = int(os.getenv("GRPC_MAX_MESSAGE_MB", "50"))
_OPTIONS = [
    ("grpc.max_receive_message_length", MAX_MSG_MB * 1024 * 1024),
    ("grpc.max_send_message_length",    MAX_MSG_MB * 1024 * 1024),
]

# ── Channel 缓存 ──────────────────────────────────────────
_channels: dict[str, grpc.Channel] = {}


def _get_channel(addr: str) -> grpc.Channel:
    if addr not in _channels:
        logger.debug("[grpc_client] creating new channel to %s (max_msg=%dMB)", addr, MAX_MSG_MB)
        _channels[addr] = grpc.insecure_channel(addr, options=_OPTIONS)
        logger.info("[grpc_client] channel created → %s", addr)
    else:
        logger.debug("[grpc_client] reusing cached channel for %s", addr)
    return _channels[addr]


def close_all() -> None:
    logger.info("[grpc_client] close_all() closing %d channel(s)", len(_channels))
    for addr, ch in _channels.items():
        try:
            ch.close()
            logger.debug("[grpc_client] closed channel %s", addr)
        except Exception as exc:
            logger.warning("[grpc_client] error closing channel %s: %s", addr, exc)
    _channels.clear()


# ── 服务可用性检测（带 TTL 缓存）────────────────────────────
_ready_cache: dict[str, tuple[bool, float]] = {}
_READY_TTL_SEC = float(os.getenv("GRPC_READY_CACHE_TTL", "30"))


def _check_ready(addr: str, timeout: float = 2.0) -> bool:
    import time

    now = time.monotonic()
    cached = _ready_cache.get(addr)
    if cached and (now - cached[1]) < _READY_TTL_SEC:
        return cached[0]

    ok = False
    try:
        ch = _get_channel(addr)
        grpc.channel_ready_future(ch).result(timeout=timeout)
        logger.debug("[grpc_client] _check_ready OK addr=%s", addr)
        ok = True
    except grpc.FutureTimeoutError:
        logger.debug("[grpc_client] _check_ready TIMEOUT addr=%s timeout=%.1fs", addr, timeout)
    except Exception as exc:
        logger.debug("[grpc_client] _check_ready ERROR addr=%s: %s", addr, exc)

    _ready_cache[addr] = (ok, now)
    return ok


# ── Stub 工厂（懒加载，降级返回 None）──────────────────────
def get_ocr_stub():
    """返回 OCRServiceStub 或 None（服务不可用时）"""
    try:
        from generated.mediaagent import ocr_pb2_grpc  # type: ignore
        if not _check_ready(OCR_ADDR):
            logger.warning("[grpc_client] OCR service not available at %s", OCR_ADDR)
            return None
        stub = ocr_pb2_grpc.OCRServiceStub(_get_channel(OCR_ADDR))
        logger.info("[grpc_client] OCR stub ready addr=%s", OCR_ADDR)
        return stub
    except ImportError:
        logger.warning("[grpc_client] OCR proto stubs not found. Run ./scripts/gen_proto.sh")
        return None


def get_document_stub():
    """返回 DocumentServiceStub 或 None"""
    try:
        from generated.mediaagent import document_pb2_grpc  # type: ignore
        if not _check_ready(PARSER_ADDR):
            logger.warning("[grpc_client] Parser service not available at %s", PARSER_ADDR)
            return None
        stub = document_pb2_grpc.DocumentServiceStub(_get_channel(PARSER_ADDR))
        logger.info("[grpc_client] Document stub ready addr=%s", PARSER_ADDR)
        return stub
    except ImportError:
        logger.warning("[grpc_client] Document proto stubs not found. Run ./scripts/gen_proto.sh")
        return None


def get_video_stub():
    """返回 VideoServiceStub 或 None"""
    try:
        from generated.mediaagent import video_pb2_grpc  # type: ignore
        if not _check_ready(PARSER_ADDR):
            logger.warning("[grpc_client] Parser service not available at %s", PARSER_ADDR)
            return None
        stub = video_pb2_grpc.VideoServiceStub(_get_channel(PARSER_ADDR))
        logger.info("[grpc_client] Video stub ready addr=%s", PARSER_ADDR)
        return stub
    except ImportError:
        logger.warning("[grpc_client] Video proto stubs not found. Run ./scripts/gen_proto.sh")
        return None


def get_directory_stub():
    """返回 DirectoryServiceStub 或 None"""
    try:
        from generated.mediaagent import directory_pb2_grpc  # type: ignore
        if not _check_ready(DIRECTORY_ADDR):
            logger.warning("[grpc_client] Directory service not available at %s", DIRECTORY_ADDR)
            return None
        stub = directory_pb2_grpc.DirectoryServiceStub(_get_channel(DIRECTORY_ADDR))
        logger.info("[grpc_client] Directory stub ready addr=%s", DIRECTORY_ADDR)
        return stub
    except ImportError:
        logger.warning("[grpc_client] Directory proto stubs not found. Run ./scripts/gen_proto.sh")
        return None


def get_workflow_scheduler_stub():
    """返回 WorkflowSchedulerServiceStub 或 None（Go :50053）"""
    try:
        from generated.mediaagent import workflow_pb2_grpc  # type: ignore
        if not _check_ready(DIRECTORY_ADDR):
            logger.warning("[grpc_client] Workflow scheduler not available at %s", DIRECTORY_ADDR)
            return None
        stub = workflow_pb2_grpc.WorkflowSchedulerServiceStub(_get_channel(DIRECTORY_ADDR))
        logger.info("[grpc_client] WorkflowScheduler stub ready addr=%s", DIRECTORY_ADDR)
        return stub
    except ImportError:
        logger.warning("[grpc_client] Workflow scheduler stubs not found. Run ./scripts/gen_proto.sh")
        return None


def get_workflow_state_stub():
    """返回 WorkflowStateServiceStub 或 None（Rust :50052）"""
    try:
        from generated.mediaagent import workflow_state_pb2_grpc  # type: ignore
        if not _check_ready(PARSER_ADDR):
            logger.warning("[grpc_client] Workflow state service not available at %s", PARSER_ADDR)
            return None
        stub = workflow_state_pb2_grpc.WorkflowStateServiceStub(_get_channel(PARSER_ADDR))
        logger.info("[grpc_client] WorkflowState stub ready addr=%s", PARSER_ADDR)
        return stub
    except ImportError:
        logger.warning("[grpc_client] Workflow state stubs not found. Run ./scripts/gen_proto.sh")
        return None
