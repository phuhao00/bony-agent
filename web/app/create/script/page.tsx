"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// 平台选项
const platforms = [
  { id: "douyin", name: "抖音", icon: "📱" },
  { id: "xiaohongshu", name: "小红书", icon: "📕" },
  { id: "bilibili", name: "B站", icon: "📺" },
  { id: "youtube", name: "YouTube", icon: "▶️" },
  { id: "kuaishou", name: "快手", icon: "⚡" },
];

// 脚本风格
const styles = [
  { id: "口播带货", name: "口播带货", desc: "主播直接讲解产品" },
  { id: "剧情演绎", name: "剧情演绎", desc: "通过故事展现内容" },
  { id: "干货讲解", name: "干货讲解", desc: "专业知识分享" },
  { id: "种草测评", name: "种草测评", desc: "真实体验分享" },
];

export default function ScriptPage() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [platform, setPlatform] = useState("douyin");
  const [style, setStyle] = useState("口播带货");
  const [duration, setDuration] = useState(60);
  const [industry, setIndustry] = useState("");
  const [additionalInfo, setAdditionalInfo] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleGenerate = async () => {
    if (!topic.trim()) {
      alert("请输入视频主题");
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const response = await fetch("/api/tools/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          platform,
          style,
          duration,
          industry: industry || "通用",
          additional_info: additionalInfo,
        }),
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
              📝 视频脚本生成
            </h1>
            <p className="mt-1 text-[13px] leading-relaxed text-[color:var(--label-secondary)]">
              智能生成结构化视频脚本，支持多平台适配
            </p>
          </div>
        </header>

        <div className="card-surface space-y-6 rounded-2xl p-6 md:p-8">
          <div>
            <label className="mb-2 block text-sm font-medium text-[color:var(--foreground)]">
              视频主题 *
            </label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="例如：如何快速入门Python编程"
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

          <div>
            <label className="mb-2 block text-sm font-medium text-[color:var(--foreground)]">
              脚本风格
            </label>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {styles.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStyle(s.id)}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    style === s.id ? chipOn : chipOff
                  }`}
                >
                  <div className="text-sm font-semibold text-[color:var(--foreground)]">
                    {s.name}
                  </div>
                  <div className="mt-0.5 text-xs text-[color:var(--label-secondary)]">
                    {s.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-[color:var(--foreground)]">
                视频时长（秒）
              </label>
              <input
                type="number"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                min={15}
                max={600}
                className={fieldCls}
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-[color:var(--foreground)]">
                行业领域
              </label>
              <input
                type="text"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="例如：科技、美妆、教育"
                className={fieldCls}
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-[color:var(--foreground)]">
              补充信息（可选）
            </label>
            <textarea
              value={additionalInfo}
              onChange={(e) => setAdditionalInfo(e.target.value)}
              placeholder="产品特点、卖点、目标人群等补充信息..."
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
            {loading ? "⏳ 生成中..." : "🚀 生成脚本"}
          </button>
        </div>

        {result && (
          <div className="card-surface mt-6 rounded-2xl p-6 md:p-8">
            <h2 className="mb-4 text-lg font-semibold text-[color:var(--foreground)]">
              生成结果
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
