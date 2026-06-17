"""backend/core/workflow_schema.py — Pydantic v2 工作流数据模型"""
from __future__ import annotations

import time
import uuid
from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field


# ── 节点类型枚举 ─────────────────────────────────────────────────────

class NodeType(str, Enum):
    # 触发器
    TRIGGER_MANUAL   = "trigger_manual"
    TRIGGER_SCHEDULE = "trigger_schedule"
    TRIGGER_WEBHOOK  = "trigger_webhook"

    # AI Agent 节点
    AGENT_SCRIPT_WRITER = "agent_script_writer"
    AGENT_COPYWRITER    = "agent_copywriter"
    AGENT_MEDIA         = "agent_media"
    AGENT_GENERAL       = "agent_general"

    # 工具节点
    TOOL_IMAGE   = "tool_image"
    TOOL_VIDEO   = "tool_video"
    TOOL_AUDIO   = "tool_audio"
    TOOL_PUBLISH = "tool_publish"
    TOOL_RAG     = "tool_rag"
    TOOL_HTTP    = "tool_http"

    # 流程控制
    CONTROL_CONDITION = "control_condition"
    CONTROL_LOOP      = "control_loop"

    # 输出节点
    OUTPUT_PREVIEW = "output_preview"


# ── 节点配置（每种节点的 configJson 对应结构）───────────────────────

class AgentNodeConfig(BaseModel):
    system_prompt: str = ""
    user_prompt_template: str = ""   # 支持 {{variable}} 替换
    max_steps: int = 10
    model: Optional[str] = None      # None = 使用全局默认模型


class ImageToolConfig(BaseModel):
    prompt_template: str = ""
    model: str = "cogview-3-plus"
    size: str = "1024x1024"


class VideoToolConfig(BaseModel):
    prompt_template: str = ""
    model: str = "cogvideox"
    duration_seconds: int = 6
    from_image: bool = False          # True = 图生视频


class AudioToolConfig(BaseModel):
    text_template: str = ""
    voice: str = "default"
    speed: float = 1.0


class PublishToolConfig(BaseModel):
    platforms: List[str] = Field(default_factory=list)  # e.g. ["xiaohongshu", "douyin"]
    title_template: str = ""
    description_template: str = ""


class HttpToolConfig(BaseModel):
    url: str = ""
    method: str = "GET"
    headers: Dict[str, str] = Field(default_factory=dict)
    body_template: str = ""


class ConditionConfig(BaseModel):
    expression: str = ""  # e.g. "$prevNode.status == 'ok'"
    true_output: str = "true"
    false_output: str = "false"


class ScheduleTriggerConfig(BaseModel):
    cron: str = ""                    # e.g. "0 9 * * 1-5"
    timezone: str = "Asia/Shanghai"


class WebhookTriggerConfig(BaseModel):
    path: str = ""                    # 自定义 webhook 路径后缀
    secret: str = ""                  # HMAC 验签密钥（建议加密存储）


NodeConfig = Union[
    AgentNodeConfig,
    ImageToolConfig,
    VideoToolConfig,
    AudioToolConfig,
    PublishToolConfig,
    HttpToolConfig,
    ConditionConfig,
    ScheduleTriggerConfig,
    WebhookTriggerConfig,
    Dict[str, Any],  # fallback for unknown types
]


# ── 节点位置（React Flow UI 坐标）─────────────────────────────────

class NodePosition(BaseModel):
    x: float = 0.0
    y: float = 0.0


# ── 工作流定义模型 ────────────────────────────────────────────────

class WorkflowNodeData(BaseModel):
    """React Flow node data (存储于 `nodes[].data`)"""
    label: str = ""
    node_type: NodeType
    config: Dict[str, Any] = Field(default_factory=dict)
    # 输入/输出端口声明
    input_map: Dict[str, str] = Field(
        default_factory=dict,
        description="param_name → '$sourceNodeId.outputKey' 或 literal",
    )
    output_map: Dict[str, str] = Field(
        default_factory=dict,
        description="output_name → 描述",
    )


class WorkflowNodeDef(BaseModel):
    """工作流节点定义（存储格式 + proto 映射）"""
    node_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    node_type: NodeType
    config_json: str = "{}"           # 序列化的 NodeConfig JSON
    input_map: Dict[str, str] = Field(default_factory=dict)
    output_map: Dict[str, str] = Field(default_factory=dict)
    # UI 相关（不传给 Go）
    position: NodePosition = Field(default_factory=NodePosition)
    label: str = ""


class WorkflowEdgeDef(BaseModel):
    """工作流边（连接）定义"""
    source: str
    target: str
    source_handle: str = "output"
    target_handle: str = "input"


class WorkflowDef(BaseModel):
    """完整工作流定义（持久化 + API 传输格式）"""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str = "Untitled Workflow"
    description: str = ""
    nodes: List[WorkflowNodeDef] = Field(default_factory=list)
    edges: List[WorkflowEdgeDef] = Field(default_factory=list)
    created_at: int = Field(default_factory=lambda: int(time.time()))
    updated_at: int = Field(default_factory=lambda: int(time.time()))
    version: int = 1


# ── 运行状态模型 ─────────────────────────────────────────────────

class NodeRunStatus(str, Enum):
    PENDING   = "pending"
    RUNNING   = "running"
    COMPLETED = "completed"
    FAILED    = "failed"
    SKIPPED   = "skipped"


class NodeRunRecord(BaseModel):
    node_id: str
    node_type: NodeType
    status: NodeRunStatus = NodeRunStatus.PENDING
    inputs: Dict[str, Any] = Field(default_factory=dict)
    outputs: Dict[str, Any] = Field(default_factory=dict)
    error: str = ""
    started_at: Optional[int] = None   # Unix ms
    finished_at: Optional[int] = None  # Unix ms


class WorkflowRunStatus(str, Enum):
    RUNNING   = "running"
    COMPLETED = "completed"
    FAILED    = "failed"
    CANCELLED = "cancelled"


class WorkflowRunRecord(BaseModel):
    """运行记录（持久化到 Rust 存储）"""
    run_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    workflow_id: str
    status: WorkflowRunStatus = WorkflowRunStatus.RUNNING
    node_records: Dict[str, NodeRunRecord] = Field(default_factory=dict)
    variables: Dict[str, str] = Field(default_factory=dict)
    initial_variables: Dict[str, str] = Field(default_factory=dict)
    started_at: int = Field(default_factory=lambda: int(time.time()))
    finished_at: Optional[int] = None
    error: str = ""


# ── API 请求 / 响应 ──────────────────────────────────────────────

class CreateWorkflowRequest(BaseModel):
    name: str = "New Workflow"
    description: str = ""
    nodes: List[WorkflowNodeDef] = Field(default_factory=list)
    edges: List[WorkflowEdgeDef] = Field(default_factory=list)


class UpdateWorkflowRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    nodes: Optional[List[WorkflowNodeDef]] = None
    edges: Optional[List[WorkflowEdgeDef]] = None


class RunWorkflowRequest(BaseModel):
    initial_variables: Dict[str, str] = Field(
        default_factory=dict,
        description="trigger 节点注入的初始变量",
    )


class WorkflowSummary(BaseModel):
    """列表接口返回的摘要（轻量）"""
    id: str
    name: str
    description: str
    node_count: int
    created_at: int
    updated_at: int


class RunSummary(BaseModel):
    """运行列表摘要"""
    run_id: str
    workflow_id: str
    status: WorkflowRunStatus
    started_at: int
    finished_at: Optional[int] = None


# ── SSE 事件格式 ─────────────────────────────────────────────────

class WorkflowSSEEvent(BaseModel):
    """工作流执行的 SSE 推流事件"""
    event: Literal[
        "step_start",      # 节点开始执行
        "step_done",       # 节点执行完成
        "step_error",      # 节点执行失败
        "workflow_done",   # 整个工作流完成
        "workflow_error",  # 整个工作流失败
        "heartbeat",       # 保活心跳
    ]
    run_id: str
    node_id: Optional[str] = None
    node_type: Optional[str] = None
    data: Dict[str, Any] = Field(default_factory=dict)
    ts: int = Field(default_factory=lambda: int(time.time() * 1000))  # Unix ms
