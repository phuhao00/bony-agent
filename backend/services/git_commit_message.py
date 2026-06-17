"""Generate git commit messages from diff context via LLM."""

from __future__ import annotations

from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from utils.logger import setup_logger

logger = setup_logger("git_commit_message")

_SYSTEM = """你是资深工程师，根据 git 变更生成**一条**提交说明。
要求：
- 使用 Conventional Commits（feat/fix/chore/docs/refactor/test）
- 第一行不超过 72 字符，中文或英文均可
- 只输出提交说明正文，不要引号、不要 markdown、不要解释
- 根据实际改动的目录与 diff 归纳，不要编造未出现的功能"""


async def suggest_commit_message(
    *,
    branch: str,
    changed_files: list[str],
    stat: str,
    diff: str,
    hint: str = "",
) -> dict[str, Any]:
    from core.llm_provider import get_api_key, get_chat_llm

    files_block = "\n".join(f"- {p}" for p in changed_files[:60])
    user_parts = [
        f"分支: {branch or 'unknown'}",
        f"变更文件 ({len(changed_files)}):",
        files_block or "(none)",
    ]
    if stat.strip():
        user_parts.extend(["", "diff --stat:", stat.strip()])
    if diff.strip():
        user_parts.extend(["", "diff (truncated):", diff.strip()[:10000]])
    if hint.strip():
        user_parts.extend(["", f"用户补充: {hint.strip()}"])

    user_text = "\n".join(user_parts)

    if not get_api_key():
        return {"message": "", "source": "none", "error": "missing_api_key"}

    try:
        llm = get_chat_llm(temperature=0.2, streaming=False)
        resp = await llm.ainvoke(
            [SystemMessage(content=_SYSTEM), HumanMessage(content=user_text)]
        )
        raw = str(getattr(resp, "content", "") or "").strip()
        # 取首行，去掉包裹引号
        line = raw.splitlines()[0].strip().strip("`\"'")
        if not line:
            return {"message": "", "source": "llm", "error": "empty_response"}
        return {"message": line[:500], "source": "llm"}
    except Exception as exc:
        logger.warning("commit message LLM failed: %s", exc)
        return {"message": "", "source": "llm", "error": str(exc)}
