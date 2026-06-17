"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import PublishModal from "../../components/PublishModal";

// 平台选项
const platforms = [
  { id: "xiaohongshu", name: "小红书", icon: "📕" },
  { id: "wechat", name: "微信公众号", icon: "💚" },
  { id: "zhihu", name: "知乎", icon: "🔵" },
  { id: "weibo", name: "微博", icon: "🔴" },
  { id: "douyin", name: "抖音文案", icon: "📱" },
];

// 内容类型
const contentTypes = [
  { id: "种草推荐", name: "种草推荐", icon: "🌱" },
  { id: "测评对比", name: "测评对比", icon: "⚖️" },
  { id: "教程攻略", name: "教程攻略", icon: "📖" },
  { id: "故事营销", name: "故事营销", icon: "📚" },
  { id: "热点借势", name: "热点借势", icon: "🔥" },
];

export default function CopywritingPage() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [platform, setPlatform] = useState("xiaohongshu");
  const [contentType, setContentType] = useState("种草推荐");
  const [targetAudience, setTargetAudience] = useState("");
  const [additionalInfo, setAdditionalInfo] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"copywriting" | "titles">(
    "copywriting",
  );

  const handleGenerate = async () => {
    if (!topic.trim()) {
      alert("请输入内容主题");
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const endpoint =
        activeTab === "copywriting"
          ? "/api/tools/copywriting"
          : "/api/tools/titles";

      const body =
        activeTab === "copywriting"
          ? {
              topic,
              platform,
              content_type: contentType,
              target_audience: targetAudience || "年轻用户",
              additional_info: additionalInfo,
            }
          : {
              topic,
              platform,
              summary: additionalInfo,
              count: 5,
            };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      setResult(data.result || JSON.stringify(data, null, 2));
    } catch (error) {
      setResult(`生成失败: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const chipOn =
    "border-[color:var(--accent)] bg-[var(--nav-active-fill)] text-[color:var(--foreground)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_35%,transparent)]";
  const chipOff =
    "border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)]";
  const fieldCls =
    "w-full rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-4 py-3 text-[color:var(--foreground)] outline-none placeholder:text-[color:var(--label-secondary)] focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--accent)_38%,transparent)]";

  return (
    <div className="page-canvas min-h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-5 py-8 pb-16 md:px-8">
        <header className="mb-8 flex items-start gap-3">
          <button
            onClick={() => router.back()}
            className="mt-1 flex items-center justify-center w-8 h-8 rounded-xl text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)] transition-colors shrink-0"
            aria-label="返回"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[color:var(--foreground)]">
              ✍️ 文案生成
            </h1>
            <p className="mt-1 text-[13px] leading-relaxed text-[color:var(--label-secondary)]">
              智能生成营销文案，支持多平台风格适配
            </p>
          </div>
        </header>

        <div className="mb-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("copywriting")}
            className={`rounded-xl px-4 py-2 text-[13px] font-semibold transition-colors ${
              activeTab === "copywriting"
                ? "bg-[var(--accent)] text-white shadow-sm"
                : "border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)]"
            }`}
          >
            📄 完整文案
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("titles")}
            className={`rounded-xl px-4 py-2 text-[13px] font-semibold transition-colors ${
              activeTab === "titles"
                ? "bg-[var(--accent)] text-white shadow-sm"
                : "border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)]"
            }`}
          >
            🏷️ 标题生成
          </button>
        </div>

        <div className="card-surface space-y-6 rounded-2xl p-6 md:p-8">
          <div>
            <label className="mb-2 block text-sm font-medium text-[color:var(--foreground)]">
              内容主题 *
            </label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="例如：iPhone 16 Pro 深度体验"
              className={fieldCls}
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-[color:var(--foreground)]">
              目标平台
            </label>
            <div className="flex flex-wrap gap-2">
              {platforms.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPlatform(p.id)}
                  className={`rounded-xl border px-4 py-2 text-[13px] font-medium transition-colors ${
                    platform === p.id ? chipOn : chipOff
                  }`}
                >
                  {p.icon} {p.name}
                </button>
              ))}
            </div>
          </div>

          {activeTab === "copywriting" && (
            <div>
              <label className="mb-2 block text-sm font-medium text-[color:var(--foreground)]">
                内容类型
              </label>
              <div className="flex flex-wrap gap-2">
                {contentTypes.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setContentType(t.id)}
                    className={`rounded-xl border px-4 py-2 text-[13px] font-medium transition-colors ${
                      contentType === t.id ? chipOn : chipOff
                    }`}
                  >
                    {t.icon} {t.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeTab === "copywriting" && (
            <div>
              <label className="mb-2 block text-sm font-medium text-[color:var(--foreground)]">
                目标人群
              </label>
              <input
                type="text"
                value={targetAudience}
                onChange={(e) => setTargetAudience(e.target.value)}
                placeholder="例如：25-35岁职场女性"
                className={fieldCls}
              />
            </div>
          )}

          <div>
            <label className="mb-2 block text-sm font-medium text-[color:var(--foreground)]">
              {activeTab === "copywriting" ? "补充信息（可选）" : "内容简介"}
            </label>
            <textarea
              value={additionalInfo}
              onChange={(e) => setAdditionalInfo(e.target.value)}
              placeholder={
                activeTab === "copywriting"
                  ? "产品特点、卖点、优惠信息等..."
                  : "简要描述内容，帮助生成更精准的标题..."
              }
              rows={3}
              className={`${fieldCls} resize-none`}
            />
          </div>

          <button
            type="button"
            onClick={handleGenerate}
            disabled={loading}
            className="w-full rounded-xl bg-[var(--accent)] py-3 text-[15px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading
              ? "⏳ 生成中..."
              : activeTab === "copywriting"
                ? "🚀 生成文案"
                : "🏷️ 生成标题"}
          </button>
        </div>

        {result && (
          <div className="card-surface mt-6 rounded-2xl p-6 md:p-8">
            <h2 className="mb-4 flex items-center justify-between text-lg font-semibold text-[color:var(--foreground)]">
              <span>生成结果</span>
              <PublishModal content={result} mediaType="text" />
            </h2>
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] p-5 font-mono text-base leading-relaxed text-[color:var(--foreground)]">
              {result}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
