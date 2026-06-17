"""
内容审核工具

功能：
- 敏感词检测
- 平台规则合规检查
- 内容安全评估
- 自动修复建议
"""

import os
import json
import re
from typing import Optional, List, Dict
from langchain.tools import tool
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from utils.logger import setup_logger

logger = setup_logger("moderation_tools")

# 敏感词分类（基础词库，实际生产环境需要更完整的词库）
SENSITIVE_WORDS = {
    "绝对化用语": [
        "最好", "最佳", "第一", "首选", "顶级", "唯一", "全网最低",
        "国家级", "世界级", "极致", "绝对", "100%", "永久"
    ],
    "虚假宣传": [
        "包治", "根治", "特效", "神奇", "秒杀", "躺赚", "稳赚不赔",
        "无副作用", "纯天然无添加"
    ],
    "违规引导": [
        "私聊", "私信", "加微信", "加V", "加WX", "点击链接",
        "扫码", "领红包"
    ],
    "政治敏感": [
        # 这里应该添加更完整的词库
    ],
    "低俗内容": [
        # 这里应该添加更完整的词库
    ]
}

# 平台审核规则
PLATFORM_RULES = {
    "douyin": {
        "name": "抖音",
        "forbidden": [
            "导流到站外（微信、淘宝等）",
            "虚假宣传和夸大效果",
            "未标注广告的商业推广",
            "诱导关注/点赞/评论",
            "搬运他人原创内容"
        ],
        "caution": [
            "敏感话题需谨慎",
            "医疗、金融等需要资质",
            "明星素材需授权"
        ]
    },
    "xiaohongshu": {
        "name": "小红书",
        "forbidden": [
            "虚假种草和刷单",
            "导流到站外购买",
            "抄袭搬运他人笔记",
            "使用绝对化用语",
            "未报备的软广"
        ],
        "caution": [
            "产品功效需有依据",
            "素人推广需标注利益关系",
            "医美、保健品需谨慎"
        ]
    },
    "bilibili": {
        "name": "B站",
        "forbidden": [
            "恶意引战和人身攻击",
            "未标注的恰饭内容",
            "侵权素材使用",
            "低俗擦边内容"
        ],
        "caution": [
            "争议话题需客观",
            "商单需明确标注",
            "版权素材需授权"
        ]
    },
    "wechat": {
        "name": "微信公众号",
        "forbidden": [
            "诱导分享和关注",
            "虚假信息传播",
            "侵权和抄袭",
            "违规营销"
        ],
        "caution": [
            "原创声明需谨慎",
            "商业推广需合规",
            "敏感话题需审慎"
        ]
    }
}

# AI审核提示词
MODERATION_PROMPT = """你是一位专业的内容审核专家，熟悉各大平台的内容规范。

请审核以下内容：

## 待审核内容
```
{content}
```

## 目标平台
{platform} ({platform_name})

## 平台规则
禁止事项：{forbidden}
注意事项：{caution}

## 检测到的敏感词
{detected_words}

## 审核要求
1. 检查是否有违规内容
2. 检查是否有敏感词
3. 检查是否符合平台调性
4. 给出风险等级和修改建议

以JSON格式输出审核结果：

```json
{{
  "risk_level": "低风险/中风险/高风险/极高风险",
  "pass": true/false,
  "issues": [
    {{
      "type": "问题类型（敏感词/违规/不当用语/其他）",
      "content": "问题内容",
      "location": "问题位置描述",
      "severity": "严重/中等/轻微",
      "suggestion": "修改建议"
    }}
  ],
  "summary": "总体评价",
  "safe_version": "修改后的安全版本（如有问题）"
}}
```

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
        temperature=0.3  # 低温度，更精确
    )


def detect_sensitive_words(content: str) -> Dict[str, List[str]]:
    """检测敏感词"""
    detected = {}
    content_lower = content.lower()
    
    for category, words in SENSITIVE_WORDS.items():
        found = []
        for word in words:
            if word.lower() in content_lower:
                found.append(word)
        if found:
            detected[category] = found
    
    return detected


def parse_json_response(content: str) -> dict:
    """解析 LLM 返回的 JSON"""
    try:
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0]
        elif "```" in content:
            content = content.split("```")[1].split("```")[0]
        
        return json.loads(content.strip())
    except json.JSONDecodeError:
        return {"raw_content": content, "pass": False}


@tool
def check_content(
    content: str,
    platform: str = "douyin"
) -> str:
    """
    审核内容是否符合平台规范。
    
    Args:
        content: 待审核的文本内容
        platform: 目标平台 (douyin/xiaohongshu/bilibili/wechat)
    
    Returns:
        审核结果（JSON格式）
    """
    logger.info(f"Checking content for platform: {platform}")
    
    # 本地敏感词检测
    detected_words = detect_sensitive_words(content)
    detected_str = json.dumps(detected_words, ensure_ascii=False) if detected_words else "无"
    
    # 获取平台规则
    platform_config = PLATFORM_RULES.get(platform, PLATFORM_RULES["douyin"])
    
    prompt = ChatPromptTemplate.from_template(MODERATION_PROMPT)
    
    try:
        llm = get_llm()
        chain = prompt | llm
        
        response = chain.invoke({
            "content": content,
            "platform": platform,
            "platform_name": platform_config["name"],
            "forbidden": "\n".join(f"- {item}" for item in platform_config["forbidden"]),
            "caution": "\n".join(f"- {item}" for item in platform_config["caution"]),
            "detected_words": detected_str
        })
        
        data = parse_json_response(response.content)
        
        # 添加本地检测结果
        data["local_detection"] = detected_words
        
        result = json.dumps(data, ensure_ascii=False, indent=2)
        
        risk_emoji = {
            "低风险": "🟢",
            "中风险": "🟡", 
            "高风险": "🟠",
            "极高风险": "🔴"
        }
        risk = data.get("risk_level", "未知")
        emoji = risk_emoji.get(risk, "⚪")
        
        logger.info(f"Content check completed: {risk}")
        return f"{emoji} 审核完成 - {risk}\n\n{result}"
        
    except Exception as e:
        logger.error(f"Content check failed: {e}")
        return f"❌ 审核失败: {str(e)}"


@tool
def quick_check_sensitive_words(content: str) -> str:
    """
    快速检测敏感词（本地检测，不调用AI）。
    
    Args:
        content: 待检测的文本内容
    
    Returns:
        检测结果
    """
    logger.info(f"Quick checking sensitive words in {len(content)} chars")
    
    detected = detect_sensitive_words(content)
    
    if not detected:
        return "✅ 未检测到敏感词"
    
    result = "⚠️ 检测到以下敏感词：\n\n"
    for category, words in detected.items():
        result += f"**{category}**：{', '.join(words)}\n"
    
    return result


@tool
def get_platform_rules(platform: str = "douyin") -> str:
    """
    获取平台审核规则说明。
    
    Args:
        platform: 平台名称 (douyin/xiaohongshu/bilibili/wechat)
    
    Returns:
        平台规则详情
    """
    config = PLATFORM_RULES.get(platform)
    
    if not config:
        platforms = ", ".join(PLATFORM_RULES.keys())
        return f"❌ 未知平台。支持的平台有：{platforms}"
    
    forbidden = "\n".join(f"  - {item}" for item in config["forbidden"])
    caution = "\n".join(f"  - {item}" for item in config["caution"])
    
    return f"""
📋 **{config['name']}** 审核规则

**🚫 禁止事项**：
{forbidden}

**⚠️ 注意事项**：
{caution}
"""


@tool
def fix_content(
    content: str,
    platform: str = "douyin"
) -> str:
    """
    自动修复内容中的违规问题。
    
    Args:
        content: 需要修复的内容
        platform: 目标平台
    
    Returns:
        修复后的内容
    """
    logger.info(f"Fixing content for platform: {platform}")
    
    platform_config = PLATFORM_RULES.get(platform, PLATFORM_RULES["douyin"])
    
    prompt = ChatPromptTemplate.from_template("""你是一位内容合规专家，擅长修改违规内容使其符合平台规范。

请修复以下内容：

## 原始内容
```
{content}
```

## 目标平台
{platform_name}

## 修复要求
1. 删除或替换敏感词
2. 修改夸大用语
3. 移除导流信息
4. 保持内容原意和吸引力
5. 确保符合平台规范

以JSON格式输出：
```json
{{
  "fixed_content": "修复后的完整内容",
  "changes": [
    {{"original": "原文", "fixed": "修改后", "reason": "原因"}}
  ],
  "change_count": 修改处数量
}}
```

只输出JSON，不要其他内容。
""")
    
    try:
        llm = get_llm()
        chain = prompt | llm
        
        response = chain.invoke({
            "content": content,
            "platform_name": platform_config["name"]
        })
        
        data = parse_json_response(response.content)
        result = json.dumps(data, ensure_ascii=False, indent=2)
        
        change_count = data.get("change_count", 0)
        logger.info(f"Content fixed: {change_count} changes")
        
        return f"✅ 内容修复完成（{change_count}处修改）\n\n{result}"
        
    except Exception as e:
        logger.error(f"Content fix failed: {e}")
        return f"❌ 内容修复失败: {str(e)}"


@tool
def batch_check(
    contents: List[str],
    platform: str = "douyin"
) -> str:
    """
    批量审核多条内容。
    
    Args:
        contents: 内容列表
        platform: 目标平台
    
    Returns:
        批量审核结果
    """
    logger.info(f"Batch checking {len(contents)} items for {platform}")
    
    results = []
    for i, content in enumerate(contents[:10]):  # 限制最多10条
        # 简化检测，只做本地敏感词检测
        detected = detect_sensitive_words(content)
        
        status = "🟢 通过" if not detected else "🟡 需审核"
        results.append({
            "index": i + 1,
            "preview": content[:50] + "..." if len(content) > 50 else content,
            "status": status,
            "issues": detected if detected else None
        })
    
    # 统计
    passed = sum(1 for r in results if r["status"] == "🟢 通过")
    need_review = len(results) - passed
    
    output = f"📊 批量审核结果：通过 {passed}/{len(results)}，需审核 {need_review}\n\n"
    
    for r in results:
        output += f"**[{r['index']}]** {r['status']}\n"
        output += f"内容：{r['preview']}\n"
        if r['issues']:
            output += f"问题：{json.dumps(r['issues'], ensure_ascii=False)}\n"
        output += "\n"
    
    return output


# 导出工具列表
moderation_tools = [
    check_content,
    quick_check_sensitive_words,
    get_platform_rules,
    fix_content,
    batch_check
]
