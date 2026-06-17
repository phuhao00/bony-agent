import type { PetAnimation } from "./api";

export type PetVisualState = PetAnimation | "offline" | "blink" | "coquettish";

const ACTION_TO_ANIM: Record<string, PetVisualState> = {
  idle: "idle",
  thinking: "thinking",
  talking: "talking",
  cheer_up: "cheer_up",
  celebrate: "celebrate",
  remind_drink: "remind_drink",
  coquettish: "coquettish",
};

export function actionToAnimation(action: string): PetVisualState {
  return ACTION_TO_ANIM[action] || "talking";
}

export function stageClass(stage?: string): string {
  if (stage === "evolved") return "stage-evolved";
  if (stage === "teen") return "stage-teen";
  return "stage-young";
}

export function careGlow(careScore = 0): string {
  if (careScore >= 200) return "glow-high";
  if (careScore >= 50) return "glow-mid";
  return "glow-low";
}
