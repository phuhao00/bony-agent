from __future__ import annotations

import asyncio
import json
from typing import Any

from langchain_core.tools import BaseTool
from pydantic import PrivateAttr


def _normalize_tool_payload(output: Any) -> str:
    if isinstance(output, dict) and {"ok", "data", "error"}.issubset(output.keys()):
        payload = output
    else:
        payload = {
            "ok": True,
            "data": output,
            "error": None,
        }
    return json.dumps(payload, ensure_ascii=False, default=str)


class SafeToolProxy(BaseTool):
    name: str
    description: str
    args_schema: Any = None
    return_direct: bool = False

    _source_tool: Any = PrivateAttr()

    def __init__(self, source_tool: Any):
        super().__init__(
            name=getattr(source_tool, "name", getattr(source_tool, "__name__", "tool")),
            description=getattr(source_tool, "description", ""),
            args_schema=getattr(source_tool, "args_schema", None),
            return_direct=getattr(source_tool, "return_direct", False),
        )
        self._source_tool = source_tool

    def _build_tool_input(self, args: tuple[Any, ...], kwargs: dict[str, Any]) -> Any:
        if kwargs:
            return kwargs
        if len(args) == 1:
            return args[0]
        return list(args)

    def _invoke_source(self, args: tuple[Any, ...], kwargs: dict[str, Any]) -> Any:
        tool_input = self._build_tool_input(args, kwargs)
        if hasattr(self._source_tool, "invoke"):
            return self._source_tool.invoke(tool_input)
        if callable(self._source_tool):
            return self._source_tool(*args, **kwargs)
        raise TypeError(f"Unsupported tool type: {type(self._source_tool)!r}")

    def _run(self, *args: Any, **kwargs: Any) -> str:
        try:
            result = self._invoke_source(args, kwargs)
            return _normalize_tool_payload(result)
        except Exception as exc:
            return _normalize_tool_payload({"ok": False, "data": None, "error": str(exc)})

    async def _arun(self, *args: Any, **kwargs: Any) -> str:
        try:
            if hasattr(self._source_tool, "ainvoke"):
                tool_input = self._build_tool_input(args, kwargs)
                result = await self._source_tool.ainvoke(tool_input)
            else:
                result = await asyncio.to_thread(self._invoke_source, args, kwargs)
            return _normalize_tool_payload(result)
        except Exception as exc:
            return _normalize_tool_payload({"ok": False, "data": None, "error": str(exc)})


def safe_tool(tool: Any) -> Any:
    if isinstance(tool, SafeToolProxy):
        return tool
    if isinstance(tool, BaseTool) or hasattr(tool, "invoke"):
        return SafeToolProxy(tool)
    return tool