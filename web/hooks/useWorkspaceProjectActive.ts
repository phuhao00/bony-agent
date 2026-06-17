"use client";

import {
  readWorkspaceSelectedId,
  subscribeWorkspaceSelection,
  WORKSPACE_NONE_ID,
} from "@/lib/workspace-selection-sync";
import { useEffect, useMemo, useState } from "react";

/** 避免 SSR hydration 与 localStorage 取值不一致：首帧 null，挂载后再读 LS。 */
export function useWorkspaceProjectActive() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const bump = () => setSelectedId(readWorkspaceSelectedId());
    bump();
    return subscribeWorkspaceSelection(bump);
  }, []);

  return useMemo(() => {
    const hydrated = selectedId !== null;
    return {
      hydrated,
      selectedId: selectedId ?? WORKSPACE_NONE_ID,
      /** 挂载且未选「不使用项目」时出现顶栏入口 */
      projectActive: hydrated && selectedId !== WORKSPACE_NONE_ID,
    };
  }, [selectedId]);
}
