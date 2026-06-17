"use client";

import { CreativeAgentChat, type ApprovalInfo, type ChatMessage } from "@/app/creative-apps/components/CreativeAgentChat";
import { CreativeAgentComposer } from "@/app/creative-apps/components/CreativeAgentComposer";
import { CreativeAgentHeader } from "@/app/creative-apps/components/CreativeAgentHeader";
import { CreativeAgentSidebar } from "@/app/creative-apps/components/CreativeAgentSidebar";
import { getCreativeAppConfig, isCreativeAppId } from "@/app/creative-apps/lib/app-config";
import { parseSseChunk, reduceAssistantSseEvent } from "@/app/components/assistantSse";
import { useTranslation } from "@/hooks/useTranslation";
import { Loader2 } from "lucide-react";

interface FigmaPluginStatus {
  connected: boolean;
  bridge_url?: string;
}
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function extractTaskIds(content: string): string[] {
  const ids = new Set<string>();
  const patterns = [
    /task[_\s-]?id["']?\s*[:=]\s*["']?([a-f0-9-]{8,})/gi,
    /"task_id"\s*:\s*"([a-f0-9-]{8,})"/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      ids.add(m[1]);
    }
  }
  return Array.from(ids);
}

const TERMINAL_TASK_STATUSES = new Set(["completed", "failed", "cancelled", "expired"]);

interface CreativeAppStatus {
  installed: boolean;
  executable_path?: string | null;
}

interface DesktopEnvironment {
  platform?: string;
  creative_apps?: Record<string, CreativeAppStatus>;
  error?: string;
}

export default function CreativeAgentPage() {
  const params = useParams();
  const router = useRouter();
  const { t } = useTranslation();
  const appId = String(params.appId || "");
  const config = useMemo(() => getCreativeAppConfig(appId), [appId]);

  const [environment, setEnvironment] = useState<DesktopEnvironment | null>(null);
  const [envLoading, setEnvLoading] = useState(true);
  const [envError, setEnvError] = useState("");
  const [pluginStatus, setPluginStatus] = useState<FigmaPluginStatus | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [composerKey, setComposerKey] = useState(0);
  const pollIntervals = useRef<Map<string, number>>(new Map());

  const isInstalled = environment?.creative_apps?.[appId]?.installed ?? false;

  const loadEnvironment = useCallback(async () => {
    setEnvLoading(true);
    setEnvError("");
    try {
      const res = await fetch("/api/desktop/environment", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as DesktopEnvironment;
      if (!res.ok) {
        throw new Error(data.error || t("creativeApps.loadEnvError"));
      }
      setEnvironment(data);
    } catch (e) {
      setEnvError(e instanceof Error ? e.message : t("creativeApps.loadEnvError"));
    } finally {
      setEnvLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadEnvironment();
  }, [loadEnvironment]);

  const isFigma = appId.toLowerCase() === "figma";

  const loadPluginStatus = useCallback(async () => {
    if (!isFigma) return;
    try {
      const res = await fetch("/api/figma-plugin/status", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as FigmaPluginStatus;
      setPluginStatus(data);
    } catch {
      setPluginStatus({ connected: false });
    }
  }, [isFigma]);

  useEffect(() => {
    if (!isFigma) return;
    void loadPluginStatus();
    const id = window.setInterval(() => void loadPluginStatus(), 5000);
    return () => window.clearInterval(id);
  }, [isFigma, loadPluginStatus]);

  const injectContext = useCallback(
    (text: string) => {
      if (!config) return text;
      const context = config.contextIntro;
      return `${context}\n\n用户请求：${text}`;
    },
    [config],
  );

  const handleSend = useCallback(
    async (text: string) => {
      if (!config) return;

      const userMessageId = `${Date.now()}-user`;
      const thinkingMessageId = `${Date.now()}-thinking`;

      setMessages((prev) => [
        ...prev,
        { id: userMessageId, role: "user", content: text },
        { id: thinkingMessageId, role: "thinking", content: "" },
      ]);
      setStreaming(true);

      const isFirstUserMessage = messages.filter((m) => m.role === "user").length === 0;
      const finalText = isFirstUserMessage ? injectContext(text) : text;

      try {
        const response = await fetch("/api/agent/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input: finalText,
            messages: [{ role: "user", content: finalText }],
            agent_id: config.agentId,
            mode: "multi",
          }),
        });

        if (!response.ok || !response.body) {
          const errData = (await response.json().catch(() => ({}))) as {
            detail?: string;
            error?: string;
          };
          throw new Error(
            errData.detail || errData.error || `Error ${response.status}`,
          );
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let accumulated = "";
        let pendingError: string | undefined;
        let done = false;

        while (!done) {
          const { value, done: doneReading } = await reader.read();
          done = doneReading;
          buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
          buffer = parseSseChunk(buffer, (event) => {
            const result = reduceAssistantSseEvent(event, accumulated);
            if (result.error) pendingError = result.error;
            if (result.text !== accumulated) {
              accumulated = result.text;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === thinkingMessageId ? { ...m, role: "assistant", content: accumulated } : m,
                ),
              );
            }
          });
          if (pendingError) {
            throw new Error(pendingError);
          }
        }

        if (!accumulated.trim() || accumulated.trim() === "思考中…") {
          throw new Error(t("creativeAgent.noResponseError"));
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === thinkingMessageId ? { ...m, role: "assistant", content: accumulated } : m,
          ),
        );
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : t("creativeAgent.sendError");
        setMessages((prev) =>
          prev
            .filter((m) => m.id !== thinkingMessageId)
            .concat({ id: `${Date.now()}-error`, role: "error", content: errorMessage }),
        );
      } finally {
        setStreaming(false);
      }
    },
    [config, injectContext, messages, t],
  );

  const handleLaunchApp = useCallback(async () => {
    if (!config) return;
    setLaunching(true);
    try {
      const res = await fetch("/api/computer/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "launch_app",
          app_id: config.name,
          metadata: { source: "creative_agent", app_id: config.id },
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        detail?: string;
      };
      if (!res.ok || data.error) {
        throw new Error(data.detail || data.error || t("creativeApps.runFailed"));
      }
      setMessages((prev) =>
        prev.concat({
          id: `${Date.now()}-system`,
          role: "assistant",
          content: t("creativeAgent.launchSuccess", { name: config.name }),
        }),
      );
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : t("creativeApps.runFailed");
      setMessages((prev) =>
        prev.concat({
          id: `${Date.now()}-error`,
          role: "error",
          content: errorMessage,
        }),
      );
    } finally {
      setLaunching(false);
    }
  }, [config, t]);

  const handleReset = useCallback(() => {
    setMessages([]);
    setComposerKey((k) => k + 1);
  }, []);

  const handleQuickPrompt = useCallback(
    (text: string) => {
      void handleSend(text);
    },
    [handleSend],
  );

  const handleApprove = useCallback(
    async (info: ApprovalInfo, messageId: string) => {
      if (!info.approvalId || !info.taskId) return;
      try {
        const approveRes = await fetch(`/api/approvals/${info.approvalId}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approved_by: "local_user" }),
        });
        if (!approveRes.ok) {
          const data = (await approveRes.json().catch(() => ({}))) as { error?: string; detail?: string };
          throw new Error(data.detail || data.error || "Approval failed");
        }
        await fetch(`/api/tasks/${info.taskId}/resume`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, approvalStatus: "approved" as const } : m)),
        );
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : t("creativeAgent.approvalError");
        setMessages((prev) =>
          prev.concat({ id: `${Date.now()}-error`, role: "error", content: errorMessage }),
        );
      }
    },
    [t],
  );

  const handleDeny = useCallback(
    async (info: ApprovalInfo, messageId: string) => {
      if (!info.approvalId) return;
      try {
        await fetch(`/api/approvals/${info.approvalId}/deny`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ denied_by: "local_user", reason: "用户拒绝" }),
        });
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, approvalStatus: "denied" as const } : m)),
        );
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : t("creativeAgent.approvalError");
        setMessages((prev) =>
          prev.concat({ id: `${Date.now()}-error`, role: "error", content: errorMessage }),
        );
      }
    },
    [t],
  );

  // Poll task status for any background native/desktop task spawned by the agent.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const startedTaskIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!config) return;

    const allContent = messagesRef.current.map((m) => m.content).join("\n");
    const taskIds = extractTaskIds(allContent);

    for (const taskId of taskIds) {
      if (startedTaskIds.current.has(taskId)) continue;
      startedTaskIds.current.add(taskId);

      const statusMessageId = `${taskId}-status`;
      setMessages((prev) => {
        if (prev.some((m) => m.id === statusMessageId)) return prev;
        return prev.concat({
          id: statusMessageId,
          role: "thinking",
          content: t("creativeAgent.taskRunning", { taskId }),
        });
      });

      const intervalId = window.setInterval(async () => {
        try {
          const res = await fetch(`/api/tasks/${taskId}`, { cache: "no-store" });
          if (!res.ok) return;
          const task = (await res.json()) as {
            status?: string;
            message?: string;
            error?: string;
            result?: unknown;
            progress?: number;
          };
          const status = task.status || "unknown";

          if (TERMINAL_TASK_STATUSES.has(status)) {
            const finalText =
              status === "completed"
                ? t("creativeAgent.taskCompleted", {
                    taskId,
                    message: task.message || "",
                  })
                : t("creativeAgent.taskFailed", {
                    taskId,
                    message: task.message || task.error || "",
                  });
            setMessages((prev) =>
              prev
                .filter((m) => m.id !== statusMessageId)
                .concat({ id: `${taskId}-${status}-${Date.now()}`, role: "assistant", content: finalText }),
            );
            window.clearInterval(intervalId);
            pollIntervals.current.delete(taskId);
            startedTaskIds.current.delete(taskId);
          } else {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === statusMessageId
                  ? { ...m, content: t("creativeAgent.taskRunning", { taskId }) }
                  : m,
              ),
            );
          }
        } catch {
          // Ignore polling errors; will retry on next interval.
        }
      }, 2000);

      pollIntervals.current.set(taskId, intervalId);
    }
  }, [config, messages.length, t]);

  useEffect(() => {
    return () => {
      for (const id of pollIntervals.current.values()) {
        window.clearInterval(id);
      }
      pollIntervals.current.clear();
      startedTaskIds.current.clear();
    };
  }, []);

  if (!isCreativeAppId(appId) || !config) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-[color:var(--label-secondary)]">
        <p>{t("creativeAgent.unknownApp")}</p>
        <button
          type="button"
          onClick={() => router.push("/creative-apps")}
          className="rounded-lg bg-[color:var(--accent)] px-4 py-2 text-sm text-white"
        >
          {t("creativeApps.back")}
        </button>
      </div>
    );
  }

  if (envLoading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-[color:var(--label-secondary)]">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        {t("creativeAgent.loading")}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--shell-bg)]">
      <CreativeAgentHeader
        appName={config.name}
        logo={config.logo}
        category={config.category}
        installed={isInstalled}
        running={launching}
        onLaunch={handleLaunchApp}
        docUrl={config.docUrl}
      />

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {envError && (
            <div className="mx-4 mt-4 rounded-xl border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-4 py-2.5 text-[12px] text-[var(--status-danger-text)] sm:mx-6">
              {envError}
            </div>
          )}

          <CreativeAgentChat
            appName={config.name}
            logo={config.logo}
            messages={messages}
            onApprove={handleApprove}
            onDeny={handleDeny}
          />

          <CreativeAgentComposer
            key={composerKey}
            placeholder={config.placeholder}
            streaming={streaming}
            showReset={messages.length > 0}
            onSend={handleSend}
            onReset={handleReset}
          />
        </div>

        <CreativeAgentSidebar
          appName={config.name}
          category={config.category}
          installed={isInstalled}
          quickPrompts={config.quickPrompts}
          onPromptClick={handleQuickPrompt}
          docUrl={config.docUrl}
          downloadUrl={config.downloadUrl}
          plugin={pluginStatus}
        />
      </div>
    </div>
  );
}
