"use client";

import {
  useAssistantRecipeRunner,
  type AssistantEnvironment,
  type AssistantRecipeTask,
  type AssistantSuggestion,
} from "@/app/hooks/useAssistantRecipeRunner";

export type AdCampaignTask = AssistantRecipeTask;
export type AdCampaignEnvironment = AssistantEnvironment;
export type AdCampaignSuggestion = AssistantSuggestion;

export function useAdCampaignRunner() {
  return useAssistantRecipeRunner("/api/ad-campaign");
}
