"""Desktop Operator Agent — automate any local application."""

from agents.base.bot import BaseAgent
from tools.desktop_operator_tools import DESKTOP_OPERATOR_TOOLS
from utils.logger import setup_logger

logger = setup_logger("desktop_operator_agent")

AGENT_ID = "desktop_operator_agent"
AGENT_DESCRIPTION = "桌面操作员：操作本机任意软件（Blender/Photoshop/Office/微信等），CLI 批处理与 GUI 自动化"
AGENT_CAPABILITIES = [
    "creative_app_script",
    "app_launch",
    "native_desktop_control",
    "desktop_operator",
]

SYSTEM_PROMPT = """你是 AI Media Agent 的桌面操作员（Desktop Operator）。

你的职责是帮助用户在本机操作任意软件：
- 安装/探测应用（list_desktop_apps / search_desktop_apps / get_desktop_environment）
- CLI/批处理自动化（Blender、Photoshop JSX、Unity batch 等）
- 启动应用（launch_desktop_app）
- GUI 原生自动化（run_native_desktop_task，用于无 CLI 的软件）

## 工作原则

1. **先探测**：用 get_desktop_environment 或 search 确认应用是否安装
2. **分层策略**：有 CLI 模板则 plan → write_script → run；否则 launch 或 run_native_desktop_task
3. **路径沙箱**：脚本与项目文件须在 My Computer 登记目录内；working_dir 必须在该目录下
4. **必须审批**：run_desktop_automation / launch / native GUI 会进入审批；告知用户 task_id 与 /settings/capabilities
5. **脚本透明**：写脚本后用 write_automation_script，审批 payload 含路径与 hash
6. **未安装应用**：建议用户通过 system_assistant 安装（如 brew install --cask blender）

## 典型 CLI 流程（Blender 示例）

1. get_desktop_environment
2. write_automation_script（bpy 脚本）
3. plan_desktop_automation(app_id=blender, mode=batch_python, params_json=...)
4. run_desktop_automation(plan_json, working_dir)
5. 返回 task_id，引导用户批准

回答使用中文，步骤清晰。"""


def _build_agent(api_key: str = "") -> BaseAgent:
    agent = BaseAgent(
        name="DesktopOperator",
        system_prompt=SYSTEM_PROMPT,
        agent_id=AGENT_ID,
        description=AGENT_DESCRIPTION,
        capabilities=AGENT_CAPABILITIES,
        with_memory=False,
        with_rag=False,
    )
    agent.tools.extend(DESKTOP_OPERATOR_TOOLS)
    logger.info("[desktop_operator_agent] built agent_id=%s tools=%d", AGENT_ID, len(agent.tools))
    return agent


def get_desktop_operator_agent(api_key: str = ""):
    return _build_agent(api_key).get_executor()


def get_desktop_operator_base_agent(api_key: str = ""):
    return _build_agent(api_key)
