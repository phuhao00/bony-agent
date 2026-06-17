"""
Trend Analyst Agent - 热点分析与选题策划专家

负责游戏/社交媒体热点分析，提供内容选题建议。
"""

from agents.base.bot import BaseAgent
from tools.trend_tools import analyze_trends, generate_hashtags
from tools.gaming_trending import get_gaming_trends, analyze_gaming_trends
from tools.social_trending import get_hot_topics
from utils.logger import setup_logger

logger = setup_logger("trend_analyst_agent")

# --- Agent 元信息 ---
AGENT_ID = "trend_analyst_agent"
AGENT_DESCRIPTION = "热点分析与选题策划专家，专注游戏、社交媒体趋势追踪和内容选题建议"
AGENT_CAPABILITIES = ["trend_analysis", "gaming_trends", "topic_generation", "hashtag_optimization"]

SYSTEM_PROMPT = """你是一位专业的热点分析与选题策划专家（Trend Analyst Agent）。

你的职责是追踪全网热点趋势，为用户提供高转化率的内容选题建议。

## 核心能力
1. **游戏热点追踪**：调用 `get_gaming_trends` 获取 Steam/Epic/TapTap 榜单
2. **趋势深度分析**：调用 `analyze_gaming_trends` 提炼数据价值
3. **社交媒体热点**：调用 `get_hot_topics` 获取微博/抖音热榜
4. **话题生成**：调用 `generate_hashtags` 生成优化标签
5. **综合趋势分析**：调用 `analyze_trends` 获取综合趋势报告

## 平台数据源特性
- **Steam**：PC端核心玩家，价格与评测驱动，"特惠"是最高转化流量密码
- **Epic**：免费领游戏（白嫖）是核心驱动力，跨界引流突破口
- **TapTap**：移动端、二次元及年轻群体大本营，强社交属性与视觉依赖

## 内容输出策略
1. **白嫖前置**：Epic免单、Steam史低必须作为最优先级输出
2. **趋势打包**：适合做《本周必玩新游盘点》或《X月份爆款预警》
3. **平台差异化**：
   - B站/抖音：侧重游戏实机画面、奇葩玩法或白嫖攻略
   - 小红书：侧重画风治愈、女生必玩、双人联机

## 选题生成框架
为每个热点生成：
- 3-5个可以直接用于不同平台的爆款选题方向
- 短文案大纲（含标题策略）
- 推荐标签（hashtags）
- 最佳发布时间建议

始终保持数据敏感，快速捕捉异动，提供有价值的创作指导。
"""


def _build_agent() -> BaseAgent:
    """构建 Trend Analyst Agent"""
    logger.debug("[trend_analyst_agent] _build_agent() called")
    agent = BaseAgent(
        name="TrendAnalystAgent",
        system_prompt=SYSTEM_PROMPT,
        agent_id=AGENT_ID,
        description=AGENT_DESCRIPTION,
        capabilities=AGENT_CAPABILITIES,
    )

    # 添加热点分析相关工具
    agent.tools.extend([
        get_gaming_trends,
        analyze_gaming_trends,
        get_hot_topics,
        analyze_trends,
        generate_hashtags,
    ])
    logger.info("[trend_analyst_agent] built agent_id=%s tools=%d", AGENT_ID, len(agent.tools))
    return agent


def get_trend_analyst_agent(api_key: str):
    """返回 executor (保持向后兼容)"""
    logger.info("[trend_analyst_agent] get_trend_analyst_agent() → executor")
    return _build_agent().get_executor(api_key)


def get_trend_analyst_base_agent(api_key: str = "") -> BaseAgent:
    """返回 BaseAgent 实例 (供注册表和 Orchestrator 使用)"""
    logger.debug("[trend_analyst_agent] get_trend_analyst_base_agent() called")
    return _build_agent()
