"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BUILTIN_SLASH_COMMANDS,
  mergeSlashCommands,
  type SlashCommandDef,
} from "../lib/slash-commands";

async function fetchWorkspaceCommands(
  workspaceRoot: string,
  signal?: AbortSignal,
): Promise<SlashCommandDef[]> {
  const res = await fetch(
    `/api/claude-code/commands?workspace_root=${encodeURIComponent(workspaceRoot)}`,
    { signal, cache: "no-store" },
  );
  const data = (await res.json()) as { commands?: SlashCommandDef[] };
  return Array.isArray(data.commands) ? data.commands : [];
}

export function useSlashCommands(workspaceRoot: string | null) {
  const [custom, setCustom] = useState<SlashCommandDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => {
    setTick((n) => n + 1);
  }, []);

  useEffect(() => {
    const root = workspaceRoot?.trim();
    if (!root) {
      setCustom([]);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    void fetchWorkspaceCommands(root, ac.signal)
      .then((list) => {
        if (!ac.signal.aborted) setCustom(list);
      })
      .catch(() => {
        if (!ac.signal.aborted) setCustom([]);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [workspaceRoot, tick]);

  const commands = useMemo(
    () => mergeSlashCommands(BUILTIN_SLASH_COMMANDS, custom),
    [custom],
  );

  return { commands, custom, loading, reload, totalCount: commands.length };
}
