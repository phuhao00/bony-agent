"use client";

import { useTranslation } from "@/hooks/useTranslation";
import { Wrench } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import CapabilitiesApprovalsTab from "./CapabilitiesApprovalsTab";
import CapabilitiesConnectionsTab from "./CapabilitiesConnectionsTab";
import CapabilitiesMCPTab from "./CapabilitiesMCPTab";
import CapabilitiesScheduledTab from "./CapabilitiesScheduledTab";
import CapabilitiesSkillsTab from "./CapabilitiesSkillsTab";

interface ProviderInfo {
  id: string;
  name: string;
  default_model: string;
  models: string[];
  env_var: string;
  has_key: boolean;
  api_key_value?: string;
  extra_keys?: { env_var: string; has_key: boolean; value: string }[];
}

interface ProviderConfig {
  current: {
    id: string;
    name: string;
    model: string;
    has_key: boolean;
  };
  available: ProviderInfo[];
}

interface ProviderUpdateBody {
  provider?: string;
  model?: string;
  api_keys?: Record<string, string>;
}

// 供应商图标 & 品牌色
const PROVIDER_META: Record<
  string,
  { icon: string; color: string; site: string; desc: string }
> = {
  zhipu: {
    icon: "🧠",
    color: "from-blue-500 to-indigo-600",
    site: "https://open.bigmodel.cn/",
    desc: "GLM-4.7 · Agentic 编码增强 · CogView · CogVideoX",
  },
  google: {
    icon: "🌐",
    color: "from-green-500 to-emerald-600",
    site: "https://aistudio.google.com/",
    desc: "Gemini 3 Flash · 内置推理 · 超大上下文 · 实时视频",
  },
  deepseek: {
    icon: "🔮",
    color: "from-purple-500 to-violet-600",
    site: "https://platform.deepseek.com/",
    desc: "DeepSeek V3.2 · R1 推理 · Agents 优先 · 高性价比",
  },
  bytedance: {
    icon: "🔥",
    color: "from-orange-500 to-red-500",
    site: "https://console.volcengine.com/",
    desc: "Doubao-Seed-1.6 · 多模态深度思考 · 极致速度",
  },
  jimeng: {
    icon: "🎨",
    color: "from-cyan-500 to-teal-500",
    site: "https://console.volcengine.com/",
    desc: "即梦 AI · 图片 4.0 · 视频 3.0 Pro · 火山引擎",
  },
  alibaba: {
    icon: "☁️",
    color: "from-sky-500 to-blue-600",
    site: "https://dashscope.console.aliyun.com/",
    desc: "通义千问 · DashScope 兼容 OpenAI 接口 · ALIBABA_API_KEY 或 DASHSCOPE_API_KEY（sk-）",
  },
  openai: {
    icon: "⚡",
    color: "from-gray-700 to-gray-900",
    site: "https://platform.openai.com/",
    desc: "GPT-5.2 · 旗舰推理 · Codex 编码 · 结构化输出",
  },
  openrouter: {
    icon: "🔗",
    color: "from-pink-500 to-rose-600",
    site: "https://openrouter.ai/",
    desc: "OpenRouter · 聚合模型 · Gemini V2/Claude 3.5/GPT-4",
  },
};

// ============== Media Model Selector ==============

interface MediaModel {
  id: string;
  name: string;
  provider: string;
  model_id: string;
  api_type: string;
  description?: string;
  available: boolean;
}

interface MediaModelsData {
  [modality: string]: {
    models: MediaModel[];
    current: string;
  };
}

const MODALITY_ICONS: Record<string, string> = {
  image: "🖼️",
  video: "🎥",
  audio: "🔊",
};

function MediaModelSelector({
  showToast,
}: {
  showToast: (type: "success" | "error", message: string) => void;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<MediaModelsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);

  const loadModels = useCallback(async () => {
    try {
      const res = await fetch("/api/config/media-models");
      const json = await res.json();
      setData(json);
    } catch (e) {
      console.error("Failed to load media models:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  const selectModel = async (modality: string, modelId: string) => {
    setSwitching(modelId);
    try {
      const res = await fetch("/api/config/media-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modality, model_id: modelId }),
      });
      const json = await res.json();
      if (json.status === "ok") {
        const modalityLabel =
          modality === "image" || modality === "video" || modality === "audio"
            ? t(`settings.capabilities.media.${modality}`)
            : modality;
        showToast(
          "success",
          t("settings.capabilities.toast.switchedModality", {
            modality: modalityLabel,
          }),
        );
        await loadModels();
      } else {
        showToast(
          "error",
          json.message || t("settings.capabilities.toast.switchFailed"),
        );
      }
    } catch {
      showToast("error", t("settings.capabilities.toast.networkError"));
    } finally {
      setSwitching(null);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-8 text-[color:var(--label-secondary)]">
        {t("settings.capabilities.media.loadingList")}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-8 text-[color:#ff3b30]">
        {t("settings.capabilities.media.loadFailed")}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {(["image", "video", "audio"] as const).map((modality) => {
        const group = data[modality];
        if (!group) return null;
        const metaIcon = MODALITY_ICONS[modality] || "📎";
        const modalityLabel =
          modality === "image" || modality === "video" || modality === "audio"
            ? t(`settings.capabilities.media.${modality}`)
            : modality;
        const models = group.models || [];
        const currentId = group.current;

        return (
          <div key={modality}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">{metaIcon}</span>
              <span className="font-medium text-[color:var(--foreground)] text-sm">
                {modalityLabel}
              </span>
              <span className="text-xs text-[color:var(--label-secondary)] ml-1">
                (
                {t("settings.capabilities.media.modelCount", {
                  count: models.length,
                })}
                )
              </span>
            </div>
            {models.length === 0 ? (
              <p className="text-xs text-[color:var(--label-secondary)] ml-7">
                {t("settings.capabilities.media.noModels")}
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 ml-7">
                {models.map((m) => {
                  const isSelected = m.id === currentId;
                  const isSwitching = switching === m.id;
                  return (
                    <button
                      key={m.id}
                      onClick={() =>
                        !isSelected &&
                        m.available &&
                        selectModel(modality, m.id)
                      }
                      disabled={!m.available || isSwitching}
                      className={`text-left p-3 rounded-xl border transition-all duration-200 ${
                        isSelected
                          ? "border-[color:var(--accent)] bg-[var(--nav-active-fill)] shadow-sm ring-1 ring-[color:rgba(255,149,0,0.2)]"
                          : m.available
                            ? "border-[color:var(--separator-subtle)] bg-[var(--card-bg)] hover:border-[color:var(--separator)] hover:bg-[var(--chrome-rail-bg)] cursor-pointer"
                            : "border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] opacity-50 cursor-not-allowed"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span
                          className={`text-sm font-medium text-[color:var(--foreground)]`}
                        >
                          {m.name}
                        </span>
                        {isSelected && (
                          <span className="text-xs text-[color:var(--accent)] font-semibold">
                            ✓ {t("settings.capabilities.media.current")}
                          </span>
                        )}
                        {isSwitching && (
                          <span className="text-xs text-[color:var(--label-secondary)] animate-pulse">
                            {t("settings.capabilities.media.switching")}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[color:var(--label-secondary)] truncate">
                        {m.provider} · {m.model_id}
                      </p>
                      {!m.available && (
                        <p className="text-xs text-[color:var(--accent)] mt-1">
                          {t("settings.capabilities.media.apiKeyMissing")}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<ProviderConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  type CapTab =
    | "connections"
    | "skills"
    | "scheduled"
    | "approvals"
    | "mcp"
    | "system"
    | "architecture";
  const [capTab, setCapTab] = useState<CapTab>("connections");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const validTabs: CapTab[] = [
      "connections",
      "skills",
      "scheduled",
      "approvals",
      "mcp",
      "system",
      "architecture",
    ];
    const param = new URLSearchParams(window.location.search).get("tab");
    if (param && validTabs.includes(param as CapTab)) {
      setCapTab(param as CapTab);
      return;
    }
    if (window.location.hash === "#llm-settings") {
      setCapTab("system");
    }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/config/provider");
      const data = await res.json();
      setConfig(data);
      setSelectedProvider(data.current.id);
      setSelectedModel(data.current.model);

      // Populate API keys
      const initialKeys: Record<string, string> = {};
      data.available.forEach((p: ProviderInfo) => {
        if (p.api_key_value) {
          initialKeys[p.env_var] = p.api_key_value;
        }
        p.extra_keys?.forEach((ek) => {
          if (ek.value) {
            initialKeys[ek.env_var] = ek.value;
          }
        });
      });
      setApiKeys(initialKeys);
    } catch (err) {
      console.error("Failed to load config:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  /** 从飞书工作台「去设置切换」带 #llm-settings 时滚动到模型区 */
  useEffect(() => {
    if (loading || !config) return;
    if (capTab !== "system") return;
    if (typeof window === "undefined") return;
    if (window.location.hash !== "#llm-settings") return;
    const scrollTimer = window.setTimeout(() => {
      document
        .getElementById("llm-settings")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => window.clearTimeout(scrollTimer);
  }, [loading, config, capTab]);

  // 切换供应商时自动切换到该供应商的默认模型
  const handleProviderSelect = (providerId: string) => {
    setSelectedProvider(providerId);
    // 找到这个供应商的默认模型
    const prov = config?.available.find((p) => p.id === providerId);
    if (prov) {
      setSelectedModel(prov.default_model);
    }
  };

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // 只发送非空的 api_keys
      const filteredKeys: Record<string, string> = {};
      for (const [k, v] of Object.entries(apiKeys)) {
        if (v.trim()) filteredKeys[k] = v.trim();
      }

      const body: ProviderUpdateBody = {};

      // 供应商变更
      if (selectedProvider !== config?.current.id) {
        body.provider = selectedProvider;
      }

      // 模型变更
      if (selectedModel !== config?.current.model) {
        body.model = selectedModel;
      }

      // API Key 变更
      if (Object.keys(filteredKeys).length > 0) {
        body.api_keys = filteredKeys;
      }

      if (!body.provider && !body.model && !body.api_keys) {
        showToast("error", t("settings.capabilities.toast.noChanges"));
        setSaving(false);
        return;
      }

      const res = await fetch("/api/config/provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (data.success) {
        showToast(
          "success",
          t("settings.capabilities.toast.saved", {
            name: data.current.name,
            model: data.current.model,
          }),
        );
        setApiKeys({});
        await loadConfig();
      } else {
        showToast(
          "error",
          data.detail ||
            data.error ||
            t("settings.capabilities.toast.saveFailed"),
        );
      }
    } catch (err: unknown) {
      showToast(
        "error",
        t("settings.capabilities.toast.saveFailedDetail", {
          msg: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setSaving(false);
    }
  };

  // 获取当前选中供应商的可选模型列表
  const currentProviderModels =
    config?.available.find((p) => p.id === selectedProvider)?.models || [];

  return (
    <div className="page-canvas h-full overflow-y-auto">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 animate-slide-in">
          <div
            className={`rounded-xl px-5 py-3 text-sm font-medium text-white shadow-lg ${
              toast.type === "success"
                ? "bg-[color:#34c759]"
                : "bg-[color:#ff3b30]"
            }`}
          >
            {toast.type === "success" ? "✅ " : "❌ "}
            {toast.message}
          </div>
        </div>
      )}

      <div className="mx-auto max-w-5xl px-6 py-8">
        <header className="mb-6 flex gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--nav-active-fill)] text-[color:var(--accent)] shadow-sm ring-1 ring-[color:var(--separator-subtle)]">
            <Wrench className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div className="min-w-0 pt-0.5">
            <h1 className="text-xl font-semibold tracking-tight text-[color:var(--foreground)] md:text-2xl">
              {t("settings.capabilities.title")}
            </h1>
            <p className="mt-1 text-[13px] leading-relaxed text-[color:var(--label-secondary)]">
              {t("settings.capabilities.subtitle")}
              <span className="text-[color:var(--label-secondary)] opacity-80">
                {t("settings.capabilities.subtitleSystem")}
              </span>
            </p>
          </div>
        </header>

        <nav
          className="mb-8 flex gap-1 overflow-x-auto border-b border-[color:var(--separator-subtle)] pb-px"
          aria-label={t("settings.capabilities.navAria")}
        >
          {(
            [
              {
                id: "connections" as const,
                labelKey: "settings.capabilities.tabs.connections",
              },
              {
                id: "skills" as const,
                labelKey: "settings.capabilities.tabs.skills",
              },
              {
                id: "scheduled" as const,
                labelKey: "settings.capabilities.tabs.scheduled",
              },
              {
                id: "approvals" as const,
                labelKey: "settings.capabilities.tabs.approvals",
              },
              {
                id: "mcp" as const,
                labelKey: "settings.capabilities.tabs.mcp",
              },
              {
                id: "system" as const,
                labelKey: "settings.capabilities.tabs.system",
              },
              {
                id: "architecture" as const,
                labelKey: "settings.capabilities.tabs.architecture",
              },
            ] as const
          ).map((tabDef) => (
            <button
              key={tabDef.id}
              type="button"
              onClick={() => setCapTab(tabDef.id)}
              className={`relative shrink-0 whitespace-nowrap px-3 py-2.5 text-[13px] font-medium transition-colors ${
                capTab === tabDef.id
                  ? "text-[color:var(--foreground)] after:absolute after:bottom-0 after:left-2 after:right-2 after:h-0.5 after:rounded-full after:bg-[color:var(--accent)]"
                  : "text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]"
              }`}
            >
              {t(tabDef.labelKey)}
            </button>
          ))}
        </nav>

        {capTab === "connections" && <CapabilitiesConnectionsTab />}

        {capTab === "skills" && <CapabilitiesSkillsTab />}

        {capTab === "scheduled" && <CapabilitiesScheduledTab />}

        {capTab === "approvals" && <CapabilitiesApprovalsTab />}

        {capTab === "mcp" && <CapabilitiesMCPTab />}

        {capTab === "architecture" && (
          <iframe
            src="/architecture"
            className="w-full rounded-2xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)]"
            style={{ height: "calc(100vh - 260px)", minHeight: 480 }}
            title={t("settings.capabilities.architectureIframeTitle")}
          />
        )}

        {capTab === "system" && (
          <>
            {loading && !config ? (
              <div className="flex justify-center py-20">
                <div className="h-9 w-9 animate-spin rounded-full border-2 border-[color:var(--accent)] border-t-transparent" />
              </div>
            ) : !config ? (
              <div className="rounded-2xl border border-[color:rgba(255,59,48,0.35)] bg-[color:rgba(255,59,48,0.06)] px-4 py-8 text-center text-sm text-[color:var(--foreground)]">
                配置加载失败，请刷新页面或检查网络。
              </div>
            ) : (
              <>
                {/* 常用：一键选中供应商（仍须填 Key 后点保存） */}
                {config && (
                  <div className="card-surface mb-6 rounded-2xl p-4">
                    <p className="mb-2 text-xs font-semibold text-[color:var(--foreground)]">
                      常用切换（选中后请在下方填对应 Key 并保存）
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          {
                            id: "alibaba",
                            label: "通义千问",
                            sub: "ALIBABA 或 DASHSCOPE",
                          },
                          {
                            id: "zhipu",
                            label: "智谱 GLM",
                            sub: "ZHIPUAI_API_KEY",
                          },
                          {
                            id: "deepseek",
                            label: "DeepSeek",
                            sub: "DEEPSEEK_API_KEY",
                          },
                          {
                            id: "openrouter",
                            label: "OpenRouter",
                            sub: "OPENROUTER_API_KEY",
                          },
                        ] as const
                      ).map((chip) => {
                        const active = selectedProvider === chip.id;
                        return (
                          <button
                            key={chip.id}
                            type="button"
                            onClick={() => handleProviderSelect(chip.id)}
                            className={`rounded-xl border px-3 py-2 text-left text-xs transition-colors ${
                              active
                                ? "border-[color:var(--accent)] bg-[var(--nav-active-fill)] text-[color:var(--foreground)] shadow-sm"
                                : "border-[color:var(--separator-subtle)] bg-[var(--card-bg)] text-[color:var(--foreground)] hover:border-[color:var(--separator)]"
                            }`}
                          >
                            <span className="font-semibold">{chip.label}</span>
                            <span className="mt-0.5 block font-mono text-[10px] text-[color:var(--label-secondary)]">
                              {chip.sub}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-[11px] leading-relaxed text-[color:var(--label-secondary)]">
                      若智谱 Key
                      填在千问或反之，会出现「身份验证失败」。千问可用环境变量{" "}
                      <code className="font-mono">ALIBABA_API_KEY</code>{" "}
                      或官方示例里的{" "}
                      <code className="font-mono">DASHSCOPE_API_KEY</code>
                      （二选一即可）。
                    </p>
                  </div>
                )}

                {/* Current status */}
                {config && (
                  <div className="card-surface mb-8 rounded-2xl p-5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-3xl">
                          {PROVIDER_META[config.current.id]?.icon || "🤖"}
                        </span>
                        <div>
                          <div className="font-semibold text-[color:var(--foreground)]">
                            当前供应商: {config.current.name}
                          </div>
                          <div className="text-sm text-[color:var(--label-secondary)]">
                            模型:{" "}
                            <code className="rounded bg-[var(--nav-active-fill)] px-1.5 py-0.5 font-mono text-xs">
                              {config.current.model}
                            </code>
                          </div>
                        </div>
                      </div>
                      <div
                        className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                          config.current.has_key
                            ? "bg-[var(--nav-active-fill)] text-[color:var(--accent)]"
                            : "border border-[color:rgba(255,59,48,0.35)] bg-[color:rgba(255,59,48,0.08)] text-[color:var(--foreground)]"
                        }`}
                      >
                        {config.current.has_key
                          ? "🟢 已配置 Key"
                          : "🔴 未配置 Key"}
                      </div>
                    </div>
                  </div>
                )}

                {/* Provider cards + Model selector */}
                <div className="mb-6" id="llm-settings">
                  <h2 className="mb-4 text-lg font-semibold text-[color:var(--foreground)]">
                    选择供应商
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {config?.available.map((p) => {
                      const meta = PROVIDER_META[p.id] || {
                        icon: "🤖",
                        color: "from-gray-500 to-gray-600",
                        site: "#",
                        desc: "",
                      };
                      const isSelected = selectedProvider === p.id;

                      return (
                        <button
                          key={p.id}
                          onClick={() => handleProviderSelect(p.id)}
                          className={`relative rounded-2xl border p-5 text-left transition-all duration-200 ${
                            isSelected
                              ? "border-[color:var(--accent)] bg-[var(--nav-active-fill)] shadow-md ring-1 ring-[color:rgba(255,149,0,0.2)]"
                              : "border-[color:var(--separator-subtle)] bg-[var(--card-bg)] hover:border-[color:var(--separator)] hover:shadow-sm"
                          }`}
                        >
                          {/* 选中标记 */}
                          {isSelected && (
                            <div className="absolute top-3 right-3">
                              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[color:var(--accent)]">
                                <svg
                                  className="w-3.5 h-3.5 text-white"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={3}
                                    d="M5 13l4 4L19 7"
                                  />
                                </svg>
                              </div>
                            </div>
                          )}

                          <div className="flex items-center gap-3 mb-3">
                            <div
                              className={`w-10 h-10 rounded-xl bg-gradient-to-br ${meta.color} flex items-center justify-center text-white text-lg shadow-sm`}
                            >
                              {meta.icon}
                            </div>
                            <div>
                              <div className="font-semibold text-sm text-[color:var(--foreground)]">
                                {p.name}
                              </div>
                              <div className="text-xs text-[color:var(--label-secondary)]">
                                {p.default_model}
                              </div>
                            </div>
                          </div>

                          <p className="text-xs leading-relaxed text-[color:var(--label-secondary)]">
                            {meta.desc}
                          </p>

                          <div className="mt-3 flex items-center gap-2">
                            <span
                              className={`inline-block w-2 h-2 rounded-full ${
                                p.has_key
                                  ? "bg-[color:var(--accent)]"
                                  : "bg-[color:var(--label-secondary)]"
                              }`}
                            />
                            <span className="text-xs text-[color:var(--label-secondary)]">
                              {p.has_key ? "Key 已配置" : "未配置"}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Model selector */}
                <div className="mb-8">
                  <h2 className="mb-4 text-lg font-semibold text-[color:var(--foreground)]">
                    选择模型
                  </h2>
                  <div className="card-surface rounded-2xl p-5">
                    <div className="mb-4 flex items-center gap-3">
                      <span className="text-2xl">
                        {PROVIDER_META[selectedProvider]?.icon || "🤖"}
                      </span>
                      <div>
                        <div className="text-sm font-medium text-[color:var(--foreground)]">
                          {config?.available.find(
                            (p) => p.id === selectedProvider,
                          )?.name || ""}
                        </div>
                        <div className="text-xs text-[color:var(--label-secondary)]">
                          选择该供应商下的模型
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
                      {currentProviderModels.map((model) => {
                        const isActive = selectedModel === model;
                        const isDefault =
                          model ===
                          config?.available.find(
                            (p) => p.id === selectedProvider,
                          )?.default_model;
                        return (
                          <button
                            key={model}
                            onClick={() => setSelectedModel(model)}
                            className={`rounded-xl border px-4 py-3 text-left transition-all duration-150 ${
                              isActive
                                ? "border-[color:var(--accent)] bg-[var(--nav-active-fill)] text-[color:var(--foreground)] shadow-sm"
                                : "border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] text-[color:var(--foreground)] hover:border-[color:var(--separator)] hover:bg-[var(--card-bg)]"
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <code className="font-mono text-xs">{model}</code>
                              {isActive && (
                                <svg
                                  className="ml-1 h-4 w-4 flex-shrink-0 text-[color:var(--accent)]"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M5 13l4 4L19 7"
                                  />
                                </svg>
                              )}
                            </div>
                            {isDefault && (
                              <span className="mt-1 block text-[10px] text-[color:var(--label-secondary)]">
                                默认
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {/* 当前选择摘要 */}
                    <div className="mt-4 flex items-center gap-2 border-t border-[color:var(--separator-subtle)] pt-4">
                      <span className="text-xs text-[color:var(--label-secondary)]">
                        当前选择:
                      </span>
                      <code className="rounded-lg bg-[var(--nav-active-fill)] px-2 py-1 font-mono text-xs text-[color:var(--accent)]">
                        {selectedProvider}/{selectedModel}
                      </code>
                      {selectedModel !== config?.current.model ||
                      selectedProvider !== config?.current.id ? (
                        <span className="text-xs font-medium text-[color:var(--accent)]">
                          ← 未保存
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>

                {/* API Key inputs */}
                <div className="mb-8">
                  <h2 className="mb-4 text-lg font-semibold text-[color:var(--foreground)]">
                    API Key 配置
                  </h2>
                  <div className="space-y-4">
                    {config?.available.map((p) => {
                      const meta = PROVIDER_META[p.id];
                      const isActive = selectedProvider === p.id;

                      return (
                        <div
                          key={p.id}
                          className={`rounded-2xl border p-5 transition-all duration-200 ${
                            isActive
                              ? "border-[color:var(--accent)] bg-[var(--nav-active-fill)]"
                              : "border-[color:var(--separator-subtle)] bg-[var(--card-bg)]"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <span className="text-lg">
                                {meta?.icon || "🤖"}
                              </span>
                              <span className="text-sm font-medium text-[color:var(--foreground)]">
                                {p.name}
                              </span>
                              {isActive && (
                                <span className="rounded-full bg-[var(--nav-active-fill)] px-2 py-0.5 text-xs font-medium text-[color:var(--accent)]">
                                  当前选中
                                </span>
                              )}
                            </div>
                            <a
                              href={meta?.site || "#"}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-[color:var(--accent)] hover:underline"
                            >
                              获取 Key →
                            </a>
                          </div>

                          {/* Main API Key */}
                          <div className="relative mb-3">
                            <div className="absolute left-3 top-1/2 w-32 -translate-y-1/2 truncate font-mono text-[10px] text-[color:var(--label-secondary)]">
                              {p.env_var}
                            </div>
                            <input
                              type={showKeys[p.id] ? "text" : "password"}
                              placeholder={
                                p.has_key
                                  ? "••••••••（已设置，留空保持不变）"
                                  : p.id === "jimeng"
                                    ? "请输入 Access Key ID (例如 AKLT...)"
                                    : p.id === "alibaba"
                                      ? "sk-…（写入 ALIBABA_API_KEY；若 .env 已用 DASHSCOPE_API_KEY 也可不改）"
                                      : "请输入 API Key"
                              }
                              value={apiKeys[p.env_var] || ""}
                              onChange={(e) =>
                                setApiKeys((prev) => ({
                                  ...prev,
                                  [p.env_var]: e.target.value,
                                }))
                              }
                              className="w-full rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] py-3 pl-36 pr-12 font-mono text-sm text-[color:var(--foreground)] outline-none transition-all placeholder:text-[color:var(--label-secondary)] focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:rgba(255,149,0,0.2)]"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setShowKeys((prev) => ({
                                  ...prev,
                                  [p.id]: !prev[p.id],
                                }))
                              }
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]"
                            >
                              {showKeys[p.id] ? "🙈" : "👁️"}
                            </button>
                          </div>

                          {/* Extra Keys (e.g. JIMENG_SECRET_KEY) */}
                          {p.extra_keys?.map((ek) => (
                            <div
                              key={ek.env_var}
                              className="relative mb-3 last:mb-0"
                            >
                              <div className="absolute left-3 top-1/2 w-32 -translate-y-1/2 truncate font-mono text-[10px] text-[color:var(--label-secondary)]">
                                {ek.env_var}
                              </div>
                              <input
                                type={
                                  showKeys[p.id + "_" + ek.env_var]
                                    ? "text"
                                    : "password"
                                }
                                placeholder={
                                  ek.has_key
                                    ? "••••••••（已设置，留空保持不变）"
                                    : ek.env_var === "DASHSCOPE_API_KEY"
                                      ? "DashScope 变量名（sk-，与上方主 Key 二选一）"
                                      : "请输入 Secret Access Key (通常 40 位)"
                                }
                                value={apiKeys[ek.env_var] || ""}
                                onChange={(e) =>
                                  setApiKeys((prev) => ({
                                    ...prev,
                                    [ek.env_var]: e.target.value,
                                  }))
                                }
                                className="w-full rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] py-3 pl-36 pr-12 font-mono text-sm text-[color:var(--foreground)] outline-none transition-all placeholder:text-[color:var(--label-secondary)] focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:rgba(255,149,0,0.2)]"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setShowKeys((prev) => ({
                                    ...prev,
                                    [p.id + "_" + ek.env_var]:
                                      !prev[p.id + "_" + ek.env_var],
                                  }))
                                }
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]"
                              >
                                {showKeys[p.id + "_" + ek.env_var]
                                  ? "🙈"
                                  : "👁️"}
                              </button>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Media Model Selection */}
                <div className="mb-8">
                  <h2 className="mb-4 text-lg font-semibold text-[color:var(--foreground)]">
                    🎬 多媒体模型选择
                  </h2>
                  <MediaModelSelector
                    showToast={(type: "success" | "error", message: string) => {
                      setToast({ type, message });
                      setTimeout(() => setToast(null), 3000);
                    }}
                  />
                </div>

                {/* Save button */}
                <div className="flex justify-end gap-3 pb-8">
                  <button
                    onClick={() => {
                      setSelectedProvider(config?.current.id || "zhipu");
                      setSelectedModel(config?.current.model || "glm-4-plus");
                      setApiKeys({});
                    }}
                    className="rounded-xl border border-[color:var(--separator-subtle)] px-6 py-3 text-sm font-medium text-[color:var(--foreground)] transition-colors hover:bg-[var(--nav-active-fill)]"
                  >
                    重置
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="rounded-xl bg-[color:var(--accent)] px-8 py-3 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saving ? (
                      <span className="flex items-center gap-2">
                        <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                        保存中...
                      </span>
                    ) : (
                      "💾 保存配置"
                    )}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
