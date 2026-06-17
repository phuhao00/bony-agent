"use client";

import { ClaudeCodePermissionBanner } from "@/components/ClaudeCodePermissionBanner";
import { CheckCircle2, Circle, Code2, Settings2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CodingChatPanel } from "./components/CodingChatPanel";
import { CodingConfigPanel } from "./components/CodingConfigPanel";
import { CodingExplorer } from "./components/CodingExplorer";
import { CodingOutputPanel } from "./components/CodingOutputPanel";
import { CodingWorkspaceToolbar } from "./components/CodingWorkspaceToolbar";
import { useClaudeCodeSession } from "@/contexts/ClaudeCodeSessionContext";
import { useCodingWorkspace } from "./hooks/useCodingWorkspace";
import { useGitActions } from "./hooks/useGitActions";
import { useSlashCommands } from "./hooks/useSlashCommands";
import { executeLocalSlashCommand } from "./lib/slash-command-local";
import { isLocalSlashCommand, resolveSlashCommand } from "./lib/slash-commands";
import {
  projectScope,
  scopeRequiresTarget,
  workspaceScope,
  type CodingScope,
  type CodingScopeType,
} from "./lib/scope";

type Health = {
  ready?: boolean;
  sdk_available?: boolean;
  not_ready_reason?: string;
  claude_bin?: string;
  version?: string;
  coding?: { provider_name?: string; model?: string };
};

function resolveRunRoot(scope: CodingScope, effectiveRoot: string | null): string | undefined {
  if (scope.type === "project" && scope.relPath.trim()) return scope.relPath.trim();
  return effectiveRoot?.trim() || undefined;
}

function isStopSlashCommand(text: string): boolean {
  return /^\/(stop|cancel)(\s|$)/i.test(text.trim());
}

const GIT_STREAM_COMMANDS = new Set(["commit", "commit-push", "ship", "push"]);

export default function ClaudeCodePage() {
  const {
    state,
    run,
    cancel,
    resetConversation,
    replyLocally,
    startLocalExchange,
    updateLocalExchange,
    finishLocalExchange,
    respondPermission,
  } = useClaudeCodeSession();
  const ws = useCodingWorkspace();
  const {
    projects,
    selectedId,
    selectedProject,
    effectiveRoot,
    serverLabel,
    gitSummary,
    loadingGit,
    isElectron,
    selectProject,
    pickFolderAsWorkspace,
    refreshGit,
  } = ws;
  const [prompt, setPrompt] = useState("");
  const [health, setHealth] = useState<Health | null>(null);
  const [scopeType, setScopeType] = useState<CodingScopeType>("workspace");
  const [scope, setScope] = useState<CodingScope>(workspaceScope());
  const [configOpen, setConfigOpen] = useState(false);
  const runRoot = useMemo(
    () => resolveRunRoot(scope, effectiveRoot),
    [scope, effectiveRoot],
  );
  const { commands: slashCommands, reload: reloadSlashCommands } = useSlashCommands(
    runRoot || effectiveRoot,
  );
  const { busy: gitBusy, commit: gitCommit, push: gitPush, commitAndPush: gitCommitAndPush } =
    useGitActions(effectiveRoot);

  const refreshHealth = useCallback(() => {
    void fetch("/api/claude-code/health")
      .then((r) => r.json())
      .then((d) => setHealth(d))
      .catch(() => setHealth({ ready: false }));
  }, []);

  useEffect(() => {
    refreshHealth();
  }, [refreshHealth]);

  const canSend = useMemo(() => {
    const text = prompt.trim();
    if (!text) return false;
    if (isStopSlashCommand(text)) return true;
    if (state.running) return false;
    if (scopeRequiresTarget(scopeType) && !scope.relPath.trim()) return false;
    if (scopeType === "project" && !scope.relPath.trim()) return false;
    return true;
  }, [prompt, scope.relPath, scopeType, state.running]);

  const handleLocalSlash = useCallback(
    async (text: string): Promise<boolean> => {
      const resolved = resolveSlashCommand(slashCommands, text);
      if (!resolved) return false;
      const { def, args } = resolved;
      if (!isLocalSlashCommand(def)) return false;

      const ctx = {
        commandText: text,
        commandName: def.name,
        args,
        slashCommands,
        state,
        health,
        scope,
        workspaceRoot: effectiveRoot,
        gitSummary,
        reloadSlashCommands,
        refreshGit,
        onProgress: updateLocalExchange,
        gitCommit,
        gitPush,
        gitCommitAndPush,
        openConfig: () => setConfigOpen(true),
        resetConversation,
        cancelRun: cancel,
      };

      const streamGit = GIT_STREAM_COMMANDS.has(def.name.toLowerCase());

      if (streamGit) {
        startLocalExchange(text, "⏳ 开始处理…");
        try {
          const reply = await executeLocalSlashCommand(ctx);
          finishLocalExchange(reply ?? "完成");
        } catch (e: unknown) {
          finishLocalExchange(`错误：${e instanceof Error ? e.message : String(e)}`);
        }
        await refreshGit();
        return true;
      }

      const reply = await executeLocalSlashCommand(ctx);
      if (reply === null) return true;
      replyLocally(text, reply);
      return true;
    },
    [
      cancel,
      effectiveRoot,
      finishLocalExchange,
      gitCommit,
      gitCommitAndPush,
      gitPush,
      gitSummary,
      health,
      refreshGit,
      reloadSlashCommands,
      replyLocally,
      resetConversation,
      scope,
      slashCommands,
      startLocalExchange,
      state,
      updateLocalExchange,
    ],
  );

  const executeSlash = useCallback(
    async (text: string) => {
      const handled = await handleLocalSlash(text);
      if (!handled) {
        await run(text, { workspaceRoot: runRoot, scope });
      }
    },
    [handleLocalSlash, run, runRoot, scope],
  );

  const onGitCommit = useCallback(
    async (message: string) => {
      const label = message.trim() ? `/commit ${message.trim()}` : "/commit";
      startLocalExchange(label, "⏳ 开始处理…");
      const res = await gitCommit(message, { onProgress: updateLocalExchange });
      finishLocalExchange(res.message);
      if (res.ok) await refreshGit();
    },
    [finishLocalExchange, gitCommit, refreshGit, startLocalExchange, updateLocalExchange],
  );

  const onGitPush = useCallback(async () => {
    startLocalExchange("/push", "⏳ 开始处理…");
    const res = await gitPush(undefined, updateLocalExchange);
    finishLocalExchange(res.message);
    if (res.ok) await refreshGit();
  }, [finishLocalExchange, gitPush, refreshGit, startLocalExchange, updateLocalExchange]);

  const onGitCommitAndPush = useCallback(
    async (message: string) => {
      const label = message.trim()
        ? `/commit-push ${message.trim()}`
        : "/commit-push";
      startLocalExchange(label, "⏳ 开始处理…");
      const res = await gitCommitAndPush(message, { onProgress: updateLocalExchange });
      finishLocalExchange(res.message);
      if (res.ok) await refreshGit();
    },
    [
      finishLocalExchange,
      gitCommitAndPush,
      refreshGit,
      startLocalExchange,
      updateLocalExchange,
    ],
  );

  const onSend = useCallback(() => {
    const text = prompt.trim();
    if (!text) return;
    if (isStopSlashCommand(text)) {
      void handleLocalSlash(text).then(() => setPrompt(""));
      return;
    }
    void handleLocalSlash(text).then((handled) => {
      if (handled) {
        setPrompt("");
        return;
      }
      void run(text, {
        workspaceRoot: runRoot,
        scope,
      });
      setPrompt("");
    });
  }, [handleLocalSlash, prompt, run, runRoot, scope]);

  const onNewChat = useCallback(() => {
    resetConversation();
    setPrompt("");
  }, [resetConversation]);

  const onSelectProjectScope = useCallback(
    (p: { id: string; label: string; path?: string }) => {
      selectProject(p.id);
      if (p.path) setScope(projectScope(p.path, p.label));
    },
    [selectProject],
  );

  const onOpenFolder = useCallback(() => {
    void pickFolderAsWorkspace();
  }, [pickFolderAsWorkspace]);

  const ready = !!health?.ready;

  return (
    <div className="page-canvas flex min-h-[calc(100vh-4rem)] w-full flex-1 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-3 py-2 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[color:color-mix(in_srgb,var(--accent)_14%,transparent)]">
              <Code2 className="h-4 w-4 text-[color:var(--accent)]" strokeWidth={2} />
            </div>
            <div>
              <h1 className="text-base font-bold text-[color:var(--foreground)]">Claude Code</h1>
              <p className="text-[10px] text-[color:var(--label-secondary)]">
                输入 <span className="font-mono">/</span> 唤起 {slashCommands.length} 条命令
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusChip ok={ready} label={ready ? "就绪" : "未就绪"} />
            {health?.sdk_available === false ? (
              <StatusChip ok={false} label="SDK" />
            ) : (
              <StatusChip ok label="SDK" />
            )}
            {state.sessionId ? (
              <span className="hidden max-w-[8rem] truncate font-mono text-[10px] text-[color:var(--label-secondary)] lg:inline">
                会话续聊中
              </span>
            ) : null}
            {health?.coding?.model ? (
              <span className="hidden font-mono text-[10px] text-[color:var(--label-secondary)] sm:inline">
                {health.coding.model}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => setConfigOpen((v) => !v)}
              className={[
                "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[10px] font-semibold",
                configOpen
                  ? "border-[color:var(--accent)] bg-[color:color-mix(in_srgb,var(--accent)_12%,transparent)]"
                  : "border-[color:var(--separator-subtle)]",
              ].join(" ")}
            >
              <Settings2 className="h-3 w-3" />
              配置
            </button>
          </div>
        </div>
      </header>

      <CodingWorkspaceToolbar
        projects={projects}
        selectedId={selectedId}
        selectedProject={selectedProject}
        effectiveRoot={effectiveRoot}
        rootLabel={serverLabel}
        gitSummary={gitSummary}
        loadingGit={loadingGit}
        isElectron={isElectron}
        onSelectProject={selectProject}
        onOpenFolder={onOpenFolder}
        onRefreshGit={refreshGit}
        gitBusy={gitBusy}
        canGitCommit={!!gitSummary?.gitAvailable && (gitSummary.dirtyCount ?? 0) > 0}
        canGitPush={!!gitSummary?.gitAvailable}
        onGitCommit={onGitCommit}
        onGitPush={onGitPush}
        onGitCommitAndPush={onGitCommitAndPush}
      />

      {configOpen ? (
        <div className="shrink-0 border-b border-[color:var(--separator-subtle)] bg-[var(--shell-bg)] px-4 py-3">
          <CodingConfigPanel compact onSaved={refreshHealth} />
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(260px,24vw)_minmax(0,1fr)_minmax(280px,30vw)]">
        <CodingExplorer
          scopeType={scopeType}
          scope={scope}
          browseRoot={effectiveRoot}
          projects={projects}
          isElectron={isElectron}
          onScopeTypeChange={setScopeType}
          onScopeChange={setScope}
          onOpenFolder={onOpenFolder}
          onSelectProjectScope={onSelectProjectScope}
        />

        <section className="flex min-h-0 min-w-0 flex-col p-3 sm:p-4">
          <ClaudeCodePermissionBanner
            pending={state.pendingPermission}
            onAllow={() => void respondPermission(true)}
            onDeny={() => void respondPermission(false)}
          />
          <CodingChatPanel
            messages={state.messages}
            prompt={prompt}
            onPromptChange={setPrompt}
            running={state.running}
            disabled={!canSend}
            scope={scope}
            workspaceRoot={effectiveRoot}
            slashCommands={slashCommands}
            onSend={onSend}
            onExecuteSlash={(text) => {
              setPrompt("");
              void executeSlash(text);
            }}
            onCancel={cancel}
            onNewChat={onNewChat}
          />
        </section>

        <CodingOutputPanel timeline={state.timeline} error={state.error} />
      </div>
    </div>
  );
}

function StatusChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
        ok
          ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
          : "border-amber-500/30 text-amber-800 dark:text-amber-200",
      ].join(" ")}
    >
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
      {label}
    </span>
  );
}
