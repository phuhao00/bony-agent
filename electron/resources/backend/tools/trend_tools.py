"""
趋势分析与话题探索工具

功能：
- 分析特定领域的流行趋势
- 生成热门话题标签（Hashtags）
- 竞争对手/对标账号分析（模拟）
"""

import os
import json
from langchain.tools import tool
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from utils.logger import setup_logger

logger = setup_logger("trend_tools")

# 趋势分析提示词
TREND_ANALYSIS_PROMPT = """你是一位敏锐的市场分析师和潮流观察家。

请分析以下领域的当前流行趋势：

领域/行业：{category}
目标平台：{platform}

请列出 3-5 个当前的流行趋势或热门话题，并说明其背后的原因和应用建议。

以JSON格式输出：
```json
{
  "trends": [
    {
      "name": "趋势名称",
      "description": "趋势描述",
      "reason": "流行原因",
      "suggestion": "内容创作建议"
    }
  ],
  "summary": "整体趋势总结"
}
```
"""

# Hashtag 生成提示词
HASHTAG_PROMPT = """你是一位通过算法优化流量的社交媒体运营专家。

请为以下内容生成最佳的话题标签（Hashtags）：

主题/内容：{topic}
平台：{platform}

请提供 3 组不同策略的标签：
1. 流量大词（高曝光）
2. 精准长尾词（高转化）
3. 圈层/场景词（精准人群）

以JSON格式输出：
```json
{
  "high_traffic": ["#标签1", "#标签2"],
  "long_tail": ["#标签3", "#标签4"],
  "niche": ["#标签5", "#标签6"],
  "best_mix": "推荐的混合标签组合（直接可复制）"
}
```
"""

def get_llm(temperature: float = 0.5):
    """获取 LLM 实例（通过统一供应商配置）"""
    from core.llm_provider import get_chat_llm
    return get_chat_llm(temperature=temperature)

def parse_json_response(content: str) -> dict:
    """解析 LLM 返回的 JSON"""
    try:
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0]
        elif "```" in content:
            content = content.split("```")[1].split("```")[0]
        return json.loads(content.strip())
    except json.JSONDecodeError:
        return {"raw_content": content}

@tool
def analyze_trends(category: str, platform: str = "douyin") -> str:
    """
    分析指定领域的流行趋势。
    
    Args:
        category: 领域或行业 (e.g. 美妆, 科技, 职场)
        platform: 目标平台 (douyin/xiaohongshu/etc)
        
    Returns:
        JSON格式的趋势分析报告
    """
    logger.info(f"Analyzing trends for {category} on {platform}")
    
    prompt = ChatPromptTemplate.from_template(TREND_ANALYSIS_PROMPT)
    
    try:
        llm = get_llm(temperature=0.8)
        chain = prompt | llm
        
        response = chain.invoke({
            "category": category,
            "platform": platform
        })
        
        data = parse_json_response(response.content)
        result = json.dumps(data, ensure_ascii=False, indent=2)
        return f"✅ 趋势分析完成！\n\n{result}"
        
    except Exception as e:
        logger.error(f"Trend analysis failed: {e}")
        return f"❌ 趋势分析失败: {str(e)}"

@tool
def generate_hashtags(topic: str, platform: str = "xiaohongshu") -> str:
    """
    生成优化的话题标签 (Hashtags)。
    
    Args:
        topic: 内容主题或关键词
        platform: 目标平台
        
    Returns:
        JSON格式的标签建议
    """
    logger.info(f"Generating hashtags for {topic} on {platform}")
    
    prompt = ChatPromptTemplate.from_template(HASHTAG_PROMPT)
    
    try:
        llm = get_llm(temperature=0.7)
        chain = prompt | llm
        
        response = chain.invoke({
            "topic": topic,
            "platform": platform
        })
        
        data = parse_json_response(response.content)
        result = json.dumps(data, ensure_ascii=False, indent=2)
        return f"✅ 标签生成完成！\n\n{result}"
        
    except Exception as e:
        logger.error(f"Hashtag generation failed: {e}")
        return f"❌ 标签生成失败: {str(e)}"

# 导出工具列表
trend_tools = [analyze_trends, generate_hashtags]
