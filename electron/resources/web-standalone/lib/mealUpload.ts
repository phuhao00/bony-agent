export const MAX_MEAL_UPLOAD_IMAGES = 3;

export type MealRecognizedImage = {
  index?: number;
  ok?: boolean;
  date?: string | null;
  amount?: number;
  currency?: string;
  merchant?: string;
  error?: string;
};

export type MealRecognizedPayload = {
  ok?: boolean;
  date?: string;
  amount?: number;
  currency?: string;
  merchant?: string;
  image_url?: string;
  image_urls?: string[];
  image_count?: number;
  amounts?: number[];
  pending_review?: boolean;
  review_note?: string;
  images?: MealRecognizedImage[];
  error?: string;
};

export type MealSavedRecord = {
  employee_name?: string;
  meal_date?: string;
  amount?: number;
  currency?: string;
  merchant?: string;
  team?: string;
  pending_review?: boolean;
  review_note?: string;
  image_urls?: string[];
};

export function mealImageHref(url: string): string {
  return url.replace("/uploads/meal/", "/api/meal/image/");
}

export function appendMealFiles(fd: FormData, files: File[]): void {
  for (const f of files) {
    fd.append("files", f);
  }
}

/** 按文件内容 SHA-256 去重（与后端一致），避免同批重复选图。 */
export async function dedupeMealFiles(
  files: File[],
): Promise<{ files: File[]; skipped: number }> {
  const seen = new Set<string>();
  const out: File[] = [];
  let skipped = 0;
  for (const f of files) {
    const buf = await f.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    if (seen.has(hex)) {
      skipped += 1;
      continue;
    }
    seen.add(hex);
    out.push(f);
  }
  return { files: out.slice(0, MAX_MEAL_UPLOAD_IMAGES), skipped };
}
