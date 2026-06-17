"use client";

import {
  useAssistantRecipeRunner,
  type AssistantEnvironment,
  type AssistantRecipeTask,
  type AssistantSuggestion,
} from "@/app/hooks/useAssistantRecipeRunner";

export type GameDesignTask = AssistantRecipeTask;
export type GameDesignEnvironment = AssistantEnvironment;
export type GameDesignSuggestion = AssistantSuggestion;

export function useGameDesignRunner() {
  return useAssistantRecipeRunner("/api/game-design");
}
