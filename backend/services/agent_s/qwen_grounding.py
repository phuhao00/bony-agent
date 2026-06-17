"""Qwen-VL visual grounding for native PC desktop UI elements."""

from __future__ import annotations

import base64
import json
import re
from typing import Any, Dict, Optional, Tuple

from openai import OpenAI

from core.llm_provider import resolve_vision_credentials
from utils.logger import setup_logger

logger = setup_logger("agent_s.qwen_grounding")

_GROUNDING_SYSTEM = """你是 PC 桌面 UI 元素定位器。
根据截图与用户描述，返回目标 UI 元素中心点的 JSON 坐标。

坐标系：0-1000 归一化（相对截图宽高，左上角 0,0，右下角 1000,1000）。

只输出一个 JSON 对象，例如：
{"x":500,"y":320}

不要 Markdown，不要解释。"""

_COORD_PATTERNS = [
    re.compile(r'"x"\s*:\s*(\d+)\s*,\s*"y"\s*:\s*(\d+)', re.I),
    re.compile(r"\((\d+)\s*,\s*(\d+)\)"),
    re.compile(r"(\d{1,4})\s+(\d{1,4})"),
]


def _extract_coords(raw: str) -> Optional[Tuple[int, int]]:
    text = (raw or "").strip()
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        try:
            obj = json.loads(text[start : end + 1])
            if isinstance(obj, dict) and "x" in obj and "y" in obj:
                return int(obj["x"]), int(obj["y"])
        except Exception:
            pass
    for pat in _COORD_PATTERNS:
        m = pat.search(text)
        if m:
            return int(m.group(1)), int(m.group(2))
    return None


class QwenVLGroundingClient:
    """Locate UI elements on native desktop screenshots via DashScope Qwen-VL."""

    def __init__(self) -> None:
        self._pid, self._model, self._key, self._cfg = resolve_vision_credentials()

    @property
    def available(self) -> bool:
        return bool(self._key)

    def ground(
        self,
        *,
        screenshot_png: bytes,
        element_description: str,
        screen_width: int = 0,
        screen_height: int = 0,
    ) -> Optional[Tuple[int, int]]:
        if not self._key or not screenshot_png or not element_description.strip():
            return None

        b64 = base64.b64encode(screenshot_png).decode("ascii")
        size_hint = ""
        if screen_width and screen_height:
            size_hint = f"\n截图尺寸: {screen_width} x {screen_height} 像素。"

        user_text = (
            f"定位 UI 元素: {element_description.strip()}\n"
            f"{size_hint}\n"
            "返回中心点 JSON（x,y 均为 0-1000 归一化坐标）。"
        )

        try:
            client = OpenAI(api_key=self._key, base_url=self._cfg.base_url)
            resp = client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": _GROUNDING_SYSTEM},
                    {
                        "role": "user",
                        "content": [
                            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                            {"type": "text", "text": user_text},
                        ],
                    },
                ],
                max_tokens=128,
                temperature=0.0,
                timeout=45,
            )
            raw = resp.choices[0].message.content or ""
            coords = _extract_coords(raw)
            if coords:
                x, y = coords
                x = max(0, min(x, 1000))
                y = max(0, min(y, 1000))
                logger.info("Qwen grounded '%s' -> (%s,%s)", element_description[:50], x, y)
                return x, y
            logger.warning("Qwen grounding parse failed: %s", raw[:200])
            return None
        except Exception as exc:
            logger.warning("Qwen grounding request failed: %s", exc)
            return None
