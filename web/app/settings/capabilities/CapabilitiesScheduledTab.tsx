"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type ScheduleType = "cron" | "interval";
export type SchedulerContentType = "image" | "video" | "article" | "agent";

interface AgentJobConfig {
  multi_agent?: boolean;
  skills_context?: string;
  mcp_context?: string;
  online_search_mode?: string;
  provider_id?: string;
  model?: string;
  publish_content_type?: string;
}

interface SchedulerJobRow {
  id: string;
  name: string;
  content_type: SchedulerContentType;
  prompt: string;
  platforms: string[];
  schedule_type: ScheduleType;
  cron_expr: string;
  interval_hours: number;
  interval_minutes?: number | null;
  enabled: boolean;
  created_at?: string;
  last_run?: string | null;
  next_run?: string | null;
  run_count?: number;
  is_active?: boolean;
  agent_config?: AgentJobConfig;
}

interface ProviderInfo {
  id: string;
  name: string;
  default_model: string;
  models: string[];
}

interface ProviderCfg {
  available: ProviderInfo[];
  current: { id: string; model: string };
}

const PLATFORMS = [
  { id: "xiaohongshu", label: "小红书" },
  { id: "douyin", label: "抖音" },
  { id: "bilibili", label: "B站" },
  { id: "weibo", label: "微博" },
  { id: "youtube", label: "YouTube" },
];

const CONTENT_TYPE_META: Record<
  SchedulerContentType,
  { label: string; emoji: string; hint: string }
> = {
  image: {
    emoji: "🎨",
    label: "AI 图片定时发布",
    hint: "按提示词生成图片，可选发布渠道",
  },
  video: {
    emoji: "🎬",
    label: "AI 视频定时发布",
    hint: "按提示词生成视频，可选发布渠道",
  },
  article: {
    emoji: "✍️",
    label: "软文定时发布",
    hint: "生成图文软文文案，可选发布渠道",
  },
  agent: {
    emoji: "🤖",
    label: "Agent 编排任务",
    hint: "多 Agent / MCP / 工具由编排器自主选择，可选执行后发文",
  },
};

const CRON_PRESETS = [
  { label: "每天 9:00", value: "0 9 * * *" },
  { label: "每天 18:00", value: "0 18 * * *" },
  { label: "每 6 小时", value: "0 */6 * * *" },
  { label: "每周一 10:00", value: "0 10 * * 1" },
  { label: "每月 1 日 9:00", value: "0 9 1 * *" },
];

function jobToForm(job: SchedulerJobRow) {
  const ac = job.agent_config || {};
  return {
    name: job.name,
    content_type: job.content_type,
    prompt: job.prompt || "",
    platforms: [...(job.platforms || [])],
    schedule_type: job.schedule_type,
    cron_expr: job.cron_expr || "0 9 * * *",
    interval_hours: job.interval_hours ?? 6,
    interval_minutes_raw:
      job.interval_minutes != null && job.interval_minutes > 0
        ? String(job.interval_minutes)
        : "",
    intervalGranularity:
      job.interval_minutes != null && job.interval_minutes > 0
        ? ("minutes" as const)
        : ("hours" as const),
    enabled: job.enabled !== false,
    multi_agent: ac.multi_agent !== false,
    skills_context: ac.skills_context || "",
    mcp_context: ac.mcp_context || "",
    online_search_mode: ac.online_search_mode || "smart",
    provider_id: ac.provider_id || "",
    model: ac.model || "",
    publish_content_type:
      (ac.publish_content_type as "article" | "image" | "video") ||
      "article",
  };
}

export type ScheduledTaskFormValues = ReturnType<typeof emptyForm>;

export function emptyForm() {
  return {
    name: "",
    content_type: "agent" as SchedulerContentType,
    prompt: "",
    platforms: [] as string[],
    schedule_type: "cron" as ScheduleType,
    cron_expr: "0 9 * * *",
    interval_hours: 6,
    interval_minutes_raw: "",
    intervalGranularity: "hours" as "hours" | "minutes",
    enabled: true,
    multi_agent: true,
    skills_context: "",
    mcp_context: "",
    online_search_mode: "smart",
    provider_id: "",
    model: "",
    publish_content_type: "article" as "article" | "image" | "video",
  };
}

function buildPayload(form: ScheduledTaskFormValues): Record<string, unknown> {
  const base: Record<string, unknown> = {
    name: form.name.trim(),
    content_type: form.content_type,
    prompt: form.prompt.trim(),
    platforms: form.platforms,
    schedule_type: form.schedule_type,
    cron_expr: form.cron_expr.trim(),
    interval_hours: form.interval_hours,
    enabled: form.enabled,
  };

  if (form.schedule_type === "interval") {
    if (
      form.intervalGranularity === "minutes" &&
      form.interval_minutes_raw.trim()
    ) {
      const m = parseInt(form.interval_minutes_raw, 10);
      base.interval_minutes = Number.isFinite(m) && m > 0 ? m : null;
    } else base.interval_minutes = null;
  } else base.interval_minutes = null;

  if (form.content_type === "agent") {
    const ac: AgentJobConfig = {
      multi_agent: form.multi_agent,
      skills_context: form.skills_context.trim() || undefined,
      mcp_context: form.mcp_context.trim() || undefined,
      online_search_mode: form.online_search_mode,
      publish_content_type: form.publish_content_type,
    };
    const pid = form.provider_id.trim();
    const mid = form.model.trim();
    if (pid) ac.provider_id = pid;
    if (mid) ac.model = mid;
    base.agent_config = ac;
  } else {
    base.agent_config = {};
  }

  return base;
}

function JobEditorModal(props: {
  open: boolean;
  initialJob: SchedulerJobRow | null;
  providerCfg: ProviderCfg | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { open, initialJob, providerCfg, onClose, onSaved } = props;
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(initialJob ? jobToForm(initialJob) : emptyForm());
  }, [open, initialJob]);

  const modelChoices = useMemo(() => {
    if (!providerCfg) return [];
    const pid =
      form.provider_id.trim() ||
      providerCfg.current?.id ||
      providerCfg.available[0]?.id;
    const p = providerCfg.available.find((x) => x.id === pid);
    return p?.models || [];
  }, [form.provider_id, providerCfg]);

  if (!open) return null;

  const togglePlatform = (id: string) =>
    setForm((f) => ({
      ...f,
      platforms: f.platforms.includes(id)
        ? f.platforms.filter((p) => p !== id)
        : [...f.platforms, id],
    }));

  const handleSave = async () => {
    if (!form.name.trim() || !form.prompt.trim()) {
      setError("请填写任务名称与提示 / 指令");
      return;
    }
    if (form.schedule_type === "interval") {
      if (form.intervalGranularity === "hours" && !(form.interval_hours > 0)) {
        setError("间隔小时数须大于 0");
        return;
      }
      if (
        form.intervalGranularity === "minutes" &&
        (!form.interval_minutes_raw.trim() ||
          parseInt(form.interval_minutes_raw, 10) <= 0)
      ) {
        setError("请填写有效的间隔分钟数");
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      const base = buildPayload(form);

      let res: Response;
      if (initialJob?.id) {
        res = await fetch(`/api/scheduler/${initialJob.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(base),
        });
      } else {
        res = await fetch("/api/scheduler", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(base),
        });
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        let msg = "保存失败";
        if (typeof data.detail === "string") {
          msg = data.detail;
        } else if (Array.isArray(data.detail)) {
          msg =
            data.detail
              .map((e: { msg?: string }) => e.msg || "")
              .filter(Boolean)
              .join("; ") || msg;
        } else if (typeof data.error === "string") {
          msg = data.error;
        }
        setError(msg);
        return;
      }
      await onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-labelledby="scheduled-modal-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] shadow-2xl"
      >
        <div className="flex items-start justify-between border-b border-[color:var(--separator-subtle)] px-5 py-4">
          <h2
            id="scheduled-modal-title"
            className="text-[15px] font-semibold text-[color:var(--foreground)]"
          >
            {initialJob ? "编辑定时任务" : "新建定时任务"}
          </h2>
          <button
            type="button"
            aria-label="关闭"
            className="-mr-1 rounded-lg px-2 py-1 text-[18px] leading-none text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)]"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="space-y-5 px-5 py-4">
          {/* 类别 */}
          <div>
            <label className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-[color:var(--label-secondary)]">
              任务类型
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(Object.keys(CONTENT_TYPE_META) as SchedulerContentType[]).map(
                (k) => {
                  const meta = CONTENT_TYPE_META[k];
                  const on = form.content_type === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, content_type: k }))}
                      className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                        on
                          ? "border-[color:var(--accent)] bg-[var(--nav-active-fill)] shadow-sm ring-1 ring-[color:rgba(255,149,0,0.18)]"
                          : "border-[color:var(--separator-subtle)] hover:border-[color:var(--separator)]"
                      }`}
                    >
                      <div className="text-[13px] font-semibold text-[color:var(--foreground)]">
                        <span className="mr-1">{meta.emoji}</span>
                        {meta.label}
                      </div>
                      <p className="mt-0.5 text-[11px] text-[color:var(--label-secondary)]">
                        {meta.hint}
                      </p>
                    </button>
                  );
                },
              )}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[13px] font-medium text-[color:var(--foreground)]">
              名称
            </label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-3 py-2 text-[13px] text-[color:var(--foreground)] outline-none focus:ring-2 focus:ring-[color:var(--accent)]"
              placeholder={
                form.content_type === "agent"
                  ? "例如：每日热点摘要发到小红书"
                  : "例如：每日早安插图"
              }
            />
          </div>

          <div className="space-y-1">
            <label className="text-[13px] font-medium text-[color:var(--foreground)]">
              {form.content_type === "agent"
                ? "要做什么（给 Agent 的完整指令）"
                : "生成提示词 / 主题"}
            </label>
            <textarea
              value={form.prompt}
              onChange={(e) =>
                setForm((f) => ({ ...f, prompt: e.target.value }))
              }
              rows={4}
              className="w-full resize-y rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-3 py-2 text-[13px] text-[color:var(--foreground)] outline-none focus:ring-2 focus:ring-[color:var(--accent)]"
              placeholder={
                form.content_type === "agent"
                  ? "说明目标、产出格式、可参考的事实来源；编排器会自动选用已启用技能 / 工具 / MCP。"
                  : "描述要生成的图片、视频画面或软文主题。"
              }
            />
          </div>

          {/* Agent-only */}
          {form.content_type === "agent" && (
            <div className="space-y-4 rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--label-secondary)]">
                Agent 与环境
              </p>
              <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[color:var(--foreground)]">
                <input
                  type="checkbox"
                  checked={form.multi_agent}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, multi_agent: e.target.checked }))
                  }
                  className="rounded border-[color:var(--separator)]"
                />
                启用多 Agent 编排（关掉则仅用 Media Agent）
              </label>

              <div className="space-y-1">
                <label className="text-[11px] text-[color:var(--label-secondary)]">
                  技能 / 能力倾向（可选）
                </label>
                <textarea
                  rows={2}
                  value={form.skills_context}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      skills_context: e.target.value,
                    }))
                  }
                  placeholder="示例：优先考虑文案 Agent，若需配图再调用图像工具。"
                  className="w-full rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-2 py-1.5 text-[12px] text-[color:var(--foreground)]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-[color:var(--label-secondary)]">
                  MCP / 工具使用提示（可选）
                </label>
                <textarea
                  rows={2}
                  value={form.mcp_context}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, mcp_context: e.target.value }))
                  }
                  placeholder="示例：可先 searchWeb 查证，再通过已配的 MCP 拉取数据源。"
                  className="w-full rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-2 py-1.5 text-[12px] text-[color:var(--foreground)]"
                />
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <label className="text-[11px] text-[color:var(--label-secondary)]">
                    联网查证
                  </label>
                  <select
                    value={form.online_search_mode}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        online_search_mode: e.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-2 py-2 text-[12px]"
                  >
                    <option value="smart">智能（与时效相关内容可搜）</option>
                    <option value="always">尽量查证</option>
                    <option value="off">关闭联网描述</option>
                  </select>
                </div>
                {form.platforms.length > 0 ? (
                  <div>
                    <label className="text-[11px] text-[color:var(--label-secondary)]">
                      发布后文案类型（connector）
                    </label>
                    <select
                      value={form.publish_content_type}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          publish_content_type: e.target.value as typeof f.publish_content_type,
                        }))
                      }
                      className="mt-1 w-full rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-2 py-2 text-[12px]"
                    >
                      <option value="article">article（图文）</option>
                      <option value="image">image</option>
                      <option value="video">video</option>
                    </select>
                  </div>
                ) : (
                  <p className="self-end text-[11px] text-[color:var(--label-secondary)]">
                    未选发布渠道时仅执行 Agent，不发文。
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-[11px] text-[color:var(--label-secondary)]">
                    LLM 供应商覆盖
                  </label>
                  <select
                    value={form.provider_id}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        provider_id: e.target.value,
                        model:
                          providerCfg?.available.find(
                            (x) => x.id === e.target.value,
                          )?.default_model || "",
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-2 py-2 text-[12px]"
                  >
                    <option value="">沿用 System 页的当前配置</option>
                    {(providerCfg?.available || []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name || p.id}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-[color:var(--label-secondary)]">
                    模型覆盖
                  </label>
                  <select
                    value={
                      form.provider_id.trim()
                        ? form.model
                        : "__default__"
                    }
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        model: e.target.value === "__default__" ? "" : e.target.value,
                      }))
                    }
                    disabled={!form.provider_id.trim()}
                    className="mt-1 w-full rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-2 py-2 text-[12px] disabled:opacity-50"
                  >
                    <option value="__default__">默认模型</option>
                    {(form.provider_id.trim() ? modelChoices : []).map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  {!form.provider_id.trim() ? (
                    <p className="mt-1 text-[10px] text-[color:var(--label-secondary)]">
                      请先选择供应商，或沿用系统默认。
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          )}

          {/* 调度 */}
          <div className="space-y-2">
            <label className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--label-secondary)]">
              触发方式
            </label>
            <div className="flex gap-2">
              {(
                [
                  ["cron", "Cron 表达式"],
                  ["interval", "固定间隔"],
                ] as const
              ).map(([v, lbl]) => {
                const on = form.schedule_type === v;
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() =>
                      setForm((f) => ({ ...f, schedule_type: v }))
                    }
                    className={`flex-1 rounded-xl border px-3 py-2 text-[12px] font-semibold ${
                      on
                        ? "border-[color:var(--accent)] bg-[var(--nav-active-fill)] text-[color:var(--accent)]"
                        : "border-[color:var(--separator-subtle)] text-[color:var(--foreground)]"
                    }`}
                  >
                    {lbl}
                  </button>
                );
              })}
            </div>

            {form.schedule_type === "cron" ? (
              <div className="space-y-2 pt-2">
                <input
                  value={form.cron_expr}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, cron_expr: e.target.value }))
                  }
                  className="font-mono w-full rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-3 py-2 text-[12px]"
                  placeholder="分 时 日 月 星期"
                />
                <div className="flex flex-wrap gap-1.5">
                  {CRON_PRESETS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() =>
                        setForm((f) => ({ ...f, cron_expr: c.value }))
                      }
                      className="rounded-lg bg-[var(--nav-active-fill)] px-2 py-1 text-[10px] text-[color:var(--foreground)] hover:opacity-90"
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-3 pt-2">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        intervalGranularity: "hours",
                      }))
                    }
                    className={`flex-1 rounded-xl border px-2 py-2 text-[11px] ${
                      form.intervalGranularity === "hours"
                        ? "border-[color:var(--accent)] bg-[var(--nav-active-fill)]"
                        : "border-[color:var(--separator-subtle)]"
                    }`}
                  >
                    按小时间隔
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        intervalGranularity: "minutes",
                      }))
                    }
                    className={`flex-1 rounded-xl border px-2 py-2 text-[11px] ${
                      form.intervalGranularity === "minutes"
                        ? "border-[color:var(--accent)] bg-[var(--nav-active-fill)]"
                        : "border-[color:var(--separator-subtle)]"
                    }`}
                  >
                    按分钟间隔
                  </button>
                </div>
                {form.intervalGranularity === "hours" ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-[color:var(--label-secondary)]">
                      每
                    </span>
                    <input
                      type="number"
                      min={1}
                      value={form.interval_hours}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          interval_hours: Math.max(
                            1,
                            parseInt(e.target.value || "6", 10) || 1,
                          ),
                        }))
                      }
                      className="w-24 rounded-lg border px-2 py-1 text-[13px]"
                    />
                    <span className="text-[12px]">小时执行一次</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-[color:var(--label-secondary)]">
                      每
                    </span>
                    <input
                      type="number"
                      min={1}
                      value={form.interval_minutes_raw}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          interval_minutes_raw: e.target.value,
                        }))
                      }
                      className="w-24 rounded-lg border px-2 py-1 text-[13px]"
                      placeholder="如 30"
                    />
                    <span className="text-[12px]">分钟</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 渠道 */}
          <div>
            <label className="mb-2 block text-[13px] font-medium text-[color:var(--foreground)]">
              发布渠道（可选）
              {form.content_type === "agent"
                ? " — 勾选后可将 Agent 最终输出尝试同步到平台"
                : ""}
            </label>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map((p) => {
                const on = form.platforms.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => togglePlatform(p.id)}
                    className={`rounded-full border px-3 py-1 text-[11px] ${
                      on
                        ? "border-[color:var(--accent)] bg-[var(--nav-active-fill)] text-[color:var(--accent)]"
                        : "border-[color:var(--separator-subtle)]"
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) =>
                setForm((f) => ({ ...f, enabled: e.target.checked }))
              }
              className="rounded"
            />
            创建后立即启用
          </label>

          {error ? (
            <p className="rounded-lg bg-[color:rgba(255,59,48,0.08)] px-3 py-2 text-[12px] text-[color:var(--foreground)]">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-[color:var(--separator-subtle)] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border px-4 py-2 text-[13px]"
          >
            取消
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="rounded-xl bg-[color:var(--accent)] px-4 py-2 text-[13px] font-semibold text-white hover:opacity-92 disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

function scheduleSummary(job: SchedulerJobRow) {
  if (job.schedule_type === "cron") {
    return job.cron_expr || "cron";
  }
  if (job.interval_minutes != null && job.interval_minutes > 0) {
    return `每 ${job.interval_minutes} 分钟`;
  }
  return `每 ${job.interval_hours ?? 6} 小时`;
}

export default function CapabilitiesScheduledTab() {
  const [jobs, setJobs] = useState<SchedulerJobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editJob, setEditJob] = useState<SchedulerJobRow | null>(null);
  const [providerCfg, setProviderCfg] = useState<ProviderCfg | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/scheduler");
      const data = await res.json();
      setJobs(data.jobs || []);
    } catch {
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!modalOpen) return;
    fetch("/api/config/provider")
      .then((r) => r.json())
      .then(setProviderCfg)
      .catch(() => setProviderCfg(null));
  }, [modalOpen]);

  const openNew = () => {
    setEditJob(null);
    setModalOpen(true);
  };

  const openEdit = (j: SchedulerJobRow) => {
    setEditJob(j);
    setModalOpen(true);
  };

  const runNow = async (jobId: string) => {
    setRunning(jobId);
    try {
      await fetch(`/api/scheduler/${jobId}`, { method: "POST" });
      await load();
    } finally {
      setRunning(null);
    }
  };

  const deleteJob = async (jobId: string) => {
    if (!confirm("确认删除此定时任务？")) return;
    await fetch(`/api/scheduler/${jobId}`, { method: "DELETE" });
    setJobs((prev) => prev.filter((j) => j.id !== jobId));
  };

  const toggleJob = async (job: SchedulerJobRow) => {
    await fetch(`/api/scheduler/${job.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !job.enabled }),
    });
    setJobs((prev) =>
      prev.map((j) =>
        j.id === job.id ? { ...j, enabled: !j.enabled } : j,
      ),
    );
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-[color:var(--accent)] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <JobEditorModal
        open={modalOpen}
        initialJob={editJob}
        providerCfg={providerCfg}
        onClose={() => {
          setModalOpen(false);
          setEditJob(null);
        }}
        onSaved={load}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[13px] text-[color:var(--label-secondary)]">
            共 {jobs.length} 个任务，{jobs.filter((j) => j.enabled).length}{" "}
            个启用中
          </p>
          <p className="mt-1 text-[11px] text-[color:var(--label-secondary)]">
            在此创建「Agent / 多媒体发布」定时任务；
            <Link
              href="/scheduler"
              className="font-medium text-[color:var(--accent)] hover:underline"
            >
              完整定时发布工作台
            </Link>
            仍可使用（列表中的发布类任务也会在下方展示）。
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={openNew}
            className="rounded-xl bg-[color:var(--accent)] px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition-opacity hover:opacity-92"
          >
            + 新建任务
          </button>
        </div>
      </div>

      {jobs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[color:var(--separator-subtle)] py-16 text-center">
          <p className="text-sm text-[color:var(--label-secondary)]">
            暂无定时任务
          </p>
          <button
            type="button"
            onClick={openNew}
            className="mt-3 text-sm font-medium text-[color:var(--accent)] hover:underline"
          >
            在此新建 →
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => {
            const ct = job.content_type as SchedulerContentType;
            const meta = CONTENT_TYPE_META[ct];
            const emoji = meta?.emoji || "⚙️";
            const isRunning = running === job.id;
            const platStr =
              Array.isArray(job.platforms) && job.platforms.length
                ? job.platforms.join("、")
                : null;

            const ac = job.agent_config || {};
            const modelHint =
              ct === "agent" &&
              ((ac.provider_id && String(ac.provider_id)) ||
                (ac.model && String(ac.model))) ? (
                <span className="rounded-md bg-[var(--nav-active-fill)] px-1.5 py-0.5 font-mono text-[10px]">
                  {ac.provider_id ? `${ac.provider_id}` : "sys"}
                  {ac.model ? ` · ${ac.model}` : ""}
                </span>
              ) : null;

            return (
              <div
                key={job.id}
                className={`flex items-center gap-4 rounded-2xl border p-4 transition-shadow ${
                  job.enabled
                    ? "border-[color:var(--separator-subtle)] bg-[var(--card-bg)] shadow-sm"
                    : "border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] opacity-75"
                }`}
              >
                <span className="text-2xl">{emoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-[color:var(--foreground)]">
                    {job.name}{" "}
                    <span className="font-normal text-[color:var(--label-secondary)]">
                      （{meta?.label ?? job.content_type}）
                    </span>
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[color:var(--label-secondary)]">
                    <span className="rounded-md bg-[var(--nav-active-fill)] px-1.5 py-0.5 font-mono">
                      {scheduleSummary(job)}
                    </span>
                    {modelHint}
                    {platStr ? <span>平台: {platStr}</span> : null}
                    {job.next_run ? (
                      <span title={job.next_run}>
                        下次:{" "}
                        {(() => {
                          try {
                            return new Date(job.next_run!).toLocaleString(
                              "zh-CN",
                              {
                                month: "2-digit",
                                day: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              },
                            );
                          } catch {
                            return job.next_run;
                          }
                        })()}
                      </span>
                    ) : null}
                    {job.last_run ? (
                      <span>
                        上次:{" "}
                        {new Date(job.last_run).toLocaleString("zh-CN", {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="rounded-xl border border-[color:var(--separator-subtle)] px-3 py-1.5 text-[11px]"
                    onClick={() => openEdit(job)}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={job.enabled}
                    onClick={() => toggleJob(job)}
                    aria-label={job.enabled ? "禁用" : "启用"}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                      job.enabled
                        ? "bg-[color:var(--accent)]"
                        : "bg-[color:var(--separator-subtle)]"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform duration-200 ${
                        job.enabled ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                  <button
                    type="button"
                    disabled={isRunning}
                    onClick={() => runNow(job.id)}
                    className="rounded-xl border border-[color:var(--accent)] bg-[var(--nav-active-fill)] px-3 py-1.5 text-[11px] font-semibold text-[color:var(--accent)] hover:opacity-90 disabled:opacity-50"
                  >
                    {isRunning ? "执行中…" : "立即执行"}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteJob(job.id)}
                    className="rounded-xl border border-[color:rgba(255,59,48,0.35)] bg-[color:rgba(255,59,48,0.06)] px-2 py-1.5 text-[11px] text-[color:var(--foreground)] hover:bg-[color:rgba(255,59,48,0.1)]"
                  >
                    删除
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
