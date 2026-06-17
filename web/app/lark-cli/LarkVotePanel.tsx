"use client";

import { parseJsonResponse } from "@/lib/apiJson";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type VoteTemplate = {
  id: string;
  name: string;
  emoji: string;
  description: string;
  mode: "single" | "multi";
  anonymous?: boolean;
  max_choices?: number;
  options: { id: string; label: string }[];
};

type FeishuChat = { chat_id: string; name: string };

type PollOption = { id: string; label: string };

type PollSummary = {
  id: string;
  title: string;
  template_id: string;
  status: string;
  mode: string;
  anonymous: boolean;
  chat_id?: string;
  chat_name?: string;
  created_at?: string;
  sent_at?: string;
  closed_at?: string;
  total_voters: number;
  total_votes: number;
  message_id?: string;
};

type StatRow = {
  option_id: string;
  label: string;
  count: number;
  percent: number;
};

type StatsPayload = {
  ok?: boolean;
  error?: string;
  poll?: PollSummary;
  stats?: {
    total_voters: number;
    total_votes: number;
    by_option: StatRow[];
    leader?: StatRow | null;
    participation_hint?: string;
  };
  analysis?: {
    summary: string;
    insights: string[];
  };
};

const CONTENT_CLASS = "mx-auto w-full max-w-7xl";

type SetupStep = {
  id: string;
  title: string;
  done: boolean;
  hint: string;
  action?: string | null;
};

type VoteSetup = {
  ok?: boolean;
  configured?: boolean;
  lark_cli_configured?: boolean;
  lark_cli_app_id?: string;
  ws_connected?: boolean;
  connection_mode?: string;
  ws_error?: string;
  ready_to_send?: boolean;
  ready_for_callbacks?: boolean;
  card_callback_error_hint?: string;
  webhook_url?: string;
  webhook_url_frontend?: string;
  lark_cli_page?: string;
  developer_console_url?: string;
  developer_event_url?: string;
  steps?: SetupStep[];
  callback_modes?: {
    id: string;
    name: string;
    description: string;
    active: boolean;
  }[];
};

function apiError(data: Record<string, unknown>, fallback: string): string {
  const detail = data.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail) && detail.length) {
    return detail.map((d) => String(d)).join("; ");
  }
  return String(data.error || data.message || fallback);
}

function Section({
  step,
  title,
  hint,
  children,
}: {
  step: number;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-100 bg-white p-4 sm:p-5 lg:p-6">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
          {step}
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
          {hint ? (
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{hint}</p>
          ) : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function BarChart({ rows }: { rows: StatRow[] }) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.option_id}>
          <div className="mb-1 flex items-center justify-between gap-2 text-sm">
            <span className="truncate font-medium text-slate-800">{row.label}</span>
            <span className="shrink-0 tabular-nums text-slate-500">
              {row.count} 票 · {row.percent}%
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-500"
              style={{ width: `${Math.max((row.count / max) * 100, row.count > 0 ? 4 : 0)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function LarkVotePanel() {
  const [templates, setTemplates] = useState<VoteTemplate[]>([]);
  const [chats, setChats] = useState<FeishuChat[]>([]);
  const [history, setHistory] = useState<PollSummary[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("single_choice");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [options, setOptions] = useState<PollOption[]>([]);
  const [mode, setMode] = useState<"single" | "multi">("single");
  const [anonymous, setAnonymous] = useState(false);
  const [maxChoices, setMaxChoices] = useState(2);
  const [deadline, setDeadline] = useState("");
  const [chatId, setChatId] = useState("");
  const [activePollId, setActivePollId] = useState<string | null>(null);
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [setup, setSetup] = useState<VoteSetup | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId),
    [templates, selectedTemplateId],
  );

  const applyTemplate = useCallback((tpl: VoteTemplate) => {
    setSelectedTemplateId(tpl.id);
    setMode(tpl.mode);
    setAnonymous(Boolean(tpl.anonymous));
    setMaxChoices(tpl.max_choices || 2);
    setOptions(tpl.options.map((o) => ({ ...o })));
    if (!title.trim()) {
      setTitle(tpl.name);
    }
  }, [title]);

  const loadTemplates = useCallback(async () => {
    const res = await fetch("/api/feishu/votes/templates");
    const data = await parseJsonResponse<{ templates?: VoteTemplate[] }>(res);
    const list = data.templates || [];
    setTemplates(list);
    if (list.length && !list.find((t) => t.id === selectedTemplateId)) {
      applyTemplate(list[0]);
    }
  }, [applyTemplate, selectedTemplateId]);

  const loadChats = useCallback(async () => {
    const res = await fetch("/api/meal/feishu/chats");
    const data = await parseJsonResponse<{ chats?: FeishuChat[]; error?: string }>(res);
    setChats(data.chats || []);
    if (data.error && !data.chats?.length) {
      setError(data.error);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    const res = await fetch("/api/feishu/votes?limit=30");
    const data = await parseJsonResponse<{ polls?: PollSummary[] }>(res);
    setHistory(data.polls || []);
  }, []);

  const loadStats = useCallback(async (pollId: string) => {
    const res = await fetch(`/api/feishu/votes/${pollId}/stats`);
    const data = await parseJsonResponse<StatsPayload>(res);
    if (data.ok) {
      setStats(data);
    }
  }, []);

  const loadSetup = useCallback(async () => {
    const res = await fetch("/api/feishu/votes/setup");
    const data = await parseJsonResponse<VoteSetup>(res);
    if (data.ok !== false) {
      setSetup(data);
    }
  }, []);

  const handleConnectFeishu = async () => {
    setConnecting(true);
    setError("");
    try {
      await fetch("/api/meal/feishu/sync-lark-cli", { method: "POST" });
      const res = await fetch("/api/meal/feishu/connect", { method: "POST" });
      const data = await parseJsonResponse<{
        ok?: boolean;
        message?: string;
        connected?: boolean;
      }>(res);
      if (!data.ok && !data.connected) {
        throw new Error(data.message || "连接失败");
      }
      setSuccess(data.message || "飞书事件订阅已启动，可接收投票回调");
      await loadSetup();
      await loadChats();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "连接飞书失败");
    } finally {
      setConnecting(false);
    }
  };

  const copyWebhook = async () => {
    const url = setup?.webhook_url || setup?.webhook_url_frontend;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedWebhook(true);
      setTimeout(() => setCopiedWebhook(false), 2000);
    } catch {
      setError("复制失败，请手动复制回调地址");
    }
  };

  useEffect(() => {
    void loadTemplates();
    void loadChats();
    void loadHistory();
    void loadSetup();
  }, [loadTemplates, loadChats, loadHistory, loadSetup]);

  useEffect(() => {
    const timer = setInterval(() => {
      void loadSetup();
    }, 8000);
    return () => clearInterval(timer);
  }, [loadSetup]);

  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (!activePollId) return;
    void loadStats(activePollId);
    pollRef.current = setInterval(() => {
      void loadStats(activePollId);
    }, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [activePollId, loadStats]);

  const updateOption = (index: number, label: string) => {
    setOptions((prev) =>
      prev.map((o, i) => (i === index ? { ...o, label } : o)),
    );
  };

  const addOption = () => {
    setOptions((prev) => [
      ...prev,
      { id: `opt${prev.length + 1}`, label: `选项 ${prev.length + 1}` },
    ]);
  };

  const removeOption = (index: number) => {
    setOptions((prev) => (prev.length <= 2 ? prev : prev.filter((_, i) => i !== index)));
  };

  const handleCreateAndSend = async () => {
    setError("");
    setSuccess("");
    if (!title.trim()) {
      setError("请填写投票标题");
      return;
    }
    if (!chatId) {
      setError("请选择目标群聊");
      return;
    }
    const validOptions = options.filter((o) => o.label.trim());
    if (validOptions.length < 2) {
      setError("至少需要 2 个有效选项");
      return;
    }

    setLoading(true);
    setSending(true);
    try {
      const chatName = chats.find((c) => c.chat_id === chatId)?.name || "";
      const createRes = await fetch("/api/feishu/votes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_id: selectedTemplateId,
          title: title.trim(),
          description: description.trim(),
          chat_id: chatId,
          chat_name: chatName,
          mode,
          anonymous,
          max_choices: mode === "multi" ? maxChoices : 1,
          deadline: deadline || null,
          options: validOptions.map((o, i) => ({
            id: o.id || `opt${i + 1}`,
            label: o.label.trim(),
          })),
        }),
      });
      const created = await parseJsonResponse<Record<string, unknown>>(createRes);
      if (!created.ok || !(created.poll as PollSummary | undefined)?.id) {
        throw new Error(apiError(created, "创建投票失败"));
      }
      const pollId = (created.poll as PollSummary).id;

      const sendRes = await fetch(`/api/feishu/votes/${pollId}/send`, {
        method: "POST",
      });
      const sent = await parseJsonResponse<Record<string, unknown>>(sendRes);
      if (!sent.ok) {
        throw new Error(apiError(sent, "发送到飞书失败"));
      }

      setActivePollId(pollId);
      setSuccess(`已发送到群「${chatName || chatId}」，群成员点击卡片即可投票`);
      void loadHistory();
      void loadStats(pollId);
      void loadSetup();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setLoading(false);
      setSending(false);
    }
  };

  const handleClosePoll = async () => {
    if (!activePollId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/feishu/votes/${activePollId}/close`, {
        method: "POST",
      });
      const data = await parseJsonResponse<{ ok?: boolean; error?: string }>(res);
      if (!data.ok) throw new Error(data.error || "结束失败");
      setSuccess("投票已结束");
      void loadStats(activePollId);
      void loadHistory();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "结束失败");
    } finally {
      setLoading(false);
    }
  };

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      draft: "bg-slate-100 text-slate-600",
      active: "bg-emerald-100 text-emerald-800",
      closed: "bg-rose-100 text-rose-700",
    };
    const label: Record<string, string> = {
      draft: "草稿",
      active: "进行中",
      closed: "已结束",
    };
    return (
      <span
        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${map[status] || map.draft}`}
      >
        {label[status] || status}
      </span>
    );
  };

  return (
    <div className={`${CONTENT_CLASS} flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-6`}>
      <header>
        <h2 className="text-lg font-semibold text-slate-900">飞书投票</h2>
        <p className="mt-1 text-xs text-slate-500">
          选择模版、配置选项后发送到群聊；群成员在飞书卡片上点击投票，此处实时统计与分析。
        </p>
      </header>

      {(error || success) && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            error
              ? "border border-rose-200 bg-rose-50 text-rose-800"
              : "border border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          {error || success}
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">接入检查</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              发送卡片只需 ①⑥；点击投票按钮还需在飞书开发者后台完成 ②–⑤
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={connecting}
              onClick={() => void handleConnectFeishu()}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {connecting ? "连接中…" : "一键连接飞书"}
            </button>
            <a
              href={setup?.developer_event_url || setup?.developer_console_url || "https://open.feishu.cn/app"}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-800 hover:bg-blue-100"
            >
              打开飞书开发者后台
            </a>
            <a
              href="/lark-cli"
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              连接飞书
            </a>
          </div>
        </div>

        {!setup?.ready_for_callbacks && (
          <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-900">
            <p className="font-semibold">点击投票若提示 Card callback isn&apos;t configured</p>
            <p className="mt-1 leading-relaxed text-rose-800">
              {setup?.card_callback_error_hint ||
                "请在飞书开发者后台完成下方 ②③④⑤，并发布应用版本后重试。"}
            </p>
          </div>
        )}

        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          <span
            className={`rounded-full px-2.5 py-1 font-medium ${
              setup?.ready_to_send
                ? "bg-emerald-100 text-emerald-800"
                : "bg-amber-100 text-amber-800"
            }`}
          >
            发送：{setup?.ready_to_send ? "就绪" : "未就绪"}
          </span>
          <span
            className={`rounded-full px-2.5 py-1 font-medium ${
              setup?.ready_for_callbacks
                ? "bg-emerald-100 text-emerald-800"
                : "bg-amber-100 text-amber-800"
            }`}
          >
            回调：{setup?.ready_for_callbacks ? "已订阅" : "未订阅"}
          </span>
          {setup?.connection_mode ? (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">
              {setup.connection_mode}
            </span>
          ) : null}
        </div>

        <ol className="space-y-2">
          {(setup?.steps || []).map((step, idx) => (
            <li
              key={step.id}
              className={`flex gap-3 rounded-lg border px-3 py-2 text-sm ${
                step.done
                  ? "border-emerald-100 bg-emerald-50/40"
                  : "border-slate-100 bg-slate-50/50"
              }`}
            >
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  step.done ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-600"
                }`}
              >
                {step.done ? "✓" : idx + 1}
              </span>
              <div className="min-w-0">
                <p className="font-medium text-slate-800">{step.title}</p>
                <p className="mt-0.5 text-xs text-slate-500">{step.hint}</p>
              </div>
            </li>
          ))}
        </ol>

        {setup?.ws_error ? (
          <p className="mt-3 text-xs text-rose-600">连接错误：{setup.ws_error}</p>
        ) : null}
      </section>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Section step={1} title="选择模版" hint="常用场景一键套用，可再自定义选项">
            <div className="grid gap-2 sm:grid-cols-2">
              {templates.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => applyTemplate(tpl)}
                  className={`rounded-xl border p-3 text-left transition-all ${
                    selectedTemplateId === tpl.id
                      ? "border-blue-300 bg-blue-50 ring-1 ring-blue-200"
                      : "border-slate-100 bg-slate-50/50 hover:border-slate-200"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{tpl.emoji}</span>
                    <span className="text-sm font-semibold text-slate-900">{tpl.name}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500 line-clamp-2">{tpl.description}</p>
                </button>
              ))}
            </div>
          </Section>

          <Section step={2} title="配置投票" hint="标题、选项、规则与目标群">
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">标题</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="例如：本周团建地点投票"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">说明（可选）</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="补充背景、规则说明…"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200"
                />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-600">投票选项</label>
                  <button
                    type="button"
                    onClick={addOption}
                    className="text-xs font-medium text-blue-600 hover:text-blue-800"
                  >
                    + 添加选项
                  </button>
                </div>
                <div className="space-y-2">
                  {options.map((opt, i) => (
                    <div key={opt.id + i} className="flex gap-2">
                      <input
                        value={opt.label}
                        onChange={(e) => updateOption(i, e.target.value)}
                        className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
                      />
                      <button
                        type="button"
                        onClick={() => removeOption(i)}
                        disabled={options.length <= 2}
                        className="rounded-lg px-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={mode === "single"}
                    onChange={() => setMode("single")}
                  />
                  单选
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={mode === "multi"}
                    onChange={() => setMode("multi")}
                  />
                  多选
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={anonymous}
                    onChange={(e) => setAnonymous(e.target.checked)}
                  />
                  匿名投票
                </label>
                {mode === "multi" && (
                  <label className="flex items-center gap-2">
                    最多选
                    <input
                      type="number"
                      min={2}
                      max={10}
                      value={maxChoices}
                      onChange={(e) => setMaxChoices(Number(e.target.value) || 2)}
                      className="w-14 rounded border border-slate-200 px-2 py-1 text-center"
                    />
                    项
                  </label>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  截止时间（可选，展示用）
                </label>
                <input
                  type="datetime-local"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">目标群聊</label>
                <select
                  value={chatId}
                  onChange={(e) => setChatId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
                >
                  <option value="">选择群聊…</option>
                  {chats.map((c) => (
                    <option key={c.chat_id} value={c.chat_id}>
                      {c.name || c.chat_id}
                    </option>
                  ))}
                </select>
                {chats.length === 0 && (
                  <p className="mt-1 text-xs text-amber-600">
                    请先在「连接飞书」完成 lark-cli 授权，并将机器人拉入目标群
                  </p>
                )}
              </div>

              <button
                type="button"
                disabled={loading || sending}
                onClick={() => void handleCreateAndSend()}
                className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {sending ? "发送中…" : "创建并发送到飞书"}
              </button>
            </div>
          </Section>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <section className="rounded-xl border border-slate-100 bg-white p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-slate-900">实时统计</h4>
              {activePollId && stats?.poll ? statusBadge(stats.poll.status) : null}
            </div>

            {!activePollId ? (
              <p className="text-sm text-slate-500">
                发送投票后，此处每 3 秒自动刷新结果。
              </p>
            ) : stats?.stats ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-slate-50 p-3 text-center">
                    <p className="text-xs text-slate-500">参与人数</p>
                    <p className="text-2xl font-semibold tabular-nums text-slate-900">
                      {stats.stats.total_voters}
                    </p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3 text-center">
                    <p className="text-xs text-slate-500">总票数</p>
                    <p className="text-2xl font-semibold tabular-nums text-slate-900">
                      {stats.stats.total_votes}
                    </p>
                  </div>
                </div>

                <BarChart rows={stats.stats.by_option || []} />

                {stats.analysis && (
                  <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 p-3">
                    <p className="text-xs font-semibold text-indigo-900">分析摘要</p>
                    <p className="mt-1 text-xs leading-relaxed text-indigo-800">
                      {stats.analysis.summary}
                    </p>
                    {(stats.analysis.insights || []).length > 0 && (
                      <ul className="mt-2 space-y-1 text-xs text-indigo-700">
                        {stats.analysis.insights.map((ins, i) => (
                          <li key={i}>· {ins}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {stats.poll?.status === "active" && (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void handleClosePoll()}
                    className="w-full rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                  >
                    结束投票
                  </button>
                )}

                <p className="text-center text-xs text-slate-400">
                  {stats.stats.participation_hint} · 自动刷新中
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-500">加载统计中…</p>
            )}
          </section>

          <section className="rounded-xl border border-slate-100 bg-white p-4 sm:p-5">
            <h4 className="mb-3 text-sm font-semibold text-slate-900">历史投票</h4>
            {history.length === 0 ? (
              <p className="text-xs text-slate-500">暂无记录</p>
            ) : (
              <ul className="max-h-64 space-y-2 overflow-y-auto">
                {history.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setActivePollId(p.id);
                        void loadStats(p.id);
                      }}
                      className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                        activePollId === p.id
                          ? "border-blue-200 bg-blue-50"
                          : "border-slate-100 hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium text-slate-800">{p.title}</span>
                        {statusBadge(p.status)}
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {p.total_voters} 人 · {p.chat_name || "未发送"}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4 text-xs text-indigo-950">
            <p className="text-sm font-semibold">飞书开发者后台配置（点击投票必做）</p>
            <ol className="mt-2 list-decimal space-y-1.5 pl-4 leading-relaxed text-indigo-900">
              <li>
                <a
                  href={setup?.developer_console_url || "https://open.feishu.cn/app"}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-blue-700 underline"
                >
                  应用能力 → 机器人
                </a>
                ：开启 <strong>交互卡片（Interactive Card）</strong>
              </li>
              <li>
                <a
                  href={setup?.developer_event_url || setup?.developer_console_url || "https://open.feishu.cn/app"}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-blue-700 underline"
                >
                  开发配置 → 事件与回调
                </a>
                → 已订阅的回调 → 添加 <strong>卡片回传交互</strong>
              </li>
              <li>
                回调配置：选 <strong>使用长连接接收回调</strong>（本页保持连接），或填 HTTP 请求地址（见下）
              </li>
              <li>
                <strong>版本管理与发布</strong> → 创建版本并发布（否则配置不生效）
              </li>
            </ol>

            <div className="mt-3 rounded-lg border border-indigo-100 bg-white/80 p-3">
              <p className="font-semibold text-indigo-900">HTTP 回调地址（tunnel 部署时）</p>
              <p className="mt-1 text-indigo-800">任选其一填入「请求地址」：</p>
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded bg-slate-100 px-2 py-1.5 text-[11px] text-slate-700">
                    {setup?.webhook_url || "https://api.tech-huhao.tech/meal/feishu/webhook"}
                  </code>
                  <button
                    type="button"
                    onClick={() => void copyWebhook()}
                    className="shrink-0 rounded border border-slate-200 px-2 py-1 text-[11px] font-medium hover:bg-slate-50"
                  >
                    {copiedWebhook ? "已复制" : "复制"}
                  </button>
                </div>
                {setup?.webhook_url_frontend ? (
                  <code className="block truncate rounded bg-slate-100 px-2 py-1.5 text-[11px] text-slate-700">
                    {setup.webhook_url_frontend}
                  </code>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
