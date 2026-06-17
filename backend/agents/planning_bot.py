import operator
import re
from typing import Annotated, List, Tuple, Union, Optional
from typing_extensions import TypedDict

from pydantic import BaseModel, Field
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage

from langgraph.graph import StateGraph, END
from langgraph.prebuilt import create_react_agent

from tools.media_tools import generate_image, generate_video, edit_image
from tools.memory_tools import search_memory
from tools.rag_tools import search_knowledge_base
from tools.publisher_tools import publish_content_tool, get_publish_accounts_tool
from tools.reach_tools import reach_tools
from utils.logger import setup_logger

logger = setup_logger("planning_agent")

# --- 1. 定义状态 (State) ---
class PlanExecuteState(TypedDict):
    input: str
    plan: List[str]
    past_steps: Annotated[List[Tuple], operator.add]
    response: str

# --- 2. 定义计划模型 (Plan Model) ---
class Plan(BaseModel):
    """Plan to follow in future"""
    steps: List[str] = Field(description="different steps to follow, should be in sorted order")

# --- 3. 定义 Planner (规划器) ---
def get_planner_node():
    planner_prompt = ChatPromptTemplate.from_messages([
        ("system", 
         "你是一个专业的任务规划师。你的目标是将用户的复杂请求拆解为一系列可执行的简单步骤。\n"
         "可用的工具包括：\n"
         "- generate_image: 生成图片\n"
         "- edit_image: 精准编辑已有图片（局部重绘、指令编辑、去物体、扩图）\n"
         "- generate_video: 生成视频\n"
         "- search_memory: 查找历史记忆\n"
         "- search_knowledge_base: 查找私有知识库/文档\n"
         "- publish_content: 发布内容到社交平台(小红书,微博,抖音,B站等)，系统已内置发布能力，直接调用即可，无需安装任何额外包\n\n"
         "规划原则：\n"
         "1. 【最高优先级】如果用户提到'图片'、'画'、'照片'、'视频'等视觉需求，必须直接规划调用 generate_image 或 generate_video 进行创作！严禁先搜索。\n"
         "2. 如果用户请求生成图片但描述模糊（例如'生成一张图'），请自行发挥创意构思一个详细的 Prompt，直接生成，不要询问。\n"
         "3. 仅在用户请求的是纯文本信息且信息模糊时，才规划去查知识库或记忆。\n"
         "4. 不要规划'搜索现有图片资源'之类的步骤，因为我们没有联网搜索图片的能力，只能生成。\n"
         "5. 如果用户要求发布内容，请先生成内容(和媒体), 然后规划调用 publish_content。\n"
         "6. 步骤应简洁明了。\n\n"
         "【重要】请直接输出步骤列表，每行一个步骤，不要使用 JSON 格式。\n"
         "例如：\n"
         "1. 使用 generate_image 生成一张深圳城市风景图片\n"
         "2. 使用 publish_content 发布图片到小红书"
        ),
        ("user", "{input}")
    ])
    
    async def plan_step(state: PlanExecuteState):
        logger.info(f"Planning for input: {state['input']}")
        user_input = state['input']
        
        # 快速路径：直接识别图片/视频生成请求，跳过 LLM 规划
        if any(kw in user_input for kw in ['图片', '图', '画', '照片', 'image', '生成图']):
            steps = [f"使用 generate_image 生成图片：{user_input}"]
            logger.info(f"Quick plan (image): {steps}")
            return {"plan": steps}
        
        if any(kw in user_input for kw in ['视频', 'video', '动画', '动图']):
            steps = [f"使用 generate_video 生成视频：{user_input}"]
            logger.info(f"Quick plan (video): {steps}")
            return {"plan": steps}
        
        # 复杂请求：使用 LLM 规划 (Dynamic Load)
        from core.llm_provider import get_chat_llm
        model = get_chat_llm(temperature=0.5)
        
        try:
            result = await (planner_prompt | model).ainvoke({"input": user_input})
            content = result.content.strip()
            
            # 解析返回的步骤
            steps = []
            for line in content.split('\n'):
                line = line.strip()
                if line:
                    # 去掉开头的数字、点、横线等
                    cleaned = re.sub(r'^[\d\.\-、\)\]\s]+', '', line).strip()
                    if cleaned:
                        steps.append(cleaned)
            
            if steps:
                logger.info(f"Generated plan: {steps}")
                return {"plan": steps}
        except Exception as e:
            logger.warning(f"Planning failed: {e}")
        
        # 兜底
        logger.info("Using default plan")
        return {"plan": [f"回答用户问题：{user_input}"]}
    
    return plan_step

# --- 4. 定义 Executor (执行器) ---
# 我们复用一个简单的 ReAct Agent 作为单步执行器
def get_step_executor_node(api_key: str):
    # Notice: We instantiate tools once, but agent might be dynamic
    tools = [generate_image, edit_image, generate_video, search_memory, search_knowledge_base, publish_content_tool, get_publish_accounts_tool] + reach_tools
    
    async def execute_step(state: PlanExecuteState):
        # Dynamic LLM instantiation to support model switching
        from core.llm_provider import get_chat_llm
        llm = get_chat_llm(temperature=0.5, api_key=api_key)
        agent_executor = create_react_agent(llm, tools)
        
        plan = state["plan"]
        plan_str = "\n".join(f"{i+1}. {step}" for i, step in enumerate(plan))
        task = plan[0] # 获取当前第一步
        task_input = f"For the following plan:\n{plan_str}\n\nYou are tasked with executing step 1, {task}."
        
        logger.info(f"Executing step: {task}")
        
        # 调用 worker agent 执行当前步骤
        # 注意：create_react_agent 的输入状态主要是 messages
        config = {"recursion_limit": 10}
        agent_response = await agent_executor.ainvoke(
            {"messages": [("user", task_input)]}, 
            config=config
        )
        
        # 获取最后一条消息的内容作为结果
        response_content = agent_response["messages"][-1].content
        
        return {
            "past_steps": [(task, response_content)],
            "plan": plan[1:] # 移除已执行的步骤
        }
        
    return execute_step

# --- 5. 定义 Re-Planner / Response Generator ---
def get_replan_node():
    """
    重新规划节点：检查执行结果，决定是继续执行还是返回最终结果
    完全不使用结构化输出，直接分析执行结果
    """
    
    async def replan_step(state: PlanExecuteState):
        logger.info("Replanning...")
        
        # Instantiate model as per instruction, though it's not used in current replan logic
        from core.llm_provider import get_chat_llm
        model = get_chat_llm(temperature=0.1)
        
        # 从 past_steps 中提取结果
        past_results = ""
        for step_name, step_result in state.get("past_steps", []):
            past_results += f"\n{step_result}"
        
        # 检查是否有 URL 或本地路径（说明已经生成了媒体）
        urls = re.findall(r'(https?://[^\s)\]<>"\']+)', past_results)
        local_paths = re.findall(r'(storage/outputs/[^\s]+\.(jpg|png|mp4|gif))', past_results)
        full_paths = re.findall(r'(/[^\s]+\.(jpg|png|mp4|gif))', past_results)
        
        # 清理 URLs
        clean_urls = [url.rstrip('.,;:"\'。，！？') for url in urls]
        
        if clean_urls or local_paths or full_paths:
            # 已经完成媒体生成，直接返回结果
            logger.info("Task completed with media generation.")
            
            # 构造友好的回复
            response_parts = ["✅ 已为您完成请求！\n"]
            
            if clean_urls:
                response_parts.append(f"\n🔗 **媒体链接:** {clean_urls[0]}")
            
            if full_paths:
                path = full_paths[0][0] if isinstance(full_paths[0], tuple) else full_paths[0]
                response_parts.append(f"\n📁 **本地文件:** {path}")
            
            # 添加原始结果供展示
            response_parts.append(f"\n\n{past_results}")
            
            return {"response": "".join(response_parts), "plan": []}
        
        # 检查是否还有剩余计划
        remaining_plan = state.get("plan", [])
        if remaining_plan:
            logger.info(f"Continuing with remaining plan: {remaining_plan}")
            return {"plan": remaining_plan}
        
        # 没有媒体也没有剩余计划，返回执行结果
        if past_results.strip():
            logger.info("Returning execution results.")
            return {"response": f"已处理您的请求。\n\n{past_results}", "plan": []}
        
        # 兜底
        return {
            "response": "抱歉，处理过程中遇到了问题。请重试。",
            "plan": []
        }

    return replan_step

# --- 6. 构建 Graph ---
def get_planning_graph(api_key: str):
    # Note: Model is now instantiated dynamically inside nodes
    workflow = StateGraph(PlanExecuteState)
    
    # 添加节点
    workflow.add_node("planner", get_planner_node())
    workflow.add_node("executor", get_step_executor_node(api_key))
    workflow.add_node("replan", get_replan_node())
    
    # 设置入口
    workflow.set_entry_point("planner")
    
    # 添加边
    workflow.add_edge("planner", "executor")
    workflow.add_edge("executor", "replan")
    
    # 条件边：如果 plan 为空（即返回了 Response），结束；否则继续执行
    def should_end(state: PlanExecuteState):
        if state["response"]:
            return True
        else:
            return False
            
    workflow.add_conditional_edges(
        "replan",
        should_end,
        {True: END, False: "executor"}
    )
    
    return workflow.compile()
