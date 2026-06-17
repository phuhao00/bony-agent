"""OS script policy for AppleScript / PowerShell automation."""

from __future__ import annotations

import hashlib
import re
import sys
from typing import Any, Dict, List

BLOCKED_PATTERNS = (
    re.compile(r"do\s+shell\s+script", re.I),
    re.compile(r"Invoke-Expression", re.I),
    re.compile(r"Start-Process\s+.*-ArgumentList", re.I),
    re.compile(r"rm\s+-rf", re.I),
)

OS_SCRIPT_TEMPLATES: Dict[str, Dict[str, str]] = {
    "photoshop.activate": {
        "platform": "darwin",
        "language": "applescript",
        "template": 'tell application "Adobe Photoshop 2024" to activate',
    },
    "photoshop.export_png": {
        "platform": "darwin",
        "language": "applescript",
        "template": (
            'tell application "Adobe Photoshop 2024"\n'
            "  activate\n"
            "end tell"
        ),
    },
    "finder.batch_rename": {
        "platform": "darwin",
        "language": "applescript",
        "template": 'tell application "Finder" to activate',
    },
}


def validate_os_script(script: str, *, language: str = "applescript") -> Dict[str, Any]:
    script = (script or "").strip()
    if not script:
        raise ValueError("script content is required")
    if len(script) > 16000:
        raise ValueError("script is too long")
    for pattern in BLOCKED_PATTERNS:
        if pattern.search(script):
            raise ValueError(f"blocked pattern in script: {pattern.pattern}")
    digest = hashlib.sha256(script.encode("utf-8")).hexdigest()[:16]
    return {
        "language": language,
        "sha256_prefix": digest,
        "preview": script[:500],
        "platform": sys.platform,
        "read_only": False,
        "os_script": True,
    }


def get_os_script_template(template_id: str) -> Dict[str, Any]:
    tpl = OS_SCRIPT_TEMPLATES.get(template_id)
    if not tpl:
        raise ValueError(f"unknown os script template: {template_id}")
    return {"template_id": template_id, **tpl, "validation": validate_os_script(tpl["template"], language=tpl["language"])}
