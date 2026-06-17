export type AssistantRiskLevel = "low" | "medium" | "high";

export type AssistantCatalogEntry = {
  toolKey: string;
  agentId: string;
  displayName: string;
  apiBase: string;
  labsHref: string;
  description: string;
  intentKeywords: string[];
  recipeCategories: string[];
  riskLevel: AssistantRiskLevel;
  requiresApproval: boolean;
};

export const ASSISTANT_CATALOG: AssistantCatalogEntry[] = [
  {
    toolKey: "productManager",
    agentId: "product_manager_agent",
    displayName: "产品经理助手",
    apiBase: "/api/product-manager",
    labsHref: "/product-manager",
    description: "市场、竞品、PRD、JTBD、路线图",
    intentKeywords: [
      "产品经理",
      "市场分析",
      "游戏市场",
      "MOD 市场",
      "MOD 生态",
      "竞品分析",
      "PRD",
      "JTBD",
      "roadmap",
    ],
    recipeCategories: ["market", "idea", "product", "competitor", "methodology"],
    riskLevel: "low",
    requiresApproval: false,
  },
  {
    toolKey: "legalAdvisor",
    agentId: "legal_agent",
    displayName: "法律顾问助手",
    apiBase: "/api/legal-advisor",
    labsHref: "/legal-advisor",
    description: "案例、合规、法规、合同风险",
    intentKeywords: ["法律", "合规", "法规", "合同审查", "劳动合同"],
    recipeCategories: ["case", "compliance", "regulation", "contract", "finance"],
    riskLevel: "medium",
    requiresApproval: false,
  },
  {
    toolKey: "gameArt",
    agentId: "game_art_agent",
    displayName: "游戏美术助手",
    apiBase: "/api/game-art",
    labsHref: "/game-art",
    description: "视觉风格、角色、场景、UI、Moodboard",
    intentKeywords: ["游戏美术", "视觉风格", "角色设计", "概念图", "Moodboard"],
    recipeCategories: ["style", "character", "scene", "ui", "research"],
    riskLevel: "low",
    requiresApproval: false,
  },
  {
    toolKey: "imageEdit",
    agentId: "image_edit_agent",
    displayName: "图片编辑 Agent",
    apiBase: "/api/tools/image/edit",
    labsHref: "/media/image-edit",
    description: "自然语言修图、局部重绘、去水印、扩图、参考图",
    intentKeywords: [
      "图片编辑", "修图", "改图", "去水印", "局部重绘", "扩图", "参考图", "超分",
      "Logo 动画", "Logo动效", "标志动画", "标志动效", "让 Logo 动起来", "图标动画",
      "logo motion", "logo animation",
    ],
    recipeCategories: ["instruction", "inpaint", "remove", "reference", "outpaint", "upscale", "logo_motion"],
    riskLevel: "low",
    requiresApproval: false,
  },
  {
    toolKey: "opencut",
    agentId: "opencut_agent",
    displayName: "OpenCut 专业剪辑",
    apiBase: "/api/tools/video/opencut",
    labsHref: "/media/opencut",
    description: "借鉴 OpenCut 的专业视频剪辑：裁剪、变速、转场、画中画、字幕、滤镜",
    intentKeywords: [
      "opencut", "专业剪辑", "多轨道", "关键帧", "画中画", "精准裁剪", "高级转场",
      "视频变速", "视频滤镜", "音轨替换", "提取音频", "文字叠加", "拆分视频",
    ],
    recipeCategories: ["cut", "split", "merge", "speed", "overlay", "text", "filter", "audio", "project"],
    riskLevel: "low",
    requiresApproval: false,
  },
  {
    toolKey: "gameDesign",
    agentId: "game_design_agent",
    displayName: "游戏策划助手",
    apiBase: "/api/game-design",
    labsHref: "/game-design",
    description: "概念案、核心循环、系统、关卡、数值",
    intentKeywords: ["游戏策划", "核心玩法", "系统设计", "关卡设计", "数值"],
    recipeCategories: ["concept", "system", "level", "narrative", "balance"],
    riskLevel: "low",
    requiresApproval: false,
  },
  {
    toolKey: "procurementAssistant",
    agentId: "procurement_agent",
    displayName: "采购助手",
    apiBase: "/api/procurement-assistant",
    labsHref: "/procurement-assistant",
    description: "供应商、RFQ、报价、合同、降本",
    intentKeywords: ["采购", "供应商", "RFQ", "报价比对", "寻源"],
    recipeCategories: ["vendor", "rfq", "quote", "contract", "cost", "sourcing"],
    riskLevel: "medium",
    requiresApproval: false,
  },
  {
    toolKey: "businessPartnership",
    agentId: "business_partnership_agent",
    displayName: "商务合作助手",
    apiBase: "/api/business-partnership",
    labsHref: "/business-partnership",
    description: "Outreach、合作方案、条款、伙伴评估",
    intentKeywords: ["商务合作", "BD", "合作方案", "outreach", "伙伴评估"],
    recipeCategories: ["outreach", "proposal", "contract", "partner", "pipeline"],
    riskLevel: "medium",
    requiresApproval: false,
  },
  {
    toolKey: "adCampaign",
    agentId: "ad_campaign_agent",
    displayName: "广告投放助手",
    apiBase: "/api/ad-campaign",
    labsHref: "/ad-campaign",
    description: "投放策略、创意、受众、预算、复盘",
    intentKeywords: ["广告投放", "投放策略", "广告创意", "受众定向", "ROAS"],
    recipeCategories: ["strategy", "creative", "audience", "budget", "report"],
    riskLevel: "low",
    requiresApproval: false,
  },
  {
    toolKey: "programmer",
    agentId: "programmer_agent",
    displayName: "程序员助手",
    apiBase: "/api/programmer",
    labsHref: "/programmer",
    description: "Git/SSH、中间件、测试、开发工具",
    intentKeywords: ["程序员", "Git", "Redis", "MySQL", "跑测试", "DevOps"],
    recipeCategories: ["git", "infra", "dev"],
    riskLevel: "high",
    requiresApproval: true,
  },
  {
    toolKey: "systemAssistant",
    agentId: "system_assistant",
    displayName: "电脑助手",
    apiBase: "/api/system-assistant",
    labsHref: "/system-assistant",
    description: "安装卸载、网络修复、环境配置、文件整理",
    intentKeywords: ["安装软件", "卸载软件", "修复网络", "整理文件"],
    recipeCategories: ["install", "uninstall", "repair", "network", "env", "organize"],
    riskLevel: "high",
    requiresApproval: true,
  },
  {
    toolKey: "desktopOperator",
    agentId: "desktop_operator_agent",
    displayName: "桌面操作员",
    apiBase: "/api/desktop-operator",
    labsHref: "/desktop-operator",
    description: "本机软件、DCC、Office、GUI 自动化",
    intentKeywords: ["Blender", "Photoshop", "Office", "桌面操作", "GUI 自动化"],
    recipeCategories: ["recommended", "launch", "gui", "dcc"],
    riskLevel: "high",
    requiresApproval: true,
  },
];

export const AUTO_ASSISTANT_ID = "auto";

export function getAssistantByAgentId(agentId?: string | null) {
  return ASSISTANT_CATALOG.find((entry) => entry.agentId === agentId) ?? null;
}

