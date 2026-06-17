"use client";

import { useClaudeCodeRunner } from "@/app/claude-code/hooks/useClaudeCodeRunner";
import { createContext, useContext } from "react";

type ClaudeCodeSessionValue = ReturnType<typeof useClaudeCodeRunner>;

const ClaudeCodeSessionContext = createContext<ClaudeCodeSessionValue | null>(
  null,
);

export function ClaudeCodeSessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const runner = useClaudeCodeRunner();
  return (
    <ClaudeCodeSessionContext.Provider value={runner}>
      {children}
    </ClaudeCodeSessionContext.Provider>
  );
}

export function useClaudeCodeSession(): ClaudeCodeSessionValue {
  const ctx = useContext(ClaudeCodeSessionContext);
  if (!ctx) {
    throw new Error(
      "useClaudeCodeSession must be used within ClaudeCodeSessionProvider",
    );
  }
  return ctx;
}
