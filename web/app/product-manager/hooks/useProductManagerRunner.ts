"use client";

import {
  useAssistantRecipeRunner,
  type AssistantEnvironment,
  type AssistantRecipeTask,
  type AssistantSuggestion,
} from "@/app/hooks/useAssistantRecipeRunner";

export type ProductManagerTask = AssistantRecipeTask;
export type ProductManagerEnvironment = AssistantEnvironment;
export type ProductManagerSuggestion = AssistantSuggestion;

export function useProductManagerRunner() {
  return useAssistantRecipeRunner("/api/product-manager");
}
