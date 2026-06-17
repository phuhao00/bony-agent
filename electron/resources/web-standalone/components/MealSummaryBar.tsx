/** 餐费汇总条（日封顶 30：可报销合计 vs 票据合计） */

export interface MealSummary {
  total: number;
  total_bill?: number;
  days: number;
  avg: number;
  count: number;
  daily_cap?: number;
  capped_days?: number;
}

export function MealSummaryBar({ summary }: { summary: MealSummary }) {
  const cap = summary.daily_cap ?? 30;
  const bill = summary.total_bill ?? summary.total;
  const showBill = bill !== summary.total || (summary.capped_days ?? 0) > 0;

  const cards: { label: string; value: string; hint?: string }[] = [
    { label: "可报销合计", value: `¥${summary.total}` },
    ...(showBill ? [{ label: "票据合计", value: `¥${bill}` }] : []),
    { label: "报销天数", value: String(summary.days) },
    { label: "记录条数", value: String(summary.count) },
    { label: "日均报销", value: `¥${summary.avg}` },
    ...(summary.capped_days
      ? [{ label: "超标天数", value: String(summary.capped_days), hint: `日封顶 ¥${cap}` }]
      : [{ label: "日封顶", value: `¥${cap}` }]),
  ];

  return (
    <div
      className={`grid gap-2 sm:gap-3 mb-4 grid-cols-2 ${
        cards.length >= 5 ? "sm:grid-cols-3" : "sm:grid-cols-4"
      }`}
    >
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-xl border p-2.5 sm:p-3 min-w-0"
          style={{ borderColor: "var(--separator-subtle)" }}
        >
          <p className="text-base sm:text-lg font-bold truncate">{c.value}</p>
          <p className="text-[11px] sm:text-xs opacity-60 leading-tight">{c.label}</p>
          {c.hint && <p className="text-[10px] opacity-45 mt-0.5">{c.hint}</p>}
        </div>
      ))}
    </div>
  );
}

export function MealAmountText({
  amount,
  reimbursementAmount,
  capped,
}: {
  amount: number;
  reimbursementAmount?: number;
  capped?: boolean;
}) {
  const reimb = reimbursementAmount ?? amount;
  if (!capped && reimb === amount) {
    return <span className="font-semibold text-indigo-500">¥{amount}</span>;
  }
  return (
    <span className="font-semibold text-indigo-500">
      ¥{reimb}
      <span className="text-xs font-normal opacity-50 ml-1 line-through">¥{amount}</span>
    </span>
  );
}
