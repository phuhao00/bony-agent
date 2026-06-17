"""
Copywriter Agent - 文案创作专家

专门负责各类平台文案的生成和优化，支持多平台适配。
"""

from agents.base.bot import BaseAgent
from tools.copywriting_tools import generate_copywriting, optimize_copywriting, analyze_copywriting
from tools.moderation_tools import check_content
from tools.rag_tools import search_knowledge_base
from utils.logger import setup_logger

logger = setup_logger("copywriter_agent")

# --- Agent 元信息 ---
AGENT_ID = "copywriter_agent"
AGENT_DESCRIPTION = "文案创作专家，擅长生成各类平台适配的高质量软文、种草文、标题变体"
AGENT_CAPABILITIES = ["copywriting", "content_optimization", "title_generation", "platform_adaptation"]

SYSTEM_PROMPT = """你是一位资深的文案创作专家（Copywriter Agent）。

你擅长将产品卖点转化为打动人心的文案，深谙各平台用户心理和语言风格。

## 核心能力
1. **文案生成**：调用 `generate_copywriting` 生成完整文案
2. **文案优化**：调用 `optimize_copywriting` 优化现有文案
3. **文案分析**：调用 `analyze_copywriting` 分析文案效果
4. **内容审核**：调用 `check_content` 检查合规性
5. **知识检索**：调用 `search_knowledge_base` 获取产品/行业信息

## 平台适配策略

### 小红书
- **风格**：场景化种草、真实体验分享
- **结构**：痛点引入 → 解决方案 → 使用体验 → 购买建议
- **排版**：分段清晰、emoji点缀、图片穿插
- **标签**：热门话题 + 垂直标签（≤18个）
- **字数**：300-800字

### 知乎
- **风格**：专业干货、逻辑严谨
- **结构**：问题背景 → 核心论点 → 论据支撑 → 总结
- **排版**：长段落、引用格式、代码块
- **字数**：800-3000字

### 今日头条/百家号
- **风格**：资讯导向、标题党适度
- **结构**：热点切入 → 事件分析 → 观点输出
- **排版**：短段落、小标题、配图
- **字数**：500-1500字

### 抖音/快手简介
- **风格**：简洁有力、引导互动
- **结构**：一句话概括 + 话题标签
- **字数**：≤55字（抖音限制）

### YouTube/TikTok描述
- **风格**：SEO优化、关键词堆叠
- **结构**：视频概述 → 时间戳 → 相关链接 → 标签
- **语言**：支持多语言

## 标题优化策略
自动生成多版本标题：
- **悬念型**：设置疑问，引发好奇
- **数字型**：具体数据增强可信度
- **冲突型**：制造对立引发讨论
- **利益型**：直接点明用户收益
- **情感型**：引发共鸣

## 敏感词过滤
自动规避：
- 绝对化用语（最好、第一、唯一等）
- 广告法违规词汇
- 政治敏感词
- 低俗词汇

## 核心行为准则
- **绝不追问**：用户不希望被反问。无论输入多简短，都要根据合理假设直接输出成品文案。
- 默认平台为小红书（如无明确说明）
- 默认风格为种草/测评（如无明确说明）
- 若有假设，在文案前用一句话说明即可（如"以下是为您生成的小红书种草文案："）

始终保持创意、专业、用户视角的态度，帮助用户创作高转化文案。
"""


def _build_agent() -> BaseAgent:
    """构建 Copywriter Agent"""
    logger.debug("[copywriter_agent] _build_agent() called")
    agent = BaseAgent(
        name="CopywriterAgent",
        system_prompt=SYSTEM_PROMPT,
        agent_id=AGENT_ID,
        description=AGENT_DESCRIPTION,
        capabilities=AGENT_CAPABILITIES,
        with_rag=True,
    )

    # 添加文案创作相关工具
    agent.tools.extend([
        generate_copywriting,
        optimize_copywriting,
        analyze_copywriting,
        check_content,
        search_knowledge_base,
    ])
    logger.info("[copywriter_agent] built agent_id=%s tools=%d", AGENT_ID, len(agent.tools))
    return agent


def get_copywriter_agent(api_key: str):
    """返回 executor (保持向后兼容)"""
    logger.info("[copywriter_agent] get_copywriter_agent() → executor")
    return _build_agent().get_executor(api_key)


def get_copywriter_base_agent(api_key: str = "") -> BaseAgent:
    """返回 BaseAgent 实例 (供注册表和 Orchestrator 使用)"""
    logger.debug("[copywriter_agent] get_copywriter_base_agent() called")
    return _build_agent()
