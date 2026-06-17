"use client";

import { MealPendingBadge } from "@/components/MealRecognitionCard";
import { MealAmountText, MealSummaryBar } from "@/components/MealSummaryBar";
import { mealImageHref } from "@/lib/mealUpload";
import { MealMobileShell, mealTouchButtonClass } from "@/components/MealMobileShell";
import { parseJsonResponse } from "@/lib/apiJson";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

interface MealRecord {
  id: string;
  employee_id: string;
  employee_name: string;
  meal_date: string;
  amount: number;
  reimbursement_amount?: number;
  capped?: boolean;
  currency: string;
  merchant: string;
  image_url: string;
  source: string;
  updated_at: string;
  pending_review?: boolean;
  review_note?: string;
  image_urls?: string[];
  clock_in?: string;
  clock_out?: string;
}

interface Summary {
  total: number;
  total_bill?: number;
  days: number;
  avg: number;
  count: number;
  daily_cap?: number;
  capped_days?: number;
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function sourceLabel(source: string): string {
  if (source === "manual" || source === "feishu_manual") return "手动";
  if (source === "feishu_image") return "飞书截图";
  if (source === "feishu_web") return "网页上传";
  return "上传";
}

function HistoryInner() {
  const params = useSearchParams();
  const token = params.get("token") || "";
  const name = params.get("name") || "";
  const [month, setMonth] = useState(currentMonth());
  const [records, setRecords] = useState<MealRecord[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [employeeName, setEmployeeName] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const querySuffix = useMemo(() => {
    const q = new URLSearchParams();
    if (token) q.set("token", token);
    if (name) q.set("name", name);
    const s = q.toString();
    return s ? `?${s}` : "";
  }, [token, name]);

  const uploadHref = `/meal/upload${querySuffix}`;

  const refresh = useCallback(async () => {
    if (!token && !name.trim()) {
      setError("缺少身份参数，请从飞书「餐费」链接或上传页进入");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams();
      if (token) qs.set("token", token);
      if (name) qs.set("name", name);
      if (month) qs.set("month", month);
      const res = await fetch(`/api/meal/receipts/mine?${qs}`, {
        cache: "no-store",
      });
      const d = await parseJsonResponse<{
        ok?: boolean;
        error?: string;
        records?: MealRecord[];
        summary?: Summary;
        employee_name?: string;
        employee_id?: string;
      }>(res);
      if (!d.ok) {
        setError(d.error || "加载失败");
        setRecords([]);
        setSummary(null);
        return;
      }
      setRecords(d.records || []);
      setSummary(d.summary || null);
      setEmployeeName(d.employee_name || name);
      setEmployeeId(d.employee_id || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [token, name, month]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const monthInputClass =
    "flex-1 min-w-0 border rounded-lg px-3 py-2.5 text-base sm:text-sm bg-transparent min-h-11";

  return (
    <MealMobileShell maxWidth="lg">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-3 mb-4">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-lg font-bold leading-snug">📜 我的餐费记录</h1>
          {employeeName && (
            <p className="text-sm opacity-70 mt-1 truncate">{employeeName}</p>
          )}
        </div>
        <Link
          href={uploadHref}
          className="inline-flex items-center justify-center min-h-10 px-4 rounded-lg text-sm font-medium text-indigo-600 bg-indigo-500/10 sm:bg-transparent sm:px-0 sm:min-h-0 shrink-0 hover:underline"
        >
          去上传 →
        </Link>
      </header>

      <div className="flex flex-col sm:flex-row items-stretch gap-2 mb-4">
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className={monthInputClass}
          style={{ borderColor: "var(--separator-subtle)" }}
        />
        <button
          type="button"
          onClick={() => setMonth("")}
          className={`min-h-11 px-4 py-2.5 text-base sm:text-sm rounded-lg border touch-manipulation shrink-0 ${
            month === "" ? "bg-indigo-50 text-indigo-700 border-indigo-200" : ""
          }`}
          style={month === "" ? {} : { borderColor: "var(--separator-subtle)" }}
        >
          全部
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-500 mb-4 whitespace-pre-wrap break-words">
          {error}
        </p>
      )}

      {summary && !error && <MealSummaryBar summary={summary} />}

      <div
        className="rounded-xl border p-3 sm:p-4"
        style={{ borderColor: "var(--separator-subtle)" }}
      >
        {loading ? (
          <p className="text-sm opacity-50 animate-pulse py-2">加载中…</p>
        ) : records.length === 0 ? (
          <p className="text-sm opacity-50 leading-relaxed">
            本期暂无记录。
            <Link href={uploadHref} className="text-indigo-600 ml-1 inline-block py-2">
              去上传
            </Link>
          </p>
        ) : (
          <ul className="space-y-0 divide-y" style={{ borderColor: "var(--separator-subtle)" }}>
            {records.map((r) => {
              const imgs =
                r.image_urls?.length ? r.image_urls : r.image_url ? [r.image_url] : [];
              return (
                <li key={r.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-start sm:gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p
                          className={`font-medium text-base ${
                            r.pending_review ? "text-red-600" : ""
                          }`}
                        >
                          {r.meal_date}
                        </p>
                        {r.pending_review && <MealPendingBadge note={r.review_note} />}
                      </div>
                      <p className="text-xs opacity-60 mt-0.5 break-words">
                        {r.merchant || "—"} · {sourceLabel(r.source)}
                        {(r.clock_in || r.clock_out) && (
                          <span className="block mt-0.5">
                            考勤 {r.clock_in || "—"} — {r.clock_out || "—"}
                          </span>
                        )}
                      </p>
                      {imgs.length > 0 && (
                        <span className="inline-flex flex-wrap gap-3 mt-1">
                          {imgs.map((u, i) => (
                            <a
                              key={u}
                              href={mealImageHref(u)}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center min-h-10 text-sm text-indigo-500 hover:underline touch-manipulation"
                            >
                              凭证{i + 1}
                            </a>
                          ))}
                        </span>
                      )}
                    </div>
                    <div className="flex items-baseline justify-between sm:block sm:shrink-0 sm:text-right border-t pt-2 sm:border-0 sm:pt-0"
                      style={{ borderColor: "var(--separator-subtle)" }}
                    >
                      <span className="text-xs opacity-50 sm:hidden">报销金额</span>
                      <div>
                        <MealAmountText
                          amount={r.amount}
                          reimbursementAmount={r.reimbursement_amount}
                          capped={r.capped}
                        />
                        {r.capped && (
                          <p className="text-[10px] text-amber-600 mt-0.5 text-right sm:text-right">
                            日封顶
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {employeeId && records.length > 0 && (
        <button
          type="button"
          className={`mt-4 ${mealTouchButtonClass(false)}`}
          style={{ borderColor: "var(--separator-subtle)" }}
          onClick={() =>
            window.open(
              `/api/meal/export?scope=user&employee_id=${encodeURIComponent(employeeId)}&month=${encodeURIComponent(month)}`,
              "_blank",
            )
          }
        >
          导出 Excel
        </button>
      )}

      <p className="text-xs opacity-50 mt-6 text-center">
        <Link
          href={uploadHref}
          className="inline-flex items-center justify-center min-h-10 text-indigo-600 hover:underline touch-manipulation"
        >
          返回上传页
        </Link>
      </p>
    </MealMobileShell>
  );
}

export default function MealUploadHistoryPage() {
  return (
    <Suspense
      fallback={
        <div className="meal-mobile-page page-canvas min-h-[100dvh] flex items-center justify-center p-6 text-center opacity-60">
          加载中…
        </div>
      }
    >
      <HistoryInner />
    </Suspense>
  );
}
