"""
视频脚本生成工具

功能：
- 根据用户输入生成结构化视频脚本
- 支持多平台适配（抖音、小红书、YouTube等）
- 支持多种风格（口播、剧情、干货、种草）
- 生成多个差异化版本
"""

import os
import json
from typing import Optional, List, Dict
from langchain.tools import tool
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from utils.logger import setup_logger

logger = setup_logger("script_tools")

# 平台配置
PLATFORM_CONFIGS = {
    "douyin": {
        "name": "抖音",
        "ratio": "9:16",
        "max_duration": 600,
        "style_tips": "开头3秒必须有强钩子，节奏快，镜头时长2-3秒",
        "subtitle_style": "居中偏下，大字体，白色描边"
    },
    "xiaohongshu": {
        "name": "小红书",
        "ratio": "3:4",
        "max_duration": 300,
        "style_tips": "场景化种草风格，真实体验感，干净治愈的画面",
        "subtitle_style": "简洁清新"
    },
    "youtube": {
        "name": "YouTube",
        "ratio": "16:9",
        "max_duration": 3600,
        "style_tips": "可接受较长开场，内容深度优先，章节标记清晰",
        "subtitle_style": "CC字幕格式"
    },
    "bilibili": {
        "name": "B站",
        "ratio": "16:9",
        "max_duration": 3600,
        "style_tips": "可加入互动梗，允许较长旁白讲解，三连引导",
        "subtitle_style": "弹幕友好"
    },
    "kuaishou": {
        "name": "快手",
        "ratio": "9:16",
        "max_duration": 600,
        "style_tips": "接地气，真实感强，BGM节奏感",
        "subtitle_style": "居中大字"
    }
}

# 脚本风格
SCRIPT_STYLES = {
    "口播带货": "主播直接对镜头讲解产品，突出卖点和优惠信息，语气热情有感染力",
    "剧情演绎": "通过故事情节展现产品/内容，有角色、场景、冲突和解决",
    "干货讲解": "专业知识分享，逻辑清晰，有价值输出，适合教育类内容",
    "种草测评": "真实体验分享，展示使用过程和效果，适合产品推荐"
}

# 脚本生成提示词模板
SCRIPT_PROMPT = """你是一位专业的视频脚本策划师，擅长创作各类短视频脚本。

请根据以下信息生成一个完整的视频脚本：

## 基础信息
- 内容主题：{topic}
- 行业领域：{industry}
- 目标平台：{platform} ({platform_tips})
- 视频时长：{duration}秒
- 脚本风格：{style} - {style_desc}

## 补充信息
{additional_info}

## 输出要求
请生成一个结构化的视频脚本，包含以下JSON格式：

```json
{{
  "title": "视频标题（吸引眼球）",
  "hook": "开场钩子（前3秒抓住注意力）",
  "duration": {duration},
  "platform": "{platform}",
  "style": "{style}",
  "scenes": [
    {{
      "scene_id": 1,
      "scene_name": "场景名称",
      "duration": 5,
      "shot": {{
        "type": "景别（特写/中景/远景）",
        "movement": "运镜（固定/推/拉/跟）",
        "description": "画面描述"
      }},
      "dialogue": "台词/旁白内容",
      "subtitle": "字幕要点（简短）",
      "bgm": "BGM风格建议",
      "material_hint": "素材匹配提示"
    }}
  ],
  "cta": "结尾行动号召",
  "tags": ["相关标签1", "相关标签2"]
}}
```

确保：
1. 总时长接近 {duration} 秒
2. 开场钩子要足够吸引人
3. 内容结构符合平台特性
4. 场景过渡自然流畅
5. 字幕简洁有力

只输出JSON，不要其他内容。
"""


def get_llm():
    """获取 LLM 实例"""
    api_key = os.getenv("ZHIPUAI_API_KEY")
    if not api_key:
        raise ValueError("ZHIPUAI_API_KEY not set")
    
    return ChatOpenAI(
        api_key=api_key,
        base_url="https://open.bigmodel.cn/api/paas/v4/",
        model="glm-4-plus",
        temperature=0.7
    )


@tool
def generate_script(
    topic: str,
    platform: str = "douyin",
    duration: int = 60,
    style: str = "口播带货",
    industry: str = "通用",
    additional_info: str = ""
) -> str:
    """
    生成视频脚本。
    
    Args:
        topic: 视频主题/核心内容
        platform: 目标平台 (douyin/xiaohongshu/youtube/bilibili/kuaishou)
        duration: 视频时长（秒），默认60秒
        style: 脚本风格 (口播带货/剧情演绎/干货讲解/种草测评)
        industry: 行业领域
        additional_info: 补充信息（产品参数、卖点等）
    
    Returns:
        JSON格式的结构化脚本
    """
    logger.info(f"Generating script: topic={topic}, platform={platform}, duration={duration}s")
    
    # 获取平台配置
    platform_config = PLATFORM_CONFIGS.get(platform, PLATFORM_CONFIGS["douyin"])
    platform_tips = platform_config["style_tips"]
    
    # 获取风格描述
    style_desc = SCRIPT_STYLES.get(style, SCRIPT_STYLES["口播带货"])
    
    # 构建提示词
    prompt = ChatPromptTemplate.from_template(SCRIPT_PROMPT)
    
    try:
        llm = get_llm()
        chain = prompt | llm
        
        response = chain.invoke({
            "topic": topic,
            "industry": industry,
            "platform": platform_config["name"],
            "platform_tips": platform_tips,
            "duration": duration,
            "style": style,
            "style_desc": style_desc,
            "additional_info": additional_info or "无"
        })
        
        # 提取 JSON
        content = response.content
        
        # 尝试解析 JSON
        try:
            # 移除可能的 markdown 代码块标记
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]
            
            script_data = json.loads(content.strip())
            
            # 添加元数据
            script_data["meta"] = {
                "platform": platform,
                "platform_name": platform_config["name"],
                "target_duration": duration,
                "style": style,
                "industry": industry
            }
            
            result = json.dumps(script_data, ensure_ascii=False, indent=2)
            logger.info(f"Script generated successfully: {len(script_data.get('scenes', []))} scenes")
            
            return f"✅ 视频脚本生成成功！\n\n{result}"
            
        except json.JSONDecodeError as e:
            logger.warning(f"JSON parse error: {e}, returning raw content")
            return f"✅ 脚本生成完成（原始格式）：\n\n{content}"
            
    except Exception as e:
        logger.error(f"Script generation failed: {e}")
        return f"❌ 脚本生成失败: {str(e)}"


@tool
def generate_script_variants(
    topic: str,
    platform: str = "douyin",
    duration: int = 60,
    style: str = "口播带货",
    count: int = 3
) -> str:
    """
    生成多个差异化脚本版本。
    
    Args:
        topic: 视频主题
        platform: 目标平台
        duration: 视频时长（秒）
        style: 脚本风格
        count: 生成数量（1-5个）
    
    Returns:
        多个脚本版本
    """
    logger.info(f"Generating {count} script variants for: {topic}")
    
    count = min(max(count, 1), 5)  # 限制1-5个
    
    variants = []
    hooks = [
        "悬念开场：提出引人好奇的问题",
        "冲突开场：展示问题或痛点",
        "利益开场：直接说明观看收益",
        "故事开场：用一个小故事引入",
        "数据开场：用惊人的数据吸引"
    ]
    
    for i in range(count):
        hook_style = hooks[i % len(hooks)]
        additional = f"开场风格要求：{hook_style}"
        
        result = generate_script.invoke({
            "topic": topic,
            "platform": platform,
            "duration": duration,
            "style": style,
            "additional_info": additional
        })
        
        variants.append(f"\n{'='*50}\n## 版本 {i+1} ({hook_style.split('：')[0]})\n{'='*50}\n{result}")
    
    return f"✅ 已生成 {count} 个差异化脚本版本：\n" + "\n".join(variants)


@tool
def get_platform_info(platform: str = "douyin") -> str:
    """
    获取平台的脚本要求和规范。
    
    Args:
        platform: 平台名称 (douyin/xiaohongshu/youtube/bilibili/kuaishou)
    
    Returns:
        平台规范信息
    """
    config = PLATFORM_CONFIGS.get(platform)
    
    if not config:
        platforms = ", ".join(PLATFORM_CONFIGS.keys())
        return f"❌ 未知平台。支持的平台有：{platforms}"
    
    return f"""
📺 **{config['name']}** 平台规范

- **画面比例**：{config['ratio']}
- **最长时长**：{config['max_duration']}秒
- **风格要求**：{config['style_tips']}
- **字幕样式**：{config['subtitle_style']}
"""


# 导出工具列表
script_tools = [generate_script, generate_script_variants, get_platform_info]
