"""
Lobster Bot (龙虾流水线 Agent)

基于 LangGraph StateGraph 的 3 步全自动内容流水线:
  Step 1: collect_trends  — 抓取多平台实时热点
  Step 2: analyze_clone   — 分析热点并用 AI 工具产出同类内容 (文案/脚本/视频)
  Step 3: auto_publish    — 将产出内容自动发布到各平台

使用:
    from agents.lobster_bot import run_lobster_pipeline

    result = run_lobster_pipeline(
        platforms=["bilibili", "douyin"],
        publish_platforms=["bilibili", "xiaohongshu"],
        limit=5,
    )
"""

import json
import operator
from typing import Annotated, List, Optional, TypedDict, Dict, Any, cast

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from langgraph.graph import END, StateGraph

from tools.social_trending import collect_social_trends, fetch_social_trending, get_top_social_topics
from tools.lobster_tools import check_openclaw_status, send_task_to_openclaw
from tools.copywriting_tools import generate_copywriting
from tools.publisher_tools import publish_content_tool
from tools.video_tools import generate_video_internal
from utils.logger import setup_logger

logger = setup_logger("lobster_bot")

AGENT_ID = "lobster_agent"
AGENT_DESCRIPTION = "🦞 龙虾流水线 Agent：自动热点收集 → AI克隆内容 → 多平台发布"
AGENT_CAPABILITIES = ["trend", "clone", "publish", "lobster"]


# ------------------------------------------------------------------
# 流水线共享状态
# ------------------------------------------------------------------

class LobsterState(TypedDict):
    """龙虾流水线的共享状态"""
    messages: Annotated[List[BaseMessage], operator.add]

    # 输入参数
    trend_platforms: List[str]        # 要抓取热点的平台 ["bilibili", "douyin", ...]
    publish_platforms: List[str]       # 要发布的目标平台
    limit: int                         # 每平台热点数量

    # 中间状态
    trending_data: dict                # Step 1 结果：原始热点数据
    top_topics: List[str]              # 提取的热点话题标题
    generated_content: str             # Step 2 结果：AI 生成的内容
    generated_title: str               # AI 生成的标题
    generated_media_path: str          # Step 3 结果：AI 生成的视频路径
    target_node: str                   # 目标 OpenClaw 节点 (local/cloud/auto)
    research_backend: str              # openclaw | hermes | auto

    # 最终输出
    publish_results: List[dict]        # Step 3 结果：各平台发布结果
    final_report: str                  # 整体执行报告


# ------------------------------------------------------------------
# Step 1: 热点收集节点
# ------------------------------------------------------------------

def _collect_trends_node(state: LobsterState) -> dict:
    """Step 1: 抓取多平台热点"""
    platforms = cast(List[str], state.get("trend_platforms", ["bilibili", "douyin"]))
    limit = cast(int, state.get("limit", 8))

    logger.info(f"🦞 [Step 1] 开始热点收集 platforms={platforms}, limit={limit}")

    try:
        data = fetch_social_trending(platforms, limit)
        topics = get_top_social_topics(limit=5)

        summary_parts = [f"✅ 热点收集完成！共 {data['summary'].get('total', 0)} 条热点\n"]
        for platform in platforms:
            items = data["sources"].get(platform, [])
            pname = {"bilibili": "B站", "douyin": "抖音", "xiaohongshu": "小红书"}.get(platform, platform)
            if items:
                summary_parts.append(f"\n**{pname} Top {min(len(items), 3)}:**")
                for item in items[:3]:
                    summary_parts.append(f"  {item['rank']}. {item['title']}")

        summary = "\n".join(summary_parts)
        logger.info(f"🦞 [Step 1] 完成，topic 数量: {len(topics)}")

        return {
            "trending_data": data,
            "top_topics": topics,
            "messages": [AIMessage(
                content=summary,
                additional_kwargs={"sender": "lobster_step1_collect"},
            )],
        }

    except Exception as e:
        logger.error(f"🦞 [Step 1] 失败: {e}")
        error_msg = f"❌ 热点收集失败: {str(e)}"
        return {
            "trending_data": {},
            "top_topics": [],
            "messages": [AIMessage(content=error_msg, additional_kwargs={"sender": "lobster_step1_collect"})],
        }


# ------------------------------------------------------------------
# Step 2: 分析 & 产出同类内容节点
# ------------------------------------------------------------------

def _analyze_clone_node(state: LobsterState) -> dict:
    """Step 2: 分析热点，利用 OpenClaw + AI 工具产出同类内容"""
    topics = cast(List[str], state.get("top_topics", []))
    trending_data = cast(Dict[str, Any], state.get("trending_data", {}))

    if not topics:
        return {
            "generated_content": "暂无热点数据，跳过内容生成",
            "generated_title": "热点内容生成",
            "messages": [AIMessage(
                content="⚠️ 未获取到热点话题，跳过内容克隆步骤。",
                additional_kwargs={"sender": "lobster_step2_clone"},
            )],
        }

    logger.info(f"🦞 [Step 2] 开始分析热点并产出内容，top topics: {topics[:3]}")

    # 构建给 OpenClaw 的分析任务
    topics_str = "\n".join([f"  {i+1}. {t}" for i, t in enumerate(topics)])
    openclaw_task = f"""请分析以下今日社交媒体热点，并为我产出一个同类爆款短视频方案:

当前热点:
{topics_str}

请输出:
1. 最有潜力的热点主题（选 1 个）
2. 对应的短视频创意拍摄方向（3 个角度）
3. 一份适合抖音/B站的爆款视频标题（3 个候选）
4. 视频正文文案（200字以内，用于发布说明）
5. 推荐的标签 Hashtags（5个）

请输出 JSON 格式：
{{
  "selected_topic": "...",
  "video_angles": ["角度1", "角度2", "角度3"],
  "titles": ["标题1", "标题2", "标题3"],
  "content": "...",
  "hashtags": ["#tag1", "#tag2", ...]
}}"""

    try:
        target_node = state.get("target_node", "auto")
        research_backend = str(state.get("research_backend") or "auto").lower()

        external_result = ""
        backend_used = "openclaw"

        if research_backend in {"hermes", "auto"}:
            try:
                from services.hermes_runtime import resolve_research_backend

                if resolve_research_backend("hermes" if research_backend == "hermes" else None) == "hermes":
                    from tools.hermes_tools import send_task_to_hermes

                    external_result = send_task_to_hermes.invoke(
                        {"task": openclaw_task, "instance_id": "local"}
                    )
                    backend_used = "hermes"
            except Exception as hermes_exc:
                logger.warning("Hermes clone step failed, trying OpenClaw: %s", hermes_exc)

        if not external_result:
            external_result = send_task_to_openclaw.invoke({"task": openclaw_task, "node_id": target_node})
            backend_used = "openclaw"

        openclaw_result = external_result

        # 尝试解析 JSON（OpenClaw 可能返回带有额外文本的 JSON）
        plan = {}
        import re
        json_match = re.search(r'\{[\s\S]*\}', openclaw_result)
        if json_match:
            try:
                plan = json.loads(json_match.group())
            except json.JSONDecodeError:
                pass

        if plan:
            title = plan.get("titles", [topics[0]])[0]
            content = plan.get("content", "")
            if not content:
                content = f"今天的热搜话题「{plan.get('selected_topic', topics[0])}」爆了！\n\n" + \
                          " ".join(plan.get("hashtags", []))

            clone_report = (
                f"✅ **[Step 2] 内容克隆完成（由 {backend_used} 生成）**\n\n"
                f"📌 选定热点: **{plan.get('selected_topic', topics[0])}**\n\n"
                f"🎬 视频角度:\n" +
                "\n".join([f"  - {a}" for a in plan.get("video_angles", [])]) +
                f"\n\n📝 推荐标题: **{title}**\n\n"
                f"📄 发布文案:\n{content}\n\n"
                f"🏷️ 标签: {' '.join(plan.get('hashtags', []))}"
            )
        else:
            # OpenClaw 未返回结构化 JSON，使用原始文本
            title = topics[0] if topics else "今日热点推荐"
            content = openclaw_result
            clone_report = f"✅ **[Step 2] 内容克隆完成**\n\n{openclaw_result}"

    except Exception as e:
        logger.warning(f"🦞 [Step 2] OpenClaw 调用失败，降级到内置工具: {e}")
        # 降级到现有的 copywriting tool
        try:
            topic_prompt = f"根据今日热门话题「{topics[0]}」，创作一篇吸引眼球的短视频配套文案，适合抖音/B站发布"
            raw = generate_copywriting.invoke({"topic": topic_prompt, "platform": "douyin", "style": "trending"})
            title = topics[0]
            content = raw
            clone_report = f"✅ **[Step 2] 内容克隆完成（内置工具）**\n\n{raw}"
        except Exception as e2:
            logger.error(f"🦞 [Step 2] 内置工具也失败: {e2}")
            title = topics[0] if topics else "热点内容"
            content = f"今日热点：{', '.join(topics[:3])}"
            clone_report = f"⚠️ [Step 2] 内容生成出错，使用基础模板: {str(e2)}"

    logger.info(f"🦞 [Step 2] 完成，生成标题: {title[:50]}")

    return {
        "generated_title": title,
        "generated_content": content,
        "messages": [AIMessage(
            content=clone_report,
            additional_kwargs={"sender": "lobster_step2_clone"},
        )],
    }


# ------------------------------------------------------------------
# Step 2.5: 视频生成节点
# ------------------------------------------------------------------

def _generate_media_node(state: LobsterState) -> dict:
    """Step 2.5: 使用生成的标题或文案生成配图/视频"""
    title = cast(str, state.get("generated_title", ""))
    content = cast(str, state.get("generated_content", ""))
    
    if not title and not content:
        skip_msg = "⚠️ [Step 2.5] 跳过视频生成：没有可用的标题或文案内容。"
        return {
            "generated_media_path": "",
            "messages": [AIMessage(content=skip_msg, additional_kwargs={"sender": "lobster_step2.5_media"})],
        }

    logger.info(f"🦞 [Step 2.5] 开始根据内容自动生成视频, title={title}")
    
    # 构建适合视频生成的 Prompt (尽量简短并突出画面感)
    video_prompt = f"生成一段符合以下主题的清晰短视频: {title}。"
    if len(content) > 10:
        video_prompt += f" 画外音或字幕可参考: {content[:100]}..."

    try:
        result = generate_video_internal(video_prompt)
        if result.get("success") and result.get("local_path"):
            media_path = result["local_path"]
            provider = result.get("provider", "unknown")
            import os
            basename = os.path.basename(media_path)
            report = f"🎬 **[Step 2.5] 视频生成成功**\n\n已通过 `{provider}` 生成视频文件，准备发布。\n视频已保存至: storage/outputs/{basename}"
            logger.info(f"🦞 [Step 2.5] 视频生成成功: {media_path}")
            return {
                "generated_media_path": media_path,
                "messages": [AIMessage(content=report, additional_kwargs={"sender": "lobster_step2.5_media"})],
            }
        else:
            error_msg = result.get("error", "未知错误")
            logger.error(f"🦞 [Step 2.5] 视频生成失败: {error_msg}")
            return {
                "generated_media_path": "",
                "messages": [AIMessage(content=f"❌ **[Step 2.5] 视频生成失败**: {error_msg}", additional_kwargs={"sender": "lobster_step2.5_media"})],
            }
    except Exception as e:
        logger.error(f"🦞 [Step 2.5] 视频生成异常: {e}")
        return {
            "generated_media_path": "",
            "messages": [AIMessage(content=f"❌ **[Step 2.5] 视频生成异常**: {str(e)}", additional_kwargs={"sender": "lobster_step2.5_media"})],
        }

# ------------------------------------------------------------------
# Step 3: 自动发布节点
# ------------------------------------------------------------------

def _auto_publish_node(state: LobsterState) -> dict:
    """Step 3: 将生成内容发布到各目标平台"""
    title = cast(str, state.get("generated_title", "今日热点"))
    content = cast(str, state.get("generated_content", ""))
    target_platforms = cast(List[str], state.get("publish_platforms", []))

    if not content or not target_platforms:
        skip_msg = "⚠️ [Step 3] 跳过发布：没有内容或没有选择目标平台。"
        return {
            "publish_results": [],
            "final_report": skip_msg,
            "messages": [AIMessage(content=skip_msg, additional_kwargs={"sender": "lobster_step3_publish"})],
        }

    logger.info(f"🦞 [Step 3] 开始发布到 {target_platforms}")

    results = []
    report_lines = ["🚀 **[Step 3] 自动发布结果:**\n"]
    media_path = state.get("generated_media_path", "")
    media_urls = [media_path] if media_path else None

    for platform in target_platforms:
        try:
            import asyncio
            from tools.connectors.manager import get_connector_manager
            manager = get_connector_manager()
            
            try:
                loop = asyncio.get_event_loop()
            except RuntimeError:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                
            publish_result = loop.run_until_complete(
                manager.publish_to_platform(
                    platform_id=platform,
                    content_type="mixed" if media_urls else "text",
                    title=title,
                    content=content,
                    media_urls=media_urls
                )
            )
            
            success = publish_result.success
            status_emoji = "✅" if success else "❌"
            pname = {"bilibili": "B站", "douyin": "抖音", "xiaohongshu": "小红书"}.get(platform, platform)
            
            if success:
                msg = f"发布成功 (URL: {publish_result.url})" if publish_result.url else "发布成功"
            else:
                msg = f"发布失败 ({publish_result.error})"
                
            report_lines.append(f"  {status_emoji} {pname}: {msg}")
            
            results.append({
                "platform": platform, 
                "success": success, 
                "url": publish_result.url,
                "error": publish_result.error
            })
        except Exception as e:
            logger.error(f"🦞 [Step 3] 发布到 {platform} 失败: {e}")
            report_lines.append(f"  ❌ {platform}: {str(e)}")
            results.append({"platform": platform, "success": False, "error": str(e)})

    final_report = "\n".join(report_lines)
    logger.info(f"🦞 [Step 3] 发布完成，结果数量: {len(results)}")

    return {
        "publish_results": results,
        "final_report": final_report,
        "messages": [AIMessage(
            content=final_report,
            additional_kwargs={"sender": "lobster_step3_publish"},
        )],
    }


# ------------------------------------------------------------------
# 构建 LangGraph
# ------------------------------------------------------------------

def build_lobster_graph():
    """构建并编译龙虾流水线的 LangGraph"""
    workflow = StateGraph(LobsterState)

    workflow.add_node("collect_trends", _collect_trends_node)
    workflow.add_node("analyze_clone", _analyze_clone_node)
    workflow.add_node("generate_media", _generate_media_node)
    workflow.add_node("auto_publish", _auto_publish_node)

    workflow.set_entry_point("collect_trends")
    workflow.add_edge("collect_trends", "analyze_clone")
    workflow.add_edge("analyze_clone", "generate_media")
    workflow.add_edge("generate_media", "auto_publish")
    workflow.add_edge("auto_publish", END)

    logger.info("🦞 Lobster Pipeline LangGraph 已构建")
    return workflow.compile()


# ------------------------------------------------------------------
# 对外接口
# ------------------------------------------------------------------

def run_lobster_pipeline(
    trend_platforms: List[str] = None,
    publish_platforms: List[str] = None,
    limit: int = 8,
) -> dict:
    """
    一站式触发龙虾流水线。

    Args:
        trend_platforms: 热点抓取来源平台 (默认 bilibili + douyin)
        publish_platforms: 发布目标平台 (默认 bilibili + douyin)
        limit: 每平台热点数量

    Returns:
        dict with keys: final_report, publish_results, generated_title, generated_content
    """
    if not trend_platforms or not publish_platforms:
        try:
            from tools.connectors.manager import get_connector_manager
            manager = get_connector_manager()
            connected_platforms = [p["id"] for p in manager.get_all_platforms() if p.get("connected")]
            
            if not trend_platforms:
                trend_platforms = connected_platforms if connected_platforms else ["bilibili", "douyin", "xiaohongshu"]
            if not publish_platforms:
                publish_platforms = connected_platforms
                
            logger.info(f" Lobster pipeline auto-selected trend={trend_platforms}, publish={publish_platforms}")
        except Exception as e:
            logger.error(f"Failed to get connected platforms for lobster defaults: {e}")
            if not trend_platforms:
                trend_platforms = ["bilibili", "douyin"]
            if not publish_platforms:
                publish_platforms = []

    graph = build_lobster_graph()

    initial_state: LobsterState = {
        "messages": [HumanMessage(content=f"启动龙虾流水线，热点平台: {trend_platforms}，发布平台: {publish_platforms}")],
        "trend_platforms": trend_platforms,
        "publish_platforms": publish_platforms,
        "limit": limit,
        "trending_data": {},
        "top_topics": [],
        "generated_content": "",
        "generated_title": "",
        "generated_media_path": "",
        "target_node": "auto",
        "research_backend": "auto",
        "publish_results": [],
        "final_report": "",
    }

    result = graph.invoke(initial_state, {"recursion_limit": 10})

    return {
        "final_report": result.get("final_report", ""),
        "publish_results": result.get("publish_results", []),
        "generated_title": result.get("generated_title", ""),
        "generated_content": result.get("generated_content", ""),
        "generated_media_path": result.get("generated_media_path", ""),
        "top_topics": result.get("top_topics", []),
        "messages": [
            {"sender": m.additional_kwargs.get("sender", ""), "content": m.content}
            for m in result.get("messages", [])
            if isinstance(m, AIMessage)
        ],
    }


# ------------------------------------------------------------------
# 供 AgentRegistry 使用的 BaseAgent 包装 (兼容 orchestrator)
# ------------------------------------------------------------------

def get_lobster_base_agent(api_key: str = ""):
    """返回 BaseAgent 包装，供 AgentRegistry 注册使用"""
    from agents.base.bot import BaseAgent

    lobster_system_prompt = """你是「龙虾流水线 Agent」，你的专长是:
1. 实时抓取抖音/B站/小红书的热门内容和热搜话题
2. 分析热点内容模式，并在本地 (local) 或云端 (cloud) 的 OpenClaw 实例间分配协作任务，产出同类爆款内容（文案+脚本）
3. 将产出内容自动分发到多个社交媒体平台

当用户提到"热点"、"爆款"、"龙虾"、"自动发布"等关键词，你应该立即调用对应工具完成三步流水线。你可以根据任务负载选择不同的 OpenClaw 节点。
"""

    agent = BaseAgent(
        name="LobsterAgent",
        system_prompt=lobster_system_prompt,
        agent_id=AGENT_ID,
        description=AGENT_DESCRIPTION,
        capabilities=AGENT_CAPABILITIES,
        with_memory=False,
        with_rag=False,
    )
    agent.tools.extend([
        collect_social_trends,
        check_openclaw_status,
        send_task_to_openclaw,
        publish_content_tool,
    ])
    return agent
