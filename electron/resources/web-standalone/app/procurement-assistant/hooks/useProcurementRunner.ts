"use client";

import {
  useAssistantRecipeRunner,
  type AssistantEnvironment,
  type AssistantRecipeTask,
  type AssistantSuggestion,
} from "@/app/hooks/useAssistantRecipeRunner";

export type ProcurementTask = AssistantRecipeTask;
export type ProcurementEnvironment = AssistantEnvironment;
export type ProcurementSuggestion = AssistantSuggestion;

export function useProcurementRunner() {
  return useAssistantRecipeRunner("/api/procurement-assistant");
}
