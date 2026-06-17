"""Fetch public URLs and extract readable Markdown for knowledge-base ingestion."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup, NavigableString, Tag

from utils.logger import setup_logger
from utils.url_safety import is_safe_fetch_url

logger = setup_logger("knowledge_url_fetch")

MAX_RESPONSE_BYTES = 5 * 1024 * 1024
FETCH_TIMEOUT_SEC = 30
MAX_REDIRECTS = 5
MAX_EXTRACTED_CHARS = 200_000
USER_AGENT = (
    "Mozilla/5.0 (compatible; AI-Media-Agent/1.0; +knowledge-url-import)"
)

_STRIP_TAGS = frozenset(
    {
        "script",
        "style",
        "noscript",
        "svg",
        "iframe",
        "nav",
        "footer",
        "header",
        "aside",
        "form",
        "button",
        "menu",
    }
)
_MAIN_SELECTORS = [
    "article",
    "main",
    "[role='main']",
    ".post-content",
    ".article-content",
    ".entry-content",
    ".markdown-body",
    "#content",
    ".content",
    ".doc-content",
]


def normalize_knowledge_url(url: str) -> str:
    """Normalize user input to a fetchable http(s) URL."""
    raw = (url or "").strip()
    if not raw:
        return ""
    if not re.match(r"^https?://", raw, flags=re.IGNORECASE):
        raw = f"https://{raw}"
    parsed = urlparse(raw)
    if parsed.scheme not in ("http", "https"):
        return ""
    return raw


def _pick_main_node(soup: BeautifulSoup) -> Tag:
    for selector in _MAIN_SELECTORS:
        node = soup.select_one(selector)
        if node and _node_text_len(node) >= 120:
            return node
    body = soup.body
    return body if isinstance(body, Tag) else soup


def _node_text_len(node: Tag) -> int:
    return len(node.get_text(" ", strip=True))


def _inline_to_markdown(node: Tag) -> str:
    parts: List[str] = []
    for child in node.children:
        if isinstance(child, NavigableString):
            parts.append(str(child))
            continue
        if not isinstance(child, Tag):
            continue
        name = child.name or ""
        if name == "a":
            href = (child.get("href") or "").strip()
            label = child.get_text(" ", strip=True)
            if href and label:
                parts.append(f"[{label}]({href})")
            elif label:
                parts.append(label)
        elif name in {"strong", "b"}:
            inner = child.get_text(" ", strip=True)
            parts.append(f"**{inner}**" if inner else "")
        elif name in {"em", "i"}:
            inner = child.get_text(" ", strip=True)
            parts.append(f"*{inner}*" if inner else "")
        elif name == "code":
            inner = child.get_text(" ", strip=True)
            parts.append(f"`{inner}`" if inner else "")
        elif name == "br":
            parts.append("\n")
        else:
            parts.append(child.get_text(" ", strip=True))
    return re.sub(r"\s+", " ", "".join(parts)).strip()


def _block_to_markdown(node: Tag, *, depth: int = 0) -> str:
    name = (node.name or "").lower()
    if name in _STRIP_TAGS:
        return ""

    if name in {"h1", "h2", "h3", "h4", "h5", "h6"}:
        level = int(name[1])
        text = node.get_text(" ", strip=True)
        return f"{'#' * level} {text}\n\n" if text else ""

    if name == "p":
        text = _inline_to_markdown(node)
        return f"{text}\n\n" if text else ""

    if name in {"ul", "ol"}:
        lines: List[str] = []
        for idx, li in enumerate(node.find_all("li", recursive=False), start=1):
            item = li.get_text(" ", strip=True)
            if not item:
                continue
            prefix = f"{idx}. " if name == "ol" else "- "
            lines.append(f"{prefix}{item}")
        return ("\n".join(lines) + "\n\n") if lines else ""

    if name == "pre":
        code = node.get_text("\n", strip=False).strip("\n")
        lang = ""
        code_tag = node.find("code")
        if code_tag and code_tag.get("class"):
            for cls in code_tag.get("class") or []:
                if str(cls).startswith("language-"):
                    lang = str(cls).replace("language-", "")
                    break
        return f"```{lang}\n{code}\n```\n\n" if code else ""

    if name == "blockquote":
        text = node.get_text(" ", strip=True)
        if not text:
            return ""
        quoted = "\n".join(f"> {line}" for line in text.splitlines())
        return f"{quoted}\n\n"

    if name in {"div", "section", "article", "main", "span"}:
        chunks: List[str] = []
        for child in node.children:
            if isinstance(child, NavigableString):
                text = str(child).strip()
                if text:
                    chunks.append(text)
                continue
            if isinstance(child, Tag):
                chunk = _block_to_markdown(child, depth=depth + 1)
                if chunk:
                    chunks.append(chunk)
        return "".join(chunks)

    text = node.get_text("\n", strip=True)
    return f"{text}\n\n" if text else ""


def _extract_title(soup: BeautifulSoup) -> str:
    og = soup.find("meta", property="og:title")
    if og and og.get("content"):
        return str(og["content"]).strip()
    if soup.title and soup.title.string:
        return str(soup.title.string).strip()
    h1 = soup.find("h1")
    if h1:
        return h1.get_text(" ", strip=True)
    return ""


def _html_to_markdown(html: str, page_url: str) -> Tuple[str, str]:
    soup = BeautifulSoup(html, "html.parser")
    for tag_name in _STRIP_TAGS:
        for node in soup.find_all(tag_name):
            node.decompose()

    root = _pick_main_node(soup)
    for a in root.find_all("a", href=True):
        href = str(a.get("href") or "").strip()
        if href and not href.startswith(("#", "mailto:", "javascript:")):
            a["href"] = urljoin(page_url, href)

    title = _extract_title(soup)
    body_md = _block_to_markdown(root).strip()
    if not body_md:
        body_md = root.get_text("\n", strip=True)
    body_md = re.sub(r"\n{3,}", "\n\n", body_md).strip()
    return title, body_md


def _decode_bytes(raw_bytes: bytes, encoding: str | None) -> str:
    if not raw_bytes:
        return ""
    enc = encoding or "utf-8"
    try:
        return raw_bytes.decode(enc, errors="replace")
    except LookupError:
        return raw_bytes.decode("utf-8", errors="replace")


def fetch_url_content(url: str) -> Dict[str, Any]:
    """
    Fetch a public URL and return extracted title + markdown body.
    Applies SSRF checks, size limits, and HTML main-content heuristics.
    """
    normalized = normalize_knowledge_url(url)
    if not normalized:
        return {"success": False, "error": "请输入有效的 http(s) 链接"}

    if not is_safe_fetch_url(normalized):
        return {"success": False, "error": "不允许抓取内网、本地或私有地址"}

    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,text/plain,text/markdown;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }

    try:
        with requests.get(
            normalized,
            headers=headers,
            timeout=FETCH_TIMEOUT_SEC,
            allow_redirects=True,
            stream=True,
        ) as response:
            if len(response.history) > MAX_REDIRECTS:
                return {"success": False, "error": "重定向次数过多"}

            final_url = response.url or normalized
            if not is_safe_fetch_url(final_url):
                return {"success": False, "error": "重定向目标地址不安全"}

            if response.status_code >= 400:
                return {
                    "success": False,
                    "error": f"页面请求失败（HTTP {response.status_code}）",
                    "status_code": response.status_code,
                }

            content_type = (response.headers.get("Content-Type") or "").lower()
            chunks: List[bytes] = []
            total = 0
            for chunk in response.iter_content(chunk_size=65536):
                if not chunk:
                    continue
                total += len(chunk)
                if total > MAX_RESPONSE_BYTES:
                    return {"success": False, "error": "页面体积超过 5MB 上限"}
                chunks.append(chunk)
            raw_bytes = b"".join(chunks)
            encoding = response.encoding or response.apparent_encoding
    except requests.Timeout:
        return {"success": False, "error": "页面请求超时，请稍后重试"}
    except requests.RequestException as exc:
        logger.warning("URL fetch failed for %s: %s", normalized, exc)
        return {"success": False, "error": f"无法访问该链接：{exc}"}

    title = ""
    body = ""

    if "text/html" in content_type or b"<html" in raw_bytes[:2048].lower():
        html = _decode_bytes(raw_bytes, encoding)
        title, body = _html_to_markdown(html, final_url)
    elif any(t in content_type for t in ("text/plain", "text/markdown")):
        body = _decode_bytes(raw_bytes, encoding).strip()
        first_line = body.split("\n", 1)[0].strip()
        if first_line.startswith("# "):
            title = first_line[2:].strip()
    elif "application/json" in content_type:
        return {
            "success": False,
            "error": "暂不支持直接导入 JSON 链接，请上传文件或粘贴文本",
        }
    else:
        return {
            "success": False,
            "error": "暂不支持该内容类型，请上传文件或粘贴网页正文",
            "content_type": content_type,
        }

    if not body or len(body.strip()) < 40:
        return {
            "success": False,
            "error": "未能从页面提取到足够正文（可能需要登录或由 JavaScript 渲染）",
            "final_url": final_url,
        }

    if len(body) > MAX_EXTRACTED_CHARS:
        body = body[:MAX_EXTRACTED_CHARS].rstrip() + "\n\n…（正文已截断）"

    if not title:
        host = urlparse(final_url).netloc
        title = host or "网页摘录"

    return {
        "success": True,
        "url": normalized,
        "final_url": final_url,
        "title": title,
        "content": body,
        "char_count": len(body),
        "content_type": content_type,
    }
