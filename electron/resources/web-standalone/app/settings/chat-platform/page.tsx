"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import {
  Bot,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Globe,
  MessageSquare,
  RefreshCw,
  Save,
  Settings2,
  Shield,
} from "lucide-react";

interface FeishuStatus {
  enabled: boolean;
  configured: boolean;
  bridge_configured: boolean;
  webhook_url: string;
}

interface DiscordStatus {
  enabled: boolean;
  configured: boolean;
  token_masked: string;
}

interface CommonConfig {
  default_agent_id: string;
  rate_limit_enabled: boolean;
  rate_limit_per_sender: number;
  rate_limit_window: number;
}

interface StatusResponse {
  feishu: FeishuStatus;
  discord: DiscordStatus;
  common: CommonConfig;
}

interface PublicConfig {
  feishu: { enabled: boolean; configured: boolean };
  discord: { enabled: boolean; configured: boolean; token_masked: string };
  common: CommonConfig;
}

function IosToggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        "relative h-8 w-14 shrink-0 rounded-full transition-colors duration-200 ease-out",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] focus-visible:ring-offset-2",
        checked ? "bg-[color:var(--accent)]" : "bg-[color:var(--separator-subtle)]",
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
      ].join(" ")}
    >
      <span
        className={[
          "absolute top-1 left-1 h-6 w-6 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out",
          checked ? "translate-x-6" : "translate-x-0",
        ].join(" ")}
      />
    </button>
  );
}

function StatusPill({ active, label }: { active: boolean; label: string }) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
        active
          ? "bg-[color:var(--status-success-bg)] text-[color:var(--status-success-text)]"
          : "bg-[var(--chrome-rail-bg)] text-[color:var(--label-secondary)]",
      ].join(" ")}
    >
      <span
        className={[
          "h-1.5 w-1.5 rounded-full",
          active ? "bg-[color:var(--status-success-text)]" : "bg-[color:var(--label-secondary)]",
        ].join(" ")}
      />
      {label}
    </span>
  );
}

function Step({
  number,
  children,
  colorClass,
}: {
  number: number;
  children: React.ReactNode;
  colorClass: string;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex shrink-0 flex-col items-center">
        <div
          className={[
            "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white",
            colorClass,
          ].join(" ")}
        >
          {number}
        </div>
        <div className="mt-2 h-full w-px bg-[color:var(--separator-subtle)] last:hidden" />
      </div>
      <div className="pb-6 text-[15px] leading-relaxed text-[color:var(--label-secondary)]">
        {children}
      </div>
    </div>
  );
}

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={[
        "rounded-3xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)]",
        "shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.04)]",
        "overflow-hidden",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

function ExternalLinkButton({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3.5 text-sm font-medium text-[color:var(--label-secondary)] shadow-sm transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
    >
      {children}
      <ExternalLink className="h-3.5 w-3.5" />
    </a>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mb-5 mt-2 flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[color:var(--accent)]">
        <Icon className="h-4.5 w-4.5" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-[color:var(--label-primary)]">{title}</h2>
        <p className="text-sm text-[color:var(--label-secondary)]">{subtitle}</p>
      </div>
    </div>
  );
}

export default function ChatPlatformSettingsPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [discordToken, setDiscordToken] = useState("");
  const [defaultAgentId, setDefaultAgentId] = useState("media_agent");
  const [feishuExpanded, setFeishuExpanded] = useState(true);
  const [discordExpanded, setDiscordExpanded] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, configRes] = await Promise.all([
        fetch("/api/backend/chat-platform/status", { cache: "no-store" }),
        fetch("/api/backend/chat-platform/config", { cache: "no-store" }),
      ]);
      if (statusRes.ok) setStatus(await statusRes.json());
      if (configRes.ok) {
        const cfg = await configRes.json();
        setConfig(cfg);
        setDefaultAgentId(cfg.common?.default_agent_id || "media_agent");
      }
    } catch {
      setMessage(t("settings.chatPlatform.fetchError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const saveConfig = async () => {
    setSaving(true);
    setMessage("");
    try {
      const body: {
        discord?: { enabled?: boolean; bot_token?: string };
        common?: { default_agent_id?: string };
      } = {
        common: { default_agent_id: defaultAgentId },
      };
      if (discordToken.trim()) {
        body.discord = { bot_token: discordToken.trim() };
      }
      const res = await fetch("/api/backend/chat-platform/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setMessage(t("settings.chatPlatform.saved"));
        setDiscordToken("");
        await fetchData();
      } else {
        setMessage(t("settings.chatPlatform.saveFailed"));
      }
    } catch {
      setMessage(t("settings.chatPlatform.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const togglePlatform = async (platform: "feishu" | "discord", enabled: boolean) => {
    setSaving(true);
    try {
      const res = await fetch("/api/backend/chat-platform/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [platform]: { enabled } }),
      });
      if (res.ok) {
        await fetchData();
      }
    } catch {
      setMessage(t("settings.chatPlatform.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const copyWebhook = () => {
    if (status?.feishu.webhook_url) {
      navigator.clipboard.writeText(status.feishu.webhook_url);
      setMessage(t("settings.chatPlatform.copied"));
    }
  };

  return (
    <div className="min-h-full bg-[var(--page-bg)] px-6 py-8 lg:px-10 lg:py-10">
      <div className="mx-auto max-w-7xl">
        {/* Hero header */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-[var(--accent)]/10 px-3 py-1 text-xs font-medium text-[color:var(--accent)]">
              <MessageSquare className="h-3.5 w-3.5" />
              {t("settings.chatPlatform.title")}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-[color:var(--label-primary)] sm:text-3xl">
              {t("settings.chatPlatform.heroTitle")}
            </h1>
            <p className="mt-2 max-w-2xl text-base leading-relaxed text-[color:var(--label-secondary)]">
              {t("settings.chatPlatform.subtitle")}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={fetchData}
              disabled={loading}
              className="inline-flex h-10 items-center gap-2 rounded-full border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-4 text-sm font-medium text-[color:var(--label-secondary)] shadow-sm transition hover:bg-[var(--chrome-rail-bg)] disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              {t("common.refresh")}
            </button>
            <button
              onClick={saveConfig}
              disabled={saving}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-[color:var(--accent)] px-5 text-sm font-medium text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </div>

        {message && (
          <div className="mb-8 rounded-2xl border border-[color:var(--status-success-border)] bg-[var(--status-success-bg)] px-5 py-3.5 text-sm font-medium text-[color:var(--status-success-text)]">
            {message}
          </div>
        )}

        {/* Global settings — pinned to top so default Agent is always visible */}
        <SectionHeader
          icon={Globe}
          title={t("settings.chatPlatform.globalSettings")}
          subtitle={t("settings.chatPlatform.globalSettingsSubtitle")}
        />
        <Card className="mb-10">
          <div className="grid gap-6 p-6 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <label className="text-sm font-medium text-[color:var(--label-primary)]">
                {t("settings.chatPlatform.defaultAgentId")}
              </label>
              <input
                type="text"
                value={defaultAgentId}
                onChange={(e) => setDefaultAgentId(e.target.value)}
                className="w-full rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-4 py-3 text-sm text-[color:var(--label-primary)] outline-none transition focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:var(--accent)]/20"
              />
              <p className="text-xs text-[color:var(--label-secondary)]">
                {t("settings.chatPlatform.defaultAgentIdHint")}
              </p>
            </div>
          </div>
        </Card>

        {/* Platform integrations */}
        <SectionHeader
          icon={Bot}
          title={t("settings.chatPlatform.platformsTitle")}
          subtitle={t("settings.chatPlatform.platformsSubtitle")}
        />
        <div className="grid gap-6 xl:grid-cols-2">
          {/* Feishu */}
          <Card>
            <div className="border-b border-[color:var(--separator-subtle)] bg-gradient-to-br from-[var(--accent)]/5 to-transparent px-6 py-5">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent)] text-white shadow-sm">
                    <Bot className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-[color:var(--label-primary)]">
                      {t("settings.chatPlatform.feishuTitle")}
                    </h2>
                    <p className="truncate text-xs text-[color:var(--label-secondary)]">
                      {t("settings.chatPlatform.feishuSubtitle")}
                    </p>
                  </div>
                </div>
                <IosToggle
                  checked={!!status?.feishu.enabled}
                  onChange={(v) => togglePlatform("feishu", v)}
                  disabled={saving || loading}
                />
              </div>
            </div>

            <div className="p-6">
              <div className="mb-5 flex flex-wrap items-center gap-2">
                <StatusPill
                  active={!!status?.feishu.configured}
                  label={
                    status?.feishu.configured
                      ? t("settings.chatPlatform.feishuAppConfigured")
                      : t("settings.chatPlatform.feishuAppNotConfigured")
                  }
                />
                {status?.feishu.bridge_configured && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)]/10 px-3 py-1 text-xs font-medium text-[color:var(--accent)]">
                    <Shield className="h-3 w-3" />
                    {t("settings.chatPlatform.bridgeConfigured")}
                  </span>
                )}
              </div>

              <div className="mb-5 flex flex-wrap gap-2">
                <ExternalLinkButton href="https://open.feishu.cn/app">
                  {t("settings.chatPlatform.openFeishuPortal")}
                </ExternalLinkButton>
                <a
                  href="/lark-cli"
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 text-sm font-medium text-white shadow-sm transition hover:opacity-90"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  {t("settings.chatPlatform.openFeishuConfig")}
                </a>
              </div>

              <button
                onClick={() => setFeishuExpanded((v) => !v)}
                className="flex w-full items-center justify-between rounded-xl bg-[var(--chrome-rail-bg)] px-4 py-3 text-sm font-medium text-[color:var(--label-primary)] transition hover:bg-[var(--chrome-rail-bg)]/80"
              >
                <span>{t("settings.chatPlatform.setupGuide")}</span>
                {feishuExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>

              {feishuExpanded && (
                <div className="mt-4 space-y-0">
                  <Step number={1} colorClass="bg-[color:var(--accent)]">
                    {t("settings.chatPlatform.feishuStep1")}
                  </Step>
                  <Step number={2} colorClass="bg-[color:var(--accent)]">
                    <div className="space-y-3">
                      <p>{t("settings.chatPlatform.feishuStep2")}</p>
                      <div className="flex items-center gap-2 rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] p-1 pl-3">
                        <code className="flex-1 truncate text-xs text-[color:var(--label-primary)]">
                          {status?.feishu.webhook_url || "..."}
                        </code>
                        <button
                          onClick={copyWebhook}
                          className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-[var(--card-bg)] px-3 text-xs font-medium text-[color:var(--label-secondary)] shadow-sm transition hover:bg-[var(--accent)] hover:text-white"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          {t("settings.chatPlatform.copy")}
                        </button>
                      </div>
                    </div>
                  </Step>
                  <Step number={3} colorClass="bg-[color:var(--accent)]">
                    {t("settings.chatPlatform.feishuStep3")}
                  </Step>
                  <Step number={4} colorClass="bg-[color:var(--accent)]">
                    {t("settings.chatPlatform.feishuStep4")}
                  </Step>
                </div>
              )}
            </div>
          </Card>

          {/* Discord */}
          <Card>
            <div className="border-b border-[color:var(--separator-subtle)] bg-gradient-to-br from-[#5865F2]/5 to-transparent px-6 py-5">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#5865F2] text-white shadow-sm">
                    <Bot className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-[color:var(--label-primary)]">
                      {t("settings.chatPlatform.discordTitle")}
                    </h2>
                    <p className="truncate text-xs text-[color:var(--label-secondary)]">
                      {t("settings.chatPlatform.discordSubtitle")}
                    </p>
                  </div>
                </div>
                <IosToggle
                  checked={!!status?.discord.enabled}
                  onChange={(v) => togglePlatform("discord", v)}
                  disabled={saving || loading}
                />
              </div>
            </div>

            <div className="p-6">
              <div className="mb-5 flex flex-wrap items-center gap-2">
                <StatusPill
                  active={!!status?.discord.configured}
                  label={
                    status?.discord.configured
                      ? t("settings.chatPlatform.discordConfigured")
                      : t("settings.chatPlatform.discordNotConfigured")
                  }
                />
              </div>

              <div className="mb-5">
                <ExternalLinkButton href="https://discord.com/developers/applications">
                  {t("settings.chatPlatform.openDiscordPortal")}
                </ExternalLinkButton>
              </div>

              <div className="mb-5 space-y-1.5">
                <label className="text-sm font-medium text-[color:var(--label-primary)]">
                  {t("settings.chatPlatform.discordTokenLabel")}
                </label>
                <input
                  type="password"
                  value={discordToken}
                  onChange={(e) => setDiscordToken(e.target.value)}
                  placeholder={config?.discord.token_masked || t("settings.chatPlatform.discordTokenPlaceholder")}
                  className="w-full rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-4 py-3 text-sm text-[color:var(--label-primary)] outline-none transition focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:var(--accent)]/20"
                />
              </div>

              <button
                onClick={() => setDiscordExpanded((v) => !v)}
                className="flex w-full items-center justify-between rounded-xl bg-[var(--chrome-rail-bg)] px-4 py-3 text-sm font-medium text-[color:var(--label-primary)] transition hover:bg-[var(--chrome-rail-bg)]/80"
              >
                <span>{t("settings.chatPlatform.setupGuide")}</span>
                {discordExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>

              {discordExpanded && (
                <div className="mt-4 space-y-0">
                  <Step number={1} colorClass="bg-[#5865F2]">
                    {t("settings.chatPlatform.discordStep1")}
                  </Step>
                  <Step number={2} colorClass="bg-[#5865F2]">
                    {t("settings.chatPlatform.discordStep2")}
                  </Step>
                  <Step number={3} colorClass="bg-[#5865F2]">
                    {t("settings.chatPlatform.discordStep3")}
                  </Step>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
