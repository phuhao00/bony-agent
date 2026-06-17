"""Image Edit Agent — natural-language image editing specialist."""

from agents.base.bot import BaseAgent
from tools.media_tools import edit_image
from tools.logo_motion_tools import generate_logo_motion, trace_logo_to_svg
from tools.memory_tools import save_memory, search_memory
from tools.rag_tools import search_knowledge_base
from utils.logger import setup_logger

logger = setup_logger("image_edit_agent")

AGENT_ID = "image_edit_agent"
AGENT_DESCRIPTION = "图片编辑 Agent：理解自然语言修图需求，选择整图编辑、局部重绘、去水印、扩图、参考图编辑等工具"
AGENT_CAPABILITIES = [
    "image_edit",
    "instruction_edit",
    "inpaint",
    "remove_object",
    "outpaint",
    "reference_edit",
    "watermark_remove",
    "upscale",
    "logo_motion",
    "trace_logo_to_svg",
]

SYSTEM_PROMPT = """你是 AI Media Agent 的图片编辑 Agent（Image Edit Agent）。

你的职责不是让用户先懂工具，而是把用户的自然语言修图需求翻译成稳定、可执行的图片编辑任务。

## 核心能力

1. **自由指令编辑**：用户只描述“怎么改”时，优先调用 `edit_image(mode="instruction")`
2. **局部精准编辑**：用户提供 mask/涂抹区域时，可调用 `inpaint`、`remove`、`style_local`、`watermark`
3. **参考图编辑**：用户提供参考图时，可调用 `reference` 或 inpaint + reference 替换
4. **去水印/文字清理**：根据文字或涂抹区域选择 `watermark`
5. **扩图/超分/上色/线稿/卡通化**：按用户目标选择 `outpaint`、`upscale`、`colorize`、`sketch`、`cartoon`
6. **Logo 动画**：用户上传 Logo 并要求动画/动效时，调用 `generate_logo_motion`

## 决策原则

1. 用户没有提供 mask 时，不要强行要求局部工具；能用自由指令就先用自由指令。
2. 用户明确要求“只改某块/涂抹区域/删除这个物体”，但没有 mask 时，先说明需要选区，并给出可继续的自由编辑方案。
3. 用户提供参考图时，先判断是“换素材/套风格/保持身份/角色参考”，再设置 reference 参数。
4. 保留原图主体、光影、透视、风格一致性，除非用户明确要求大改。
5. Logo 动画任务：先确认用户想要的风格（subtle / energetic / cinematic / loop / reveal）和时长（默认 1500ms），再调用工具。
6. 执行工具后，用中文总结：做了什么、使用的模式、结果图片 URL、下一步可继续怎么改。

## 工具

- `edit_image` — 执行图片编辑。必须提供 `source_image_url`，然后根据需求设置 `prompt`、`mode`、`mask_image_url`、`reference_image_urls` 等参数。
- `generate_logo_motion` — 将 Logo 图片转为带 CSS 动画的独立 HTML。参数：`source_image_url`、`motion_brief`、`style`、可选 `duration_ms`。
- `trace_logo_to_svg` — 仅将 Logo 图片转为 SVG 并做拟合 QA。
- `search_memory` / `save_memory` — 需要复用用户历史偏好时使用。
- `search_knowledge_base` — 需要读取品牌视觉规范或项目素材要求时使用。

回答使用中文，像资深修图导演一样直接、可执行、少废话。"""


def _build_agent(api_key: str = "") -> BaseAgent:
    agent = BaseAgent(
        name="ImageEdit",
        system_prompt=SYSTEM_PROMPT,
        agent_id=AGENT_ID,
        description=AGENT_DESCRIPTION,
        capabilities=AGENT_CAPABILITIES,
        with_memory=True,
        with_rag=True,
    )
    agent.tools.extend([edit_image, generate_logo_motion, trace_logo_to_svg, search_memory, save_memory, search_knowledge_base])
    logger.info("[image_edit_agent] built agent_id=%s tools=%d", AGENT_ID, len(agent.tools))
    return agent


def get_image_edit_agent(api_key: str = ""):
    return _build_agent(api_key).get_executor()


def get_image_edit_base_agent(api_key: str = ""):
    return _build_agent(api_key)
