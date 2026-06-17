"use client";

import { usePrefs } from "@/contexts/PrefsContext";
import {
    Maximize2,
    Pause,
    Play,
    RotateCcw,
    Volume2,
    VolumeX,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import PublishModal from "../../components/PublishModal";
import UnifiedMediaSelector from "../../components/UnifiedMediaSelector";

type GenerationMode = "text" | "image" | "remix" | "long";
type RemixMode = "fast" | "ai";
type AIRemixMode = "fusion" | "segment";

interface UploadedFile {
  filename: string;
  url: string;
  filepath: string;
  type: "image" | "video";
  size: number;
}

interface AIRemixStage {
  stage: string;
  status: string;
  analyses?: { file: string; description: string }[];
  progress?: { segment: number; status: string; prompt: string }[];
}

interface AIRemixResult {
  success: boolean;
  stages: AIRemixStage[];
  script: {
    title: string;
    style: string;
    segments?: unknown[];
    fusion_prompt?: string;
    narrative?: string;
    overall_narrative?: string;
  };
  generated_segments: unknown[];
  final_video?: string;
  message?: string;
  error?: string;
}

interface LongVideoSegment {
  index: number;
  title: string;
  duration_sec: number;
  prompt: string;
  status: string;
  video_url?: string | null;
  local_path?: string | null;
  error?: string | null;
}

interface LongVideoTask {
  id: string;
  status: string;
  progress: number;
  error?: string | null;
  message?: string;
  result?: {
    provider: string;
    model: string;
    style?: string;
    duration_sec?: number;
    final_video?: string | null;
    final_video_url?: string | null;
    segments: LongVideoSegment[];
  };
}

interface VoiceOption {
  id: string;
  name: string;
  gender: string;
  description: string;
}

interface NarrationStyle {
  id: string;
  name: string;
  description: string;
}

interface BGMOption {
  id: string;
  name: string;
  path: string;
  description: string;
}

interface SubtitleStyle {
  id: string;
  name: string;
  fontsize: number;
  fontcolor: string;
}

interface AudioConfig {
  voices: VoiceOption[];
  styles: NarrationStyle[];
  bgm_list: BGMOption[];
  subtitle_styles: SubtitleStyle[];
}

export default function VideoPage() {
  // 通用状态
  const router = useRouter();
  const { prefs } = usePrefs();
  const [mode, setMode] = useState<GenerationMode>("text");
  const [remixMode, setRemixMode] = useState<RemixMode>("ai");
  const [aiRemixMode, setAiRemixMode] = useState<AIRemixMode>("fusion");
  const [result, setResult] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [aiRemixResult, setAiRemixResult] = useState<AIRemixResult | null>(
    null,
  );
  const [loadingMessage, setLoadingMessage] = useState<string>("");
  const [startTime, setStartTime] = useState<number | null>(null);
  const [videoProgress, setVideoProgress] = useState(0);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [playerVolume, setPlayerVolume] = useState(1);
  const [isPlayerMuted, setIsPlayerMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isPlayerFullscreen, setIsPlayerFullscreen] = useState(false);

  // 文生视频
  const [textPrompt, setTextPrompt] = useState("");

  // 长视频（Wan）
  const [longPrompt, setLongPrompt] = useState("");
  const [longDuration, setLongDuration] = useState(30);
  const [longStyle, setLongStyle] = useState("cinematic");
  const [longTaskId, setLongTaskId] = useState<string | null>(null);
  const [longTask, setLongTask] = useState<LongVideoTask | null>(null);

  // 图生视频
  const [imageUrl, setImageUrl] = useState("");
  const [imagePrompt, setImagePrompt] = useState("");
  const [uploadedImage, setUploadedImage] = useState<UploadedFile | null>(null);

  // 混剪模式
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [remixPrompt, setRemixPrompt] = useState("");

  // 音频设置
  const [audioConfig, setAudioConfig] = useState<AudioConfig | null>(null);
  const [addNarration, setAddNarration] = useState(false);
  const [narrationText, setNarrationText] = useState("");
  const [narrationStyle, setNarrationStyle] = useState("informative");
  const [narrationVoice, setNarrationVoice] = useState("zh-CN-XiaoxiaoNeural");
  const [addBgm, setAddBgm] = useState(false);
  const [bgmId, setBgmId] = useState("");
  const [bgmVolume, setBgmVolume] = useState(0.3);

  // 字幕设置
  const [addSubtitles, setAddSubtitles] = useState(false);
  const [subtitleText, setSubtitleText] = useState("");
  const [subtitleStyle, setSubtitleStyle] = useState("default");
  const [subtitlePosition, setSubtitlePosition] = useState("bottom");

  // ASR字幕设置
  const [useAsrSubtitles, setUseAsrSubtitles] = useState(false);
  const [asrMethod, setAsrMethod] = useState("whisper");
  const [asrLanguage, setAsrLanguage] = useState("zh");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const multiFileInputRef = useRef<HTMLInputElement>(null);
  const videoPlayerRef = useRef<HTMLVideoElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mode !== "long" || !longTaskId || !loading) return;

    const timer = setInterval(async () => {
      try {
        const response = await fetch(
          `/api/tools/video/long?task_id=${encodeURIComponent(longTaskId)}`,
          { cache: "no-store" },
        );
        const data: LongVideoTask = await response.json();
        if (!response.ok) {
          throw new Error((data as { error?: string }).error || "轮询失败");
        }

        setLongTask(data);
        setVideoProgress(data.progress || 0);
        setLoadingMessage(data.message || "正在生成长视频...");

        if (data.status === "completed") {
          setVideoUrl(data.result?.final_video_url || null);
          setResult(
            `✅ 长视频生成成功！\n\n**供应商:** 阿里通义 Wan\n**Model:** ${data.result?.model || "wan2.7-t2v"}\n**目标时长:** ${longDuration} 秒\n**实际时长:** ${data.result?.duration_sec || "未知"} 秒`,
          );
          setLoading(false);
        } else if (data.status === "failed") {
          setResult(`❌ 长视频生成失败: ${data.error || "未知错误"}`);
          setLoading(false);
        }
      } catch (error) {
        console.error("Long video polling failed:", error);
        setResult(`生成失败: ${error}`);
        setLoading(false);
      }
    }, 3000);

    return () => clearInterval(timer);
  }, [longDuration, longTaskId, loading, mode]);

  // 加载音频配置
  useEffect(() => {
    const loadAudioConfig = async () => {
      try {
        const response = await fetch("/api/tools/audio/config");
        if (response.ok) {
          const data = await response.json();
          setAudioConfig(data);
        }
      } catch (error) {
        console.error("Failed to load audio config:", error);
      }
    };
    loadAudioConfig();
  }, []);

  useEffect(() => {
    setIsVideoPlaying(false);
    setVideoCurrentTime(0);
    setVideoDuration(0);
  }, [videoUrl]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsPlayerFullscreen(
        document.fullscreenElement === videoContainerRef.current,
      );
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  const formatVideoTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds <= 0) return "00:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  const togglePlayback = async () => {
    const video = videoPlayerRef.current;
    if (!video) return;

    if (video.paused) {
      try {
        await video.play();
        setIsVideoPlaying(true);
      } catch (error) {
        console.error("Video play failed:", error);
      }
    } else {
      video.pause();
      setIsVideoPlaying(false);
    }
  };

  const restartVideo = async () => {
    const video = videoPlayerRef.current;
    if (!video) return;

    video.currentTime = 0;
    setVideoCurrentTime(0);
    try {
      await video.play();
      setIsVideoPlaying(true);
    } catch (error) {
      console.error("Video restart failed:", error);
    }
  };

  const handleSeek = (value: number) => {
    const video = videoPlayerRef.current;
    if (!video) return;

    video.currentTime = value;
    setVideoCurrentTime(value);
  };

  const handleVolumeChange = (value: number) => {
    const video = videoPlayerRef.current;
    if (!video) return;

    video.volume = value;
    video.muted = value === 0;
    setPlayerVolume(value);
    setIsPlayerMuted(value === 0);
  };

  const toggleMute = () => {
    const video = videoPlayerRef.current;
    if (!video) return;

    const nextMuted = !video.muted;
    video.muted = nextMuted;
    setIsPlayerMuted(nextMuted);
  };

  const changePlaybackRate = (value: number) => {
    const video = videoPlayerRef.current;
    if (!video) return;

    video.playbackRate = value;
    setPlaybackRate(value);
  };

  const toggleFullscreen = async () => {
    const container = videoContainerRef.current;
    if (!container) return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await container.requestFullscreen();
      }
    } catch (error) {
      console.error("Fullscreen toggle failed:", error);
    }
  };

  // 提取视频URL（从结果文本中解析，作为 data.video_url 的兜底）
  const extractVideoUrl = (resultText: string) => {
    // 优先匹配 "直接显示:" 后的绝对路径中的文件名
    const displayMatch = resultText?.match(/直接显示[：:]+\s*(\S+)/);
    if (displayMatch) {
      const filename = displayMatch[1].replace(/.*[\/\\]/, "");
      if (filename) return `/api/media/${filename}`;
    }
    // 匹配 storage/outputs/<任意文件名>.mp4|webm|mov
    const localMatch = resultText?.match(
      /storage\/outputs\/([^\s"')>]+\.(?:mp4|webm|mov))/i,
    );
    if (localMatch) {
      return `/api/media/${localMatch[1].replace(/.*[\/\\]/, "")}`;
    }
    const urlMatch = resultText?.match(/https?:\/\/[^\s]+\.(?:mp4|webm|mov)/i);
    if (urlMatch) {
      return urlMatch[0];
    }
    return null;
  };

  // 文生视频
  const handleTextGenerate = async () => {
    if (!textPrompt.trim()) {
      alert("请输入视频描述");
      return;
    }

    setLoading(true);
    setResult(null);
    setVideoUrl(null);
    setVideoProgress(0);

    const startMs = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - startMs;
      const pct = Math.min(
        90,
        Math.round(90 * (1 - Math.exp(-elapsed / 80000))),
      );
      setVideoProgress(pct);
    }, 800);
    try {
      const response = await fetch("/api/tools/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: textPrompt,
          resolution: prefs.defaultVideoRes,
        }),
      });

      const data = await response.json();
      clearInterval(timer);
      setVideoProgress(100);
      setResult(data.result);
      setVideoUrl(data.video_url || extractVideoUrl(data.result));
    } catch (error) {
      clearInterval(timer);
      setVideoProgress(0);
      setResult(`生成失败: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const handleLongGenerate = async () => {
    if (!longPrompt.trim()) {
      alert("请输入长视频描述");
      return;
    }

    setLoading(true);
    setResult(null);
    setVideoUrl(null);
    setAiRemixResult(null);
    setLongTask(null);
    setLongTaskId(null);
    setVideoProgress(3);
    setLoadingMessage("🧠 正在规划 Wan 长视频分镜...");
    setStartTime(Date.now());

    try {
      const response = await fetch("/api/tools/video/long", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: longPrompt,
          duration_sec: longDuration,
          style: longStyle,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "提交失败");
      }

      setLongTaskId(data.task_id);
      setResult(data.message || "长视频任务已提交");
    } catch (error) {
      setLoading(false);
      setVideoProgress(0);
      setResult(`生成失败: ${error}`);
    }
  };

  // 上传图片
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (data.error) {
        alert(data.error);
        return;
      }

      setUploadedImage({
        filename: data.filename,
        url: `/api/uploads/${data.filename}`,
        filepath: data.filepath,
        type: data.type,
        size: data.size,
      });
    } catch (error) {
      alert(`上传失败: ${error}`);
    }
  };

  // 图生视频
  const handleImageToVideo = async () => {
    const url = imageUrl || uploadedImage?.url;
    if (!url) {
      alert("请输入图片URL或上传图片");
      return;
    }

    // 如果是本地上传的图片，需要提醒用户
    if (url.startsWith("/api/uploads/")) {
      alert(
        "注意：本地上传的图片需要公网可访问的URL才能使用图生视频功能。\n\n请使用公网图片URL，或将图片上传到图床后使用。",
      );
      return;
    }

    setLoading(true);
    setResult(null);
    setVideoUrl(null);
    setVideoProgress(0);

    const startMs = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - startMs;
      const pct = Math.min(
        90,
        Math.round(90 * (1 - Math.exp(-elapsed / 80000))),
      );
      setVideoProgress(pct);
    }, 800);
    try {
      const response = await fetch("/api/tools/video/from-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: url, prompt: imagePrompt }),
      });

      const data = await response.json();
      clearInterval(timer);
      setVideoProgress(100);
      setResult(data.result);
      setVideoUrl(data.video_url || extractVideoUrl(data.result));
    } catch (error) {
      clearInterval(timer);
      setVideoProgress(0);
      setResult(`生成失败: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  // 上传多个文件（混剪素材）
  const handleMultiFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = e.target.files;
    if (!files) return;

    const newFiles: UploadedFile[] = [];

    for (const file of Array.from(files)) {
      const formData = new FormData();
      formData.append("file", file);

      try {
        const response = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });

        const data = await response.json();
        if (!data.error) {
          newFiles.push({
            filename: data.filename,
            url: `/api/uploads/${data.filename}`,
            filepath: data.filepath,
            type: data.type,
            size: data.size,
          });
        }
      } catch (error) {
        console.error(`上传 ${file.name} 失败:`, error);
      }
    }

    setUploadedFiles([...uploadedFiles, ...newFiles]);
  };

  // 删除上传的文件
  const removeUploadedFile = (index: number) => {
    setUploadedFiles(uploadedFiles.filter((_, i) => i !== index));
  };

  // 混剪生成
  const handleRemixGenerate = async () => {
    if (uploadedFiles.length < (remixMode === "fast" ? 2 : 1)) {
      alert(
        remixMode === "fast"
          ? "请至少上传2个素材文件"
          : "请至少上传1个素材文件",
      );
      return;
    }

    setLoading(true);
    setResult(null);
    setVideoUrl(null);
    setAiRemixResult(null);
    setVideoProgress(0);

    try {
      const filePaths = uploadedFiles.map((f) => f.filepath);

      if (remixMode === "fast") {
        // 快速拼接模式 — 进度条（约10-30s）
        const fastStartMs = Date.now();
        const fastTimer = setInterval(() => {
          const elapsed = Date.now() - fastStartMs;
          const pct = Math.min(
            90,
            Math.round(90 * (1 - Math.exp(-elapsed / 15000))),
          );
          setVideoProgress(pct);
        }, 500);

        try {
          const response = await fetch("/api/tools/video/remix", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              file_paths: filePaths,
              transition: "fade",
              duration_per_clip: 3.0,
            }),
          });

          const data = await response.json();
          clearInterval(fastTimer);
          setVideoProgress(100);
          setResult(data.result);
          setVideoUrl(data.video_url || extractVideoUrl(data.result));
        } catch (e) {
          clearInterval(fastTimer);
          setVideoProgress(0);
          throw e;
        }
      } else {
        // AI智能混剪模式
        setLoadingMessage("🔍 正在分析素材内容...");
        setStartTime(Date.now());

        // 进度条动画（AI混剪预计2-10分钟）
        const aiEstimatedMs = uploadedFiles.length * 180000; // ~3min per file
        const aiStartMs = Date.now();
        const aiProgressTimer = setInterval(() => {
          const elapsed = Date.now() - aiStartMs;
          const pct = Math.min(
            90,
            Math.round(90 * (1 - Math.exp(-elapsed / (aiEstimatedMs * 0.8)))),
          );
          setVideoProgress(pct);
        }, 1000);

        // 根据模式选择进度消息
        const fusionProgressMessages = [
          "🔍 正在分析素材内容...",
          "✨ AI正在融合创意...",
          "🎬 正在生成融合视频（约1-2分钟）...",
        ];
        const segmentProgressMessages = [
          "🔍 正在分析素材内容...",
          "📝 AI正在生成剪辑脚本...",
          "🎬 正在生成AI视频片段（每个约1-2分钟）...",
          "🎞️ 正在合成最终视频...",
        ];
        const progressMessages =
          aiRemixMode === "fusion"
            ? fusionProgressMessages
            : segmentProgressMessages;

        // 如果添加了音频选项，更新进度消息
        if (addNarration || addBgm) {
          progressMessages.push("🔊 正在合成音频...");
        }

        // 如果添加了字幕选项，更新进度消息
        if (addSubtitles) {
          progressMessages.push("📝 正在添加字幕...");
        }

        // 如果使用ASR字幕
        if (useAsrSubtitles) {
          progressMessages.push("🎙️ 正在识别语音并生成字幕...");
        }

        let msgIndex = 0;
        const progressInterval = setInterval(() => {
          msgIndex = Math.min(msgIndex + 1, progressMessages.length - 1);
          setLoadingMessage(progressMessages[msgIndex]);
        }, 60000); // 每分钟更新一次消息

        try {
          const response = await fetch("/api/tools/video/ai-remix", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              file_paths: filePaths,
              user_prompt: remixPrompt,
              fusion_mode: aiRemixMode === "fusion",
              generate_ai_segments: true,
              segment_duration: 4,
              // 音频参数
              add_narration: addNarration,
              narration_text: narrationText,
              narration_style: narrationStyle,
              narration_voice: narrationVoice,
              add_bgm: addBgm,
              bgm_id: bgmId,
              bgm_volume: bgmVolume,
              // 字幕参数
              add_subtitles: addSubtitles,
              subtitle_text: subtitleText,
              subtitle_style: subtitleStyle,
              subtitle_position: subtitlePosition,
              // ASR字幕参数
              use_asr_subtitles: useAsrSubtitles,
              asr_method: asrMethod,
              asr_language: asrLanguage,
            }),
          });

          clearInterval(progressInterval);

          if (!response.ok) {
            clearInterval(aiProgressTimer);
            const errorText = await response.text();
            throw new Error(
              `API Error (${response.status}): ${errorText.substring(0, 100)}`,
            );
          }

          const data = await response.json();

          if (data.task_id) {
            // 异步轮询模式
            setLoadingMessage("✅ 任务已提交，后台处理中...");
            let terminal = false;
            let attempts = 0;
            const maxAttempts = 600; // 10分钟

            while (!terminal && attempts < maxAttempts) {
              attempts++;
              // 每2秒查一次
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
                clearInterval(aiProgressTimer);
                setVideoProgress(100);
                const resultData = statusData.result as AIRemixResult;
                setAiRemixResult(resultData);
                if (resultData.final_video) {
                  const videoPath =
                    resultData.final_video.split("storage/outputs/")[1];
                  if (videoPath) {
                    setVideoUrl(`/api/media/${videoPath}`);
                  }
                }
                if (resultData.message) {
                  setResult(resultData.message);
                }
              } else if (statusData.status === "failed") {
                terminal = true;
                clearInterval(aiProgressTimer);
                setVideoProgress(0);
                setResult(`❌ 混剪失败: ${statusData.error || "未知错误"}`);
              }
            }

            if (!terminal) {
              clearInterval(aiProgressTimer);
              setResult("❌ 混剪任务超时");
            }
          } else {
            // 旧的同步模式或直接结果
            clearInterval(aiProgressTimer);
            setVideoProgress(100);
            setAiRemixResult(data);
            if (data.success && data.final_video) {
              const videoPath = data.final_video.split("storage/outputs/")[1];
              if (videoPath) {
                setVideoUrl(`/api/media/${videoPath}`);
              }
            }
            if (data.message) {
              setResult(data.message);
            } else if (data.error) {
              setResult(`❌ ${data.error}`);
            }
          }
        } catch (fetchError) {
          clearInterval(progressInterval);
          clearInterval(aiProgressTimer);
          setVideoProgress(0);
          throw fetchError;
        }
      }
    } catch (error) {
      setResult(`混剪失败: ${error}`);
    } finally {
      setLoading(false);
      setLoadingMessage("");
      setStartTime(null);
    }
  };

  // 预设提示词
  const textPresets = [
    { name: "自然风景", prompt: "壮观的山川河流，云雾缭绕，延时摄影效果" },
    { name: "城市夜景", prompt: "繁华城市夜景，霓虹灯闪烁，车流穿梭" },
    { name: "人物动态", prompt: "人物行走在街道上，自然光线，电影质感" },
    { name: "产品展示", prompt: "产品360度旋转展示，白色背景，专业灯光" },
  ];

  const imagePresets = [
    { name: "镜头推进", prompt: "镜头缓慢推进，景深变化" },
    { name: "水面涟漪", prompt: "水面泛起涟漪，光影变化" },
    { name: "风吹动", prompt: "微风吹动，树叶摇曳，头发飘动" },
    { name: "旋转展示", prompt: "缓慢旋转，360度展示" },
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
                🎬 AI 视频生成
              </h1>
              <p className="text-gray-500 mt-1">
                从创意到成片的全链路 AI 视频创作
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <UnifiedMediaSelector modality="video" />
          </div>
        </div>

        {/* Mode Tabs */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setMode("text")}
            className={`px-6 py-3 rounded-lg font-medium transition-colors ${
              mode === "text"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            📝 文生视频
          </button>
          <button
            onClick={() => setMode("image")}
            className={`px-6 py-3 rounded-lg font-medium transition-colors ${
              mode === "image"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            🖼️ 图生视频
          </button>
          <button
            onClick={() => setMode("remix")}
            className={`px-6 py-3 rounded-lg font-medium transition-colors ${
              mode === "remix"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            ✂️ 素材混剪
          </button>
          <Link
            href="/media/long-video"
            className="px-6 py-3 rounded-lg font-medium transition-colors bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200"
          >
            🎞️ 长视频工坊
          </Link>
          <Link
            href="/media/happyhorse"
            className="px-6 py-3 rounded-lg font-medium transition-colors bg-violet-50 text-violet-700 hover:bg-violet-100 border border-violet-200"
          >
            🐴 欢乐马工坊
          </Link>
        </div>

        {/* Form */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">
          {/* 文生视频模式 */}
          {mode === "text" && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  快速模板
                </label>
                <div className="flex flex-wrap gap-2">
                  {textPresets.map((p) => (
                    <button
                      key={p.name}
                      onClick={() => setTextPrompt(p.prompt)}
                      className="px-4 py-2 text-sm font-medium text-gray-800 bg-gray-100 rounded-lg border border-gray-300 hover:bg-blue-50 hover:border-blue-400 hover:text-blue-700 transition-colors"
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  视频描述 *
                </label>
                <textarea
                  value={textPrompt}
                  onChange={(e) => setTextPrompt(e.target.value)}
                  placeholder="详细描述你想要生成的视频内容，包括场景、动作、氛围等..."
                  rows={4}
                  className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 resize-none text-gray-900"
                />
              </div>

              <button
                onClick={handleTextGenerate}
                disabled={loading}
                className="w-full py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {loading ? "⏳ 生成中（约1-3分钟）..." : "🎬 生成视频"}
              </button>

              {/* 视频生成进度条 */}
              {loading && (
                <div className="mt-3 space-y-1.5">
                  <div className="flex justify-between text-xs text-blue-600">
                    <span>🎬 视频生成中，请耐心等待...</span>
                    <span className="font-semibold">{videoProgress}%</span>
                  </div>
                  <div className="h-2.5 bg-blue-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-full transition-all duration-700 ease-out"
                      style={{ width: `${videoProgress}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-400">⏱️ 预计 1-3 分钟完成</p>
                </div>
              )}
            </>
          )}

          {/* 图生视频模式 */}
          {mode === "image" && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  图片来源
                </label>
                <div className="space-y-4">
                  {/* URL输入 */}
                  <div>
                    <input
                      type="text"
                      value={imageUrl}
                      onChange={(e) => setImageUrl(e.target.value)}
                      placeholder="输入图片URL（需要公网可访问）"
                      className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 text-gray-900"
                    />
                  </div>

                  <div className="text-center text-gray-500 text-sm">或</div>

                  {/* 文件上传 */}
                  <div>
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleImageUpload}
                      accept="image/*"
                      className="hidden"
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full py-3 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-colors text-gray-600"
                    >
                      📁 点击上传图片
                    </button>
                  </div>

                  {/* 预览上传的图片 */}
                  {uploadedImage && (
                    <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                      <img
                        src={uploadedImage.url}
                        alt="Uploaded"
                        className="w-20 h-20 object-cover rounded"
                      />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-800">
                          {uploadedImage.filename}
                        </p>
                        <p className="text-xs text-gray-500">
                          {(uploadedImage.size / 1024).toFixed(1)} KB
                        </p>
                      </div>
                      <button
                        onClick={() => setUploadedImage(null)}
                        className="text-red-500 hover:text-red-700"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  动作描述（可选）
                </label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {imagePresets.map((p) => (
                    <button
                      key={p.name}
                      onClick={() => setImagePrompt(p.prompt)}
                      className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg border border-gray-300 hover:bg-blue-50 hover:border-blue-400 hover:text-blue-700 transition-colors"
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
                <textarea
                  value={imagePrompt}
                  onChange={(e) => setImagePrompt(e.target.value)}
                  placeholder="描述期望的动作效果，如：镜头缓慢推进，云朵流动..."
                  rows={2}
                  className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 resize-none text-gray-900"
                />
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-700">
                ⚠️
                图生视频需要公网可访问的图片URL。本地上传的图片需要先上传到图床。
              </div>

              <button
                onClick={handleImageToVideo}
                disabled={loading || (!imageUrl && !uploadedImage)}
                className="w-full py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {loading ? "⏳ 生成中（约1-3分钟）..." : "🎬 从图片生成视频"}
              </button>

              {/* 视频生成进度条 */}
              {loading && (
                <div className="mt-3 space-y-1.5">
                  <div className="flex justify-between text-xs text-blue-600">
                    <span>🎬 视频生成中，请耐心等待...</span>
                    <span className="font-semibold">{videoProgress}%</span>
                  </div>
                  <div className="h-2.5 bg-blue-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-full transition-all duration-700 ease-out"
                      style={{ width: `${videoProgress}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-400">⏱️ 预计 1-3 分钟完成</p>
                </div>
              )}
            </>
          )}

          {/* 混剪模式 */}
          {mode === "remix" && (
            <>
              {/* 混剪模式选择 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  混剪模式
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setRemixMode("ai")}
                    className={`p-4 rounded-lg border-2 text-left transition-all ${
                      remixMode === "ai"
                        ? "border-purple-500 bg-purple-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="text-lg font-semibold text-gray-800">
                      🤖 AI智能混剪
                    </div>
                    <div className="text-sm text-gray-500 mt-1">
                      大模型分析素材，AI生成创意视频片段
                    </div>
                  </button>
                  <button
                    onClick={() => setRemixMode("fast")}
                    className={`p-4 rounded-lg border-2 text-left transition-all ${
                      remixMode === "fast"
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="text-lg font-semibold text-gray-800">
                      ⚡ 快速拼接
                    </div>
                    <div className="text-sm text-gray-500 mt-1">
                      使用FFmpeg直接合并素材，速度快
                    </div>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  上传素材（图片/视频）
                </label>
                <input
                  type="file"
                  ref={multiFileInputRef}
                  onChange={handleMultiFileUpload}
                  accept="image/*,video/*"
                  multiple
                  className="hidden"
                />
                <button
                  onClick={() => multiFileInputRef.current?.click()}
                  className="w-full py-4 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-colors text-gray-600"
                >
                  📁 点击上传多个素材文件
                </button>
              </div>

              {/* 已上传的素材列表 */}
              {uploadedFiles.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    已上传素材 ({uploadedFiles.length})
                  </label>
                  <div className="grid grid-cols-4 gap-3">
                    {uploadedFiles.map((file, index) => (
                      <div
                        key={index}
                        className="relative group rounded-lg overflow-hidden border border-gray-200"
                      >
                        {file.type === "video" ? (
                          <video
                            src={file.url}
                            className="w-full h-24 object-cover"
                          />
                        ) : (
                          <img
                            src={file.url}
                            alt={file.filename}
                            className="w-full h-24 object-cover"
                          />
                        )}
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <button
                            onClick={() => removeUploadedFile(index)}
                            className="text-white text-xl"
                          >
                            ✕
                          </button>
                        </div>
                        <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs p-1 text-center">
                          {file.type === "video" ? "🎬" : "🖼️"}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* AI混剪需要描述 */}
              {remixMode === "ai" && (
                <>
                  {/* AI混剪子模式选择 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      AI混剪方式
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => setAiRemixMode("fusion")}
                        className={`p-3 rounded-lg border-2 text-left transition-all ${
                          aiRemixMode === "fusion"
                            ? "border-purple-500 bg-purple-50"
                            : "border-gray-200 hover:border-gray-300"
                        }`}
                      >
                        <div className="text-base font-semibold text-gray-800">
                          ✨ 融合模式
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          将所有素材元素融合成一个完整视频
                        </div>
                      </button>
                      <button
                        onClick={() => setAiRemixMode("segment")}
                        className={`p-3 rounded-lg border-2 text-left transition-all ${
                          aiRemixMode === "segment"
                            ? "border-purple-500 bg-purple-50"
                            : "border-gray-200 hover:border-gray-300"
                        }`}
                      >
                        <div className="text-base font-semibold text-gray-800">
                          🎞️ 分段模式
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          为每个素材生成视频再拼接
                        </div>
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      创作需求（可选）
                    </label>
                    <textarea
                      value={remixPrompt}
                      onChange={(e) => setRemixPrompt(e.target.value)}
                      placeholder={
                        aiRemixMode === "fusion"
                          ? "描述你想要的融合效果。例如：将这些风景照片融合成一个梦幻的自然纪录片画面，有流动的云彩和变幻的光影..."
                          : "描述你想要的视频风格、主题、情感等。例如：制作一个温馨的家庭相册视频，带有舒缓的节奏和温暖的色调..."
                      }
                      rows={3}
                      className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 resize-none text-gray-900"
                    />
                  </div>

                  {/* 🔊 音频设置面板 */}
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                      <h3 className="text-sm font-semibold text-gray-700">
                        🔊 音频设置（参考剪映）
                      </h3>
                    </div>
                    <div className="p-4 space-y-4">
                      {/* AI配音开关 */}
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium text-gray-800">
                            🎙️ AI配音
                          </div>
                          <div className="text-xs text-gray-500">
                            自动生成解说配音
                          </div>
                        </div>
                        <button
                          onClick={() => setAddNarration(!addNarration)}
                          className={`relative w-12 h-6 rounded-full transition-colors ${
                            addNarration ? "bg-purple-500" : "bg-gray-300"
                          }`}
                        >
                          <div
                            className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                              addNarration ? "translate-x-7" : "translate-x-1"
                            }`}
                          />
                        </button>
                      </div>

                      {/* 配音详细设置 */}
                      {addNarration && (
                        <div className="pl-4 border-l-2 border-purple-200 space-y-3">
                          {/* 配音风格 */}
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              配音风格
                            </label>
                            <div className="flex flex-wrap gap-2">
                              {(
                                audioConfig?.styles || [
                                  {
                                    id: "informative",
                                    name: "专业解说",
                                    description: "",
                                  },
                                  {
                                    id: "emotional",
                                    name: "感性叙述",
                                    description: "",
                                  },
                                  {
                                    id: "energetic",
                                    name: "活力激情",
                                    description: "",
                                  },
                                  {
                                    id: "poetic",
                                    name: "诗意优雅",
                                    description: "",
                                  },
                                ]
                              ).map((style) => (
                                <button
                                  key={style.id}
                                  onClick={() => setNarrationStyle(style.id)}
                                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                                    narrationStyle === style.id
                                      ? "border-purple-500 bg-purple-50 text-purple-700"
                                      : "border-gray-200 text-gray-600 hover:border-gray-300"
                                  }`}
                                >
                                  {style.name}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* 配音员选择 */}
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              配音员
                            </label>
                            <select
                              value={narrationVoice}
                              onChange={(e) =>
                                setNarrationVoice(e.target.value)
                              }
                              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-800 focus:ring-2 focus:ring-purple-500"
                            >
                              {(
                                audioConfig?.voices || [
                                  {
                                    id: "zh-CN-XiaoxiaoNeural",
                                    name: "晓晓",
                                    gender: "女",
                                    description: "温柔亲切",
                                  },
                                  {
                                    id: "zh-CN-YunxiNeural",
                                    name: "云希",
                                    gender: "男",
                                    description: "年轻活力",
                                  },
                                  {
                                    id: "zh-CN-YunjianNeural",
                                    name: "云健",
                                    gender: "男",
                                    description: "沉稳大气",
                                  },
                                  {
                                    id: "zh-CN-XiaoyiNeural",
                                    name: "晓伊",
                                    gender: "女",
                                    description: "知性优雅",
                                  },
                                  {
                                    id: "zh-CN-YunyangNeural",
                                    name: "云扬",
                                    gender: "男",
                                    description: "新闻播报",
                                  },
                                  {
                                    id: "zh-CN-XiaochenNeural",
                                    name: "晓辰",
                                    gender: "女",
                                    description: "甜美可爱",
                                  },
                                ]
                              ).map((voice) => (
                                <option key={voice.id} value={voice.id}>
                                  {voice.name} ({voice.gender}) -{" "}
                                  {voice.description}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* 自定义配音文案 */}
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              配音文案（留空则AI自动生成）
                            </label>
                            <textarea
                              value={narrationText}
                              onChange={(e) => setNarrationText(e.target.value)}
                              placeholder="输入自定义配音文案，或留空让AI根据视频内容自动生成..."
                              rows={2}
                              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-800 focus:ring-2 focus:ring-purple-500 resize-none"
                            />
                          </div>
                        </div>
                      )}

                      {/* 背景音乐开关 */}
                      <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                        <div>
                          <div className="font-medium text-gray-800">
                            🎵 背景音乐
                          </div>
                          <div className="text-xs text-gray-500">
                            添加氛围背景音乐
                          </div>
                        </div>
                        <button
                          onClick={() => setAddBgm(!addBgm)}
                          className={`relative w-12 h-6 rounded-full transition-colors ${
                            addBgm ? "bg-purple-500" : "bg-gray-300"
                          }`}
                        >
                          <div
                            className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                              addBgm ? "translate-x-7" : "translate-x-1"
                            }`}
                          />
                        </button>
                      </div>

                      {/* 背景音乐详细设置 */}
                      {addBgm && (
                        <div className="pl-4 border-l-2 border-purple-200 space-y-3">
                          {/* BGM选择 */}
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              选择音乐
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                              {(
                                audioConfig?.bgm_list || [
                                  {
                                    id: "gentle",
                                    name: "轻柔舒缓",
                                    path: "",
                                    description: "适合温馨、治愈类内容",
                                  },
                                  {
                                    id: "epic",
                                    name: "史诗壮阔",
                                    path: "",
                                    description: "适合震撼、大气类内容",
                                  },
                                  {
                                    id: "upbeat",
                                    name: "欢快活泼",
                                    path: "",
                                    description: "适合活力、运动类内容",
                                  },
                                  {
                                    id: "emotional",
                                    name: "感人深情",
                                    path: "",
                                    description: "适合情感、回忆类内容",
                                  },
                                  {
                                    id: "tech",
                                    name: "科技未来",
                                    path: "",
                                    description: "适合科技、创新类内容",
                                  },
                                ]
                              ).map((bgm) => (
                                <button
                                  key={bgm.id}
                                  onClick={() => setBgmId(bgm.id)}
                                  className={`p-2 text-left rounded-lg border transition-colors ${
                                    bgmId === bgm.id
                                      ? "border-purple-500 bg-purple-50"
                                      : "border-gray-200 hover:border-gray-300"
                                  }`}
                                >
                                  <div className="text-sm font-medium text-gray-800">
                                    {bgm.name}
                                  </div>
                                  <div className="text-xs text-gray-500">
                                    {bgm.description}
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* 音量控制 */}
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              音乐音量: {Math.round(bgmVolume * 100)}%
                            </label>
                            <input
                              type="range"
                              min="0"
                              max="1"
                              step="0.05"
                              value={bgmVolume}
                              onChange={(e) =>
                                setBgmVolume(parseFloat(e.target.value))
                              }
                              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-500"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 📝 字幕设置面板 */}
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                      <h3 className="text-sm font-semibold text-gray-700">
                        📝 字幕设置
                      </h3>
                    </div>
                    <div className="p-4 space-y-4">
                      {/* 字幕开关 */}
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium text-gray-800">
                            🔤 添加字幕
                          </div>
                          <div className="text-xs text-gray-500">
                            在视频中显示文字字幕
                          </div>
                        </div>
                        <button
                          onClick={() => setAddSubtitles(!addSubtitles)}
                          className={`relative w-12 h-6 rounded-full transition-colors ${
                            addSubtitles ? "bg-purple-500" : "bg-gray-300"
                          }`}
                        >
                          <div
                            className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                              addSubtitles ? "translate-x-7" : "translate-x-1"
                            }`}
                          />
                        </button>
                      </div>

                      {/* 字幕详细设置 */}
                      {addSubtitles && (
                        <div className="pl-4 border-l-2 border-purple-200 space-y-3">
                          {/* 字幕样式 */}
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              字幕样式
                            </label>
                            <div className="flex flex-wrap gap-2">
                              {(
                                audioConfig?.subtitle_styles || [
                                  { id: "default", name: "默认样式" },
                                  { id: "modern", name: "现代简约" },
                                  { id: "cinematic", name: "电影字幕" },
                                  { id: "vibrant", name: "活力彩色" },
                                  { id: "minimal", name: "极简风格" },
                                ]
                              ).map((style) => (
                                <button
                                  key={style.id}
                                  onClick={() => setSubtitleStyle(style.id)}
                                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                                    subtitleStyle === style.id
                                      ? "border-purple-500 bg-purple-50 text-purple-700"
                                      : "border-gray-200 text-gray-600 hover:border-gray-300"
                                  }`}
                                >
                                  {style.name}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* 字幕位置 */}
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              字幕位置
                            </label>
                            <div className="flex gap-2">
                              {[
                                { id: "top", name: "顶部" },
                                { id: "center", name: "居中" },
                                { id: "bottom", name: "底部" },
                              ].map((pos) => (
                                <button
                                  key={pos.id}
                                  onClick={() => setSubtitlePosition(pos.id)}
                                  className={`px-4 py-1.5 text-xs rounded-lg border transition-colors ${
                                    subtitlePosition === pos.id
                                      ? "border-purple-500 bg-purple-50 text-purple-700"
                                      : "border-gray-200 text-gray-600 hover:border-gray-300"
                                  }`}
                                >
                                  {pos.name}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* 自定义字幕文案 */}
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              字幕文案（留空则自动生成）
                            </label>
                            <textarea
                              value={subtitleText}
                              onChange={(e) => setSubtitleText(e.target.value)}
                              placeholder="输入自定义字幕文案，或留空让AI根据配音/视频内容自动生成..."
                              rows={2}
                              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-800 focus:ring-2 focus:ring-purple-500 resize-none"
                            />
                          </div>

                          {/* 提示 */}
                          <div className="text-xs text-gray-500 bg-gray-50 p-2 rounded">
                            💡 提示：如果开启了AI配音，字幕会与配音内容同步
                          </div>
                        </div>
                      )}
                    </div>

                    {/* ASR智能字幕 */}
                    <div className="border-t border-gray-100 pt-4">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <div className="font-medium text-gray-800 flex items-center gap-2">
                            <span>🎙️</span>
                            <span>ASR智能字幕</span>
                            <span className="text-xs bg-gradient-to-r from-blue-500 to-purple-500 text-white px-2 py-0.5 rounded-full">
                              语音识别
                            </span>
                          </div>
                          <div className="text-xs text-gray-500">
                            自动识别语音并生成带时间轴的字幕
                          </div>
                        </div>
                        <button
                          onClick={() => setUseAsrSubtitles(!useAsrSubtitles)}
                          className={`relative w-12 h-6 rounded-full transition-colors ${
                            useAsrSubtitles ? "bg-blue-500" : "bg-gray-300"
                          }`}
                        >
                          <div
                            className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                              useAsrSubtitles
                                ? "translate-x-7"
                                : "translate-x-1"
                            }`}
                          />
                        </button>
                      </div>

                      {/* ASR详细设置 */}
                      {useAsrSubtitles && (
                        <div className="pl-4 border-l-2 border-blue-200 space-y-3">
                          {/* ASR引擎选择 */}
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              语音识别引擎
                            </label>
                            <div className="flex gap-2">
                              <button
                                onClick={() => setAsrMethod("whisper")}
                                className={`px-4 py-2 text-xs rounded-lg border transition-colors ${
                                  asrMethod === "whisper"
                                    ? "border-blue-500 bg-blue-50 text-blue-700"
                                    : "border-gray-200 text-gray-600 hover:border-gray-300"
                                }`}
                              >
                                <div className="font-medium">Whisper</div>
                                <div className="text-gray-400 mt-0.5">
                                  本地运行·免费
                                </div>
                              </button>
                              <button
                                onClick={() => setAsrMethod("glm-asr")}
                                className={`px-4 py-2 text-xs rounded-lg border transition-colors ${
                                  asrMethod === "glm-asr"
                                    ? "border-blue-500 bg-blue-50 text-blue-700"
                                    : "border-gray-200 text-gray-600 hover:border-gray-300"
                                }`}
                              >
                                <div className="font-medium">GLM-ASR</div>
                                <div className="text-gray-400 mt-0.5">
                                  云端API·更快
                                </div>
                              </button>
                            </div>
                          </div>

                          {/* 语言选择 */}
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              识别语言
                            </label>
                            <div className="flex gap-2">
                              {[
                                { id: "zh", name: "中文" },
                                { id: "en", name: "English" },
                                { id: "auto", name: "自动检测" },
                              ].map((lang) => (
                                <button
                                  key={lang.id}
                                  onClick={() => setAsrLanguage(lang.id)}
                                  className={`px-4 py-1.5 text-xs rounded-lg border transition-colors ${
                                    asrLanguage === lang.id
                                      ? "border-blue-500 bg-blue-50 text-blue-700"
                                      : "border-gray-200 text-gray-600 hover:border-gray-300"
                                  }`}
                                >
                                  {lang.name}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* 提示 */}
                          <div className="text-xs text-gray-500 bg-blue-50 p-2 rounded">
                            💡
                            ASR会识别视频中的语音并自动生成带时间轴的字幕，适合配音视频
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* 模式说明 */}
              {remixMode === "ai" ? (
                aiRemixMode === "fusion" ? (
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 text-sm text-purple-800">
                    <div className="font-semibold mb-2">
                      ✨ AI融合模式流程：
                    </div>
                    <ol className="list-decimal list-inside space-y-1">
                      <li>🔍 使用GLM-4V视觉模型分析每个素材内容</li>
                      <li>✨ AI将所有素材元素融合成统一的创意描述</li>
                      <li>🎬 使用CogVideoX生成一个融合所有元素的完整视频</li>
                    </ol>
                    <div className="mt-2 text-purple-600">
                      ⏱️ 预计耗时：2-3 分钟（只生成一个融合视频）
                    </div>
                  </div>
                ) : (
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 text-sm text-purple-800">
                    <div className="font-semibold mb-2">
                      🎞️ AI分段模式流程：
                    </div>
                    <ol className="list-decimal list-inside space-y-1">
                      <li>🔍 使用GLM-4V视觉模型分析每个素材内容</li>
                      <li>📝 AI根据素材和需求生成创意剪辑脚本</li>
                      <li>🎬 使用CogVideoX为每个片段生成AI视频</li>
                      <li>🎞️ 智能合成最终视频</li>
                    </ol>
                    <div className="mt-2 text-purple-600">
                      ⏱️ 预计耗时：{uploadedFiles.length * 2 || 5}-
                      {uploadedFiles.length * 5 || 15} 分钟
                    </div>
                  </div>
                )
              ) : (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700">
                  ⚡
                  快速拼接模式：直接使用FFmpeg合并素材，速度快（约10-30秒），需至少2个素材
                </div>
              )}

              <button
                onClick={handleRemixGenerate}
                disabled={
                  loading ||
                  uploadedFiles.length < (remixMode === "fast" ? 2 : 1)
                }
                className={`w-full py-3 font-medium rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed ${
                  remixMode === "ai"
                    ? "bg-purple-600 text-white hover:bg-purple-700"
                    : "bg-blue-600 text-white hover:bg-blue-700"
                }`}
              >
                {loading
                  ? remixMode === "ai"
                    ? loadingMessage || "🤖 AI处理中..."
                    : "⏳ 拼接处理中..."
                  : remixMode === "ai"
                    ? "🤖 开始AI智能混剪"
                    : "⚡ 开始快速拼接"}
              </button>

              {/* AI混剪进度提示（含进度条） */}
              {loading && remixMode === "ai" && startTime && (
                <div className="mt-3 p-4 bg-purple-50 border border-purple-200 rounded-lg space-y-3">
                  <div className="flex items-center gap-2 text-purple-700">
                    <div className="animate-spin w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full flex-shrink-0"></div>
                    <span className="font-medium">{loadingMessage}</span>
                  </div>
                  {/* 视频生成进度条 */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs text-purple-600">
                      <span>🎬 视频生成进度</span>
                      <span className="font-semibold">{videoProgress}%</span>
                    </div>
                    <div className="h-2.5 bg-purple-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-purple-500 via-pink-500 to-rose-500 rounded-full transition-all duration-700 ease-out"
                        style={{ width: `${videoProgress}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-xs text-purple-600">
                    已用时: {Math.floor((Date.now() - startTime) / 60000)} 分钟
                    <br />
                    {aiRemixMode === "fusion"
                      ? "预计总时长: 2-3 分钟（融合模式只生成一个视频）"
                      : `预计总时长: ${uploadedFiles.length * 2}-${uploadedFiles.length * 5} 分钟（每个素材需生成AI视频）`}
                  </div>
                </div>
              )}

              {/* 快速拼接进度条 */}
              {loading && remixMode === "fast" && (
                <div className="mt-3 space-y-1.5">
                  <div className="flex justify-between text-xs text-blue-600">
                    <span>⚡ 视频拼接中...</span>
                    <span className="font-semibold">{videoProgress}%</span>
                  </div>
                  <div className="h-2.5 bg-blue-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-blue-500 to-cyan-500 rounded-full transition-all duration-700 ease-out"
                      style={{ width: `${videoProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {/* 通用提示 */}
          {mode !== "remix" && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-700">
              ⚠️ 视频生成需要较长时间（约1-3分钟），请耐心等待
            </div>
          )}
        </div>

        {/* Result */}
        {(videoUrl || result || aiRemixResult) && (
          <div className="mt-6 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">
              生成结果
            </h2>

            {/* AI混剪进度展示 */}
            {aiRemixResult && aiRemixResult.stages && (
              <div className="mb-6">
                <h3 className="text-md font-medium text-gray-700 mb-3">
                  📊 处理进度
                </h3>
                <div className="space-y-2">
                  {aiRemixResult.stages.map((stage, index) => (
                    <div key={index} className="flex items-center gap-3">
                      <span
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-sm ${
                          stage.status === "完成"
                            ? "bg-green-100 text-green-600"
                            : stage.status === "失败"
                              ? "bg-red-100 text-red-600"
                              : "bg-yellow-100 text-yellow-600"
                        }`}
                      >
                        {stage.status === "完成"
                          ? "✓"
                          : stage.status === "失败"
                            ? "✕"
                            : "●"}
                      </span>
                      <span className="text-gray-700">{stage.stage}</span>
                      <span
                        className={`text-sm ${
                          stage.status === "完成"
                            ? "text-green-600"
                            : stage.status === "失败"
                              ? "text-red-600"
                              : "text-yellow-600"
                        }`}
                      >
                        {stage.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI剪辑脚本展示 */}
            {aiRemixResult?.script && (
              <div className="mb-6 p-4 bg-purple-50 rounded-lg border border-purple-200">
                <h3 className="text-md font-medium text-purple-800 mb-2">
                  {aiRemixResult.script.fusion_prompt
                    ? "✨ AI融合创意"
                    : "🎬 AI剪辑脚本"}
                </h3>
                <div className="text-sm text-purple-700 space-y-1">
                  <p>
                    <strong>标题:</strong> {aiRemixResult.script.title}
                  </p>
                  <p>
                    <strong>风格:</strong> {aiRemixResult.script.style}
                  </p>
                  {aiRemixResult.script.fusion_prompt && (
                    <p>
                      <strong>融合描述:</strong>{" "}
                      {aiRemixResult.script.fusion_prompt}
                    </p>
                  )}
                  {aiRemixResult.script.narrative && (
                    <p>
                      <strong>创意说明:</strong>{" "}
                      {aiRemixResult.script.narrative}
                    </p>
                  )}
                  {aiRemixResult.script.overall_narrative && (
                    <p>
                      <strong>叙事:</strong>{" "}
                      {aiRemixResult.script.overall_narrative}
                    </p>
                  )}
                </div>
              </div>
            )}

            {longTask?.result?.segments?.length ? (
              <div className="mb-6 p-4 bg-amber-50 rounded-lg border border-amber-200">
                <h3 className="text-md font-medium text-amber-800 mb-3">
                  🎞️ Wan 长视频分镜
                </h3>
                <div className="space-y-2">
                  {longTask.result.segments.map((segment) => (
                    <div
                      key={`result-${segment.index}`}
                      className="text-sm text-amber-900"
                    >
                      <strong>{segment.title}</strong> ({segment.duration_sec}s)
                      - {segment.status}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {videoUrl && (
              <div className="mb-4">
                <div
                  ref={videoContainerRef}
                  className="overflow-hidden rounded-lg border border-slate-200 bg-slate-950 shadow-sm"
                >
                  <button
                    type="button"
                    onClick={togglePlayback}
                    className="group relative block w-full bg-black text-left"
                    aria-label={isVideoPlaying ? "暂停视频" : "播放视频"}
                  >
                    <video
                      ref={videoPlayerRef}
                      src={videoUrl}
                      playsInline
                      className="aspect-video w-full bg-black object-contain"
                      onLoadedMetadata={(event) => {
                        const video = event.currentTarget;
                        video.volume = playerVolume;
                        video.muted = isPlayerMuted;
                        video.playbackRate = playbackRate;
                        setVideoDuration(video.duration || 0);
                      }}
                      onTimeUpdate={(event) => {
                        setVideoCurrentTime(event.currentTarget.currentTime);
                      }}
                      onPlay={() => setIsVideoPlaying(true)}
                      onPause={() => setIsVideoPlaying(false)}
                      onEnded={() => setIsVideoPlaying(false)}
                    />
                    {!isVideoPlaying && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/10 opacity-100 transition-opacity group-hover:bg-black/20">
                        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 text-slate-950 shadow-lg">
                          <Play
                            size={28}
                            className="ml-1"
                            fill="currentColor"
                          />
                        </span>
                      </span>
                    )}
                  </button>

                  <div className="space-y-3 border-t border-white/10 bg-slate-900 p-3 text-white">
                    <input
                      type="range"
                      min={0}
                      max={videoDuration || 0}
                      step={0.1}
                      value={Math.min(videoCurrentTime, videoDuration || 0)}
                      onChange={(event) =>
                        handleSeek(Number(event.target.value))
                      }
                      className="h-2 w-full cursor-pointer accent-sky-400"
                      aria-label="视频播放进度"
                    />

                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <button
                        type="button"
                        onClick={togglePlayback}
                        className="flex h-9 w-9 items-center justify-center rounded-md bg-white text-slate-950 hover:bg-sky-100"
                        aria-label={isVideoPlaying ? "暂停" : "播放"}
                      >
                        {isVideoPlaying ? (
                          <Pause size={18} fill="currentColor" />
                        ) : (
                          <Play
                            size={18}
                            className="ml-0.5"
                            fill="currentColor"
                          />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={restartVideo}
                        className="flex h-9 w-9 items-center justify-center rounded-md border border-white/15 bg-white/10 text-white hover:bg-white/20"
                        aria-label="从头播放"
                      >
                        <RotateCcw size={17} />
                      </button>

                      <span className="min-w-[92px] font-mono text-xs text-slate-200">
                        {formatVideoTime(videoCurrentTime)} /{" "}
                        {formatVideoTime(videoDuration)}
                      </span>

                      <div className="flex min-w-[150px] items-center gap-2">
                        <button
                          type="button"
                          onClick={toggleMute}
                          className="flex h-9 w-9 items-center justify-center rounded-md border border-white/15 bg-white/10 text-white hover:bg-white/20"
                          aria-label={isPlayerMuted ? "取消静音" : "静音"}
                        >
                          {isPlayerMuted || playerVolume === 0 ? (
                            <VolumeX size={17} />
                          ) : (
                            <Volume2 size={17} />
                          )}
                        </button>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={isPlayerMuted ? 0 : playerVolume}
                          onChange={(event) =>
                            handleVolumeChange(Number(event.target.value))
                          }
                          className="w-24 cursor-pointer accent-sky-400"
                          aria-label="音量"
                        />
                      </div>

                      <select
                        value={playbackRate}
                        onChange={(event) =>
                          changePlaybackRate(Number(event.target.value))
                        }
                        className="h-9 rounded-md border border-white/15 bg-white/10 px-2 text-sm text-white outline-none hover:bg-white/20"
                        aria-label="播放倍速"
                      >
                        {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                          <option
                            key={rate}
                            value={rate}
                            className="text-slate-900"
                          >
                            {rate}x
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        onClick={toggleFullscreen}
                        className="ml-auto flex h-9 items-center gap-2 rounded-md border border-white/15 bg-white/10 px-3 text-white hover:bg-white/20"
                        aria-label={
                          isPlayerFullscreen ? "退出全屏" : "全屏播放"
                        }
                      >
                        <Maximize2 size={17} />
                        <span className="hidden sm:inline">
                          {isPlayerFullscreen ? "退出全屏" : "全屏"}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex gap-2 flex-wrap">
                  <a
                    href={videoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 bg-gray-100 text-gray-800 font-medium rounded-lg hover:bg-gray-200 text-sm border border-gray-300"
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
                          a.download = `video_${Date.now()}.mp4`;
                          document.body.appendChild(a);
                          a.click();
                          window.URL.revokeObjectURL(url);
                          document.body.removeChild(a);
                        })
                        .catch(() => {
                          window.open(videoUrl, "_blank");
                        });
                    }}
                    className="px-4 py-2 bg-blue-100 text-blue-800 font-medium rounded-lg hover:bg-blue-200 text-sm border border-blue-300"
                  >
                    ⬇️ 下载视频
                  </button>
                  <PublishModal
                    content={
                      result || textPrompt || imagePrompt || "AI生成视频"
                    }
                    mediaUrl={videoUrl}
                    mediaType="video"
                  />
                </div>
              </div>
            )}

            <div className="mt-4">
              <details className={videoUrl ? "" : "open"}>
                <summary className="cursor-pointer text-sm text-gray-600 hover:text-gray-800">
                  {videoUrl ? "查看详细信息" : "生成结果"}
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
