"""SSRF-safe URL validation for outbound HTTP fetches."""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse


_BLOCKED_HOSTS = frozenset({"localhost", "127.0.0.1", "0.0.0.0", "::1"})

# Provider media CDNs (DashScope OSS, Volcengine, etc.). HTTPS-only; skip DNS IP
# pre-check because CDN edges may resolve oddly or fail DNS in packaged runtimes.
_TRUSTED_MEDIA_CDN_SUFFIXES = (
    ".aliyuncs.com",
    ".volces.com",
    ".volccdn.com",
    ".byteimg.com",
    ".myqcloud.com",
    ".qcloud.com",
)


def _is_trusted_media_cdn_host(host: str) -> bool:
    lowered = (host or "").strip().lower()
    return any(lowered == suffix[1:] or lowered.endswith(suffix) for suffix in _TRUSTED_MEDIA_CDN_SUFFIXES)


def is_safe_fetch_url(url: str) -> bool:
    """Return True when URL is http(s) and does not target private/loopback hosts."""
    try:
        parsed = urlparse((url or "").strip())
    except Exception:
        return False

    if parsed.scheme not in ("http", "https"):
        return False

    host = (parsed.hostname or "").strip().lower()
    if not host or host in _BLOCKED_HOSTS:
        return False

    if host.endswith(".local") or host.endswith(".internal"):
        return False

    if parsed.scheme == "https" and _is_trusted_media_cdn_host(host):
        return True

    try:
        addr = ipaddress.ip_address(host)
        if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved:
            return False
    except ValueError:
        # hostname — resolve and check all IPs
        try:
            infos = socket.getaddrinfo(host, None)
        except OSError:
            return False
        for info in infos:
            ip = info[4][0]
            try:
                addr = ipaddress.ip_address(ip)
            except ValueError:
                continue
            if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved:
                return False

    return True
