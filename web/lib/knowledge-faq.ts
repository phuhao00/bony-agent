export type FaqItem = {
  id: string;
  question: string;
  answer: string;
  tags: string[];
  extra?: Record<string, string>;
  order: number;
  updated_at?: string;
};

export type FaqPayload = {
  success: boolean;
  document_id?: string;
  title?: string;
  items?: FaqItem[];
  error?: string;
  metadata?: Record<string, unknown>;
};

export function isFaqDocument(doc: {
  content_type?: string;
  filename?: string;
}): boolean {
  if (doc.content_type === "faq") return true;
  return (doc.filename || "").toLowerCase().endsWith(".faq.json");
}

export function newFaqItem(order = 0): FaqItem {
  return {
    id: crypto.randomUUID(),
    question: "",
    answer: "",
    tags: [],
    extra: {},
    order,
  };
}
