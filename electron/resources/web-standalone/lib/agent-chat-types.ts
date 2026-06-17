/** Unified LangGraph agent chat SSE v2 types */

export type AgentChatMode = "multi";
export type GraphHint =
  | "auto"
  | "orchestrator"
  | "planning"
  | "lobster"
  | "chat"
  | "claude_code";

export type AgentChatPreferences = {
  onlineSearchMode?: string;
  chatKnowledgeMode?: string;
  chatKnowledgeScope?: string;
  chatMemoryRecall?: boolean;
  unboundMode?: boolean;
  chatMemoryEnabled?: boolean;
};

export type AgentChatMessage = {
  role: string;
  content: string;
};

export type WorkspaceContextPayload = {
  root?: string;
  attached_files?: string[];
  attachments?: Array<{
    name?: string;
    type?: string;
    size?: number;
    url?: string;
  }>;
  branch?: string;
  source_message_id?: string;
  trace_id?: string;
};

export type AgentChatRequestBody = {
  messages?: AgentChatMessage[];
  input?: string;
  preferences?: AgentChatPreferences;
  workspace_context?: WorkspaceContextPayload;
  agent_id?: string;
  graph_hint?: GraphHint;
  mode?: AgentChatMode;
  thread_id?: string;
  stream?: boolean;
};

export type AgentChatSseEvent = {
  type: string;
  content?: string;
  response?: string;
  trace_id?: string;
  graph_id?: string;
  provider?: string;
  model?: string;
  mode?: string;
  agent_id?: string;
  next_agent?: string;
  guidance?: string;
  completed_agents?: string[];
  media_url?: string;
  reason?: string;
  confidence?: number;
  use_publish_pipeline?: boolean;
  hit_count?: number;
  hit_ids?: string[];
  detail?: string;
  permission_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  title?: string;
  description?: string;
  run_id?: string;
  assistant?: Record<string, unknown> | null;
  task_id?: string;
  status?: string;
  recipe_id?: string;
  recipe_name?: string;
  report?: string;
  error?: string;
};
