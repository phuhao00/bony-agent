"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// 平台选项
const platforms = [
  { id: "douyin", name: "抖音", icon: "📱" },
  { id: "xiaohongshu", name: "小红书", icon: "📕" },
  { id: "bilibili", name: "B站", icon: "📺" },
  { id: "wechat", name: "微信", icon: "💚" },
];

export default function ModerationPage() {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [platform, setPlatform] = useState("douyin");
  const [result, setResult] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"check" | "fix" | "rules">(
    "check",
  );

  const handleCheck = async () => {
    if (!content.trim()) {
      alert("请输入待审核的内容");
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const endpoint =
        activeTab === "fix"
          ? "/api/tools/moderation/fix"
          : "/api/tools/moderation/check";

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, platform }),
      });

      const data = await response.json();
      setResult(data.result || JSON.stringify(data, null, 2));
    } catch (error) {
      setResult(`操作失败: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const handleGetRules = async () => {
    setLoading(true);
    setResult(null);

    try {
      const response = await fetch(
        `/api/tools/moderation/rules?platform=${platform}`,
      );
      const data = await response.json();
      setResult(data.result || JSON.stringify(data, null, 2));
    } catch (error) {
      setResult(`获取失败: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6">
        {/* Header */}
        <div className="mb-8 flex items-start gap-3">
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
            <h1 className="text-2xl font-bold text-gray-800">🔍 内容审核</h1>
            <p className="text-gray-500 mt-1">
              智能检测敏感词和违规内容，确保发布安全
            </p>
          </div>
        </div>

        {/* Tab Switch */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab("check")}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === "check"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            🔍 内容检测
          </button>
          <button
            onClick={() => setActiveTab("fix")}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === "fix"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            🔧 自动修复
          </button>
          <button
            onClick={() => setActiveTab("rules")}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === "rules"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            📋 平台规则
          </button>
        </div>

        {/* Form */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">
          {/* 平台选择 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              目标平台
            </label>
            <div className="flex flex-wrap gap-2">
              {platforms.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPlatform(p.id)}
                  className={`px-4 py-2 rounded-lg border font-medium transition-colors ${
                    platform === p.id
                      ? "bg-blue-50 border-blue-500 text-blue-700"
                      : "border-gray-300 text-gray-800 bg-gray-100 hover:bg-blue-50 hover:border-blue-400"
                  }`}
                >
                  {p.icon} {p.name}
                </button>
              ))}
            </div>
          </div>

          {/* 内容输入（非规则模式） */}
          {activeTab !== "rules" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                待审核内容 *
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="在这里粘贴需要审核的文案内容..."
                rows={8}
                className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 resize-none text-gray-900"
              />
              <div className="mt-2 text-sm text-gray-500">
                已输入 {content.length} 字
              </div>
            </div>
          )}

          {/* 操作按钮 */}
          {activeTab === "rules" ? (
            <button
              onClick={handleGetRules}
              disabled={loading}
              className="w-full py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {loading ? "⏳ 获取中..." : "📋 查看平台规则"}
            </button>
          ) : (
            <button
              onClick={handleCheck}
              disabled={loading}
              className="w-full py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {loading
                ? "⏳ 处理中..."
                : activeTab === "check"
                  ? "🔍 开始审核"
                  : "🔧 自动修复"}
            </button>
          )}
        </div>

        {/* Result */}
        {result && (
          <div className="mt-6 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">
              {activeTab === "check"
                ? "审核结果"
                : activeTab === "fix"
                  ? "修复结果"
                  : "平台规则"}
            </h2>
            <pre className="bg-slate-100 text-slate-900 p-5 rounded-lg overflow-x-auto text-base leading-loose whitespace-pre-wrap font-mono border border-slate-200">
              {typeof result === "string"
                ? result
                : JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}

        {/* Tips */}
        <div className="mt-6 bg-yellow-50 border border-yellow-200 rounded-xl p-4">
          <h3 className="font-medium text-yellow-800 mb-2">💡 审核提示</h3>
          <ul className="text-sm text-yellow-700 space-y-1">
            <li>• 系统会自动检测敏感词、绝对化用语和违规导流信息</li>
            <li>• 自动修复功能会保持内容原意，仅替换违规部分</li>
            <li>• 不同平台的审核规则有所差异，请选择正确的目标平台</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
