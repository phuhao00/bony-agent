export type PmExecutionLog = {
  phase?: string;
  level?: string;
  message?: string;
  detail?: Record<string, unknown>;
  ts?: number;
};

export type PmExecutionMeta = {
  recipe_id?: string;
  skill_id?: string | null;
  skill_loaded?: boolean;
  has_template?: boolean;
  has_example?: boolean;
  model?: string;
  provider?: string;
  temperature?: number;
  duration_ms?: number;
  search_queries?: string[];
  logs?: PmExecutionLog[];
};

export type PmRecipeStep = {
  id?: string;
  kind?: string;
  status?: string;
  result?: Record<string, unknown>;
  updated_at?: number;
};

export function extractExecution(
  task: { result?: Record<string, unknown>; metadata?: Record<string, unknown> } | null,
  lastResult: unknown,
): PmExecutionMeta | null {
  const fromTaskResult = task?.result?.execution;
  if (fromTaskResult && typeof fromTaskResult === "object") {
    return fromTaskResult as PmExecutionMeta;
  }
  const fromMeta = task?.metadata?.execution;
  if (fromMeta && typeof fromMeta === "object") {
    return fromMeta as PmExecutionMeta;
  }
  const fromLast = (lastResult as { result?: { execution?: PmExecutionMeta } })?.result
    ?.execution;
  return fromLast && typeof fromLast === "object" ? fromLast : null;
}

export function extractRecipeSteps(
  task: { metadata?: Record<string, unknown> } | null,
): PmRecipeStep[] {
  const steps = task?.metadata?.steps;
  return Array.isArray(steps) ? (steps as PmRecipeStep[]) : [];
}

const PHASE_LABEL: Record<string, string> = {
  skill: "Skill",
  recipe: "工作流",
  collect: "采集",
  search: "搜索",
  llm: "LLM",
};

export function pmPhaseLabel(phase?: string): string {
  if (!phase) return "步骤";
  return PHASE_LABEL[phase] || phase;
}
