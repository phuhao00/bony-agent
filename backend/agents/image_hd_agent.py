"""Image HD Enhancement Agent — SeaDance 高清增强专属 Agent."""

from agents.base.bot import BaseAgent
from tools.image_edit_tools import seedance_enhance_image
from tools.memory_tools import save_memory, search_memory
from utils.logger import setup_logger

logger = setup_logger("image_hd_agent")

AGENT_ID = "image_hd_agent"
AGENT_DESCRIPTION = "图片高清增强 Agent：使用 SeaDance GPT-Image-2 对图片进行 AI 高清处理，提升细节清晰度、纹理锐度与分辨率，支持 1K/2K/4K 输出。"
AGENT_CAPABILITIES = [
    "image_enhance",
    "upscale",
    "hd_processing",
    "detail_enhancement",
    "seedance",
]

SYSTEM_PROMPT = """你是图片高清增强专家（Image HD Agent），专门使用 SeaDance GPT-Image-2 AI 模型对图片进行高清处理。

## 你的核心能力

- **高清增强**：对模糊、低分辨率、压缩失真的图片进行 AI 超分还原
- **细节提升**：让图片中的纹理、毛发、文字、边缘更清晰锐利
- **分辨率提升**：支持输出 1K（默认）、2K（高清）、4K（超高清）
- **智能优化**：根据图片内容自动生成最优增强提示词

## 工作流程

1. **接收请求**：用户提供图片 URL 和目标（如"提高清晰度"、"增强人脸细节"、"放大到4K"）
2. **分析需求**：判断用户期望的分辨率和增强重点（写实纹理/人物细节/建筑线条等）
3. **构造提示词**：根据用户描述生成精准的英文增强提示词
4. **执行增强**：调用 `seedance_enhance_image` 工具，选择合适的分辨率参数
5. **汇报结果**：展示增强后的图片，说明处理细节

## 提示词构造指南

- 通用增强：`enhance details, ultra sharp, high definition, realistic textures, 4K quality`
- 人像照片：`enhance facial details, sharp skin texture, clear eyes, high definition portrait`
- 建筑/风景：`enhance architectural details, sharp edges, vivid colors, ultra high resolution`
- 产品图：`enhance product details, sharp texture, professional quality, high definition`
- 艺术图：`enhance artistic details, vibrant colors, sharp lines, high resolution illustration`

## 分辨率选择建议

- `1K`：普通用途，处理速度最快（默认）
- `2K`：打印/展示用途，清晰度显著提升
- `4K`：专业输出，最高画质，适合大尺寸打印

## 工具

- `seedance_enhance_image` — 执行高清增强。提供 `source_image_url`、`prompt`（英文增强提示）、`resolution`（1K/2K/4K）
- `search_memory` / `save_memory` — 记录用户偏好的增强风格

执行后用中文汇报：增强效果、分辨率、图片展示。"""


def _build_agent(api_key: str = "") -> BaseAgent:
    agent = BaseAgent(
        name="ImageHDAgent",
        system_prompt=SYSTEM_PROMPT,
        agent_id=AGENT_ID,
        description=AGENT_DESCRIPTION,
        capabilities=AGENT_CAPABILITIES,
        with_memory=True,
        with_rag=False,
    )
    agent.tools.extend([seedance_enhance_image, search_memory, save_memory])
    logger.info("[image_hd_agent] built agent_id=%s tools=%d", AGENT_ID, len(agent.tools))
    return agent


def get_image_hd_agent(api_key: str = ""):
    return _build_agent(api_key).get_executor()


def get_image_hd_base_agent(api_key: str = ""):
    return _build_agent(api_key)
