"""Format workspace context for agent chat input."""

from __future__ import annotations

from typing import Any, Dict, List, Optional


def normalize_workspace_context(raw: Optional[dict]) -> Dict[str, Any]:
    if not raw or not isinstance(raw, dict):
        return {}
    attached = raw.get("attached_files") or raw.get("attachedFiles") or []
    if not isinstance(attached, list):
        attached = []
    paths = [str(p).strip().replace("\\", "/").lstrip("/") for p in attached if str(p).strip()]
    out: Dict[str, Any] = {}
    root = str(raw.get("root") or "").strip()
    if root:
        out["root"] = root
    if paths:
        out["attached_files"] = paths
    attachments = raw.get("attachments") or []
    if isinstance(attachments, list):
        normalized_attachments = []
        for item in attachments:
            if not isinstance(item, dict):
                continue
            normalized_attachments.append(
                {
                    "name": str(item.get("name") or "").strip(),
                    "type": str(item.get("type") or "").strip(),
                    "size": item.get("size"),
                    "url": str(item.get("url") or "").strip(),
                }
            )
        if normalized_attachments:
            out["attachments"] = normalized_attachments
    branch = str(raw.get("branch") or "").strip()
    if branch:
        out["branch"] = branch
    return out


def augment_input_with_workspace(user_text: str, workspace_context: Optional[dict]) -> str:
    """Prepend workspace root / branch / attached files to user message for agents."""
    ctx = normalize_workspace_context(workspace_context)
    attached: List[str] = ctx.get("attached_files") or []
    attachments: List[dict[str, Any]] = ctx.get("attachments") or []
    root = str(ctx.get("root") or "").strip()
    branch = str(ctx.get("branch") or "").strip()

    if not root and (branch or attached):
        try:
            from utils.workspace_root import get_workspace_git_root

            root = str(get_workspace_git_root())
        except Exception:
            pass

    if not root and not branch and not attached and not attachments:
        return user_text

    lines = ["[工作区上下文]"]
    if root:
        lines.append(f"工作区根目录: {root}")
    if branch:
        lines.append(f"当前分支: {branch}")
    if attached:
        lines.append("用户附加的文件（请优先分析）:")
        for path in attached:
            lines.append(f"- @{path}")
    if attachments:
        lines.append("用户上传/附加的素材:")
        for item in attachments:
            label = item.get("name") or item.get("url") or "attachment"
            detail = item.get("type") or ""
            size = item.get("size")
            suffix = f" ({detail}, {size} bytes)" if detail and size else f" ({detail})" if detail else ""
            lines.append(f"- {label}{suffix}")
    elif root:
        lines.append(
            "用户已绑定本地工作区但未指定具体文件。"
            "请立即使用 search_code_symbols、search_code_text、read_workspace_file 等工具主动探索并分析代码库，"
            "禁止要求用户补充文件路径或重复询问分析范围。"
        )
    lines.append("")
    return "\n".join(lines) + user_text


def resolve_workspace_root(workspace_context: Optional[dict]) -> Optional[str]:
    """Return explicit workspace root from request context, if any."""
    ctx = normalize_workspace_context(workspace_context)
    root = str(ctx.get("root") or "").strip()
    return root or None
