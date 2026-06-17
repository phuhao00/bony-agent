import type { ParticipationItem } from "@/lib/agentModelTrace";

export type TraceEntry = {
  type: string;
  title: string;
  detail?: string;
};

export type RecipeResultCard = {
  assistantName: string;
  agentId?: string;
  recipeId?: string;
  recipeName?: string;
  status?: string;
  report?: string;
  taskId?: string;
  labsHref?: string;
  error?: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  modelTag?: string;
  traceId?: string;
  trace?: TraceEntry[];
  recipeCards?: RecipeResultCard[];
  completedAgents?: string[];
  participation?: ParticipationItem[];
};

export type ChatSessionSnapshot = {
  messages: ChatMessage[];
  input: string;
  updatedAt: string;
};
