"use client";

import UnifiedMediaSelector from "@/app/components/UnifiedMediaSelector";
import { usePrefs } from "@/contexts/PrefsContext";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ImagePage() {
  const router = useRouter();
  const { prefs } = usePrefs();
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      alert("请输入图片描述");
      return;
    }

    setLoading(true);
    setResult(null);
    setImageUrl(null);

    try {
      const response = await fetch("/api/tools/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, quality: prefs.defaultImageQuality }),
      });

      const data = await response.json();
      setResult(data.result);

      // 优先提取本地文件路径，避免外网 URL 授权问题
      const localMatch = data.result?.match(
        /storage\/outputs\/([a-f0-9\-]+\.(jpg|png|jpeg|gif|webp))/i,
      );
      if (localMatch) {
        setImageUrl(`/api/media/${localMatch[1]}`);
      } else {
        // 回退到外网 URL
        const urlMatch = data.result?.match(
          /https?:\/\/[^\s\n\]]+\.(jpg|png|jpeg|webp|gif)(\?[^\s\n\]]*)?/i,
        );
        if (urlMatch) {
          setImageUrl(urlMatch[0]);
        }
      }
    } catch (error) {
      setResult(`生成失败: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  // 预设提示词
  const presets = [
    { name: "产品展示", prompt: "专业产品摄影，白色背景，柔和光线，高清细节" },
    {
      name: "人物肖像",
      prompt: "专业人物肖像照，自然光线，虚化背景，面部清晰",
    },
    {
      name: "风景场景",
      prompt: "壮丽自然风景，金色黄昏光线，宽广视角，高对比度",
    },
    {
      name: "科技风格",
      prompt: "未来科技感设计，霓虹灯光，深色背景，金属质感",
    },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6">
        {/* Header */}
        <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="flex items-center justify-center w-8 h-8 rounded-xl text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)] transition-colors shrink-0"
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
              <h1 className="text-2xl font-bold text-gray-800">
                🖼️ AI 图片生成
              </h1>
              <p className="text-gray-500 mt-1">生成高质量的 AI 视觉艺术</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <UnifiedMediaSelector modality="image" />
          </div>
        </div>

        {/* Form */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">
          {/* 预设模板 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              快速模板
            </label>
            <div className="flex flex-wrap gap-2">
              {presets.map((p) => (
                <button
                  key={p.name}
                  onClick={() => setPrompt(p.prompt)}
                  className="px-4 py-2 text-sm font-medium text-gray-800 bg-gray-100 rounded-lg border border-gray-300 hover:bg-blue-50 hover:border-blue-400 hover:text-blue-700 transition-colors"
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          {/* 提示词输入 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              图片描述 *
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="详细描述你想要生成的图片内容，包括风格、颜色、构图等..."
              rows={4}
              className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 resize-none text-gray-900"
            />
          </div>

          {/* 生成按钮 */}
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="w-full py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {loading ? "⏳ 生成中（约30秒）..." : "🎨 生成图片"}
          </button>
        </div>

        {/* Result */}
        {(imageUrl || result) && (
          <div className="mt-6 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">
              生成结果
            </h2>

            {imageUrl && (
              <div className="mb-4">
                <img
                  src={imageUrl}
                  alt="Generated Image"
                  className="w-full rounded-lg shadow-sm"
                  onError={(e) => {
                    // 图片加载失败时显示错误信息
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
                <div className="mt-3 flex gap-2 flex-wrap">
                  <a
                    href={imageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 bg-gray-100 text-gray-800 font-medium rounded-lg hover:bg-gray-200 text-sm border border-gray-300"
                  >
                    🔗 新窗口打开
                  </a>
                  <button
                    onClick={() => {
                      // 使用 fetch 下载图片避免跨域问题
                      fetch(imageUrl)
                        .then((res) => res.blob())
                        .then((blob) => {
                          const url = window.URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `image_${Date.now()}.jpg`;
                          document.body.appendChild(a);
                          a.click();
                          window.URL.revokeObjectURL(url);
                          document.body.removeChild(a);
                        })
                        .catch(() => {
                          // 如果fetch失败，尝试直接打开
                          window.open(imageUrl, "_blank");
                        });
                    }}
                    className="px-4 py-2 bg-blue-100 text-blue-800 font-medium rounded-lg hover:bg-blue-200 text-sm border border-blue-300"
                  >
                    ⬇️ 下载图片
                  </button>
                </div>
              </div>
            )}

            {/* 始终显示完整结果 */}
            <div className="mt-4">
              <details className={imageUrl ? "" : "open"}>
                <summary className="cursor-pointer text-sm text-gray-600 hover:text-gray-800">
                  {imageUrl ? "查看详细信息" : "生成结果"}
                </summary>
                <pre className="mt-2 bg-slate-100 text-slate-900 p-5 rounded-lg overflow-x-auto text-base leading-loose whitespace-pre-wrap font-mono border border-slate-200">
                  {result}
                </pre>
              </details>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
