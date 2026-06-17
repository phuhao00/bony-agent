"""System Assistant Agent — install/uninstall apps, fix network, configure env, organize files."""

from agents.base.bot import BaseAgent
from tools.system_tools import SYSTEM_ASSISTANT_TOOLS
from utils.logger import setup_logger

logger = setup_logger("system_assistant_agent")

AGENT_ID = "system_assistant"
AGENT_DESCRIPTION = "电脑助手：安装/卸载软件、修复网络、配置环境、整理文件"
AGENT_CAPABILITIES = [
    "system_install",
    "system_network",
    "system_env",
    "system_organize",
    "install",
    "uninstall",
    "network",
    "organize",
]

SYSTEM_PROMPT = """你是 AI Media Agent 的电脑助手（System Assistant）。

你的职责是帮助用户在本机完成：
- 安装 / 卸载软件（通过 Homebrew / winget 应用目录）
- 修复软件（重装、清缓存）
- 修复网络（诊断、刷新 DNS）
- 配置开发环境（检查 node/python/git，安装工具）
- 整理文件（先 preview 再 apply，仅在 My Computer 已登记目录内操作）
- 图片批量整理（按格式/修改日期/EXIF 拍摄日期/大小分类）、去重、压缩、旋转/水印/格式转换、图片合成幻灯片视频（可配 BGM）

## 工作原则

1. **先诊断后执行**：网络/环境问题先用 `get_system_diagnostics` 或对应 diagnose recipe
2. **安装前查目录**：用 `search_app_catalog` 确认包名
3. **整理文件必须 preview**：先 `preview_file_organization`，用户确认后再 apply
4. **高风险操作会进入审批**：安装/卸载/ DNS 刷新 / 批量移动 / 图片压缩编辑 / 合成视频需用户批准
5. **执行环境以后端为准**：独立页面会展示 server 环境画像；安装/卸载命令在后端主机执行，若与用户客户端 OS 不一致需明确说明

## 工具

- `list_system_recipes` — 列出可用工作流
- `run_system_recipe` — 执行指定 recipe（params 为 JSON 字符串）
- `get_system_diagnostics` — 快速环境/网络快照
- `search_app_catalog` / `install_application` / `uninstall_application`
- `preview_file_organization` / `preview_image_organization`
- `compress_images_in_folder` / `edit_images_in_folder` / `dedupe_images_in_folder` / `create_slideshow_from_images`
- `flush_dns_cache`

回答使用中文，步骤清晰，执行结果如实汇报。"""


def _build_agent(api_key: str = "") -> BaseAgent:
    agent = BaseAgent(
        name="SystemAssistant",
        system_prompt=SYSTEM_PROMPT,
        agent_id=AGENT_ID,
        description=AGENT_DESCRIPTION,
        capabilities=AGENT_CAPABILITIES,
        with_memory=False,
        with_rag=False,
    )
    agent.tools.extend(SYSTEM_ASSISTANT_TOOLS)
    logger.info("[system_assistant_agent] built agent_id=%s tools=%d", AGENT_ID, len(agent.tools))
    return agent


def get_system_assistant_agent(api_key: str = ""):
    return _build_agent(api_key).get_executor()


def get_system_assistant_base_agent(api_key: str = ""):
    return _build_agent(api_key)
