"use client";

import { MealAmountText, MealSummaryBar } from "@/components/MealSummaryBar";
import { MealPendingBadge } from "@/components/MealRecognitionCard";
import { MealMemberPicker, type MealMember } from "@/components/MealMemberPicker";
import {
  MAX_MEAL_UPLOAD_IMAGES,
  appendMealFiles,
  dedupeMealFiles,
  mealImageHref,
  type MealRecognizedPayload,
} from "@/lib/mealUpload";
import { useCallback, useEffect, useRef, useState } from "react";

// ── 类型 ──────────────────────────────────────────────
interface MealRecord {
  id: string;
  employee_id: string;
  employee_name: string;
  meal_date: string;
  amount: number;
  reimbursement_amount?: number;
  capped?: boolean;
  daily_cap?: number;
  currency: string;
  merchant: string;
  image_url: string;
  image_urls?: string[];
  source: string;
  updated_at: string;
  pending_review?: boolean;
  review_note?: string;
  clock_in?: string;
  clock_out?: string;
  attendance_note?: string;
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
interface UserStat {
  employee_id: string;
  employee_name: string;
  total: number;
  total_bill?: number;
  days: number;
  avg: number;
  capped_days?: number;
  daily_cap?: number;
}
interface DateStat {
  date: string;
  total: number;
  total_bill?: number;
  people: number;
  daily_cap?: number;
}
interface VisionCfg {
  provider: string;
  model: string;
  configured: boolean;
}
type Recognized = MealRecognizedPayload;
interface Employee {
  id: string;
  name: string;
}

const EMP_KEY = "meal:employee";

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── 员工身份（认证为 stub，先用本机记住的身份）──────────
function loadEmployee(): Employee | null {
  try {
    const raw = localStorage.getItem(EMP_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return null;
}

interface FeishuStatus {
  ok?: boolean;
  feishu_app_configured?: boolean;
  use_lark_cli?: boolean;
  connection_mode?: string;
  ws_connected?: boolean;
  ws_error?: string;
  feishu_app_id_prefix?: string;
  lark_cli_installed?: boolean;
  lark_cli_configured?: boolean;
  lark_cli_app_id_prefix?: string;
  lark_cli_page?: string;
  commands?: string[];
}

interface AuthTerminalLine {
  type: "stdout" | "stderr" | "info";
  text: string;
}

function FeishuIntegrationPanel({
  embedded = false,
  onFeishuReady,
}: {
  embedded?: boolean;
  onFeishuReady?: (ready: boolean) => void;
}) {
  const [st, setSt] = useState<FeishuStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [authRunning, setAuthRunning] = useState(false);
  const [authTerminal, setAuthTerminal] = useState<AuthTerminalLine[]>([]);
  const [authUrls, setAuthUrls] = useState<string[]>([]);
  const [showTerminal, setShowTerminal] = useState(false);

  const refresh = useCallback(() => {
    fetch("/api/meal/feishu/status", { cache: "no-store" })
      .then((r) => r.json())
      .then(setSt)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [refresh]);

  const runStreamingAuth = async (command: string) => {
    if (authRunning) return;
    setAuthRunning(true);
    setShowTerminal(true);
    setAuthTerminal([{ type: "info", text: `$ ${command}\n` }]);
    setAuthUrls([]);
    const urlRegex = /https?:\/\/[^\s"'\]）)>]+/g;

    try {
      const res = await fetch("/api/lark-cli/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command, timeoutMs: 180000 }),
      });
      if (!res.body) throw new Error("无法建立授权流");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const dataPart = line.replace(/^data:\s*/, "").trim();
          if (!dataPart) continue;
          try {
            const ev = JSON.parse(dataPart) as {
              type: string;
              text?: string;
            };
            if (ev.type === "stdout" || ev.type === "stderr") {
              const text = ev.text ?? "";
              const lineType = ev.type as "stdout" | "stderr";
              setAuthTerminal((prev) => [...prev, { type: lineType, text }]);
              const urls = text.match(urlRegex) ?? [];
              if (urls.length) {
                setAuthUrls((prev) => {
                  const next = [...prev];
                  for (const u of urls) {
                    if (!next.includes(u)) next.push(u);
                  }
                  return next;
                });
              }
            }
          } catch {
            /* ignore partial SSE */
          }
        }
      }
      setMsg("授权流程已结束，请点「同步并连接餐费机器人」");
      refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "授权失败");
    } finally {
      setAuthRunning(false);
    }
  };

  const syncAndConnect = async () => {
    setBusy(true);
    setMsg("");
    try {
      const syncRes = await fetch("/api/meal/feishu/sync-lark-cli", {
        method: "POST",
      });
      const syncData = await syncRes.json();
      if (!syncData.ok) {
        setMsg(syncData.message || syncData.error || "同步 lark-cli 失败");
        return;
      }
      const connRes = await fetch("/api/meal/feishu/connect", { method: "POST" });
      const connData = await connRes.json();
      setMsg(
        connData.message ||
          (connData.ok ? "餐费机器人已连接" : connData.error || "连接失败"),
      );
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await fetch("/api/meal/feishu/disconnect", { method: "POST" });
      setMsg("已断开监听");
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const larkReady = Boolean(st?.lark_cli_installed && st?.lark_cli_configured);
  const feishuReady = Boolean(larkReady && st?.ws_connected);

  useEffect(() => {
    onFeishuReady?.(feishuReady);
  }, [feishuReady, onFeishuReady]);

  return (
    <div className="card-surface rounded-2xl p-5 border border-indigo-200/40">
      <p className="text-sm font-semibold text-indigo-600">💬 飞书接入（lark-cli）</p>
      <p className="text-xs opacity-70 mt-1 mb-4">
        与「Lark CLI 助手」共用本机飞书授权，无需手填 App Secret。员工在飞书私聊/群@
        发截图或命令，数据自动进入下方统计。
      </p>

      <div className="flex flex-wrap gap-2 text-[11px] mb-3">
        <span
          className={`px-2 py-0.5 rounded-full ${st?.lark_cli_installed ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}
        >
          lark-cli {st?.lark_cli_installed ? "已安装" : "未检测到"}
        </span>
        <span
          className={`px-2 py-0.5 rounded-full ${larkReady ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}
        >
          应用 {larkReady ? (st?.lark_cli_app_id_prefix || "已绑定") : "未绑定"}
        </span>
        <span
          className={`px-2 py-0.5 rounded-full ${st?.ws_connected ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}
        >
          餐费监听 {st?.ws_connected ? "运行中" : "未连接"}
          {st?.connection_mode ? ` · ${st.connection_mode}` : ""}
        </span>
      </div>

      <ol className="text-xs opacity-75 list-decimal list-inside space-y-1 mb-4">
        <li>首次使用：点「初始化飞书应用」，在弹出页完成开放平台授权</li>
        <li>点「同步并连接餐费机器人」（凭证从 lark-cli 自动读取）</li>
        <li>在飞书开放平台为应用开通：接收消息、发消息、读用户、下载图片</li>
      </ol>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || authRunning}
          onClick={() => runStreamingAuth("lark-cli config init --new")}
          className="px-3 py-1.5 text-sm rounded-lg border disabled:opacity-50"
          style={{ borderColor: "var(--separator-subtle)" }}
        >
          {authRunning ? "授权进行中…" : "① 初始化飞书应用"}
        </button>
        <button
          type="button"
          disabled={busy || authRunning || !st?.lark_cli_installed}
          onClick={syncAndConnect}
          className="px-3 py-1.5 text-sm rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
        >
          ② 同步并连接餐费机器人
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={disconnect}
          className="px-3 py-1.5 text-sm rounded-lg border disabled:opacity-50"
          style={{ borderColor: "var(--separator-subtle)" }}
        >
          断开
        </button>
        {!embedded && st?.lark_cli_page && (
          <a
            href={st.lark_cli_page}
            className="px-3 py-1.5 text-sm rounded-lg border inline-flex items-center"
            style={{ borderColor: "var(--separator-subtle)" }}
          >
            打开飞书工作台
          </a>
        )}
      </div>

      {authUrls.length > 0 && (
        <div className="mt-3 flex flex-col gap-1">
          {authUrls.map((u) => (
            <a
              key={u}
              href={u}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-indigo-600 underline break-all"
            >
              在浏览器中打开飞书授权
            </a>
          ))}
        </div>
      )}

      {showTerminal && authTerminal.length > 1 && (
        <details className="mt-3">
          <summary className="text-xs cursor-pointer opacity-70">授权日志</summary>
          <pre
            className="mt-2 text-[10px] max-h-40 overflow-auto p-2 rounded-lg bg-black/5 whitespace-pre-wrap"
            style={{ color: "var(--foreground)" }}
          >
            {authTerminal.map((l, i) => (
              <span key={i}>{l.text}</span>
            ))}
          </pre>
        </details>
      )}

      {msg && <p className="text-xs mt-2">{msg}</p>}
      {st?.ws_error && (
        <p className="text-xs text-red-500 mt-2">连接错误：{st.ws_error}</p>
      )}
      {!st?.lark_cli_installed && (
        <p className="text-xs opacity-60 mt-3">
          请先安装：
          <code className="text-[11px] mx-1">npm install -g @larksuite/cli</code>
          ，并用 <code className="text-[11px]">./start_local.sh</code> 启动本站。
        </p>
      )}
      <p className="text-xs opacity-70 mt-2">
        命令：私聊发截图；<code className="text-[11px]">餐费</code>、
        <code className="text-[11px]">餐费记录</code>、
        <code className="text-[11px]">餐费统计</code>、
        <code className="text-[11px]">餐费补录 日期 金额</code>；群里需 @ 机器人。
      </p>
    </div>
  );
}

interface FeishuChatOption {
  chat_id: string;
  name: string;
}

interface ReminderCfg {
  enabled?: boolean;
  chat_id?: string;
  chat_name?: string;
  hour?: number;
  minute?: number;
  days?: string;
  extra_text?: string;
  upload_url?: string;
  next_run?: string | null;
}

function MealReminderPanel({
  onChatIdChange,
  feishuReady = false,
  compact = false,
}: {
  onChatIdChange?: (chatId: string) => void;
  feishuReady?: boolean;
  compact?: boolean;
}) {
  const [cfg, setCfg] = useState<ReminderCfg | null>(null);
  const [chats, setChats] = useState<FeishuChatOption[]>([]);
  const [chatsLoading, setChatsLoading] = useState(false);
  const [chatsError, setChatsError] = useState("");
  const [manualChatId, setManualChatId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const autoFilledRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cfgRef = useRef<ReminderCfg | null>(null);
  cfgRef.current = cfg;

  const refresh = useCallback(() => {
    fetch("/api/meal/reminder", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setCfg((prev) => ({ ...prev, ...d })))
      .catch(() => {});
  }, []);

  const loadChats = useCallback(async () => {
    setChatsLoading(true);
    setChatsError("");
    try {
      const res = await fetch("/api/meal/feishu/chats", { cache: "no-store" });
      const d = await res.json();
      const list = (d.chats || []) as FeishuChatOption[];
      setChats(list);
      if (!d.ok && d.error) {
        setChatsError(String(d.error));
      } else if (list.length === 0 && d.error) {
        setChatsError(String(d.error));
      } else if (list.length === 0) {
        setChatsError(
          "未找到群聊：请先把餐费机器人拉入目标群，再点「刷新群列表」",
        );
      }
      return list;
    } catch (e) {
      setChats([]);
      setChatsError(e instanceof Error ? e.message : "加载群列表失败");
      return undefined;
    } finally {
      setChatsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (feishuReady) void loadChats();
  }, [feishuReady, loadChats]);

  const persistCfg = useCallback(
    async (next: ReminderCfg, silent = false) => {
      if (!next.chat_id) return false;
      setBusy(true);
      try {
        const res = await fetch("/api/meal/reminder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reminder_enabled: Boolean(next.enabled),
            reminder_chat_id: next.chat_id,
            reminder_chat_name: next.chat_name || "",
            reminder_hour: next.hour ?? 9,
            reminder_minute: next.minute ?? 0,
            reminder_days: next.days ?? "mon-fri",
            reminder_extra_text: next.extra_text ?? "",
          }),
        });
        const d = await res.json();
        if (d.ok) {
          setCfg((c) => ({ ...c, ...d }));
          if (!silent) setMsg("✅ 已自动保存");
        } else if (!silent) {
          setMsg(d.error || "保存失败");
        }
        return Boolean(d.ok);
      } catch (e) {
        if (!silent) setMsg(e instanceof Error ? e.message : "保存失败");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const scheduleAutoSave = useCallback(
    (next: ReminderCfg) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        void persistCfg(next, true);
      }, 500);
    },
    [persistCfg],
  );

  const applyCfg = useCallback(
    (patch: Partial<ReminderCfg>) => {
      const prevChatId = cfgRef.current?.chat_id;
      const next = {
        enabled: true,
        hour: 9,
        minute: 0,
        days: "mon-fri",
        ...cfgRef.current,
        ...patch,
      } as ReminderCfg;
      setCfg(next);
      if (next.chat_id) {
        if (next.chat_id !== prevChatId) {
          onChatIdChange?.(next.chat_id);
        }
        scheduleAutoSave(next);
      }
    },
    [onChatIdChange, scheduleAutoSave],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [remRes, list] = await Promise.all([
        fetch("/api/meal/reminder", { cache: "no-store" }).then((r) => r.json()),
        loadChats(),
      ]);
      if (cancelled) return;
      const base: ReminderCfg = {
        enabled: true,
        hour: 9,
        minute: 0,
        days: "mon-fri",
        ...remRes,
      };
      const chatList = list || [];
      let chatId = base.chat_id || "";
      let chatName = base.chat_name || "";
      if (!chatId && chatList.length > 0) {
        const saved = chatList.find((c) => c.chat_id === remRes.chat_id);
        const pick = saved || chatList[0];
        chatId = pick.chat_id;
        chatName = pick.name;
        autoFilledRef.current = true;
      } else if (chatId && !chatName) {
        chatName = chatList.find((c) => c.chat_id === chatId)?.name || "";
      }
      const merged: ReminderCfg = { ...base, chat_id: chatId, chat_name: chatName };
      setCfg(merged);
      if (chatId) onChatIdChange?.(chatId);
      if (chatId && (!remRes.chat_id || autoFilledRef.current)) {
        await persistCfg(merged, true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadChats, onChatIdChange, persistCfg]);

  const sendNow = async () => {
    const chatId = cfg?.chat_id;
    if (!chatId) {
      setMsg("❌ 暂无可用群，请先将机器人拉入群聊");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      await persistCfg(
        {
          ...cfg,
          enabled: cfg?.enabled ?? true,
          chat_id: chatId,
          hour: cfg?.hour ?? 9,
          minute: cfg?.minute ?? 0,
          days: cfg?.days ?? "mon-fri",
        } as ReminderCfg,
        true,
      );
      const res = await fetch("/api/meal/reminder/send-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId }),
      });
      const d = await res.json();
      setMsg(d.ok ? "✅ 已发送到群聊" : d.error || d.detail || "发送失败");
    } finally {
      setBusy(false);
    }
  };

  const daysLabel =
    cfg?.days === "daily"
      ? "每天"
      : cfg?.days === "mon"
        ? "仅周一"
        : "工作日";

  const applyManualChatId = () => {
    const id = manualChatId.trim();
    if (!id.startsWith("oc_")) {
      setMsg("群 ID 应以 oc_ 开头");
      return;
    }
    applyCfg({ chat_id: id, chat_name: id });
    setMsg("✅ 已使用手动填写的群 ID");
  };

  return (
    <div
      className={`card-surface rounded-2xl p-5 md:p-6 border border-amber-200/50 ${compact ? "" : "mt-4"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-700">⏰ 群聊定时提醒</p>
          <p className="text-xs opacity-70 mt-1">
            选好群和时间即<strong>自动保存</strong>，无需再点保存。消息内含员工上传表单链接。
          </p>
        </div>
        <button
          type="button"
          disabled={chatsLoading || busy}
          onClick={() => void loadChats()}
          className="shrink-0 px-3 py-1.5 text-xs rounded-lg border hover:opacity-90 disabled:opacity-50"
          style={{ borderColor: "var(--separator-subtle)" }}
        >
          {chatsLoading ? "刷新中…" : "刷新群列表"}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end mb-3">
        <label className="text-xs opacity-70 flex flex-col gap-1 md:col-span-2">
          提醒群
          {chats.length > 0 ? (
            <select
              disabled={chatsLoading || busy}
              value={cfg?.chat_id ?? ""}
              onChange={(e) => {
                const id = e.target.value;
                const row = chats.find((c) => c.chat_id === id);
                applyCfg({ chat_id: id, chat_name: row?.name ?? "" });
              }}
              className="border rounded-lg px-3 py-2.5 text-sm bg-transparent w-full"
              style={{ borderColor: "var(--separator-subtle)" }}
            >
              {chats.map((c) => (
                <option key={c.chat_id} value={c.chat_id}>
                  {c.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="rounded-lg border px-3 py-2.5 text-sm opacity-80 bg-amber-50/50 dark:bg-amber-950/20">
              {chatsLoading
                ? "正在加载群聊列表…"
                : "暂无群聊：请先把机器人拉入群，再点右上角「刷新群列表」"}
            </div>
          )}
        </label>
        <label className="text-xs opacity-70 flex flex-col gap-1">
          发送时间
          <input
            type="time"
            step={60}
            disabled={busy}
            value={`${String(cfg?.hour ?? 9).padStart(2, "0")}:${String(cfg?.minute ?? 0).padStart(2, "0")}`}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              const [h, m] = v.split(":");
              applyCfg({
                hour: Math.min(23, Math.max(0, parseInt(h, 10) || 0)),
                minute: Math.min(59, Math.max(0, parseInt(m, 10) || 0)),
              });
            }}
            className="border rounded-lg px-3 py-2 text-sm bg-transparent w-[7.5rem]"
            style={{ borderColor: "var(--separator-subtle)" }}
          />
        </label>
        <label className="text-xs opacity-70 flex flex-col gap-1">
          重复
          <select
            disabled={busy}
            value={cfg?.days ?? "mon-fri"}
            onChange={(e) => applyCfg({ days: e.target.value })}
            className="border rounded-lg px-3 py-2 text-sm bg-transparent"
            style={{ borderColor: "var(--separator-subtle)" }}
          >
            <option value="mon-fri">工作日</option>
            <option value="daily">每天</option>
            <option value="mon">仅周一</option>
          </select>
        </label>
      </div>

      <label className="text-xs flex items-center gap-2 mb-3 cursor-pointer">
        <input
          type="checkbox"
          disabled={busy}
          checked={Boolean(cfg?.enabled ?? true)}
          onChange={(e) => applyCfg({ enabled: e.target.checked })}
        />
        按时自动发到群（修改后自动保存）
      </label>

      <button
        type="button"
        disabled={busy || !cfg?.chat_id || chatsLoading}
        onClick={sendNow}
        className="px-4 py-2 text-sm rounded-lg text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50"
      >
        立即发一条到群
      </button>

      {cfg?.chat_id && (
        <p className="text-[11px] opacity-65 mt-3">
          当前：{cfg.chat_name || cfg.chat_id} ·{" "}
          {String(cfg.hour ?? 9).padStart(2, "0")}:
          {String(cfg.minute ?? 0).padStart(2, "0")} · {daysLabel}
          {cfg.enabled ? " · 定时已开" : " · 定时已关"}
          {cfg.next_run ? ` · 下次 ${cfg.next_run}` : ""}
        </p>
      )}
      {cfg?.upload_url && (
        <p className="text-[11px] opacity-50 mt-1 break-all">
          表单：{cfg.upload_url}
        </p>
      )}
      {chatsError && (
        <p className="text-xs text-amber-800 dark:text-amber-200/90 mb-2 leading-relaxed">
          {chatsError}
        </p>
      )}
      {chats.length === 0 && !chatsLoading && (
        <div className="flex flex-col sm:flex-row gap-2 mb-3">
          <input
            type="text"
            value={manualChatId}
            onChange={(e) => setManualChatId(e.target.value)}
            placeholder="手动填写群 chat_id（oc_ 开头）"
            className="flex-1 border rounded-lg px-3 py-2 text-sm bg-transparent"
            style={{ borderColor: "var(--separator-subtle)" }}
          />
          <button
            type="button"
            disabled={busy || !manualChatId.trim()}
            onClick={applyManualChatId}
            className="px-3 py-2 text-sm rounded-lg border shrink-0 disabled:opacity-50"
            style={{ borderColor: "var(--separator-subtle)" }}
          >
            使用此群
          </button>
        </div>
      )}
      {msg && <p className="text-xs mt-2">{msg}</p>}
    </div>
  );
}

export function MealReceiptWorkbench({ embedded = false }: { embedded?: boolean }) {
  const shellClass = embedded ? "min-h-0 w-full" : "page-canvas p-6";
  const innerClass = embedded ? "max-w-none w-full" : "max-w-6xl mx-auto";
  const gateWidth = embedded ? "max-w-6xl w-full" : "max-w-3xl w-full";
  const [emp, setEmp] = useState<Employee | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [pickedMember, setPickedMember] = useState<MealMember | null>(null);
  const [reminderChatId, setReminderChatId] = useState("");
  const [feishuReady, setFeishuReady] = useState(false);
  const [tab, setTab] = useState<"mine" | "company">("mine");

  useEffect(() => {
    setEmp(loadEmployee());
  }, []);

  const saveEmployee = () => {
    const name = (pickedMember?.name || nameInput).trim();
    if (!name) return;
    const existing = loadEmployee();
    const id =
      pickedMember?.open_id ||
      (existing?.id?.startsWith("ou_") ? existing.id : "") ||
      `emp_${crypto.randomUUID()}`;
    const e: Employee = { id, name };
    localStorage.setItem(EMP_KEY, JSON.stringify(e));
    setEmp(e);
    setPickedMember(null);
  };

  if (!emp) {
    return (
      <div className={shellClass}>
        <div
          className={`${gateWidth} ${embedded ? "mx-auto px-2 py-4 lg:px-4" : "mx-auto mt-16"}`}
          style={{ color: "var(--foreground)" }}
        >
          <div className="card-surface rounded-2xl p-6 md:p-8 shadow-sm">
            <header className="mb-6">
              <h1 className="text-xl md:text-2xl font-bold mb-1">🧾 每日餐费票据</h1>
              <p className="text-sm opacity-70">
                先完成飞书连接并选择提醒群，再从群成员中选姓名；也可直接输入姓名进入。
              </p>
            </header>
            <div
              className={`grid gap-6 ${embedded ? "lg:grid-cols-[1.15fr_0.85fr]" : ""}`}
            >
              <section className="space-y-4 min-w-0">
                <FeishuIntegrationPanel
                  embedded={embedded}
                  onFeishuReady={setFeishuReady}
                />
                <MealReminderPanel
                  compact
                  feishuReady={feishuReady}
                  onChatIdChange={setReminderChatId}
                />
              </section>
              <section className="flex flex-col gap-4 min-w-0">
                <div className="card-surface rounded-2xl p-5 md:p-6 border border-indigo-200/30 flex-1">
                  <p className="text-sm font-semibold text-indigo-600 mb-3">
                    👤 选择你的身份
                  </p>
                  <MealMemberPicker
                    value={nameInput}
                    chatId={reminderChatId}
                    onChange={(n, m) => {
                      setNameInput(n);
                      setPickedMember(m);
                    }}
                    onSelectMember={(m) => setPickedMember(m)}
                    placeholder="搜索群成员姓名"
                  />
                  {!reminderChatId && (
                    <p className="text-xs text-amber-700 mt-3">
                      请先在左侧「群聊定时提醒」中选择提醒群
                    </p>
                  )}
                </div>
                <button
                  onClick={saveEmployee}
                  disabled={!nameInput.trim() && !pickedMember}
                  className="w-full px-4 py-3 rounded-xl text-white bg-indigo-600 hover:bg-indigo-700 text-sm font-medium disabled:opacity-50"
                >
                  进入
                </button>
              </section>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${shellClass} space-y-6 ${innerClass}`}>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">🧾 每日餐费票据</h1>
          <p className="text-sm opacity-70 mt-0.5">
            上传餐费截图自动识别日期/金额 · 每人每天一条 · 统计与导出
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="opacity-70">当前员工：</span>
          <span className="font-medium">{emp.name}</span>
          <button
            onClick={() => {
              setNameInput(emp.name);
              setPickedMember(
                emp.id.startsWith("ou_")
                  ? { open_id: emp.id, name: emp.name }
                  : null,
              );
              setEmp(null);
            }}
            className="px-2 py-1 rounded-lg border text-xs opacity-80 hover:opacity-100"
            style={{ borderColor: "var(--separator-subtle)" }}
          >
            切换
          </button>
        </div>
      </div>

      <div className={`grid gap-4 ${embedded ? "lg:grid-cols-2" : ""}`}>
        <FeishuIntegrationPanel
          embedded={embedded}
          onFeishuReady={setFeishuReady}
        />
        <MealReminderPanel
          feishuReady={feishuReady}
          onChatIdChange={setReminderChatId}
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {[
          { id: "mine", label: "我的餐费" },
          { id: "company", label: "全员统计" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as "mine" | "company")}
            className={`px-4 py-1.5 text-sm rounded-lg border ${
              tab === t.id
                ? "bg-indigo-600 text-white border-indigo-600"
                : "opacity-80 hover:opacity-100"
            }`}
            style={tab === t.id ? {} : { borderColor: "var(--separator-subtle)" }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "mine" ? <MineTab emp={emp} /> : <CompanyTab />}
    </div>
  );
}

// ════════════════════════════════════════════════════════
// 我的餐费
// ════════════════════════════════════════════════════════
function MineTab({ emp }: { emp: Employee }) {
  const [month, setMonth] = useState(currentMonth());
  const [records, setRecords] = useState<MealRecord[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [conflict, setConflict] = useState<{ existing: MealRecord; rec: Recognized } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 手动补录
  const [mDate, setMDate] = useState(todayStr());
  const [mAmount, setMAmount] = useState("");
  const [mMerchant, setMMerchant] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/meal/receipts?employee_id=${encodeURIComponent(emp.id)}&employee_name=${encodeURIComponent(emp.name)}&month=${encodeURIComponent(month)}`,
        { cache: "no-store" },
      );
      const d = await res.json();
      if (d.ok) {
        setRecords(d.records || []);
        setSummary(d.summary || null);
        setLoadError("");
      } else {
        setRecords([]);
        setSummary(null);
        setLoadError(d.error || "加载餐费记录失败");
      }
    } catch (e) {
      setRecords([]);
      setSummary(null);
      setLoadError(e instanceof Error ? e.message : "加载餐费记录失败");
    } finally {
      setLoading(false);
    }
  }, [emp.id, emp.name, month]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const doUpload = async (
    files: File[],
    overwrite: boolean,
    mealDateForOverwrite?: string,
  ) => {
    if (!files.length) return;
    const { files: uniqueFiles, skipped: clientSkipped } = await dedupeMealFiles(files);
    if (!uniqueFiles.length) {
      setMsg("❌ 所选图片内容重复，请换一张后重试");
      return;
    }
    setBusy(true);
    setMsg(`🔍 正在识别 ${uniqueFiles.length} 张票据…`);
    setConflict(null);
    try {
      const fd = new FormData();
      appendMealFiles(fd, uniqueFiles);
      fd.append("employee_id", emp.id);
      fd.append("employee_name", emp.name);
      fd.append("overwrite", overwrite ? "true" : "false");
      if (overwrite && mealDateForOverwrite) {
        fd.append("meal_date", mealDateForOverwrite);
      }
      const res = await fetch("/api/meal/upload", { method: "POST", body: fd });
      const d = await res.json();
      const dupNote =
        (d.skipped_duplicates || 0) + clientSkipped > 0
          ? `（已跳过 ${(d.skipped_duplicates || 0) + clientSkipped} 张重复图）`
          : "";
      if (d.status === "created" || d.status === "updated") {
        const pending = d.record?.pending_review ? " · 待处理" : "";
        setMsg(
          `✅ 已登记：${d.record.meal_date} · ¥${d.record.amount}${pending}${dupNote}`,
        );
        setPendingFiles([]);
        refresh();
      } else if (d.status === "unchanged") {
        setMsg(`ℹ️ ${d.message || "图片与当日记录重复，未重复添加"}${dupNote}`);
        setPendingFiles([]);
        setConflict(null);
        refresh();
      } else if (d.status === "exists") {
        setMsg("");
        setConflict({ existing: d.record, rec: d.recognized });
      } else {
        setMsg(`❌ ${d.error || "识别失败，可用下方手动补录"}`);
      }
    } catch (e) {
      setMsg(`❌ ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const onPick = async (list: FileList | null) => {
    if (!list?.length) return;
    const { files, skipped } = await dedupeMealFiles(Array.from(list));
    if (!files.length) {
      setMsg("❌ 所选图片内容重复，请换一张后重试");
      return;
    }
    if (skipped > 0) {
      setMsg(`ℹ️ 已忽略 ${skipped} 张重复图片，将上传 ${files.length} 张`);
    }
    setPendingFiles(files);
    void doUpload(files, false);
  };

  const manualSubmit = async () => {
    const amt = parseFloat(mAmount);
    if (!mDate || !amt || amt <= 0) {
      setMsg("请填写有效日期和金额");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/meal/receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: emp.id,
          employee_name: emp.name,
          meal_date: mDate,
          amount: amt,
          merchant: mMerchant,
        }),
      });
      const d = await res.json();
      if (d.ok) {
        setMsg(`✅ 已保存：${mDate} · ¥${amt}`);
        setMAmount("");
        setMMerchant("");
        refresh();
      } else {
        setMsg("❌ 保存失败");
      }
    } finally {
      setBusy(false);
    }
  };

  const del = async (r: MealRecord) => {
    if (!confirm(`删除 ${r.meal_date} 的餐费记录？`)) return;
    await fetch(
      `/api/meal/receipts?employee_id=${encodeURIComponent(r.employee_id)}&meal_date=${encodeURIComponent(r.meal_date)}`,
      { method: "DELETE" },
    );
    refresh();
  };

  return (
    <div className="space-y-6">
      {/* 上传区 */}
      <div className="card-surface rounded-2xl p-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-sm font-semibold">📤 上传今日餐费截图</p>
            <p className="text-xs opacity-60 mt-0.5">
              单次最多 {MAX_MEAL_UPLOAD_IMAGES} 张，相同图片会自动去重；同日补传会合并凭证并跳过重复图
            </p>
          </div>
          <button
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="px-4 py-2 rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 text-sm font-medium disabled:opacity-50"
          >
            选择图片
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => onPick(e.target.files)}
          />
        </div>
        {msg && <p className="text-sm mt-3">{msg}</p>}

        {/* 冲突：当天已有记录 */}
        {conflict && (
          <div
            className="mt-4 p-4 rounded-xl border"
            style={{ borderColor: "var(--separator-subtle)" }}
          >
            <p className="text-sm font-medium mb-1">
              ⚠️ {conflict.rec.date || conflict.existing.meal_date} 当天已有记录
            </p>
            <p className="text-xs opacity-70">
              原：¥{conflict.existing.amount}（{conflict.existing.merchant || "—"}） → 新识别：¥
              {conflict.rec.amount}（{conflict.rec.merchant || "—"}）
            </p>
            <div className="flex gap-2 mt-3">
              <button
                disabled={busy || pendingFiles.length === 0}
                onClick={() =>
                  pendingFiles.length &&
                  doUpload(pendingFiles, true, conflict.existing.meal_date)
                }
                className="px-3 py-1.5 text-sm rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
              >
                覆盖更新
              </button>
              <button
                onClick={() => {
                  setConflict(null);
                  setPendingFiles([]);
                }}
                className="px-3 py-1.5 text-sm rounded-lg border"
                style={{ borderColor: "var(--separator-subtle)" }}
              >
                保留原记录
              </button>
            </div>
          </div>
        )}

        {/* 手动补录 */}
        <details className="mt-4">
          <summary className="text-xs opacity-70 cursor-pointer">
            识别不准？手动补录 / 更正
          </summary>
          <div className="flex flex-wrap items-end gap-2 mt-3">
            <label className="text-xs opacity-70 flex flex-col gap-1">
              日期
              <input
                type="date"
                value={mDate}
                onChange={(e) => setMDate(e.target.value)}
                className="border rounded-lg px-2 py-1.5 text-sm bg-transparent"
                style={{ borderColor: "var(--separator-subtle)" }}
              />
            </label>
            <label className="text-xs opacity-70 flex flex-col gap-1">
              金额
              <input
                type="number"
                step="0.01"
                value={mAmount}
                onChange={(e) => setMAmount(e.target.value)}
                placeholder="35.5"
                className="border rounded-lg px-2 py-1.5 text-sm bg-transparent w-28"
                style={{ borderColor: "var(--separator-subtle)" }}
              />
            </label>
            <label className="text-xs opacity-70 flex flex-col gap-1">
              商家（可选）
              <input
                value={mMerchant}
                onChange={(e) => setMMerchant(e.target.value)}
                placeholder="食堂"
                className="border rounded-lg px-2 py-1.5 text-sm bg-transparent"
                style={{ borderColor: "var(--separator-subtle)" }}
              />
            </label>
            <button
              disabled={busy}
              onClick={manualSubmit}
              className="px-3 py-1.5 text-sm rounded-lg border hover:bg-black/5 disabled:opacity-50"
              style={{ borderColor: "var(--separator-subtle)" }}
            >
              保存
            </button>
          </div>
        </details>
      </div>

      {/* 汇总 + 工具栏 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm bg-transparent"
            style={{ borderColor: "var(--separator-subtle)" }}
          />
          <button
            onClick={() => setMonth("")}
            className={`px-3 py-1.5 text-sm rounded-lg border ${month === "" ? "bg-indigo-50 text-indigo-700 border-indigo-200" : ""}`}
            style={month === "" ? {} : { borderColor: "var(--separator-subtle)" }}
          >
            全部
          </button>
        </div>
        <button
          onClick={() =>
            window.open(
              `/api/meal/export?scope=user&employee_id=${encodeURIComponent(emp.id)}&employee_name=${encodeURIComponent(emp.name)}&month=${encodeURIComponent(month)}`,
              "_blank",
            )
          }
          className="px-3 py-1.5 text-sm rounded-lg text-white bg-emerald-600 hover:bg-emerald-700"
        >
          📤 导出我的 Excel
        </button>
      </div>

      {loadError && (
        <p className="text-sm text-amber-800 dark:text-amber-200/90">{loadError}</p>
      )}

      {summary && <MealSummaryBar summary={summary} />}

      {/* 明细 */}
      <div className="card-surface rounded-2xl p-5">
        <p className="text-sm font-semibold mb-1">🧾 我的明细（{records.length} 条）</p>
        <p className="text-xs opacity-50 mb-4">
          每日报销封顶 ¥{summary?.daily_cap ?? 30}，超额按封顶计入统计与导出
        </p>
        {loading ? (
          <p className="text-sm opacity-50">加载中…</p>
        ) : records.length === 0 ? (
          <p className="text-sm opacity-50">本期暂无记录，上传截图即可登记。</p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left opacity-50 border-b" style={{ borderColor: "var(--separator-subtle)" }}>
                  <th className="py-2 pr-3 font-medium">日期</th>
                  <th className="py-2 pr-3 font-medium">状态</th>
                  <th className="py-2 pr-3 font-medium">报销金额</th>
                  <th className="py-2 pr-3 font-medium">上班</th>
                  <th className="py-2 pr-3 font-medium">下班</th>
                  <th className="py-2 pr-3 font-medium">商家</th>
                  <th className="py-2 pr-3 font-medium">来源</th>
                  <th className="py-2 pr-3 font-medium">凭证</th>
                  <th className="py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => {
                  const imgs =
                    r.image_urls?.length ? r.image_urls : r.image_url ? [r.image_url] : [];
                  return (
                  <tr key={r.id} className="border-b" style={{ borderColor: "var(--separator-subtle)" }}>
                    <td className={`py-2 pr-3 ${r.pending_review ? "text-red-600 font-medium" : ""}`}>
                      {r.meal_date}
                    </td>
                    <td className="py-2 pr-3">
                      {r.pending_review ? (
                        <MealPendingBadge note={r.review_note} />
                      ) : (
                        <span className="text-xs opacity-50">正常</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <MealAmountText
                        amount={r.amount}
                        reimbursementAmount={r.reimbursement_amount}
                        capped={r.capped}
                      />
                      {r.capped && (
                        <span className="block text-[10px] text-amber-600">日封顶</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      {r.clock_in || (r.attendance_note ? "—" : "")}
                      {!r.clock_in && r.attendance_note && (
                        <span className="block opacity-50">{r.attendance_note}</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-xs">{r.clock_out || "—"}</td>
                    <td className="py-2 pr-3">{r.merchant || "—"}</td>
                    <td className="py-2 pr-3 opacity-60">
                      {r.source === "manual" ? "手动" : "上传"}
                    </td>
                    <td className="py-2 pr-3">
                      {imgs.length ? (
                        <span className="flex flex-wrap gap-2">
                          {imgs.map((u, i) => (
                            <a
                              key={u}
                              href={mealImageHref(u)}
                              target="_blank"
                              rel="noreferrer"
                              className="text-indigo-500 hover:underline text-xs"
                            >
                              图{i + 1}
                            </a>
                          ))}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2">
                      <button
                        onClick={() => del(r)}
                        className="px-2 py-1 text-xs text-red-500 border border-red-200 rounded-lg hover:bg-red-50"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// 全员统计
// ════════════════════════════════════════════════════════
function CompanyTab() {
  const [month, setMonth] = useState(currentMonth());
  const [summary, setSummary] = useState<Summary | null>(null);
  const [users, setUsers] = useState<UserStat[]>([]);
  const [byDate, setByDate] = useState<DateStat[]>([]);
  const [records, setRecords] = useState<MealRecord[]>([]);
  const [vision, setVision] = useState<VisionCfg | null>(null);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/meal/receipts/all?month=${encodeURIComponent(month)}`, {
        cache: "no-store",
      });
      const d = await res.json();
      if (d.ok) {
        setSummary(d.summary);
        setUsers(d.by_user || []);
        setByDate(d.by_date || []);
        setRecords(d.records || []);
        setVision(d.vision || null);
      }
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const filtered = records.filter((r) => {
    if (!keyword.trim()) return true;
    const k = keyword.toLowerCase();
    return (
      (r.employee_name || "").toLowerCase().includes(k) ||
      (r.merchant || "").toLowerCase().includes(k) ||
      r.meal_date.includes(k)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm bg-transparent"
            style={{ borderColor: "var(--separator-subtle)" }}
          />
          <button
            onClick={() => setMonth("")}
            className={`px-3 py-1.5 text-sm rounded-lg border ${month === "" ? "bg-indigo-50 text-indigo-700 border-indigo-200" : ""}`}
            style={month === "" ? {} : { borderColor: "var(--separator-subtle)" }}
          >
            全部
          </button>
          <button
            onClick={refresh}
            className="px-3 py-1.5 text-sm rounded-lg border"
            style={{ borderColor: "var(--separator-subtle)" }}
          >
            🔄 刷新
          </button>
        </div>
        <button
          onClick={() =>
            window.open(`/api/meal/export?scope=company&month=${encodeURIComponent(month)}`, "_blank")
          }
          className="px-3 py-1.5 text-sm rounded-lg text-white bg-emerald-600 hover:bg-emerald-700"
        >
          📤 导出全员 Excel
        </button>
      </div>

      {vision && (
        <div className="card-surface rounded-2xl p-4 text-xs opacity-80">
          🖼️ 识别模型：<b>{vision.provider}</b> · {vision.model} ·{" "}
          {vision.configured ? (
            <span className="text-emerald-500">密钥已配置</span>
          ) : (
            <span className="text-red-500">⚠️ 未配置密钥（去「设置·模型」配置）</span>
          )}
          <span className="ml-2 opacity-60">（识别用当前对话模型的视觉能力，可在设置中切换 provider）</span>
        </div>
      )}

      {summary && <MealSummaryBar summary={summary} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 按员工 */}
        <div className="card-surface rounded-2xl p-5">
          <p className="text-sm font-semibold mb-1">👥 按员工汇总（{users.length} 人）</p>
          <p className="text-xs opacity-50 mb-4">金额为可报销合计（日封顶 ¥{summary?.daily_cap ?? 30}）</p>
          {loading ? (
            <p className="text-sm opacity-50">加载中…</p>
          ) : users.length === 0 ? (
            <p className="text-sm opacity-50">本期暂无记录</p>
          ) : (
            <div className="space-y-2">
              {users.map((u) => (
                <div
                  key={u.employee_id}
                  className="flex items-center justify-between p-3 rounded-xl border"
                  style={{ borderColor: "var(--separator-subtle)" }}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{u.employee_name}</p>
                    <p className="text-xs opacity-60 mt-0.5">
                      {u.days} 天 · 日均 ¥{u.avg}
                      {(u.total_bill ?? u.total) > u.total && (
                        <span> · 票据 ¥{u.total_bill}</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-sm font-bold text-indigo-500">¥{u.total}</span>
                    <button
                      onClick={() =>
                        window.open(
                          `/api/meal/export?scope=user&employee_id=${encodeURIComponent(u.employee_id)}&month=${encodeURIComponent(month)}`,
                          "_blank",
                        )
                      }
                      className="px-2.5 py-1 text-xs text-indigo-500 border border-indigo-200 rounded-lg hover:bg-indigo-50"
                    >
                      导出
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 按日 */}
        <div className="card-surface rounded-2xl p-5">
          <p className="text-sm font-semibold mb-1">📅 按日汇总</p>
          <p className="text-xs opacity-50 mb-4">可报销合计（已按人日封顶）</p>
          {loading ? (
            <p className="text-sm opacity-50">加载中…</p>
          ) : byDate.length === 0 ? (
            <p className="text-sm opacity-50">本期暂无记录</p>
          ) : (
            <div className="space-y-2 max-h-[360px] overflow-auto">
              {byDate.map((d) => (
                <div
                  key={d.date}
                  className="flex items-center justify-between p-3 rounded-xl border"
                  style={{ borderColor: "var(--separator-subtle)" }}
                >
                  <p className="text-sm font-medium">{d.date}</p>
                  <p className="text-xs opacity-60">
                    {d.people} 人 ·{" "}
                    <span className="text-indigo-500 font-bold">¥{d.total}</span>
                    {(d.total_bill ?? d.total) > d.total && (
                      <span className="opacity-50"> (票 ¥{d.total_bill})</span>
                    )}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 明细 */}
      <div className="card-surface rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <p className="text-sm font-semibold">🧾 全员明细（{filtered.length} 条）</p>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索员工 / 商家 / 日期"
            className="border rounded-lg px-3 py-1.5 text-sm bg-transparent w-56"
            style={{ borderColor: "var(--separator-subtle)" }}
          />
        </div>
        {loading ? (
          <p className="text-sm opacity-50">加载中…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm opacity-50">本期暂无记录</p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left opacity-50 border-b" style={{ borderColor: "var(--separator-subtle)" }}>
                  <th className="py-2 pr-3 font-medium">员工</th>
                  <th className="py-2 pr-3 font-medium">日期</th>
                  <th className="py-2 pr-3 font-medium">状态</th>
                  <th className="py-2 pr-3 font-medium">报销金额</th>
                  <th className="py-2 pr-3 font-medium">上班</th>
                  <th className="py-2 pr-3 font-medium">下班</th>
                  <th className="py-2 pr-3 font-medium">商家</th>
                  <th className="py-2 pr-3 font-medium">来源</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-b" style={{ borderColor: "var(--separator-subtle)" }}>
                    <td className="py-2 pr-3">{r.employee_name}</td>
                    <td className={`py-2 pr-3 ${r.pending_review ? "text-red-600 font-medium" : ""}`}>
                      {r.meal_date}
                    </td>
                    <td className="py-2 pr-3">
                      {r.pending_review ? (
                        <MealPendingBadge note={r.review_note} />
                      ) : (
                        <span className="text-xs opacity-50">正常</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <MealAmountText
                        amount={r.amount}
                        reimbursementAmount={r.reimbursement_amount}
                        capped={r.capped}
                      />
                    </td>
                    <td className="py-2 pr-3 text-xs whitespace-nowrap">
                      {r.clock_in || "—"}
                    </td>
                    <td className="py-2 pr-3 text-xs whitespace-nowrap">
                      {r.clock_out || "—"}
                    </td>
                    <td className="py-2 pr-3">{r.merchant || "—"}</td>
                    <td className="py-2 pr-3 opacity-60">
                      {r.source === "manual" ? "手动" : "上传"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs opacity-50 mt-3">
          上班/下班时间为飞书考勤打卡。应用需开通 attendance:task:readonly 与
          contact:user.employee_id:readonly；手动填姓名上传的记录会按提醒群成员匹配 open_id。
          若仍无数据，可在 storage/meal/feishu_config.json 配置 attendance_user_id_map（用户 ID 见飞书管理后台成员详情）。
        </p>
      </div>
    </div>
  );
}
