export type StepLog = Record<string, unknown>;

export type Round = {
  round?: number;
  planned_steps?: unknown[];
  steps_logs?: StepLog[];
  parse_error?: string;
  raw_preview?: string;
  bootstrap_auto_search?: boolean;
  bootstrap_query?: string;
};

export type ComputerUseApproval = {
  id?: string;
  capability_id?: string;
  proposed_action?: string;
  risk_level?: string;
  expires_at?: string;
};

export type ComputerUseStage = {
  step?: number;
  stage?: string;
  plan?: string;
  reflection?: string;
  at?: number;
};

export type ComputerUseProgressMeta = {
  current_step?: number;
  max_steps?: number;
  last_plan?: string;
  last_reflection?: string;
  preview_screenshot_base64?: string;
  current_stage?: string;
  stages?: ComputerUseStage[];
};

export type SearchResultItem = {
  title?: string;
  url?: string;
  snippet?: string;
};

export type ComputerUseResult = {
  success?: boolean;
  error?: string;
  message?: string;
  rounds?: Round[];
  final_screenshot_base64?: string;
  preview_screenshot_base64?: string;
  total_steps_executed?: number;
  status?: string;
  requires_approval?: boolean;
  task_id?: string;
  approval?: ComputerUseApproval;
  autoresearch_markdown?: string;
  autoresearch_error?: string;
  autoresearch_skipped?: boolean;
  engine?: string;
  search_results?: SearchResultItem[];
  search_results_count?: number;
  computer_use?: ComputerUseProgressMeta;
  final_page_context?: {
    url?: string;
    title?: string;
    text_excerpt_preview?: string;
  };
};

export type TaskPollState = {
  id?: string;
  status?: string;
  progress?: number;
  message?: string;
  error?: string;
  result?: ComputerUseResult;
  metadata?: {
    computer_use?: ComputerUseProgressMeta;
    preview_screenshot_base64?: string;
    last_approval_id?: string;
    goal?: string;
    start_url?: string;
  };
};

export type RunMeta = {
  startUrl: string;
  hint: string;
};
