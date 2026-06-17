"use client";

import { useCallback, useState } from "react";

type RunnerWithReset = {
  resetSession: () => void;
  setError: (msg: string | null) => void;
};

export function useAssistantPageSession(runner: RunnerWithReset) {
  const [lastResult, setLastResult] = useState<unknown>(null);
  const [streamText, setStreamText] = useState("");
  const [composerKey, setComposerKey] = useState(0);

  const resetConversation = useCallback(() => {
    runner.resetSession();
    runner.setError(null);
    setLastResult(null);
    setStreamText("");
    setComposerKey((key) => key + 1);
  }, [runner]);

  return {
    lastResult,
    setLastResult,
    streamText,
    setStreamText,
    composerKey,
    resetConversation,
  };
}
