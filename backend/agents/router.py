"""
意图路由器 (Intent Router)

两级路由策略:
1. 关键词快速匹配 (零延迟)
2. LLM 兜底分类 (需要 API 调用)

返回 RouteResult 告知 Orchestrator 应该将请求分派给哪个 Agent。
"""

import asyncio
import re
import time
from dataclasses import dataclass
from typing import List, Optional
from core.assistant_catalog import iter_keyword_rules
from core.assistant_intent_resolver import resolve_assistant_intent
from utils.logger import setup_logger

logger = setup_logger("intent_router")


@dataclass
class RouteResult:
    """路由结果"""
    agent_id: str       # 目标 Agent ID
    confidence: float   # 置信度 0-1
    reason: str         # 路由原因 (调试用)


# ------------------------------------------------------------------
# 关键词 -> Agent ID 映射表
# ------------------------------------------------------------------
_KEYWORD_RULES = [
    *iter_keyword_rules(),
    # (关键词列表, agent_id, 优先级)
    # 内容审核
    (["审核", "合规", "敏感词", "检查内容", "review", "moderate", "审查", "违规"], "reviewer_agent", 0.95),

    # 视频剪辑（简单混剪）
    (["视频剪辑", "混剪", "拼接", "remix", "编辑视频", "视频编辑", "剪视频", "剪辑"], "video_editor_agent", 0.95),

    # OpenCut 专业剪辑
    ([
        "opencut", "专业剪辑", "多轨道", "关键帧", "画中画", "精准裁剪", "高级转场",
        "视频变速", "视频滤镜", "音轨替换", "提取音频", "文字叠加", "拆分视频",
    ], "opencut_agent", 0.96),

    # 长视频工坊（必须在泛化「视频」规则之前，否则会误进 media_agent）
    (
        [
            "长视频工坊",
            "长视频",
            "分段长视频",
            "long-form video",
            "long video",
            "分钟长视频",
        ],
        "long_video_agent",
        0.97,
    ),

    # 媒体生成 - 明确的图片/海报/封面生成意图（优先命中）
    ([
        "封面图", "头图", "banner", "海报", "宣传图", "配图", "插图", "主图",
        "生成图片", "生成一张图", "生成图", "文生图", "画一张", "画个",
        "做一张图", "做张图",
    ], "media_agent", 0.95),

    # 媒体生成 (图片/视频)
    (["图片", "画", "照片", "海报", "image", "picture", "photo", "生成图", "作图", "画图", "AI绘画"], "media_agent", 0.90),
    (["视频", "video", "动画", "animation", "生成视频", "AI视频", "做视频"], "media_agent", 0.90),

    # 发布/投稿
    (["发布", "上传", "投稿", "哔哩哔哩", "b站", "bilibili", "小红书", "抖音", "快手", "youtube", "twitter"], "media_agent", 0.80),

    # 脚本创作 (细分类)
    (["脚本", "分镜", "storyboard", "拍摄脚本", "视频脚本", "脚本创作"], "script_writer_agent", 0.92),

    # 文案创作 (细分类)
    (["文案", "软文", "种草文", "标题", "copywriting", "推文", "笔记", "种草"], "copywriter_agent", 0.92),

    # 热点分析
    (["热点", "趋势", "trend", "热搜", "热门", "榜单", "游戏资讯", "游戏推荐", "喜加一", "史低"], "trend_analyst_agent", 0.92),

    # 联网 / 实时信息（必须在 creative_agent 兜底之前）
    (
        [
            "天气", "weather", "气温", "forecast", "空气质量", "aqi",
            "实时", "最新", "查一下", "搜索", "news", "股价", "汇率",
            "exchange rate",
        ],
        "creative_agent",
        0.96,
    ),

    # 代码分析 / 审查（优先于创意兜底）
    (
        [
            "代码分析",
            "分析代码",
            "分析下代码",
            "帮我分析下代码",
            "帮我分析代码",
            "分析下项目代码",
            "代码审查",
            "code review",
            "review 代码",
            "调用关系",
            "谁在用",
            "谁调用",
            "call graph",
            "符号",
            "lint",
            "bug",
            "重构这段",
            "帮我看这段代码",
            "看看这段代码",
            "codegraph",
        ],
        "code_analyst_agent",
        0.93,
    ),

    # 桌面操作员 / 本机软件自动化
    (
        [
            "blender",
            "photoshop",
            "jsx",
            "bpy",
            "extendscript",
            "批量渲染",
            "3d渲染",
            "unity batch",
            "unreal",
            "打开应用",
            "操作软件",
            "自动化桌面",
            "微信",
            "office",
            "excel",
            "word",
            "桌面操作",
            "操作电脑软件",
            "launch app",
            "desktop automation",
        ],
        "desktop_operator_agent",
        0.91,
    ),

    # 产品经理 / 市场洞察 / 产品迭代
    (
        [
            "产品经理",
            "产品助手",
            "市场分析",
            "市场洞察",
            "竞品分析",
            "竞品扫描",
            "产品创意",
            "产品点子",
            "产品诊断",
            "产品迭代",
            "产品优化",
            "运营分析",
            "增长策略",
            "mvp",
            "product manager",
            "market research",
            "competitor analysis",
            "product idea",
        ],
        "product_manager_agent",
        0.93,
    ),

    # 法律顾问 / 案例解读 / 公司合规
    (
        [
            "法律顾问",
            "法律助手",
            "法律解读",
            "案例检索",
            "司法案例",
            "裁判文书",
            "公司合规",
            "合规体检",
            "合规审查",
            "法规解读",
            "政策解读",
            "合同审查",
            "合同风险",
            "劳动合规",
            "税务合规",
            "金融合规",
            "行政处罚",
            "法律风险",
            "legal advisor",
            "legal agent",
            "compliance audit",
            "case research",
            "contract review",
        ],
        "legal_agent",
        0.93,
    ),

    # 广告投放 / 创意文案 / 受众定向
    (
        [
            "广告投放",
            "投放助手",
            "广告策略",
            "投放策略",
            "广告创意",
            "广告文案",
            "受众定向",
            "人群定向",
            "广告预算",
            "预算分配",
            "投放复盘",
            "效果复盘",
            "cpc",
            "cpa",
            "roas",
            "ad campaign",
            "ad copy",
            "audience targeting",
        ],
        "ad_campaign_agent",
        0.93,
    ),

    # 商务合作 / BD / 合作方案
    (
        [
            "商务合作",
            "合作助手",
            "bd",
            "business development",
            "合作方案",
            "合作 outreach",
            "outreach",
            "冷邮件",
            "伙伴评估",
            "合作条款",
            "合同条款",
            "合作 pipeline",
            "战略合作",
            "渠道合作",
            "品牌联名",
            "partnership",
            "partner evaluation",
        ],
        "business_partnership_agent",
        0.93,
    ),

    # 采购 / 供应商 / RFQ / 寻源
    (
        [
            "采购助手",
            "采购",
            "供应商评估",
            "供应商审查",
            "尽职调查",
            "rfq",
            "询价",
            "招标",
            "报价比对",
            "报价对比",
            "采购合同",
            "降本",
            "成本优化",
            "寻源",
            "品类管理",
            "spend",
            "procurement",
            "vendor evaluation",
            "rfq draft",
            "quote comparison",
            "sourcing strategy",
        ],
        "procurement_agent",
        0.93,
    ),

    # 游戏美术
    (
        [
            "游戏美术",
            "美术助手",
            "视觉风格",
            "角色设计",
            "场景概念",
            "原画",
            "概念图",
            "ui美术",
            "游戏ui",
            "mood board",
            "竞品画面",
            "game art",
            "character design",
            "concept art",
            "visual style",
        ],
        "game_art_agent",
        0.93,
    ),

    # 游戏策划
    (
        [
            "游戏策划",
            "策划助手",
            "核心玩法",
            "玩法循环",
            "系统设计",
            "关卡设计",
            "数值策划",
            "世界观",
            "剧情大纲",
            "游戏概念",
            "game design",
            "game designer",
            "level design",
            "game balance",
            "core loop",
        ],
        "game_design_agent",
        0.93,
    ),

    # 程序员助手 / DevOps / 中间件
    (
        [
            "程序员",
            "程序员助手",
            "git ssh",
            "ssh key",
            "redis",
            "mysql",
            "mongodb",
            "mongo",
            "etcd",
            "consul",
            "nsq",
            "中间件",
            "基础设施",
            "运维组件",
            "跑测试",
            "pytest",
            "启动redis",
            "启动mysql",
            "devops",
            "programmer",
            "infra",
        ],
        "programmer_agent",
        0.92,
    ),

    # 电脑助手 / 系统维护
    (
        [
            "安装软件",
            "卸载软件",
            "卸载应用",
            "安装应用",
            "修复网络",
            "修网络",
            "dns",
            "刷新dns",
            "配置环境",
            "整理文件",
            "归类文件",
            "整理电脑",
            "install app",
            "uninstall",
            "fix network",
            "organize files",
            "brew install",
            "winget",
            "电脑助手",
        ],
        "system_assistant",
        0.94,
    ),

    # 架构 / 项目结构
    (
        ["架构", "目录结构", "规范", "architecture", "项目结构", "代码规范", "重构", "模块边界"],
        "code_analyst_agent",
        0.88,
    ),

    # 创意创作 (兜底)
    (["创作", "内容", "创意", "write", "create"], "creative_agent", 0.85),
]


class IntentRouter:
    """意图路由器"""

    def __init__(self, available_agent_ids: Optional[List[str]] = None):
        self._available = set(available_agent_ids) if available_agent_ids else None

    def _is_available(self, agent_id: str) -> bool:
        if self._available is None:
            return True
        return agent_id in self._available

    # ------------------------------------------------------------------
    # 快速路径: 关键词匹配
    # ------------------------------------------------------------------
    def _keyword_route(self, user_input: str) -> Optional[RouteResult]:
        text = user_input.lower()
        smart_candidate = resolve_assistant_intent(
            user_input,
            available_agent_ids=self._available,
        )
        if smart_candidate:
            logger.info(
                "🧠 [router] smart intent hit: %s score=%.2f conf=%.2f reason=%s",
                smart_candidate.agent_id,
                smart_candidate.score,
                smart_candidate.confidence,
                smart_candidate.reason,
            )
            return RouteResult(
                agent_id=smart_candidate.agent_id,
                confidence=smart_candidate.confidence,
                reason=smart_candidate.reason,
            )
        for keywords, agent_id, confidence in _KEYWORD_RULES:
            if not self._is_available(agent_id):
                continue
            for kw in keywords:
                if kw in text:
                    result = RouteResult(
                        agent_id=agent_id,
                        confidence=confidence,
                        reason=f"keyword_match: '{kw}'",
                    )
                    logger.info("🎯 [router] keyword hit: %r → %s (conf=%.2f)", kw, agent_id, confidence)
                    return result
        logger.debug("[router] no keyword match for input=%.60r", user_input[:60])
        return None

    # ------------------------------------------------------------------
    # 慢速路径: LLM 兜底
    # ------------------------------------------------------------------
    async def _llm_route(self, user_input: str) -> RouteResult:
        """使用 LLM 判断应分派给哪个 Agent (async, non-blocking)"""
        logger.info("[router] falling back to LLM route | input=%.80r", user_input[:80])
        t0 = time.monotonic()
        try:
            from core.llm_provider import get_chat_llm
            from agents.registry import AgentRegistry

            registry = AgentRegistry()
            agents_info = registry.list_all()

            # 构建可选 Agent 描述
            options = "\n".join(
                f"- {a['agent_id']}: {a['description']} (能力: {', '.join(a['capabilities'])})"
                for a in agents_info
                if self._is_available(a["agent_id"])
            )

            prompt = (
                "你是一个意图推断专家。根据用户请求，从以下 Agent 中选择最合适的一个。\n"
                "用户的输入可能很简短或模糊——你必须大胆推断意图，不能说需要更多信息。\n"
                "只需回复 Agent ID，不要任何解释。\n\n"
                "推断规则（按优先级）：\n"
                "- 涉及图片/海报/宣传图/画 → media_agent\n"
                "- 涉及较长成片、多分镜连续叙事、明确要求长视频/长视频工坊 → long_video_agent\n"
                "- 涉及短视频/单段视频生成、图生视频（非长片分镜）→ media_agent\n"
                "- 涉及视频剪辑/混剪/拼接 → video_editor_agent\n"
                "- 涉及专业剪辑/OpenCut/多轨道/画中画/精准裁剪/高级转场/视频变速/滤镜 → opencut_agent\n"
                "- 涉及脚本/分镜/拍摄计划 → script_writer_agent\n"
                "- 涉及文案/种草/标题/推文/笔记 → copywriter_agent\n"
                "- 涉及热点/趋势/榜单 → trend_analyst_agent\n"
                "- 涉及审核/合规/敏感词 → reviewer_agent\n"
                "- 涉及代码审查/代码分析/调用关系/符号搜索/架构/目录规范 → code_analyst_agent\n"
                "- 涉及 Git/SSH、中间件运维(Redis/MySQL/MongoDB/etcd/Consul/NSQ)、跑测试、DevOps → programmer_agent\n"
                "- 涉及市场分析、产品创意、竞品分析、产品诊断/迭代、运营增长策略 → product_manager_agent\n"
                "- 涉及采购、供应商评估、RFQ/询价、报价比对、采购合同、降本寻源 → procurement_agent\n"
                "- 涉及司法案例、公司合规、法规政策、合同/金融法律风险 → legal_agent\n"
                "- 涉及广告投放策略、广告创意文案、受众定向、预算分配、投放复盘 → ad_campaign_agent\n"
                "- 涉及商务合作 outreach、合作方案、条款要点、伙伴评估、BD pipeline → business_partnership_agent\n"
                "- 涉及游戏美术、视觉风格、角色/场景概念、UI 美术规范 → game_art_agent\n"
                "- 涉及游戏策划、核心玩法、系统设计、关卡规划、数值框架 → game_design_agent\n"
                "- 涉及安装/卸载软件、修复网络、配置环境、整理文件 → system_assistant\n"
                "- 涉及操作本机已安装软件、Blender/Photoshop/Office/DCC、桌面 GUI 自动化 → desktop_operator_agent\n"
                "- 涉及天气/新闻/股价/汇率/实时信息/需要联网查询 → creative_agent\n"
                "- 其他创作需求 → creative_agent\n\n"
                f"可选 Agent:\n{options}\n\n"
                f"用户请求: {user_input}\n\n"
                "回复格式: agent_id（仅此一行）"
            )

            llm = get_chat_llm(temperature=0.0)
            result = await asyncio.wait_for(llm.ainvoke(prompt), timeout=15.0)
            elapsed = time.monotonic() - t0
            chosen = result.content.strip().lower().replace('"', "").replace("'", "")
            logger.info(
                "[router] LLM responded in %.3fs | raw=%r chosen=%r",
                elapsed, result.content.strip()[:80], chosen,
            )

            # 验证返回的 agent_id 存在
            valid_ids = {a["agent_id"] for a in agents_info}
            if chosen in valid_ids and self._is_available(chosen):
                logger.info("[router] 🤖 LLM route → %s (conf=0.75)", chosen)
                return RouteResult(agent_id=chosen, confidence=0.75, reason=f"llm_classification")
            logger.warning("[router] LLM returned unknown agent_id=%r | valid=%s", chosen, sorted(valid_ids))

        except Exception as e:
            logger.warning("[router] LLM routing failed after %.3fs: %s", time.monotonic() - t0, e, exc_info=True)

        # 兜底: 使用 creative_agent（最通用）
        fallback = "creative_agent"
        if not self._is_available(fallback):
            fallback = "media_agent"
        logger.warning("[router] ⚠️ fallback route → %s", fallback)
        return RouteResult(agent_id=fallback, confidence=0.5, reason="fallback")

    # ------------------------------------------------------------------
    # 主入口
    # ------------------------------------------------------------------
    async def route(self, user_input: str) -> RouteResult:
        """
        对用户输入进行意图路由 (async, non-blocking)。

        Returns:
            RouteResult(agent_id, confidence, reason)
        """
        logger.info("[router] route() input_len=%d preview=%.80r", len(user_input), user_input[:80])
        # 1. 关键词快速路径
        result = self._keyword_route(user_input)
        if result:
            logger.info(
                "[router] resolved via keyword: %s conf=%.2f",
                result.agent_id, result.confidence,
            )
            return result

        # 2. LLM 兜底
        result = await self._llm_route(user_input)
        logger.info(
            "[router] resolved via LLM: %s conf=%.2f reason=%s",
            result.agent_id, result.confidence, result.reason,
        )
        return result
