export type ClaudeCodeSseEvent = {
  type: string;
  run_id?: string;
  cwd?: string;
  session_id?: string;
  permission_mode?: string;
  permission_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  title?: string;
  description?: string;
  display_name?: string;
  payload?: Record<string, unknown>;
  text?: string;
  response?: string;
  detail?: string;
  content?: string;
};

export type ClaudeCodeTimelineItem = {
  id: string;
  kind: "start" | "message" | "permission" | "error" | "final";
  title: string;
  detail?: string;
  at: number;
};

export type CodingChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  at: number;
  streaming?: boolean;
};

export type ClaudeCodeRunState = {
  running: boolean;
  error: string;
  runId: string;
  cwd: string;
  sessionId: string | null;
  messages: CodingChatMessage[];
  timeline: ClaudeCodeTimelineItem[];
  finalResponse: string;
  pendingPermission: {
    permission_id: string;
    tool_name?: string;
    title?: string;
    description?: string;
  } | null;
};
