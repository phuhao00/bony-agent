"""Playwright-based ACI: maps Agent-S style actions to browser viewport operations."""

from __future__ import annotations

import asyncio
import base64
import re
from typing import Any, Dict, List, Optional, Tuple

from services.agent_s.grounding import UITarsGroundingClient
from services.computer_use_service import (
    _fill_first_search_input_via_js,
    _try_fill_locator_force,
)
from utils.logger import setup_logger

logger = setup_logger("agent_s.aci")

_SEARCH_FILL_FALLBACKS = [
    "#search_form_input_homepage",
    "input.search__input",
    "input.query",
    "#searchbox_input",
    "input[name='q']",
    "textarea[name='q']",
    "input[name='p']",
    "input[type='search']",
    "#APjFqb",
    "textarea[aria-label='Search']",
    "input[aria-label='Search']",
    "form[action*='search'] input[type='text']",
]

_SEARCH_TARGET_RE = re.compile(
    r"搜索|search|输入|input|query|textbox|框|homepage",
    re.I,
)


class PlaywrightBrowserACI:
    """Browser-only ACI (no pyautogui). Coordinates scaled from grounding resolution."""

    def __init__(
        self,
        page,
        *,
        viewport_width: int,
        viewport_height: int,
        grounding: Optional[UITarsGroundingClient] = None,
        ground_width: int = 1920,
        ground_height: int = 1080,
    ):
        self.page = page
        self.viewport_width = viewport_width
        self.viewport_height = viewport_height
        self.grounding = grounding
        self.ground_width = ground_width
        self.ground_height = ground_height
        self.last_screenshot_b64 = ""
        self._last_png: bytes = b""

    def scale_coords(self, x: int, y: int) -> Tuple[float, float]:
        sx = self.viewport_width / max(self.ground_width, 1)
        sy = self.viewport_height / max(self.ground_height, 1)
        return x * sx, y * sy

    async def assign_screenshot(self, png_bytes: bytes) -> None:
        self._last_png = png_bytes
        self.last_screenshot_b64 = base64.b64encode(png_bytes).decode("ascii")

    async def execute_action(self, action: Dict[str, Any]) -> Dict[str, Any]:
        name = str(action.get("action", "")).lower().strip()
        if name == "click":
            target = str(action.get("target") or action.get("description") or "")
            return await self.click(target)
        if name in {"type", "fill"}:
            return await self.type_text(str(action.get("text", "")))
        if name == "scroll":
            direction = str(action.get("direction", "down")).lower()
            amount = int(action.get("amount", action.get("delta_y", 400)))
            delta = amount if direction != "up" else -amount
            return await self.scroll(delta)
        if name == "wait":
            ms = int(action.get("ms", 1000))
            return await self.wait(ms)
        if name == "press":
            return await self.press(str(action.get("key", "Enter")))
        if name == "screenshot":
            return await self.screenshot()
        if name == "done":
            return {"action": "done", "ok": True, "summary": action.get("summary", "")}
        if name == "fail":
            return {
                "action": "fail",
                "ok": False,
                "error": str(action.get("reason") or action.get("error") or "failed"),
            }
        return {"action": name, "ok": False, "error": f"unknown action: {name}"}

    def _is_search_target(self, description: str) -> bool:
        return bool(_SEARCH_TARGET_RE.search(description or ""))

    async def click(self, description: str) -> Dict[str, Any]:
        log: Dict[str, Any] = {"action": "click", "target": description}

        # 搜索框类描述：直接点真实 input，不靠视觉坐标
        if self._is_search_target(description):
            sel = await self._focus_search_input()
            if sel:
                log.update({"ok": True, "method": "search_input", "selector": sel})
                return log

        if self.grounding and self.grounding.available and self._last_png:
            coords = await self.grounding.ground(
                screenshot_png=self._last_png,
                element_description=description,
            )
            if coords:
                x, y = self.scale_coords(coords[0], coords[1])
                await self.page.mouse.click(x, y)
                log.update({"ok": True, "method": "grounding", "x": x, "y": y})
                return log
            log["grounding_miss"] = True

        fb = await self._click_playwright_fallback(description)
        log.update(fb)
        if "ok" not in log:
            log["ok"] = False
        return log

    async def _click_playwright_fallback(self, description: str) -> Dict[str, Any]:
        desc = (description or "").strip()

        if self._is_search_target(desc):
            sel = await self._focus_search_input()
            if sel:
                return {"ok": True, "method": "search_input", "selector": sel}

        candidates: List[str] = []
        if desc:
            if len(desc) <= 40:
                candidates.append(f"text={desc}")
            m = re.search(r"['\"]([^'\"]+)['\"]", desc)
            if m:
                candidates.append(f"text={m.group(1)}")
            for kw in ("submit", "button", "btn", "搜索", "search"):
                if kw.lower() in desc.lower():
                    candidates.extend(
                        [
                            "input[type='submit']",
                            "button[type='submit']",
                            ".search__button",
                            "input.search__button",
                        ]
                    )
                    break
        for sel in candidates:
            try:
                loc = self.page.locator(sel).first
                await loc.wait_for(state="attached", timeout=8000)
                await loc.scroll_into_view_if_needed(timeout=8000)
                await loc.click(timeout=12000, force=True)
                return {"ok": True, "method": "playwright", "selector": sel}
            except Exception:
                continue
        return {"ok": False, "error": f"无法定位元素: {desc[:120]}"}

    async def type_text(self, text: str) -> Dict[str, Any]:
        if not text:
            return {"action": "type", "ok": False, "error": "empty text"}

        for sel in _SEARCH_FILL_FALLBACKS:
            if await _try_fill_locator_force(self.page, sel, text):
                return {
                    "action": "type",
                    "ok": True,
                    "text_len": len(text),
                    "method": "fill",
                    "selector": sel,
                }

        js_sel = await _fill_first_search_input_via_js(self.page, text)
        if js_sel:
            return {
                "action": "type",
                "ok": True,
                "text_len": len(text),
                "method": "js_fill",
                "selector": js_sel,
            }

        focused = await self._focused_is_editable()
        if not focused:
            sel = await self._focus_search_input()
            if not sel and self.grounding and self._last_png:
                coords = await self.grounding.ground(
                    screenshot_png=self._last_png,
                    element_description="search input field",
                )
                if coords:
                    x, y = self.scale_coords(coords[0], coords[1])
                    await self.page.mouse.click(x, y)
                    await asyncio.sleep(0.2)
            elif sel:
                try:
                    loc = self.page.locator(sel).first
                    await loc.fill(text, timeout=15000, force=True)
                    return {
                        "action": "type",
                        "ok": True,
                        "text_len": len(text),
                        "selector": sel,
                    }
                except Exception:
                    pass

        try:
            await self.page.keyboard.press("Control+A")
            await self.page.keyboard.type(text, delay=10)
            return {"action": "type", "ok": True, "text_len": len(text), "method": "keyboard"}
        except Exception as exc:
            return {"action": "type", "ok": False, "error": str(exc)[:300]}

    async def _focused_is_editable(self) -> bool:
        try:
            tag = await self.page.evaluate(
                "() => { const el = document.activeElement; return el ? el.tagName.toLowerCase() : ''; }"
            )
            return tag in ("input", "textarea")
        except Exception:
            return False

    async def _focus_search_input(self) -> Optional[str]:
        for sel in _SEARCH_FILL_FALLBACKS:
            try:
                loc = self.page.locator(sel).first
                await loc.wait_for(state="attached", timeout=5000)
                await loc.scroll_into_view_if_needed(timeout=5000)
                await loc.click(timeout=8000, force=True)
                await asyncio.sleep(0.15)
                return sel
            except Exception:
                continue
        return None

    async def scroll(self, delta_y: int) -> Dict[str, Any]:
        try:
            await self.page.mouse.wheel(0, delta_y)
            return {"action": "scroll", "ok": True, "delta_y": delta_y}
        except Exception as exc:
            return {"action": "scroll", "ok": False, "error": str(exc)[:300]}

    async def wait(self, ms: int) -> Dict[str, Any]:
        ms = max(0, min(ms, 30_000))
        await asyncio.sleep(ms / 1000.0)
        return {"action": "wait", "ok": True, "ms": ms}

    async def press(self, key: str) -> Dict[str, Any]:
        try:
            await self.page.keyboard.press(key[:80])
            await asyncio.sleep(0.3)
            return {"action": "press", "ok": True, "key": key}
        except Exception as exc:
            return {"action": "press", "ok": False, "error": str(exc)[:300]}

    async def screenshot(self) -> Dict[str, Any]:
        try:
            png = await self.page.screenshot(type="png")
            b64 = base64.b64encode(png).decode("ascii")
            self._last_png = png
            self.last_screenshot_b64 = b64
            return {"action": "screenshot", "ok": True, "screenshot_base64": b64}
        except Exception as exc:
            return {"action": "screenshot", "ok": False, "error": str(exc)[:300]}
