import { requireTrimmed, rejectPlaceholders } from "@/app/components/assistantValidation";

export function buildRecipeParams(
  recipeId: string,
  ctx: { projectInput: string; subjectInput: string },
): { params?: Record<string, unknown>; error?: string } {
  const { projectInput, subjectInput } = ctx;
  if (recipeId === "style.guide" || recipeId === "ui.art.guide") {
    const err = rejectPlaceholders(projectInput, ["你的游戏项目"], "请填写游戏项目名称");
    if (err) return { error: err };
    return { params: { game_name: projectInput.trim() } };
  }
  if (recipeId === "character.brief") {
    const err = rejectPlaceholders(subjectInput, ["主角"], "请填写角色名/定位");
    if (err) return { error: err };
    return { params: { character_name: subjectInput.trim() } };
  }
  if (recipeId === "scene.concept") {
    const err = rejectPlaceholders(subjectInput, ["主城"], "请填写场景名称");
    if (err) return { error: err };
    return { params: { scene_name: subjectInput.trim() } };
  }
  if (recipeId === "visual.research") {
    const err = requireTrimmed(projectInput, "请填写项目/品类关键词");
    if (err) return { error: err };
    return { params: { genre: projectInput.trim() } };
  }
  return { params: {} };
}

export function showSubjectInput(category: string) {
  return category === "character" || category === "scene";
}
