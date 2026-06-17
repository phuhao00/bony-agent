"use client";

import {
  useAssistantRecipeRunner,
  type AssistantEnvironment,
  type AssistantRecipeTask,
  type AssistantSuggestion,
} from "@/app/hooks/useAssistantRecipeRunner";

export type GameArtTask = AssistantRecipeTask;
export type GameArtEnvironment = AssistantEnvironment;
export type GameArtSuggestion = AssistantSuggestion;

export function useGameArtRunner() {
  return useAssistantRecipeRunner("/api/game-art");
}
