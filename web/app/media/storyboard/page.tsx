"use client";

import { useCallback, useState } from "react";
import PublishModal from "../../components/PublishModal";
import UnifiedMediaSelector from "../../components/UnifiedMediaSelector";
import {
    FRAME_COUNT_OPTIONS,
    STYLE_OPTIONS,
    TOPIC_PRESETS,
    WORKFLOW_STEPS,
} from "./constants";
import StoryboardFrameCard, { StoryboardFrame } from "./StoryboardFrameCard";

interface StoryboardScript {
  title: string;
  theme: string;
  frames: StoryboardFrame[];
}

type WorkflowStep = "input" | "edit" | "generate";

export default function StoryboardPage() {
  // 工作流状态
  const [currentStep, setCurrentStep] = useState<WorkflowStep>("input");

  // 输入阶段
  const [topic, setTopic] = useState("");
  const [frameCount, setFrameCount] = useState(4);
  const [style, setStyle] = useState("电影感");
  const [generatingScript, setGeneratingScript] = useState(false);

  // 编辑阶段
  const [script, setScript] = useState<StoryboardScript | null>(null);
  const [frames, setFrames] = useState<StoryboardFrame[]>([]);

  // 视频生成阶段
  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoResult, setVideoResult] = useState<string | null>(null);
  const [loadingMessage, setLoadingMessage] = useState("");

  // 音频设置
  const [addNarration, setAddNarration] = useState(false);
  const [narrationText, setNarrationText] = useState("");
  const [addBgm, setAddBgm] = useState(false);

  // 第一步：生成故事板脚本
  const handleGenerateScript = async () => {
    if (!topic.trim()) {
      alert("请输入视频主题");
      return;
    }

    setGeneratingScript(true);

    try {
      const response = await fetch("/api/tools/storyboard/generate-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          frameCount,
          style,
        }),
      });

      const data = await response.json();

      if (data.error) {
        alert(`生成失败: ${data.error}`);
        return;
      }

      if (data.script) {
        setScript(data.script);
        setFrames(
          data.script.frames.map((f: StoryboardFrame) => ({
            ...f,
            generating: false,
            imageUrl: undefined,
            error: undefined,
          })),
        );
        setCurrentStep("edit");
      }
    } catch (error) {
      alert(`生成失败: ${error}`);
    } finally {
      setGeneratingScript(false);
    }
  };

  // 生成单个分镜图片
  const handleGenerateFrameImage = async (frameId: string) => {
    const frameIndex = frames.findIndex((f) => f.id === frameId);
    if (frameIndex === -1) return;

    // 更新状态为生成中
    setFrames((prev) =>
      prev.map((f) =>
        f.id === frameId ? { ...f, generating: true, error: undefined } : f,
      ),
    );

    try {
      const frame = frames[frameIndex];
      const response = await fetch("/api/tools/storyboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: frame.prompt,
          frameId,
        }),
      });

      const data = await response.json();

      setFrames((prev) =>
        prev.map((f) =>
          f.id === frameId
            ? {
                ...f,
                generating: false,
                imageUrl: data.imageUrl || undefined,
                error: data.error || undefined,
                customImage: undefined,
                customImagePreview: undefined,
              }
            : f,
        ),
      );
    } catch (error: any) {
      setFrames((prev) =>
        prev.map((f) =>
          f.id === frameId
            ? { ...f, generating: false, error: error.message }
            : f,
        ),
      );
    }
  };

  // 批量生成所有分镜图片
  const handleGenerateAllImages = async () => {
    for (const frame of frames) {
      if (!frame.imageUrl && !frame.customImagePreview) {
        await handleGenerateFrameImage(frame.id);
      }
    }
  };

  // 上传自定义图片
  const handleCustomImageUpload = (
    frameId: string,
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      setFrames((prev) =>
        prev.map((f) =>
          f.id === frameId
            ? {
                ...f,
                customImage: file,
                customImagePreview: e.target?.result as string,
                imageUrl: undefined,
                error: undefined,
              }
            : f,
        ),
      );
    };
    reader.readAsDataURL(file);
  };

  // 更新分镜信息
  const updateFrame = (frameId: string, updates: Partial<StoryboardFrame>) => {
    setFrames((prev) =>
      prev.map((f) => (f.id === frameId ? { ...f, ...updates } : f)),
    );
  };

  // 添加新分镜
  const addFrame = () => {
    const newId = `frame_${frames.length + 1}_${Date.now()}`;
    setFrames((prev) => [
      ...prev,
      {
        id: newId,
        prompt: "",
        description: `新场景 ${frames.length + 1}`,
        duration: 3,
      },
    ]);
  };

  // 删除分镜
  const removeFrame = (frameId: string) => {
    if (frames.length <= 1) {
      alert("至少需要保留一个分镜");
      return;
    }
    setFrames((prev) => prev.filter((f) => f.id !== frameId));
  };

  // 移动分镜顺序
  const moveFrame = (frameId: string, direction: "up" | "down") => {
    const index = frames.findIndex((f) => f.id === frameId);
    if (index === -1) return;

    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= frames.length) return;

    const newFrames = [...frames];
    [newFrames[index], newFrames[newIndex]] = [
      newFrames[newIndex],
      newFrames[index],
    ];
    setFrames(newFrames);
  };

  // 检查是否所有分镜都有图片
  const allFramesHaveImages = frames.every(
    (f) => f.imageUrl || f.customImagePreview,
  );

  // 获取可用于生成视频的图片路径
  const getVideoSourcePaths = useCallback(async () => {
    const paths: string[] = [];

    for (const frame of frames) {
      if (frame.customImage) {
        // 上传自定义图片
        const formData = new FormData();
        formData.append("file", frame.customImage);

        try {
          const response = await fetch("/api/upload", {
            method: "POST",
            body: formData,
          });
          const data = await response.json();
          if (data.filepath) {
            paths.push(data.filepath);
          }
        } catch (error) {
          console.error("Upload failed:", error);
        }
      } else if (frame.imageUrl) {
        // 已生成的图片 - 从 URL 转换为路径
        const match = frame.imageUrl.match(/\/api\/media\/(.+)/);
        if (match) {
          paths.push(`./storage/outputs/${match[1]}`);
        } else {
          // 外部 URL，需要下载
          paths.push(frame.imageUrl);
        }
      }
    }

    return paths;
  }, [frames]);

  // 生成最终视频
  const handleGenerateVideo = async () => {
    if (!allFramesHaveImages) {
      alert("请先为所有分镜生成或上传图片");
      return;
    }

    setGeneratingVideo(true);
    setVideoUrl(null);
    setVideoResult(null);
    setCurrentStep("generate");

    try {
      // 准备分镜数据，上传自定义图片
      const preparedFrames = [];
      for (const frame of frames) {
        let imageUrl = frame.imageUrl || "";

        // 如果是自定义上传的图片，先上传到服务器
        if (frame.customImage) {
          const formData = new FormData();
          formData.append("file", frame.customImage);

          try {
            const uploadResponse = await fetch("/api/upload", {
              method: "POST",
              body: formData,
            });
            const uploadData = await uploadResponse.json();
            if (uploadData.url) {
              imageUrl = uploadData.url;
            }
          } catch (uploadError) {
            console.error("Upload failed:", uploadError);
          }
        }

        preparedFrames.push({
          id: frame.id,
          imageUrl,
          prompt: frame.prompt,
          description: frame.description,
          duration: frame.duration,
        });
      }

      // 调用故事板视频生成 API
      const response = await fetch("/api/tools/storyboard/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          frames: preparedFrames,
          title: script?.title || topic,
          addNarration,
          narrationText:
            narrationText || frames.map((f) => f.description).join("。"),
          addBgm,
        }),
      });

      const data = await response.json();

      if (data.task_id) {
        // 异步轮询模式
        setLoadingMessage("✅ 任务已提交，后台处理中...");
        let terminal = false;
        let attempts = 0;
        const maxAttempts = 600; // 10分钟

        while (!terminal && attempts < maxAttempts) {
          attempts++;
          await new Promise((r) => setTimeout(r, 2000));

          const statusRes = await fetch(
            `/api/tools/video/ai-remix/status/${data.task_id}`,
          );
          if (!statusRes.ok) continue;

          const statusData = await statusRes.json();

          if (statusData.message) {
            setLoadingMessage(`⏳ ${statusData.message}`);
          }

          if (statusData.status === "completed") {
            terminal = true;
            const resultData = statusData.result;
            if (resultData && resultData.final_video) {
              let videoPath = resultData.final_video;
              if (videoPath.includes("storage/outputs/")) {
                videoPath = videoPath.split("storage/outputs/")[1];
              } else if (videoPath.startsWith("/media/")) {
                videoPath = videoPath.replace("/media/", "");
              }
              setVideoUrl(`/api/media/${videoPath}`);
              setVideoResult(resultData.message || "✅ 视频生成成功！");
            }
          } else if (statusData.status === "failed") {
            terminal = true;
            setVideoResult(`❌ 混剪失败: ${statusData.error || "未知错误"}`);
          }
        }

        if (!terminal) {
          setVideoResult("❌ 混剪任务超时");
        }
      } else if (data.success && data.final_video) {
        // 处理不同格式的路径
        let videoPath = data.final_video;
        if (videoPath.includes("storage/outputs/")) {
          videoPath = videoPath.split("storage/outputs/")[1];
        } else if (videoPath.startsWith("/media/")) {
          videoPath = videoPath.replace("/media/", "");
        }
        if (videoPath) {
          setVideoUrl(`/api/media/${videoPath}`);
        }
      }

      setVideoResult(data.message || data.error || "生成完成");
    } catch (error: any) {
      setVideoResult(`生成失败: ${error.message}`);
      setCurrentStep("edit");
    } finally {
      setGeneratingVideo(false);
    }
  };

  // 返回上一步
  const goBack = () => {
    if (currentStep === "edit") {
      setCurrentStep("input");
    } else if (currentStep === "generate") {
      setCurrentStep("edit");
    }
  };

  // 重新开始
  const restart = () => {
    setCurrentStep("input");
    setScript(null);
    setFrames([]);
    setVideoUrl(null);
    setVideoResult(null);
  };

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-br from-slate-50 to-blue-50">
      <div className="max-w-6xl mx-auto p-6">
        {/* Header */}
        <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
              🎬 故事板视频生成器
            </h1>
            <p className="text-gray-500 mt-2">
              三步创建专业视频：生成分镜 → 编辑调整 → 合成视频
            </p>
          </div>
          <div className="flex items-center gap-3">
            <UnifiedMediaSelector modality="image" />
          </div>
        </div>

        {/* 进度指示器 */}
        <div className="mb-8">
          <div className="flex items-center justify-center gap-4">
            {WORKFLOW_STEPS.map((item, index) => (
              <div key={item.step} className="flex items-center">
                <div
                  className={`flex items-center gap-2 px-4 py-2 rounded-full font-medium transition-all ${
                    currentStep === item.step
                      ? "bg-gradient-to-r from-purple-500 to-blue-500 text-white shadow-lg"
                      : frames.length > 0 && item.step === "input"
                        ? "bg-green-100 text-green-700"
                        : item.step === "generate" && videoUrl
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-500"
                  }`}
                >
                  <span>{item.icon}</span>
                  <span className="hidden sm:inline">{item.label}</span>
                </div>
                {index < 2 && <div className="w-8 h-0.5 bg-gray-200 mx-2" />}
              </div>
            ))}
          </div>
        </div>

        {/* 第一步：输入主题 */}
        {currentStep === "input" && (
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
            <h2 className="text-xl font-semibold text-gray-800 mb-6">
              📝 描述你的视频主题
            </h2>

            {/* 预设主题 */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-600 mb-3">
                快速开始
              </label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {TOPIC_PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    onClick={() => setTopic(preset.topic)}
                    className="p-3 text-left text-sm font-medium text-gray-700 bg-gradient-to-r from-gray-50 to-gray-100 rounded-xl border border-gray-200 hover:border-purple-400 hover:from-purple-50 hover:to-blue-50 transition-all"
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>

            {/* 主题输入 */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-600 mb-2">
                视频主题 *
              </label>
              <textarea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="描述你想要制作的视频内容，例如：一段关于春天的诗意短片，展现花开、蝴蝶、微风等元素..."
                rows={4}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none text-gray-800 placeholder-gray-400"
              />
            </div>

            {/* 设置选项 */}
            <div className="grid grid-cols-2 gap-6 mb-8">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-2">
                  分镜数量
                </label>
                <select
                  value={frameCount}
                  onChange={(e) => setFrameCount(Number(e.target.value))}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 text-gray-800"
                >
                  {FRAME_COUNT_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n} 个分镜
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-2">
                  视觉风格
                </label>
                <select
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 text-gray-800"
                >
                  {STYLE_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              onClick={handleGenerateScript}
              disabled={generatingScript || !topic.trim()}
              className="w-full py-4 bg-gradient-to-r from-purple-500 to-blue-500 text-white font-semibold rounded-xl hover:from-purple-600 hover:to-blue-600 transition-all disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed shadow-lg"
            >
              {generatingScript ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin">⏳</span>
                  AI 正在生成分镜脚本...
                </span>
              ) : (
                "✨ 生成故事板分镜"
              )}
            </button>
          </div>
        )}

        {/* 第二步：编辑分镜 */}
        {currentStep === "edit" && (
          <div className="space-y-6">
            {/* 操作栏 */}
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-4">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-4">
                  <button
                    onClick={goBack}
                    className="px-4 py-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    ← 返回修改主题
                  </button>
                  <div className="h-6 w-px bg-gray-200" />
                  <span className="text-lg font-semibold text-gray-800">
                    {script?.title || "故事板编辑"}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={addFrame}
                    className="px-4 py-2 text-purple-600 bg-purple-50 hover:bg-purple-100 rounded-lg font-medium transition-colors"
                  >
                    ➕ 添加分镜
                  </button>
                  <button
                    onClick={handleGenerateAllImages}
                    disabled={frames.some((f) => f.generating)}
                    className="px-4 py-2 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg font-medium transition-colors disabled:opacity-50"
                  >
                    🎨 批量生成图片
                  </button>
                </div>
              </div>
            </div>

            {/* 分镜列表 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {frames.map((frame, index) => (
                <StoryboardFrameCard
                  key={frame.id}
                  frame={frame}
                  index={index}
                  totalFrames={frames.length}
                  onMove={moveFrame}
                  onRemove={removeFrame}
                  onGenerate={handleGenerateFrameImage}
                  onUpload={handleCustomImageUpload}
                  onUpdate={updateFrame}
                />
              ))}
            </div>

            {/* 音频设置 */}
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">
                🔊 音频设置（可选）
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={addNarration}
                      onChange={(e) => setAddNarration(e.target.checked)}
                      className="w-5 h-5 rounded text-purple-500 focus:ring-purple-500"
                    />
                    <span className="font-medium text-gray-700">
                      添加 AI 配音
                    </span>
                  </label>
                  {addNarration && (
                    <textarea
                      value={narrationText}
                      onChange={(e) => setNarrationText(e.target.value)}
                      placeholder="输入配音文本，留空则自动根据场景描述生成..."
                      rows={3}
                      className="mt-3 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-800"
                    />
                  )}
                </div>
                <div>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={addBgm}
                      onChange={(e) => setAddBgm(e.target.checked)}
                      className="w-5 h-5 rounded text-purple-500 focus:ring-purple-500"
                    />
                    <span className="font-medium text-gray-700">
                      添加背景音乐
                    </span>
                  </label>
                </div>
              </div>
            </div>

            {/* 生成视频按钮 */}
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-600">
                    共 {frames.length} 个分镜，
                    {allFramesHaveImages ? (
                      <span className="text-green-600 font-medium">
                        ✅ 所有分镜已准备就绪
                      </span>
                    ) : (
                      <span className="text-orange-500 font-medium">
                        ⚠️ 还有{" "}
                        {
                          frames.filter(
                            (f) => !f.imageUrl && !f.customImagePreview,
                          ).length
                        }{" "}
                        个分镜缺少图片
                      </span>
                    )}
                  </p>
                </div>
                <button
                  onClick={handleGenerateVideo}
                  disabled={!allFramesHaveImages || generatingVideo}
                  className="px-8 py-3 bg-gradient-to-r from-green-500 to-emerald-500 text-white font-semibold rounded-xl hover:from-green-600 hover:to-emerald-600 transition-all disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed shadow-lg"
                >
                  {generatingVideo ? (
                    <span className="flex items-center gap-2">
                      <span className="animate-spin">⏳</span>
                      生成视频中（约2-5分钟）...
                    </span>
                  ) : (
                    "🎬 生成最终视频"
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 第三步：视频结果 */}
        {currentStep === "generate" && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-gray-800">
                  🎬 视频生成结果
                </h2>
                <div className="flex gap-3">
                  <button
                    onClick={goBack}
                    className="px-4 py-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    ← 返回编辑
                  </button>
                  <button
                    onClick={restart}
                    className="px-4 py-2 text-purple-600 bg-purple-50 hover:bg-purple-100 rounded-lg font-medium transition-colors"
                  >
                    🔄 创建新视频
                  </button>
                </div>
              </div>

              {videoUrl ? (
                <div className="space-y-4">
                  <div className="aspect-video bg-black rounded-xl overflow-hidden">
                    <video
                      src={videoUrl}
                      controls
                      className="w-full h-full"
                      autoPlay
                    />
                  </div>
                  <div className="flex gap-3">
                    <a
                      href={videoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2 bg-blue-50 text-blue-600 rounded-lg font-medium hover:bg-blue-100 transition-colors"
                    >
                      🔗 新窗口打开
                    </a>
                    <button
                      onClick={() => {
                        fetch(videoUrl)
                          .then((res) => res.blob())
                          .then((blob) => {
                            const url = window.URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = `storyboard_video_${Date.now()}.mp4`;
                            document.body.appendChild(a);
                            a.click();
                            window.URL.revokeObjectURL(url);
                            document.body.removeChild(a);
                          });
                      }}
                      className="px-4 py-2 bg-green-50 text-green-600 rounded-lg font-medium hover:bg-green-100 transition-colors"
                    >
                      ⬇️ 下载视频
                    </button>
                    <PublishModal
                      content={script?.title || topic || "AI视频故事板"}
                      mediaUrl={videoUrl || ""}
                      mediaType="video"
                    />
                  </div>
                </div>
              ) : generatingVideo ? (
                <div className="aspect-video bg-gradient-to-br from-purple-100 to-blue-100 rounded-xl flex items-center justify-center">
                  <div className="text-center">
                    <div className="animate-spin text-6xl mb-4">🎬</div>
                    <p className="text-xl font-medium text-gray-700">
                      正在生成视频...
                    </p>
                    <p className="text-gray-500 mt-2">这可能需要几分钟时间</p>
                  </div>
                </div>
              ) : (
                <div className="aspect-video bg-gray-100 rounded-xl flex items-center justify-center">
                  <div className="text-center text-gray-500">
                    <p className="text-lg">{videoResult || "等待生成..."}</p>
                  </div>
                </div>
              )}

              {videoResult && (
                <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                  <details>
                    <summary className="cursor-pointer text-sm text-gray-600 hover:text-gray-800">
                      查看详细结果
                    </summary>
                    <pre className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">
                      {videoResult}
                    </pre>
                  </details>
                </div>
              )}
            </div>

            {/* 使用的分镜预览 */}
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">
                📖 故事板预览
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {frames.map((frame, index) => (
                  <div
                    key={frame.id}
                    className="aspect-video bg-gray-100 rounded-lg overflow-hidden relative"
                  >
                    {(frame.customImagePreview || frame.imageUrl) && (
                      <img
                        src={frame.customImagePreview || frame.imageUrl}
                        alt={frame.description}
                        className="w-full h-full object-cover"
                      />
                    )}
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-2">
                      {index + 1}. {frame.description}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
