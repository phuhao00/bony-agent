"use client";

import type { MealRecognizedPayload, MealSavedRecord } from "@/lib/mealUpload";

export function MealPendingBadge({ note }: { note?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-red-500/15 text-red-600 px-2 py-0.5 text-xs font-semibold">
      待处理
      {note ? <span className="font-normal opacity-80">· {note}</span> : null}
    </span>
  );
}

export function MealRecognitionCard({
  title,
  recognized,
  record,
  variant,
}: {
  title: string;
  recognized?: MealRecognizedPayload | null;
  record?: MealSavedRecord | null;
  variant: "success" | "warning" | "error";
}) {
  const pending = Boolean(record?.pending_review ?? recognized?.pending_review);
  const border = pending
    ? "border-red-500/50 bg-red-500/5"
    : variant === "success"
      ? "border-emerald-500/40 bg-emerald-500/5"
      : variant === "warning"
        ? "border-amber-500/40 bg-amber-500/5"
        : "border-red-500/40 bg-red-500/5";

  const rows: { label: string; value: string; danger?: boolean }[] = [];

  if (recognized?.images?.length) {
    recognized.images.forEach((img) => {
      const parts: string[] = [];
      if (img.amount != null) parts.push(`¥${img.amount}`);
      if (img.date) parts.push(img.date);
      if (img.merchant) parts.push(img.merchant);
      if (!img.ok && img.error) parts.push(img.error);
      rows.push({
        label: `图${img.index ?? ""}`,
        value: parts.join(" · ") || "识别失败",
        danger: !img.ok,
      });
    });
  }

  if (recognized) {
    if (recognized.amounts?.length && recognized.amounts.length > 1) {
      rows.push({
        label: "分票金额",
        value: recognized.amounts.map((a) => `¥${a}`).join(" + "),
      });
    }
    if (recognized.amount != null)
      rows.push({
        label: "合计金额",
        value: `¥${recognized.amount} ${recognized.currency || "CNY"}`.trim(),
      });
    if (recognized.date)
      rows.push({
        label: "登记日期",
        value: recognized.date,
        danger: pending,
      });
    if (recognized.merchant)
      rows.push({ label: "商家", value: recognized.merchant });
  }

  if (record) {
    if (record.employee_name)
      rows.push({ label: "登记姓名", value: record.employee_name });
    if (record.meal_date)
      rows.push({
        label: "入库日期",
        value: record.meal_date,
        danger: record.pending_review,
      });
    if (record.amount != null)
      rows.push({
        label: "入库金额",
        value: `¥${record.amount} ${record.currency || "CNY"}`.trim(),
      });
    if (record.merchant) rows.push({ label: "入库商家", value: record.merchant });
  }

  if (rows.length === 0 && recognized?.error) {
    rows.push({ label: "说明", value: recognized.error });
  }

  const reviewNote = record?.review_note || recognized?.review_note;

  if (rows.length === 0 && !reviewNote) return null;

  return (
    <div className={`rounded-xl border p-3 sm:p-4 mt-4 text-sm ${border}`}>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <p className="font-medium">{title}</p>
        {pending && <MealPendingBadge note={reviewNote} />}
      </div>
      <dl className="space-y-2.5">
        {rows.map((r) => (
          <div
            key={`${r.label}-${r.value}`}
            className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4"
          >
            <dt className="opacity-60 text-xs sm:text-sm shrink-0">{r.label}</dt>
            <dd
              className={`font-medium break-words sm:text-right sm:max-w-[65%] ${
                r.danger ? "text-red-600" : ""
              }`}
            >
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
