"""Tests for agent chat router error handling."""

import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from routers.agent_chat_router import _exception_detail


def test_exception_detail_with_message():
    exc = ValueError("something went wrong")
    assert _exception_detail(exc) == "ValueError: something went wrong"


def test_exception_detail_empty_timeout_error():
    exc = TimeoutError()
    detail = _exception_detail(exc)
    assert detail.startswith("Agent execution timed out")
    assert "timed out" in detail.lower()


def test_exception_detail_empty_generic_error():
    exc = RuntimeError()
    assert _exception_detail(exc) == (
        "RuntimeError: an unexpected error occurred (no additional details available)."
    )


def test_exception_detail_async_timeout_error():
    """asyncio.TimeoutError is an alias for the built-in TimeoutError."""
    exc = asyncio.TimeoutError()
    detail = _exception_detail(exc)
    assert "timed out" in detail.lower()
