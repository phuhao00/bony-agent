import type { ProductManagerTask } from "../hooks/useProductManagerRunner";

export type RecipeNameLookup = { id: string; name: string };

/** 从报告首行标题、任务 recipe 或兜底文案推导默认文档名 */
export function resolveReportDefaultTitle(
  markdown: string,
  task: ProductManagerTask | null,
  recipes: RecipeNameLookup[],
): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;

  const recipeId =
    typeof task?.metadata?.recipe_id === "string"
      ? task.metadata.recipe_id
      : undefined;
  const recipe = recipes.find((r) => r.id === recipeId);
  if (recipe?.name) return recipe.name;

  return "产品分析报告";
}

/** 页面已展示标题时，去掉 Markdown 首行重复的一级标题 */
export function stripDuplicateDocumentTitle(markdown: string, title: string): string {
  const normalizedTitle = title.trim();
  if (!normalizedTitle || !markdown.trim()) return markdown;

  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let index = 0;
  while (index < lines.length && !lines[index].trim()) index += 1;
  if (index >= lines.length) return markdown;

  const match = lines[index].trim().match(/^#\s+(.+)$/);
  if (!match) return markdown;

  const heading = match[1].trim();
  if (heading.toLowerCase() !== normalizedTitle.toLowerCase()) return markdown;

  index += 1;
  while (index < lines.length && !lines[index].trim()) index += 1;
  return lines.slice(index).join("\n");
}

export type KnowledgeSaveResult = {
  success: boolean;
  documents?: Array<{ id?: string; title?: string }>;
  error?: string;
  detail?: string;
};

/** 将 Markdown 报告写入 RAG 知识库（经 /api/knowledge/text） */
export async function saveReportToKnowledge(
  title: string,
  content: string,
): Promise<KnowledgeSaveResult> {
  const res = await fetch("/api/knowledge/text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: title.trim() || "产品分析报告",
      content: content.trim(),
      category: "product-manager",
      description: "产品经理助手 · 分析报告",
      tags: ["product-manager", "pm-report"],
    }),
  });
  const data = (await res.json()) as KnowledgeSaveResult & {
    detail?: string;
  };
  if (!res.ok) {
    return {
      success: false,
      error: data.detail || data.error || `HTTP ${res.status}`,
    };
  }
  return { success: true, documents: data.documents };
}
