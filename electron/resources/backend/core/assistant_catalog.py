"""Shared assistant catalog for main-chat routing and Labs deep links."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Iterable, Literal


RiskLevel = Literal["low", "medium", "high"]


@dataclass(frozen=True)
class AssistantCatalogEntry:
    tool_key: str
    agent_id: str
    display_name: str
    api_base: str
    labs_href: str
    description: str
    intent_keywords: tuple[str, ...]
    recipe_categories: tuple[str, ...] = ()
    risk_level: RiskLevel = "low"
    requires_approval: bool = False

    def to_dict(self) -> dict:
        return asdict(self)


ASSISTANT_CATALOG: tuple[AssistantCatalogEntry, ...] = (
    AssistantCatalogEntry(
        tool_key="productManager",
        agent_id="product_manager_agent",
        display_name="产品经理助手",
        api_base="/product-manager",
        labs_href="/product-manager",
        description="市场分析、产品创意、竞品扫描、PRD/JTBD/路线图",
        intent_keywords=(
            "产品经理", "产品助手", "市场分析", "市场洞察", "竞品分析", "产品创意",
            "产品诊断", "产品迭代", "用户故事", "prd", "jtbd", "roadmap", "mvp",
            "游戏市场", "手游市场", "mod游戏市场", "mod 游戏市场", "游戏mod市场",
            "mod市场", "mod 市场", "mod生态", "mod 生态", "玩家需求分析",
            "product manager", "market research", "competitor analysis",
        ),
        recipe_categories=("market", "idea", "product", "competitor", "methodology"),
    ),
    AssistantCatalogEntry(
        tool_key="legalAdvisor",
        agent_id="legal_agent",
        display_name="法律顾问助手",
        api_base="/legal-advisor",
        labs_href="/legal-advisor",
        description="案例解读、公司合规、法规政策、合同和金融法律风险",
        intent_keywords=(
            "法律顾问", "法律助手", "法律解读", "司法案例", "裁判文书", "公司合规",
            "合规体检", "法规解读", "政策解读", "合同审查", "合同风险", "劳动合规",
            "税务合规", "金融合规", "legal advisor", "contract review", "compliance audit",
        ),
        recipe_categories=("case", "compliance", "regulation", "contract", "finance"),
        risk_level="medium",
    ),
    AssistantCatalogEntry(
        tool_key="gameArt",
        agent_id="game_art_agent",
        display_name="游戏美术助手",
        api_base="/game-art",
        labs_href="/game-art",
        description="视觉风格、角色/场景概念、UI 美术规范、Moodboard",
        intent_keywords=(
            "游戏美术", "美术助手", "视觉风格", "角色设计", "场景概念", "原画",
            "概念图", "ui美术", "游戏ui", "moodboard", "mood board", "竞品画面",
            "game art", "character design", "concept art", "visual style",
        ),
        recipe_categories=("style", "character", "scene", "ui", "research"),
    ),
    AssistantCatalogEntry(
        tool_key="imageEdit",
        agent_id="image_edit_agent",
        display_name="图片编辑 Agent",
        api_base="/media/image-edit",
        labs_href="/media/image-edit",
        description="自然语言修图、局部重绘、去水印、扩图、参考图编辑",
        intent_keywords=(
            "图片编辑", "图片修改", "修图", "改图", "编辑图片", "照片编辑", "照片修改",
            "去水印", "去掉水印", "移除背景", "抠图", "局部重绘", "涂抹区域",
            "扩图", "参考图", "换衣服", "换背景", "加一只",
            "Logo 动画", "Logo动效", "标志动画", "标志动效", "让 Logo 动起来", "图标动画",
            "remove object", "image edit", "edit image", "inpaint", "outpaint",
            "watermark", "logo motion", "logo animation",
        ),
        recipe_categories=("instruction", "inpaint", "remove", "reference", "outpaint", "logo_motion"),
    ),
    AssistantCatalogEntry(
        tool_key="imageSR",
        agent_id="image_sr_agent",
        display_name="4KAgent (图片超分)",
        api_base="/media/image-sr",
        labs_href="/media/image-sr",
        description="智能分析图像画质，并使用最适合的策略进行超分放大到 4K 或指定倍数",
        intent_keywords=(
            "图片超分", "图片放大", "放大图片", "提高画质", "画质增强", "提升清晰度",
            "超分辨率", "无损放大", "照片变清晰", "老照片修复", "upscale", "super resolution",
            "enhance quality", "4k", "4kagent",
        ),
        recipe_categories=("upscale", "enhance"),
    ),
    AssistantCatalogEntry(
        tool_key="gameDesign",
        agent_id="game_design_agent",
        display_name="游戏策划助手",
        api_base="/game-design",
        labs_href="/game-design",
        description="概念案、核心循环、系统设计、关卡叙事、数值框架",
        intent_keywords=(
            "游戏策划", "策划助手", "核心玩法", "玩法循环", "系统设计", "关卡设计",
            "数值策划", "世界观", "剧情大纲", "游戏概念", "game design",
            "level design", "game balance", "core loop",
        ),
        recipe_categories=("concept", "system", "level", "narrative", "balance"),
    ),
    AssistantCatalogEntry(
        tool_key="procurementAssistant",
        agent_id="procurement_agent",
        display_name="采购助手",
        api_base="/procurement-assistant",
        labs_href="/procurement-assistant",
        description="供应商评估、RFQ、报价比对、合同审查、降本寻源",
        intent_keywords=(
            "采购助手", "采购", "供应商评估", "供应商审查", "尽职调查", "rfq",
            "询价", "招标", "报价比对", "采购合同", "降本", "成本优化", "寻源",
            "procurement", "vendor evaluation", "sourcing strategy",
        ),
        recipe_categories=("vendor", "rfq", "quote", "contract", "cost", "sourcing"),
        risk_level="medium",
    ),
    AssistantCatalogEntry(
        tool_key="businessPartnership",
        agent_id="business_partnership_agent",
        display_name="商务合作助手",
        api_base="/business-partnership",
        labs_href="/business-partnership",
        description="Outreach、合作方案、条款要点、伙伴评估、BD Pipeline",
        intent_keywords=(
            "商务合作", "合作助手", "bd", "business development", "合作方案",
            "outreach", "冷邮件", "伙伴评估", "合作条款", "合作 pipeline",
            "战略合作", "渠道合作", "品牌联名", "partnership",
        ),
        recipe_categories=("outreach", "proposal", "contract", "partner", "pipeline"),
        risk_level="medium",
    ),
    AssistantCatalogEntry(
        tool_key="adCampaign",
        agent_id="ad_campaign_agent",
        display_name="广告投放助手",
        api_base="/ad-campaign",
        labs_href="/ad-campaign",
        description="广告策略、创意文案、受众定向、预算分配、投放复盘",
        intent_keywords=(
            "广告投放", "投放助手", "广告策略", "投放策略", "广告创意",
            "广告文案", "受众定向", "人群定向", "广告预算", "预算分配",
            "投放复盘", "roas", "ad campaign", "ad copy", "audience targeting",
        ),
        recipe_categories=("strategy", "creative", "audience", "budget", "report"),
    ),
    AssistantCatalogEntry(
        tool_key="shortDrama",
        agent_id="short_drama_agent",
        display_name="AI 短剧",
        api_base="/short-drama",
        labs_href="/media/short-drama",
        description="短剧导演：剧本、分镜、场景生成与成片",
        intent_keywords=(
            "短剧", "微电影", "ai短剧", "短剧导演", "微短剧", "短剧剧本", "短剧分镜",
            "short drama", "micro drama", "short film", "short drama script",
            "甜宠短剧", "悬疑短剧", "古风短剧", "搞笑短剧",
        ),
        recipe_categories=("pre", "produce"),
    ),
    AssistantCatalogEntry(
        tool_key="podcast",
        agent_id="podcast_agent",
        display_name="AI 播客",
        api_base="/podcast",
        labs_href="/create/podcast",
        description="播客制作：策划、脚本、封面、配音与发布",
        intent_keywords=(
            "播客", "podcast", "电台", "音频节目", "播客脚本", "播客策划",
            "shownotes", "播客封面", "主播对话", "访谈脚本", "播客制作",
            "podcast script", "podcast cover", "podcast plan",
        ),
        recipe_categories=("plan", "write", "design", "audio", "publish"),
    ),
    AssistantCatalogEntry(
        tool_key="music",
        agent_id="music_agent",
        display_name="AI 音乐",
        api_base="/music",
        labs_href="/media/music",
        description="AI 音乐制作：文本/歌词生成音乐、BGM",
        intent_keywords=(
            "ai音乐", "生成音乐", "音乐制作", "bgm", "背景音乐", "配乐",
            "歌词生成音乐", "文本生成音乐", "suno", "minimax music",
            "music generation", "ai music", "generate music", "soundtrack",
        ),
        recipe_categories=("compose", "video"),
    ),
    AssistantCatalogEntry(
        tool_key="programmer",
        agent_id="programmer_agent",
        display_name="程序员助手",
        api_base="/programmer",
        labs_href="/programmer",
        description="Git/SSH、中间件运维、开发测试与代码工具",
        intent_keywords=(
            "程序员", "程序员助手", "git ssh", "ssh key", "redis", "mysql", "mongodb",
            "etcd", "consul", "nsq", "中间件", "基础设施", "跑测试", "pytest",
            "devops", "programmer", "infra",
        ),
        recipe_categories=("git", "infra", "dev"),
        risk_level="high",
        requires_approval=True,
    ),
    AssistantCatalogEntry(
        tool_key="systemAssistant",
        agent_id="system_assistant",
        display_name="电脑助手",
        api_base="/system-assistant",
        labs_href="/system-assistant",
        description="安装/卸载软件、网络修复、环境配置、文件整理",
        intent_keywords=(
            "安装软件", "卸载软件", "安装应用", "修复网络", "dns", "配置环境",
            "整理文件", "整理电脑", "brew install", "winget", "电脑助手",
            "install app", "uninstall", "fix network", "organize files",
        ),
        recipe_categories=("install", "uninstall", "repair", "network", "env", "organize"),
        risk_level="high",
        requires_approval=True,
    ),
    AssistantCatalogEntry(
        tool_key="desktopOperator",
        agent_id="desktop_operator_agent",
        display_name="桌面操作员",
        api_base="/desktop-operator",
        labs_href="/desktop-operator",
        description="操作本机软件、DCC/Office/GUI 自动化",
        intent_keywords=(
            "blender", "photoshop", "unity", "unreal", "office", "excel", "word",
            "打开应用", "操作软件", "自动化桌面", "桌面操作", "desktop automation",
            "launch app", "gui 自动化",
        ),
        recipe_categories=("recommended", "launch", "gui", "dcc"),
        risk_level="high",
        requires_approval=True,
    ),
)


def list_assistants() -> list[dict]:
    return [entry.to_dict() for entry in ASSISTANT_CATALOG]


def iter_keyword_rules() -> Iterable[tuple[list[str], str, float]]:
    for entry in ASSISTANT_CATALOG:
        confidence = 0.94 if entry.requires_approval else 0.93
        yield list(entry.intent_keywords), entry.agent_id, confidence


def get_by_agent_id(agent_id: str | None) -> AssistantCatalogEntry | None:
    if not agent_id:
        return None
    for entry in ASSISTANT_CATALOG:
        if entry.agent_id == agent_id:
            return entry
    return None

