/** 与知识库检索页一致：all | cat:{id} | doc:{id} */
export type KnowledgeScopeToken = string;

export function parseKnowledgeScope(scope: KnowledgeScopeToken): {
  category?: string;
  doc_id?: string;
} {
  const s = (scope || "all").trim();
  if (s.startsWith("cat:")) {
    const category = s.slice(4).trim();
    return category ? { category } : {};
  }
  if (s.startsWith("doc:")) {
    const doc_id = s.slice(4).trim();
    return doc_id ? { doc_id } : {};
  }
  return {};
}

export type KnowledgeScopeDoc = {
  id: string;
  filename: string;
  category?: string;
  content_type?: string;
  faq_count?: number;
  description?: string;
};

export type KnowledgeScopeCategory = {
  id: string;
  name: string;
  icon?: string;
  document_count?: number;
};

export function formatKnowledgeScopeLabel(
  scope: KnowledgeScopeToken,
  documents: KnowledgeScopeDoc[],
  categories: KnowledgeScopeCategory[],
  fallbackAll = "全部文档",
): string {
  if (!scope || scope === "all") return fallbackAll;
  if (scope.startsWith("doc:")) {
    const id = scope.slice(4);
    const doc = documents.find((d) => d.id === id);
    return doc?.filename || doc?.description || id;
  }
  if (scope.startsWith("cat:")) {
    const id = scope.slice(4);
    const cat = categories.find((c) => c.id === id);
    return cat ? `${cat.icon ?? ""} ${cat.name}`.trim() : id;
  }
  return fallbackAll;
}
