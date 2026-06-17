# AI Media Agent - 路由与协作机制详解

> 本文档详细说明当用户输入一句话时，系统如何将请求路由到合适的 Agent，以及多个 Agent 之间如何协作完成任务。

---

## 一、整体流程概览

```
用户输入
    ↓
[IntentRouter] 意图路由
    ↓
[Orchestrator] 编排器
    ↓
Agent 执行 → 工具调用 → 外部服务
    ↓
结果返回
```

---

## 二、详细流程分解

### 1. 入口层 (main.py)

用户请求通过 `POST /multi-agent/stream` 或 `POST /multi-agent/invoke` 进入系统。

```python
# 关键代码位置: backend/main.py (搜索 /multi-agent/stream)
@app.post("/multi-agent/stream")
async def api_stream_multi_agent(req: MultiAgentRequest):
    # 1. 创建执行追踪 (Trace)
    trace_id = create_trace("multi_agent", req.input, metadata={...})

    # 2. 检查是否命中确定性管道 (如"生成视频并发布到B站")
    if _is_video_generation_publish_request(req.input):
        result = await _run_video_generation_publish_pipeline(req.input)
    else:
        # 3. 进入多 Agent 协作流程
        async for event in stream_multi_agent(req.input, current_api_key):
            yield event
```

**特殊处理：确定性管道**

对于"生成视频并发不到B站"这类明确的多步骤任务，系统会绕过 LLM 路由，直接执行预设的管道：

```python
def _is_video_generation_publish_request(text: str) -> bool:
    has_video = any(kw in text for kw in ["视频", "video", "动画"])
    has_publish = any(kw in text for kw in ["发布", "发到", "上传", "投稿"])
    return has_video and has_publish and bool(_detect_publish_platform(text))
```

---

### 2. 意图路由层 (router.py)

**文件位置**: `backend/agents/router.py`

> **注**：`media_agent` 的实现文件为 `backend/agents/bot.py`（`AGENT_ID = "media_agent"`），负责图片/视频生成、发布、记忆与知识库查询；`video_editor_agent` 则专注于剪辑/混剪/拼接。

采用**两级路由策略**：

#### 2.1 第一级：关键词快速匹配 (零延迟)

```python
_KEYWORD_RULES = [
    # (关键词列表, agent_id, 优先级)
    (["审核", "合规", "敏感词"], "reviewer_agent", 0.95),
    (["视频剪辑", "混剪", "拼接"], "video_editor_agent", 0.95),
    (["图片编辑", "修图", "去水印", "扩图", "重绘", "参考图编辑"], "image_edit_agent", 0.95),
    (["长视频工坊", "长视频", "分段长视频", "分钟长视频"], "long_video_agent", 0.95),
    (["图片", "画", "照片", "海报"], "media_agent", 0.90),
    (["视频", "动画", "生成视频"], "media_agent", 0.90),
    (["发布", "上传", "投稿", "哔哩哔哩", "小红书"], "media_agent", 0.80),
    (["脚本", "分镜", "拍摄脚本"], "script_writer_agent", 0.92),
    (["文案", "软文", "种草文", "标题"], "copywriter_agent", 0.92),
    (["热点", "趋势", "热搜", "榜单"], "trend_analyst_agent", 0.92),
    (["创作", "内容", "创意"], "creative_agent", 0.85),
    (["架构", "目录结构", "规范"], "architect_agent", 0.85),
    (["代码分析", "仓库", "调用链", "源码阅读"], "code_analyst_agent", 0.85),
    (["产品经理", "PRD", "Discovery", "路线图", "用户故事"], "product_manager_agent", 0.85),
    (["法务", "合同", "合规", "法律", "律师"], "legal_agent", 0.85),
    (["广告投放", "广告计划", "受众定向", "预算"], "ad_campaign_agent", 0.85),
    (["商务合作", "BD", "合作方案", "伙伴评估"], "business_partnership_agent", 0.85),
    (["采购", "供应商", "RFQ", "比价", "成本优化"], "procurement_agent", 0.85),
    (["游戏美术", "角色", "场景", "UI", "竞品视觉"], "game_art_agent", 0.85),
    (["游戏设计", "游戏策划", "数值", "关卡", "系统"], "game_design_agent", 0.85),
    (["程序员", "代码", "Git", "运维", "中间件"], "programmer_agent", 0.85),
    (["系统", "安装软件", "卸载", "网络修复", "环境配置"], "system_assistant", 0.85),
    (["桌面操作", "自动化", "Blender", "Photoshop", "Office"], "desktop_operator_agent", 0.85),
    (["龙虾", "OpenClaw", "热点克隆", "自动发布"], "lobster_agent", 0.85),
]
```

**匹配逻辑**：
```python
def _keyword_route(self, user_input: str) -> Optional[RouteResult]:
    text = user_input.lower()
    for keywords, agent_id, confidence in _KEYWORD_RULES:
        for kw in keywords:
            if kw in text:
                return RouteResult(
                    agent_id=agent_id,
                    confidence=confidence,
                    reason=f"keyword_match: '{kw}'"
                )
    return None  # 未命中，进入 LLM 兜底
```

#### 2.2 第二级：LLM 兜底分类

当关键词未命中时，使用 LLM 进行意图推断：

```python
def _llm_route(self, user_input: str) -> RouteResult:
    prompt = f"""
你是一个意图推断专家。根据用户请求，从以下 Agent 中选择最合适的一个。

推断规则（按优先级）：
- 涉及图片/海报/宣传图/画 → media_agent
- 涉及视频/动画/混剪 → media_agent 或 video_editor_agent
- 涉及脚本/分镜/拍摄计划 → script_writer_agent
- 涉及文案/种草/标题/推文 → copywriter_agent
- 涉及热点/趋势/榜单 → trend_analyst_agent
- 涉及审核/合规/敏感词 → reviewer_agent
- 其他创作需求 → creative_agent

可选 Agent:
{options}

用户请求: {user_input}

回复格式: agent_id（仅此一行）
"""
    llm = get_chat_llm(temperature=0.0)
    result = llm.invoke(prompt)
    chosen = result.content.strip()
    return RouteResult(agent_id=chosen, confidence=0.75, reason="llm_classification")
```

---

### 3. 编排器层 (orchestrator.py)

**文件位置**: `backend/agents/orchestrator.py`

编排器采用 **Supervisor 模式**，基于 LangGraph StateGraph 实现。

#### 3.1 状态定义

```python
class MultiAgentState(TypedDict):
    messages: List[BaseMessage]          # 消息流
    next_agent: str                      # 下一个要执行的 Agent
    completed_agents: List[str]          # 已完成的 Agent
    final_response: str                  # 最终响应
```

#### 3.2 执行流程图

```
                    ┌─────────────┐
                    │   用户输入   │
                    └──────┬──────┘
                           ↓
                    ┌─────────────┐
         ┌─────────│  Supervisor │◄─────────────────┐
         │         │  (路由决策)  │                  │
         │         └──────┬──────┘                  │
         │                │                         │
         │    ┌───────────┼───────────┐             │
         │    ↓           ↓           ↓             │
         │ ┌──────┐   ┌──────┐   ┌──────┐          │
         │ │Agent1│   │Agent2│   │Agent3│          │
         │ └──┬───┘   └──┬───┘   └──┬───┘          │
         │    │          │          │              │
         │    └──────────┴──────────┘              │
         │                   │                     │
         │                   ↓                     │
         │         ┌─────────────┐                 │
         │         │  执行完成?   │                 │
         │         └──────┬──────┘                 │
         │                │                        │
         │         ┌──────┴──────┐                 │
         │         ↓             ↓                 │
         │      [是]          [否]                 │
         │         │             │                 │
         │         ↓             └─────────────────┘
         │    ┌─────────┐
         │    │  END    │
         │    └─────────┘
```

#### 3.3 Supervisor 决策逻辑

```python
def supervisor(state: MultiAgentState) -> dict:
    completed = state.get("completed_agents", [])

    # 首次调用：使用 Router 选择第一个 Agent
    if not completed:
        route_result = router.route(user_text)
        return {"next_agent": route_result.agent_id}

    # 后续调用：评估是否需要继续
    last_agent = completed[-1]
    last_content = _extract_last_agent_content(messages)

    # 快速结束：单步 Agent 直接返回
    if len(completed) == 1 and last_agent in _SINGLE_FINISH_AGENTS:
        return {"next_agent": "FINISH", "final_response": last_content}

    # LLM 决策下一步
    decision = _llm_supervisor_decision(
        available_agents=available_agents,
        user_text=user_text,
        completed=completed,
        last_agent=last_agent,
        last_content=last_content,
    )

    if decision["done"]:
        return {"next_agent": "FINISH", "final_response": ...}
    else:
        return {"next_agent": decision["next_agent"], "messages": [guidance]}
```

#### 3.4 LLM Supervisor 决策提示词

```python
prompt = f"""
你是一个多 Agent 编排器。你的任务是在当前步骤结束后决定：继续调用哪个 Agent，或者结束。

只输出 JSON 对象，不要 Markdown，不要解释。

字段要求：
- next_agent: 下一个 agent_id；如果结束则填 "FINISH"
- reason: 简短字符串，说明原因
- done: true/false
- guidance: 给下一个 Agent 的附加说明

约束：
1. next_agent 必须是以下之一：{options}，或者 FINISH
2. 不要重复选择已经明显完成同一工作的 Agent
3. 如果上一步是内容创作类 Agent，且还未审核，优先考虑 reviewer_agent
4. 如果上一步是趋势分析，且还未成稿，优先考虑 copywriter_agent
5. 如果任务已经可以直接返回给用户，done=true

用户原始请求：{user_text}
已完成 Agent：{completed}
最近一个 Agent：{last_agent}
最近输出摘要：{last_content[:1800]}
"""
```

#### 3.5 典型协作链

| 场景 | Agent 协作链 |
|------|-------------|
| "帮我写个抖音文案" | `copywriter_agent` → FINISH |
| "分析下今天的游戏热点" | `trend_analyst_agent` → `copywriter_agent` → FINISH |
| "生成视频并发不到B站" | `media_agent` (确定性管道) → FINISH |
| "帮我写个脚本并审核" | `script_writer_agent` → `reviewer_agent` → FINISH |
| "生成一张海报" | `media_agent` → FINISH |
| "制定广告投放策略" | `ad_campaign_agent` → `copywriter_agent` → FINISH |
| "起草商务合作方案" | `business_partnership_agent` → `legal_agent` → FINISH |
| "设计游戏概念并生成美术" | `game_design_agent` → `game_art_agent` → `media_agent` → FINISH |
| "排查本机网络/环境" | `system_assistant` → FINISH |
| "批量处理本地文件或操作软件" | `desktop_operator_agent` → FINISH |

---

### 4. Agent 注册表 (registry.py)

**文件位置**: `backend/agents/registry.py`

全局单例注册表，管理所有可用 Agent：

```python
class AgentRegistry:
    """全局 Agent 注册表 (Singleton)"""

    def register(self, agent_id: str, factory: Callable,
                 description: str, capabilities: List[str]):
        # 注册 Agent 工厂函数

    def get(self, agent_id: str, api_key: str = "") -> BaseAgent:
        # 获取 Agent 实例（延迟单例）

    def list_all(self) -> List[dict]:
        # 列出所有已注册 Agent
```

**已注册的 Agent** (main.py 中 `_init_multi_agent_registry`，共 22 个）

```python
# 媒体创作
_registry.register("media_agent", get_media_base_agent, ...)
_registry.register("image_edit_agent", get_image_edit_base_agent, ...)
_registry.register("video_editor_agent", get_video_editor_base_agent, ...)
_registry.register("long_video_agent", get_long_video_base_agent, ...)

# 内容创作
_registry.register("creative_agent", get_creative_base_agent, ...)  # 注册在 general_agent.py
_registry.register("copywriter_agent", get_copywriter_base_agent, ...)
_registry.register("script_writer_agent", get_script_writer_base_agent, ...)
_registry.register("trend_analyst_agent", get_trend_analyst_base_agent, ...)
_registry.register("reviewer_agent", get_reviewer_base_agent, ...)

# 专业助手 Labs
_registry.register("product_manager_agent", get_product_manager_base_agent, ...)
_registry.register("legal_agent", get_legal_base_agent, ...)
_registry.register("ad_campaign_agent", get_ad_campaign_base_agent, ...)
_registry.register("business_partnership_agent", get_business_partnership_base_agent, ...)
_registry.register("procurement_agent", get_procurement_base_agent, ...)
_registry.register("game_art_agent", get_game_art_base_agent, ...)
_registry.register("game_design_agent", get_game_design_base_agent, ...)
_registry.register("programmer_agent", get_programmer_base_agent, ...)

# 系统 / 桌面 / 代码
_registry.register("system_assistant", get_system_assistant_base_agent, ...)
_registry.register("desktop_operator_agent", get_desktop_operator_base_agent, ...)
_registry.register("code_analyst_agent", get_code_analyst_base_agent, ...)
_registry.register("architect_agent", get_architect_base_agent, ...)

# 分布式流水线
_registry.register("lobster_agent", get_lobster_base_agent, ...)
```

---

### 5. Agent 执行层

每个 Agent 都遵循统一的接口：

```python
class BaseAgent:
    def as_node(self) -> Callable:
        """返回 LangGraph 节点函数"""

    def get_executor(self, api_key: str):
        """获取可执行实例"""
```

Agent 执行时会：
1. 接收 `messages` 列表
2. 调用 LLM 进行推理
3. 根据需要调用工具（文生图、视频生成等）
4. 返回结果到共享状态

---

## 三、流式输出机制

SSE (Server-Sent Events) 流式输出事件类型：

```python
# 1. 开始事件
{"type": "start", "input": "用户输入"}

# 2. 路由决策事件
{"type": "decision", "next_agent": "copywriter_agent", "guidance": "", "completed_agents": []}

# 3. Agent 执行结果
{"type": "agent_result", "agent_id": "copywriter_agent", "content": "...", "completed_agents": ["copywriter_agent"]}

# 4. 最终响应
{"type": "final", "response": "...", "completed_agents": ["copywriter_agent"], "media_url": "..."}

# 5. 完成标记
{"type": "done"}
```

---

## 四、执行追踪 (Trace)

每次多 Agent 调用都会生成唯一的 trace_id，用于全链路追踪：

```python
trace_id = create_trace(
    "multi_agent",
    req.input,
    metadata={"mode": "stream", "provider": provider, "model": model},
)

# 记录事件
append_trace_event(trace_id, {"type": "start", "input": req.input})
append_trace_event(trace_id, {"type": "decision", "next_agent": "..."})

# 结束追踪
finalize_trace(trace_id, status="completed", final_response=...)
```

存储位置: `storage/traces/{trace_id}.json`

---

## 五、总结

| 层级 | 职责 | 关键文件 |
|------|------|----------|
| **入口层** | 接收请求、特殊管道检测、创建追踪 | `main.py` |
| **路由层** | 关键词匹配 → LLM 兜底分类 | `router.py` |
| **编排层** | Supervisor 决策、Agent 调度、状态管理 | `orchestrator.py` |
| **注册层** | Agent 注册、发现、生命周期管理 | `registry.py` |
| **执行层** | LLM 推理、工具调用、结果返回 | `agents/*.py` |

**核心设计思想**：

1. **快速路径优先**：关键词匹配零延迟处理常见请求
2. **智能兜底**：LLM 处理模糊或复杂意图
3. **可观测**：全程流式输出 + Trace 追踪
4. **可扩展**：新 Agent 只需注册即可接入协作网络
