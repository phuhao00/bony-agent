"use client";

import { useCallback, useEffect, useId, useState } from "react";

const STORAGE_KEY = "default_llm_provider";

type ProviderRow = {
  id: string;
  name: string;
  default_model: string;
  has_key: boolean;
};

type ProviderConfigResponse = {
  current?: { id: string; name?: string; model?: string };
  available?: ProviderRow[];
  _fallback?: boolean;
};

export default function DefaultLLMProviderSection() {
  const selectId = useId();
  const [config, setConfig] = useState<ProviderConfigResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/config/provider");
    const data = (await res.json()) as ProviderConfigResponse;
    setConfig(data);
    return data;
  }, []);

  const applyProvider = useCallback(async (providerId: string) => {
    setLoading(true);
    try {
      const res = await fetch("/api/config/provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId }),
      });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem(STORAGE_KEY, providerId);
        setConfig((prev) =>
          prev ? { ...prev, current: data.current } : prev,
        );
        window.dispatchEvent(
          new CustomEvent("llm-provider-changed", {
            detail: data.current?.id ?? providerId,
          }),
        );
      }
    } catch (e) {
      console.error("Failed to set default provider:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onRemoteChange = () => {
      load();
    };
    window.addEventListener("llm-provider-changed", onRemoteChange);
    return () =>
      window.removeEventListener("llm-provider-changed", onRemoteChange);
  }, [load]);

  if (!config || config._fallback || !config.available?.length) {
    return null;
  }

  const currentId = config.current?.id ?? "";

  return (
    <div className="card-surface rounded-2xl p-3">
      <label
        htmlFor={selectId}
        className="block text-[10px] font-semibold uppercase tracking-wider text-[color:var(--label-secondary)]"
      >
        默认 LLM 供应商
      </label>
      <p className="mb-2 mt-1 text-[11px] leading-relaxed text-[color:var(--label-secondary)]">
        全局默认对话供应商；将同步到服务端并记住本机选择，刷新后仍会恢复。
      </p>
      <select
        id={selectId}
        value={currentId}
        disabled={loading}
        onChange={(e) => applyProvider(e.target.value)}
        className="w-full rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2.5 text-xs font-medium text-[color:var(--foreground)] outline-none transition-colors focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:rgba(255,149,0,0.2)] disabled:opacity-50"
      >
        {config.available.map((p) => (
          <option key={p.id} value={p.id} disabled={!p.has_key}>
            {p.name}
            {!p.has_key ? "（未配置 Key）" : ""}
          </option>
        ))}
      </select>
      {config.current?.model ? (
        <p className="mt-2 text-[10px] text-[color:var(--label-secondary)]">
          当前模型：<span className="font-mono text-[color:var(--foreground)]">{config.current.model}</span>
        </p>
      ) : null}
    </div>
  );
}
