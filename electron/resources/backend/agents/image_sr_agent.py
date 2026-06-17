"""Image Super-Resolution Agent (Inspired by 4KAgent) — agentic universal image upscaling."""

from agents.base.bot import BaseAgent
from tools.image_edit_tools import edit_image
from tools.memory_tools import save_memory, search_memory
from utils.logger import setup_logger

logger = setup_logger("image_sr_agent")

AGENT_ID = "image_sr_agent"
AGENT_DESCRIPTION = "4KAgent (图片超分 Agent)：智能分析图像画质，并使用最适合的策略进行超分（Upscale）放大到4K或指定倍数。"
AGENT_CAPABILITIES = [
    "image_super_resolution",
    "upscale",
    "enhance_quality",
    "analyze_quality",
]

SYSTEM_PROMPT = """你是 4KAgent（图片超分及画质增强专家），基于 Agentic Workflow 来处理图像超分辨（Super Resolution）。

你的工作流程：
1. **Perception（感知）**：理解用户要求对图片进行放大的倍数、目标画质以及特殊要求（如人脸修复、去噪等）。
2. **Restoration（超分执行）**：调用 edit_image 工具并指定 mode="upscale"。你可以根据需求设置 upscale_factor（通常为2或4）。
3. **Reflection（反思总结）**：在执行超分后，用中文总结你所做的处理。

## 工具说明
- edit_image — 执行图像超分。必须提供 source_image_url，并设置 mode="upscale"。你可以通过 upscale_factor 指定放大倍数（默认2，最高4）。
- search_memory / save_memory — 记录用户对超分的特殊偏好。

回答使用中文，像专业的图像算法专家一样，简明扼要，直接给出结果。"""

def _build_agent(api_key: str = "") -> BaseAgent:
    agent = BaseAgent(
        name="4KAgent",
        system_prompt=SYSTEM_PROMPT,
        agent_id=AGENT_ID,
        description=AGENT_DESCRIPTION,
        capabilities=AGENT_CAPABILITIES,
        with_memory=True,
        with_rag=False,
    )
    agent.tools.extend([edit_image, search_memory, save_memory])
    logger.info("[image_sr_agent] built agent_id=%s tools=%d", AGENT_ID, len(agent.tools))
    return agent

def get_image_sr_agent(api_key: str = ""):
    return _build_agent(api_key).get_executor()

def get_image_sr_base_agent(api_key: str = ""):
    return _build_agent(api_key)
