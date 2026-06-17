"use client";

import { useCallback, useEffect, useState } from "react";

type CodingProviderOption = {
  id: string;
  name: string;
  default_base_url: string;
  default_model: string;
  description: string;
};

type CodingConfig = {
  current: {
    provider: string;
    provider_name: string;
    model: string;
    base_url: string;
    has_key: boolean;
    auth: string;
    key_source: string;
    api_key_value: string;
    ready: boolean;
  };
  available: CodingProviderOption[];
};

export function CodingConfigPanel({
  onSaved,
  compact = false,
}: {
  onSaved?: () => void;
  compact?: boolean;
}) {
  const [config, setConfig] = useState<CodingConfig | null>(null);
  const [provider, setProvider] = useState("auto");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/config/coding");
    const data = (await res.json()) as CodingConfig;
    setConfig(data);
    setProvider(data.current.provider || "auto");
    setApiKey(data.current.api_key_value || "");
    setBaseUrl(data.current.base_url || "");
    setModel(data.current.model || "");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedOption = config?.available.find((p) => p.id === provider);

  const onSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      const body: Record<string, string> = { provider };
      if (apiKey.trim()) body.api_key = apiKey.trim();
      if (baseUrl.trim()) body.base_url = baseUrl.trim();
      if (model.trim()) body.model = model.trim();

      const res = await fetch("/api/config/coding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      }
      setMessage("已保存");
      setApiKey("");
      await load();
      onSaved?.();
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const applyPreset = () => {
    if (!selectedOption) return;
    if (!baseUrl.trim() && selectedOption.default_base_url) {
      setBaseUrl(selectedOption.default_base_url);
    }
    if (!model.trim() && selectedOption.default_model) {
      setModel(selectedOption.default_model);
    }
  };

  const Wrapper = compact ? "div" : "section";
  const wrapperClass = compact
    ? "space-y-3"
    : "card-surface rounded-2xl p-4";

  return (
    <Wrapper className={wrapperClass}>
      {!compact ? (
        <>
          <h2 className="text-sm font-semibold text-[color:var(--foreground)]">
            Coding API 配置
          </h2>
          <p className="mt-1 text-xs text-[color:var(--label-secondary)]">
            与主聊天 LLM 独立。Claude Code 需要 Anthropic 兼容的 API Key 与 Base URL（支持 OpenRouter、自定义网关）。
          </p>
        </>
      ) : (
        <p className="text-[11px] text-[color:var(--label-secondary)]">
          与主聊天 LLM 独立 · Anthropic 兼容端点
        </p>
      )}

      {config ? (
        <p className="mt-2 text-xs text-[color:var(--label-secondary)]">
          当前：{config.current.provider_name} · 认证 {config.current.auth}
          {config.current.key_source ? ` · 密钥来源 ${config.current.key_source}` : ""}
          {config.current.ready ? " · 就绪" : " · 未就绪"}
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-[color:var(--foreground)]">
          供应商
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--shell-bg)] px-2 py-2 text-sm"
          >
            {(config?.available || []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {selectedOption?.description ? (
            <span className="mt-1 block text-[10px] text-[color:var(--label-secondary)]">
              {selectedOption.description}
            </span>
          ) : null}
        </label>

        <label className="block text-xs font-medium text-[color:var(--foreground)]">
          模型
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={selectedOption?.default_model || "qwen3-coder-next"}
            className="mt-1 w-full rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--shell-bg)] px-2 py-2 text-sm font-mono"
          />
        </label>

        <label className="block text-xs font-medium text-[color:var(--foreground)] sm:col-span-2">
          API Key（CODING_API_KEY）
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              config?.current.has_key
                ? "留空则保留已保存的密钥"
                : "sk-... 或 OpenRouter key"
            }
            className="mt-1 w-full rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--shell-bg)] px-2 py-2 text-sm font-mono"
          />
        </label>

        <label className="block text-xs font-medium text-[color:var(--foreground)] sm:col-span-2">
          Base URL（Anthropic 兼容）
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={
              selectedOption?.default_base_url ||
              "https://dashscope.aliyuncs.com/apps/anthropic"
            }
            className="mt-1 w-full rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--shell-bg)] px-2 py-2 text-sm font-mono"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={applyPreset}
          className="rounded-lg border border-[color:var(--separator-subtle)] px-3 py-1.5 text-xs font-semibold"
        >
          填入默认 URL/模型
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => void onSave()}
          className="rounded-lg bg-[color:var(--accent)] px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {saving ? "保存中…" : "保存配置"}
        </button>
        {message ? (
          <span className="text-xs text-[color:var(--label-secondary)]">{message}</span>
        ) : null}
      </div>
    </Wrapper>
  );
}
