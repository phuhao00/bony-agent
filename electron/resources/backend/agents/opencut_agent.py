from agents.base.bot import BaseAgent
from tools.media_tools import (
    cut_video_segment,
    split_video,
    merge_clips,
    change_video_speed,
    overlay_video,
    add_text_overlay,
    apply_video_filter,
    extract_audio_track,
    replace_audio_track,
    generate_opencut_project,
    execute_edit_script,
)
from utils.logger import setup_logger

logger = setup_logger("opencut_agent")

# --- Agent 元信息 (供注册表使用) ---
AGENT_ID = "opencut_agent"
AGENT_DESCRIPTION = "OpenCut 专业视频剪辑助手，支持精准裁剪、变速、转场、字幕、画中画、多轨道编辑"
AGENT_CAPABILITIES = [
    "opencut",
    "video_editing",
    "advanced_remix",
    "multi_track",
    "transitions",
    "subtitles",
    "pip",
]

SYSTEM_PROMPT = """你是 OpenCut 专业视频剪辑助手。

你借鉴开源视频编辑器 OpenCut 的设计思想，帮助用户完成复杂的视频剪辑任务。
你擅长：
- 精准裁剪（cut/trim）与拆分（split）
- 多段视频/图片拼接（merge）与转场（transition）
- 恒定变速（speed）并可选保持音调
- 画中画/多轨道叠加（overlay/pip）
- 文字/标题叠加（text overlay）
- 视频滤镜/调色（filter）
- 音频提取与音轨替换
- 生成 OpenCut 风格项目 JSON 文件，供未来导入真正的 OpenCut

工作原则：
1. 仔细理解用户的自然语言剪辑需求，拆解为可执行的工具调用链。
2. 如果用户提供了明确的时间、素材路径、效果参数，请直接调用对应工具。
3. 如果用户描述模糊（如"帮我剪一个 30 秒 highlights"），请先调用合适的工具进行裁剪或拆分，再按需组合。
4. 优先使用 FFmpeg 工具完成编辑；当用户明确要求 "OpenCut" 或导出项目文件时，可调用 generate_opencut_project。
5. 每完成一步，向用户说明操作内容和输出文件路径。
6. 如果某一步失败，说明原因并给出替代方案。

注意：当前 OpenCut 官方 Headless/MCP API 尚未发布，因此所有实际剪辑操作由 FFmpeg 驱动；OpenCutClient 仅作为未来迁移的占位适配层。
"""


def _build_agent() -> BaseAgent:
    logger.debug("[opencut_agent] _build_agent() called")
    agent = BaseAgent(
        name="OpenCutAgent",
        system_prompt=SYSTEM_PROMPT,
        agent_id=AGENT_ID,
        description=AGENT_DESCRIPTION,
        capabilities=AGENT_CAPABILITIES,
        with_memory=False,
        with_rag=False,
    )
    agent.tools.extend([
        cut_video_segment,
        split_video,
        merge_clips,
        change_video_speed,
        overlay_video,
        add_text_overlay,
        apply_video_filter,
        extract_audio_track,
        replace_audio_track,
        generate_opencut_project,
        execute_edit_script,
    ])
    logger.info("[opencut_agent] built agent_id=%s tools=%d", AGENT_ID, len(agent.tools))
    return agent


def get_opencut_agent(api_key: str):
    """返回 executor (保持向后兼容)"""
    logger.info("[opencut_agent] get_opencut_agent() → executor")
    return _build_agent().get_executor(api_key)


def get_opencut_base_agent(api_key: str = "") -> BaseAgent:
    """返回 BaseAgent 实例 (供注册表和 Orchestrator 使用)"""
    logger.debug("[opencut_agent] get_opencut_base_agent() called")
    return _build_agent()
