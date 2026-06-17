"use client";

import {
  useAssistantRecipeRunner,
  type AssistantEnvironment,
  type AssistantRecipeTask,
  type AssistantSuggestion,
} from "@/app/hooks/useAssistantRecipeRunner";

export type BusinessPartnershipTask = AssistantRecipeTask;
export type BusinessPartnershipEnvironment = AssistantEnvironment;
export type BusinessPartnershipSuggestion = AssistantSuggestion;

export function useBusinessPartnershipRunner() {
  return useAssistantRecipeRunner("/api/business-partnership");
}
