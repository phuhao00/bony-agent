"""UI-TARS style visual grounding client (OpenAI-compatible HTTP endpoint)."""

from __future__ import annotations

import base64
import json
import re
from typing import Any, Dict, Optional, Tuple

import aiohttp

from services.agent_s.config import AgentSConfig
from utils.logger import setup_logger

logger = setup_logger("agent_s.grounding")

_COORD_PATTERNS = [
    re.compile(r"<point>\s*(\d+)\s*,\s*(\d+)\s*</point>", re.I),
    re.compile(r"\((\d+)\s*,\s*(\d+)\)"),
    re.compile(r'"x"\s*:\s*(\d+)\s*,\s*"y"\s*:\s*(\d+)', re.I),
    re.compile(r"x\s*=\s*(\d+)\s*,\s*y\s*=\s*(\d+)", re.I),
    re.compile(r"(\d{2,4})\s+(\d{2,4})"),
]


def parse_grounding_response(text: str) -> Optional[Tuple[int, int]]:
    if not text:
        return None
    for pat in _COORD_PATTERNS:
        m = pat.search(text)
        if m:
            return int(m.group(1)), int(m.group(2))
    try:
        obj = json.loads(text.strip())
        if isinstance(obj, dict) and "x" in obj and "y" in obj:
            return int(obj["x"]), int(obj["y"])
    except Exception:
        pass
    return None


class UITarsGroundingClient:
    """Calls a UI-TARS / vLLM OpenAI-compatible endpoint for element coordinates."""

    def __init__(self, config: AgentSConfig):
        self.config = config
        self._base = config.ground_url.rstrip("/")

    @property
    def available(self) -> bool:
        return bool(self._base)

    async def ground(
        self,
        *,
        screenshot_png: bytes,
        element_description: str,
    ) -> Optional[Tuple[int, int]]:
        if not self.available:
            return None
        b64 = base64.b64encode(screenshot_png).decode("ascii")
        prompt = (
            f"Locate the UI element: {element_description}\n"
            f"Return the center point as <point>x,y</point> in coordinate space "
            f"{self.config.ground_width}x{self.config.ground_height}."
        )
        payload: Dict[str, Any] = {
            "model": self.config.ground_model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/png;base64,{b64}"},
                        },
                        {"type": "text", "text": prompt},
                    ],
                }
            ],
            "max_tokens": 128,
            "temperature": 0.0,
        }
        headers = {"Content-Type": "application/json"}
        if self.config.ground_api_key:
            headers["Authorization"] = f"Bearer {self.config.ground_api_key}"

        url = f"{self._base}/v1/chat/completions"
        try:
            timeout = aiohttp.ClientTimeout(total=45)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(url, json=payload, headers=headers) as resp:
                    if resp.status >= 400:
                        body = await resp.text()
                        logger.warning("Grounding HTTP %s: %s", resp.status, body[:300])
                        return None
                    data = await resp.json()
            content = (
                data.get("choices", [{}])[0]
                .get("message", {})
                .get("content", "")
            )
            if isinstance(content, list):
                content = "".join(
                    p.get("text", "") if isinstance(p, dict) else str(p) for p in content
                )
            coords = parse_grounding_response(str(content))
            if coords:
                logger.info("Grounded '%s' -> %s", element_description[:60], coords)
            return coords
        except Exception as exc:
            logger.warning("Grounding request failed: %s", exc)
            return None
