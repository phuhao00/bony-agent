"use client";

// Barrel — specialized node wrappers all use BaseNode internally.
// React Flow requires a stable nodeTypes map, so we export individual components.

import { NodeProps } from "@xyflow/react";
import { memo } from "react";
import { BaseNode } from "./BaseNode";

// All specialized nodes delegate to BaseNode (type is encoded in data.node_type)
export const TriggerNode = memo(function TriggerNode(props: NodeProps) {
  return <BaseNode {...props} />;
});

export const AgentNode = memo(function AgentNode(props: NodeProps) {
  return <BaseNode {...props} />;
});

export const ToolNode = memo(function ToolNode(props: NodeProps) {
  return <BaseNode {...props} />;
});

export const ConditionNode = memo(function ConditionNode(props: NodeProps) {
  return <BaseNode {...props} />;
});

export const OutputNode = memo(function OutputNode(props: NodeProps) {
  return <BaseNode {...props} />;
});

/** React Flow nodeTypes map */
export const WORKFLOW_NODE_TYPES = {
  // Triggers
  trigger_manual: TriggerNode,
  trigger_schedule: TriggerNode,
  trigger_webhook: TriggerNode,
  trigger_trending: TriggerNode,
  trigger_rss: TriggerNode,
  // Agents
  agent_script_writer: AgentNode,
  agent_copywriter: AgentNode,
  agent_media: AgentNode,
  agent_general: AgentNode,
  agent_trend_analyst: AgentNode,
  agent_reviewer: AgentNode,
  agent_video_editor: AgentNode,
  agent_planning: AgentNode,
  agent_long_video: AgentNode,
  agent_architect: AgentNode,
  // Tools
  tool_image: ToolNode,
  tool_video: ToolNode,
  tool_audio: ToolNode,
  tool_publish: ToolNode,
  tool_rag: ToolNode,
  tool_memory_search: ToolNode,
  tool_memory_save: ToolNode,
  tool_http: ToolNode,
  tool_moderation: ToolNode,
  tool_subtitle: ToolNode,
  tool_remix: ToolNode,
  tool_trending: ToolNode,
  tool_web_search: ToolNode,
  tool_template: ToolNode,
  tool_transform: ToolNode,
  // Control
  control_condition: ConditionNode,
  control_loop: ConditionNode,
  control_parallel: ConditionNode,
  control_merge: ConditionNode,
  control_switch: ConditionNode,
  control_wait: ConditionNode,
  // Output
  output_preview: OutputNode,
  output_save_history: OutputNode,
  output_notify: OutputNode,
} as const;
