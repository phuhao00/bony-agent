"""
软文/文案生成工具

功能：
- 根据产品/主题生成营销软文
- 支持多平台适配（小红书、微信公众号、知乎等）
- 生成多个标题变体
- 内容去重/改写
"""

import os
import json
from typing import Optional, List
from langchain.tools import tool
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from utils.logger import setup_logger

logger = setup_logger("copywriting_tools")

# 平台文案风格
PLATFORM_STYLES = {
    "xiaohongshu": {
        "name": "小红书",
        "style": "种草风、生活化、emoji丰富、标题党、真实体验感",
        "structure": "封面标题 + 开场引入 + 产品亮点 + 使用体验 + 总结推荐",
        "length": "300-500字",
        "tips": "多用 emoji、分点列举、避免硬广感、加话题标签"
    },
    "wechat": {
        "name": "微信公众号",
        "style": "深度内容、故事化、观点鲜明、有价值感",
        "structure": "吸睛标题 + 引言 + 主体（3-5个段落）+ 总结 + CTA",
        "length": "1000-2000字",
        "tips": "金句开头、分节清晰、适当配图提示、引导互动"
    },
    "zhihu": {
        "name": "知乎",
        "style": "专业性、干货向、逻辑清晰、有理有据",
        "structure": "直接回答 + 详细解释 + 案例佐证 + 总结升华",
        "length": "800-1500字",
        "tips": "先给结论、数据支撑、专业术语、避免广告感"
    },
    "weibo": {
        "name": "微博",
        "style": "简短有力、话题性强、互动感",
        "structure": "核心观点 + 简要说明 + 话题标签",
        "length": "100-300字",
        "tips": "话题标签、@相关账号、引导转评、配图描述"
    },
    "douyin": {
        "name": "抖音文案",
        "style": "口语化、节奏感、情绪化、有钩子",
        "structure": "钩子 + 核心内容 + 行动号召",
        "length": "50-150字",
        "tips": "适合口播的节奏、设置悬念、引导评论"
    }
}

# 软文类型
CONTENT_TYPES = {
    "种草推荐": "以真实体验视角推荐产品，突出使用感受和效果",
    "测评对比": "客观对比分析，给出专业评价和购买建议",
    "教程攻略": "详细步骤教学，提供实用价值",
    "故事营销": "通过故事情节软性植入产品/品牌",
    "热点借势": "结合热点话题进行内容创作"
}

# 软文生成提示词
COPYWRITING_PROMPT = """你是一位资深的新媒体文案策划，擅长各平台的内容创作。

请根据以下信息创作一篇软文：

## 基础信息
- 主题/产品：{topic}
- 目标平台：{platform} ({platform_name})
- 内容类型：{content_type} - {type_desc}
- 目标人群：{target_audience}

## 平台要求
- 风格：{style}
- 结构：{structure}
- 篇幅：{length}
- 技巧：{tips}

## 补充信息
{additional_info}

## 输出要求
请生成完整的软文内容，以JSON格式输出：

```json
{{
  "title": "主标题（吸引点击）",
  "subtitle": "副标题（可选）",
  "content": "正文内容（使用\\n换行，使用 emoji 增强表现力）",
  "tags": ["话题标签1", "话题标签2"],
  "cover_suggestion": "封面图建议描述（具体构图/光影/配色，禁 AI 紫蓝渐变与三卡片模板）",
  "platform": "{platform}",
  "word_count": 预估字数
}}
```

注意：
1. 符合平台调性和用户习惯
2. 内容自然，避免硬广感
3. 有明确的价值输出
4. 引导互动（点赞、评论、收藏）

只输出JSON，不要其他内容。
"""


def get_copywriting_prompt_template() -> str:
    """COPYWRITING_PROMPT with optional taste anti-slop block."""
    base = COPYWRITING_PROMPT
    try:
        from services.taste_art_direction import copy_anti_slop_block, is_taste_art_direction_enabled

        if is_taste_art_direction_enabled():
            return base + "\n\n" + copy_anti_slop_block()
    except Exception as exc:
        logger.warning("[copywriting] taste block skipped: %s", exc)
    return base


# 标题生成提示词
TITLE_PROMPT = """你是一位标题党大师，擅长写出高点击率的标题。

请为以下内容生成多个吸引人的标题变体：

主题：{topic}
平台：{platform}
内容简介：{summary}

生成 {count} 个不同风格的标题，以JSON数组格式输出：

```json
{{
  "titles": [
    {{"title": "标题1", "style": "悬念型", "hook": "引发好奇心"}},
    {{"title": "标题2", "style": "数字型", "hook": "具体量化"}},
    {{"title": "标题3", "style": "痛点型", "hook": "击中需求"}}
  ]
}}
```

标题风格可以包括：悬念型、数字型、痛点型、利益型、热点型、对比型、故事型等。

只输出JSON，不要其他内容。
"""


def get_llm(temperature: float = 0.8):
    """获取 LLM 实例（通过统一供应商配置）"""
    from core.llm_provider import get_chat_llm
    return get_chat_llm(temperature=temperature)


def parse_json_response(content: str) -> dict:
    """解析 LLM 返回的 JSON"""
    try:
        # 移除可能的 markdown 代码块标记
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0]
        elif "```" in content:
            content = content.split("```")[1].split("```")[0]
        
        return json.loads(content.strip())
    except json.JSONDecodeError:
        return {"raw_content": content}


@tool
def generate_copywriting(
    topic: str,
    platform: str = "xiaohongshu",
    content_type: str = "种草推荐",
    target_audience: str = "年轻女性",
    additional_info: str = ""
) -> str:
    """
    生成营销软文/文案。
    
    Args:
        topic: 主题或产品名称
        platform: 目标平台 (xiaohongshu/wechat/zhihu/weibo/douyin)
        content_type: 内容类型 (种草推荐/测评对比/教程攻略/故事营销/热点借势)
        target_audience: 目标受众描述
        additional_info: 补充信息（产品特点、卖点等）
    
    Returns:
        生成的软文内容（JSON格式）
    """
    logger.info(f"Generating copywriting: topic={topic}, platform={platform}")
    
    # 获取平台配置
    platform_config = PLATFORM_STYLES.get(platform, PLATFORM_STYLES["xiaohongshu"])
    type_desc = CONTENT_TYPES.get(content_type, CONTENT_TYPES["种草推荐"])
    
    prompt = ChatPromptTemplate.from_template(get_copywriting_prompt_template())
    
    try:
        llm = get_llm()
        chain = prompt | llm
        
        response = chain.invoke({
            "topic": topic,
            "platform": platform,
            "platform_name": platform_config["name"],
            "content_type": content_type,
            "type_desc": type_desc,
            "target_audience": target_audience,
            "style": platform_config["style"],
            "structure": platform_config["structure"],
            "length": platform_config["length"],
            "tips": platform_config["tips"],
            "additional_info": additional_info or "无"
        })
        
        data = parse_json_response(response.content)
        result = json.dumps(data, ensure_ascii=False, indent=2)
        
        logger.info(f"Copywriting generated: {data.get('word_count', 'N/A')} words")
        return f"✅ 软文生成成功！\n\n{result}"
        
    except Exception as e:
        logger.error(f"Copywriting generation failed: {e}")
        return f"❌ 软文生成失败: {str(e)}"


@tool
def generate_titles(
    topic: str,
    platform: str = "xiaohongshu",
    summary: str = "",
    count: int = 5
) -> str:
    """
    生成多个标题变体。
    
    Args:
        topic: 内容主题
        platform: 目标平台
        summary: 内容简介
        count: 生成数量（1-10个）
    
    Returns:
        多个标题选项
    """
    logger.info(f"Generating {count} titles for: {topic}")
    
    count = min(max(count, 1), 10)
    
    prompt = ChatPromptTemplate.from_template(TITLE_PROMPT)
    
    try:
        llm = get_llm(temperature=0.9)  # 更高的创意度
        chain = prompt | llm
        
        response = chain.invoke({
            "topic": topic,
            "platform": PLATFORM_STYLES.get(platform, {}).get("name", platform),
            "summary": summary or topic,
            "count": count
        })
        
        data = parse_json_response(response.content)
        result = json.dumps(data, ensure_ascii=False, indent=2)
        
        logger.info(f"Generated {len(data.get('titles', []))} titles")
        return f"✅ 标题生成成功！\n\n{result}"
        
    except Exception as e:
        logger.error(f"Title generation failed: {e}")
        return f"❌ 标题生成失败: {str(e)}"


@tool
def rewrite_content(
    content: str,
    style: str = "保持原意",
    platform: str = "xiaohongshu"
) -> str:
    """
    改写/去重内容。
    
    Args:
        content: 原始内容
        style: 改写风格 (保持原意/更口语化/更专业/更简洁/更详细)
        platform: 目标平台（用于风格适配）
    
    Returns:
        改写后的内容
    """
    logger.info(f"Rewriting content: {len(content)} chars, style={style}")
    
    platform_config = PLATFORM_STYLES.get(platform, PLATFORM_STYLES["xiaohongshu"])
    
    prompt = ChatPromptTemplate.from_template("""你是一位文案改写专家，擅长内容去重和风格转换。

请改写以下内容：

## 原文
{content}

## 改写要求
- 改写风格：{style}
- 目标平台：{platform_name}
- 平台调性：{platform_style}

## 输出要求
1. 保持核心信息不变
2. 改变表达方式和句式结构
3. 符合目标平台风格
4. 通过原创度检测

以JSON格式输出：
```json
{{
  "rewritten_content": "改写后的内容",
  "changes_summary": "主要改动说明",
  "similarity_estimate": "与原文相似度估计（如30%）"
}}
```

只输出JSON，不要其他内容。
""")
    
    try:
        llm = get_llm(temperature=0.7)
        chain = prompt | llm
        
        response = chain.invoke({
            "content": content,
            "style": style,
            "platform_name": platform_config["name"],
            "platform_style": platform_config["style"]
        })
        
        data = parse_json_response(response.content)
        result = json.dumps(data, ensure_ascii=False, indent=2)
        
        logger.info(f"Content rewritten successfully")
        return f"✅ 内容改写成功！\n\n{result}"
        
    except Exception as e:
        logger.error(f"Content rewriting failed: {e}")
        return f"❌ 内容改写失败: {str(e)}"


@tool
def optimize_copywriting(
    content: str,
    goal: str = "提升转化率",
    platform: str = "xiaohongshu",
) -> str:
    """
    优化现有文案。

    Args:
        content: 原始文案内容
        goal: 优化目标（如提升转化率/更口语化/更专业）
        platform: 目标平台

    Returns:
        优化后的文案结果
    """
    return rewrite_content.invoke(
        {
            "content": content,
            "style": goal,
            "platform": platform,
        }
    )


@tool
def analyze_copywriting(
    content: str,
    platform: str = "xiaohongshu",
    target_audience: str = "泛内容用户",
) -> str:
    """
    分析文案效果与问题。

    Args:
        content: 待分析文案
        platform: 发布平台
        target_audience: 目标受众

    Returns:
        文案分析报告
    """
    logger.info(f"Analyzing copywriting: {len(content)} chars, platform={platform}")

    platform_config = PLATFORM_STYLES.get(platform, PLATFORM_STYLES["xiaohongshu"])
    prompt = ChatPromptTemplate.from_template("""你是一位资深文案策略分析师。

请分析以下文案在目标平台的表现潜力：

## 文案内容
{content}

## 目标平台
- 平台：{platform_name}
- 平台风格：{platform_style}
- 目标受众：{target_audience}

## 输出要求
请以 JSON 格式输出：
```json
{{
  "overall_score": 0,
  "strengths": ["优点1", "优点2"],
  "weaknesses": ["问题1", "问题2"],
  "suggestions": ["建议1", "建议2"],
  "recommended_hook": "推荐开头句",
  "recommended_cta": "推荐行动号召"
}}
```

只输出 JSON，不要其他内容。
""")

    try:
        llm = get_llm(temperature=0.4)
        chain = prompt | llm
        response = chain.invoke(
            {
                "content": content,
                "platform_name": platform_config["name"],
                "platform_style": platform_config["style"],
                "target_audience": target_audience,
            }
        )
        data = parse_json_response(response.content)
        result = json.dumps(data, ensure_ascii=False, indent=2)
        return f"✅ 文案分析完成！\n\n{result}"
    except Exception as e:
        logger.error(f"Copywriting analysis failed: {e}")
        return f"❌ 文案分析失败: {str(e)}"


@tool
def get_platform_copywriting_guide(platform: str = "xiaohongshu") -> str:
    """
    获取平台文案写作指南。
    
    Args:
        platform: 平台名称 (xiaohongshu/wechat/zhihu/weibo/douyin)
    
    Returns:
        平台写作指南
    """
    config = PLATFORM_STYLES.get(platform)
    
    if not config:
        platforms = ", ".join(PLATFORM_STYLES.keys())
        return f"❌ 未知平台。支持的平台有：{platforms}"
    
    return f"""
📝 **{config['name']}** 文案写作指南

**风格特点**：{config['style']}

**内容结构**：{config['structure']}

**建议篇幅**：{config['length']}

**写作技巧**：{config['tips']}
"""


# 导出工具列表
copywriting_tools = [
    generate_copywriting,
    optimize_copywriting,
    analyze_copywriting,
    generate_titles,
    rewrite_content,
    get_platform_copywriting_guide
]
