"use client";

import {
  useAssistantRecipeRunner,
  type AssistantEnvironment,
  type AssistantRecipeTask,
  type AssistantSuggestion,
} from "@/app/hooks/useAssistantRecipeRunner";

export type LegalAdvisorTask = AssistantRecipeTask;
export type LegalAdvisorEnvironment = AssistantEnvironment;
export type LegalAdvisorSuggestion = AssistantSuggestion;

export function useLegalAdvisorRunner() {
  return useAssistantRecipeRunner("/api/legal-advisor");
}
