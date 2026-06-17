import { requireTrimmed, rejectPlaceholders } from "@/app/components/assistantValidation";

export function buildRecipeParams(
  recipeId: string,
  ctx: { ideaInput: string; scopeInput: string },
): { params?: Record<string, unknown>; error?: string } {
  const { ideaInput, scopeInput } = ctx;
  if (recipeId === "concept.pitch") {
    const err = rejectPlaceholders(ideaInput, ["你的游戏创意"], "请填写游戏方向/创意");
    if (err) return { error: err };
    return { params: { idea: ideaInput.trim() } };
  }
  if (recipeId === "core.loop") {
    const err = rejectPlaceholders(ideaInput, ["你的游戏创意"], "请填写游戏名称/方向");
    if (err) return { error: err };
    return { params: { game_name: ideaInput.trim() } };
  }
  if (recipeId === "system.design") {
    const err = rejectPlaceholders(scopeInput, ["养成系统"], "请填写系统名称");
    if (err) return { error: err };
    return { params: { system_name: scopeInput.trim() } };
  }
  if (recipeId === "level.plan") {
    const err = rejectPlaceholders(scopeInput, ["第一章"], "请填写内容范围");
    if (err) return { error: err };
    return { params: { content_scope: scopeInput.trim() } };
  }
  if (recipeId === "narrative.outline") {
    const err = requireTrimmed(ideaInput, "请填写题材/主题");
    if (err) return { error: err };
    return { params: { theme: ideaInput.trim() } };
  }
  if (recipeId === "balance.framework") {
    const ideaErr = rejectPlaceholders(ideaInput, ["你的游戏创意"], "请填写游戏名称/方向");
    if (ideaErr) return { error: ideaErr };
    const scopeErr = rejectPlaceholders(scopeInput, ["战斗数值"], "请填写数值重点");
    if (scopeErr) return { error: scopeErr };
    return {
      params: { system_focus: scopeInput.trim(), game_name: ideaInput.trim() },
    };
  }
  return { params: {} };
}

export function showIdeaInput(category: string) {
  return category === "concept" || category === "narrative" || category === "system" || category === "balance";
}

export function showScopeInput(category: string) {
  return category === "system" || category === "level" || category === "balance";
}

export function ideaLabel(category: string) {
  return category === "narrative" ? "题材/主题" : "游戏方向/名称";
}

export function scopeLabel(category: string) {
  if (category === "level") return "内容范围";
  if (category === "balance") return "数值重点";
  return "系统名称";
}
