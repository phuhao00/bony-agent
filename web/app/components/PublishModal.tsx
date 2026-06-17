"use client";

import {
    AlertCircle,
    Check,
    ExternalLink,
    FileText,
    Globe,
    Loader2,
    Send,
    Share2,
    X,
} from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

interface Platform {
  id: string;
  name: string;
  icon: React.ReactNode;
  color: string;
  connected: boolean;
  account_info?: { nickname?: string };
}

interface PlatformApiInfo {
  platform_id?: string;
  id?: string;
  platform_name?: string;
  name?: string;
  connected?: boolean;
  status?: string;
  account_info?: { nickname?: string };
}

interface PlatformsResponse {
  platforms?: PlatformApiInfo[];
}

// 平台配置
const PLATFORM_CONFIG: Record<
  string,
  { name: string; icon: string; color: string }
> = {
  douyin: { name: "抖音", icon: "🎵", color: "#000000" },
  kuaishou: { name: "快手", icon: "📱", color: "#FF6600" },
  xiaohongshu: { name: "小红书", icon: "📕", color: "#FF2442" },
  bilibili: { name: "B站", icon: "📺", color: "#00A1D6" },
  weibo: { name: "微博", icon: "🌐", color: "#E6162D" },
  twitter: { name: "Twitter", icon: "𝕏", color: "#000000" },
  youtube: { name: "YouTube", icon: "▶️", color: "#FF0000" },
};

// 新版本的 props 接口
interface NewPublishModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  content: string;
  htmlContent?: string;
  mediaUrls?: string[];
}

// 旧版本的 props 接口（向后兼容）
interface OldPublishModalProps {
  content: string;
  mediaUrl?: string;
  mediaType?: "text" | "image" | "video";
}

type PublishModalProps = NewPublishModalProps | OldPublishModalProps;

// 判断是否为新版本的 props
function isNewProps(props: PublishModalProps): props is NewPublishModalProps {
  return "isOpen" in props;
}

export default function PublishModal(props: PublishModalProps) {
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishResults, setPublishResults] = useState<
    Record<string, { success: boolean; message: string; url?: string }>
  >({});
  const [showResults, setShowResults] = useState(false);
  const [isOpenState, setIsOpenState] = useState(false);

  // 增加编辑状态
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");

  // 根据 props 确定值
  const isOpen = isNewProps(props) ? props.isOpen : isOpenState;
  const mediaUrl = !isNewProps(props) ? props.mediaUrl : undefined;
  const mediaUrls = isNewProps(props)
    ? props.mediaUrls
    : props.mediaUrl
      ? [props.mediaUrl]
      : undefined;
  const onClose = isNewProps(props)
    ? props.onClose
    : () => setIsOpenState(false);

  const fetchPlatforms = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/connectors/platforms");
      const data = (await response.json()) as PlatformsResponse;

      const platformsData = data.platforms || [];
      const platformList: Platform[] = platformsData.map((info) => {
        const platformId = info.platform_id || info.id || "unknown";
        const config = PLATFORM_CONFIG[platformId] || {
          name: info.platform_name || info.name || platformId,
          icon: "📄",
          color: "#6B7280",
        };

        return {
          id: platformId,
          name: config.name,
          icon: renderPlatformIcon(platformId, config.icon, config.color),
          color: config.color,
          connected: info.connected || info.status === "connected",
          account_info: info.account_info,
        };
      });

      setPlatforms(platformList);
      setSelectedPlatforms(
        platformList.filter((p) => p.connected).map((p) => p.id),
      );
    } catch (error) {
      console.error("Failed to fetch platforms:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 获取平台列表及初始化文本
  useEffect(() => {
    if (isOpen) {
      setEditTitle(isNewProps(props) ? props.title || "" : "");
      setEditContent(props.content || "");
      fetchPlatforms();
    }
  }, [fetchPlatforms, isOpen, props]);

  const renderPlatformIcon = (
    platformId: string,
    iconChar: string,
    color: string,
  ) => {
    // 对于某些平台使用自定义 SVG 图标
    if (platformId === "twitter") {
      return (
        <div className="w-10 h-10 rounded-lg bg-black flex items-center justify-center text-white font-bold text-lg">
          𝕏
        </div>
      );
    }
    if (platformId === "youtube") {
      return (
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center text-2xl"
          style={{ backgroundColor: "#FF0000" }}
        >
          <span className="text-white text-lg">▶</span>
        </div>
      );
    }
    if (platformId === "bilibili") {
      return (
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: "#00A1D6" }}
        >
          <span className="text-white font-bold text-sm">Bili</span>
        </div>
      );
    }

    // 默认使用 emoji
    return (
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center text-2xl"
        style={{ backgroundColor: `${color}15` }}
      >
        {iconChar}
      </div>
    );
  };

  const togglePlatform = (platformId: string) => {
    const platform = platforms.find((p) => p.id === platformId);
    if (!platform?.connected) return;

    setSelectedPlatforms((prev) =>
      prev.includes(platformId)
        ? prev.filter((id) => id !== platformId)
        : [...prev, platformId],
    );
  };

  const selectAllConnected = () => {
    const connected = platforms.filter((p) => p.connected).map((p) => p.id);
    setSelectedPlatforms(connected);
  };

  const handlePublish = async () => {
    if (selectedPlatforms.length === 0) return;

    setIsPublishing(true);
    setShowResults(true);
    setPublishResults({});

    // Determine content_type from available media
    const effectiveMediaUrls = mediaUrls ?? (mediaUrl ? [mediaUrl] : []);
    const hasVideo = effectiveMediaUrls.some((url) =>
      /\.(mp4|webm|mov|avi)$/i.test(url),
    );
    const hasImage = effectiveMediaUrls.some((url) =>
      /\.(jpg|jpeg|png|gif|webp)$/i.test(url),
    );
    const contentType = hasVideo
      ? "video"
      : hasImage
        ? "image"
        : effectiveMediaUrls.length > 0
          ? "mixed"
          : "text";

    for (const platformId of selectedPlatforms) {
      try {
        const response = await fetch("/api/tools/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            platform: platformId,
            title: editTitle || "无标题",
            content: editContent,
            media_urls:
              effectiveMediaUrls.length > 0 ? effectiveMediaUrls : undefined,
            content_type: contentType,
          }),
        });

        const result = await response.json();

        setPublishResults((prev) => ({
          ...prev,
          [platformId]: {
            success: result.success || response.ok,
            message: result.message || (response.ok ? "发布成功" : "发布失败"),
            url: result.url,
          },
        }));
      } catch (error) {
        setPublishResults((prev) => ({
          ...prev,
          [platformId]: {
            success: false,
            message: error instanceof Error ? error.message : "网络错误",
          },
        }));
      }
    }

    setIsPublishing(false);
  };

  const handleConnect = (platformId: string) => {
    window.open(`/platforms?connect=${platformId}`, "_blank");
  };

  // 旧版本：渲染为按钮
  if (!isNewProps(props)) {
    return (
      <>
        <button
          onClick={() => setIsOpenState(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all shadow-sm"
        >
          <Share2 size={16} />
          发布
        </button>

        {isOpenState && (
          <ModalContent
            title={editTitle}
            content={editContent}
            onTitleChange={setEditTitle}
            onContentChange={setEditContent}
            mediaUrls={mediaUrls}
            platforms={platforms}
            selectedPlatforms={selectedPlatforms}
            isLoading={isLoading}
            isPublishing={isPublishing}
            showResults={showResults}
            publishResults={publishResults}
            onTogglePlatform={togglePlatform}
            onSelectAll={selectAllConnected}
            onPublish={handlePublish}
            onConnect={handleConnect}
            onClose={onClose}
            onBack={() => {
              setShowResults(false);
              setPublishResults({});
            }}
          />
        )}
      </>
    );
  }

  if (!isOpen) return null;

  return (
    <ModalContent
      title={editTitle}
      content={editContent}
      onTitleChange={setEditTitle}
      onContentChange={setEditContent}
      mediaUrls={mediaUrls}
      platforms={platforms}
      selectedPlatforms={selectedPlatforms}
      isLoading={isLoading}
      isPublishing={isPublishing}
      showResults={showResults}
      publishResults={publishResults}
      onTogglePlatform={togglePlatform}
      onSelectAll={selectAllConnected}
      onPublish={handlePublish}
      onConnect={handleConnect}
      onClose={onClose}
      onBack={() => {
        setShowResults(false);
        setPublishResults({});
      }}
    />
  );
}

// 模态框内容组件
interface ModalContentProps {
  title: string;
  content: string;
  onTitleChange?: (title: string) => void;
  onContentChange?: (content: string) => void;
  platforms: Platform[];
  selectedPlatforms: string[];
  isLoading: boolean;
  isPublishing: boolean;
  showResults: boolean;
  publishResults: Record<
    string,
    { success: boolean; message: string; url?: string }
  >;
  onTogglePlatform: (id: string) => void;
  onSelectAll: () => void;
  onPublish: () => void;
  onConnect: (id: string) => void;
  onClose: () => void;
  onBack: () => void;
}

function ModalContent({
  title,
  content,
  onTitleChange,
  onContentChange,
  platforms,
  selectedPlatforms,
  isLoading,
  isPublishing,
  showResults,
  publishResults,
  onTogglePlatform,
  onSelectAll,
  onPublish,
  onConnect,
  onClose,
  onBack,
  mediaUrls = [],
}: ModalContentProps & { mediaUrls?: string[] }) {
  // 助手函数：转换本地存储路径为后端静态文件 URL
  const getMediaUrl = (url: string) => {
    if (!url) return "";
    // 如果已经是完整的 HTTP URL，直接返回
    if (url.startsWith("http")) return url;
    // 如果是相对于存储路径的相对路径，转换为后端提供服务的路径
    // 后端 main.py 中挂载了:
    // app.mount("/media", StaticFiles(directory=OUTPUT_DIR), name="media")
    // app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="storage/uploads")

    const backendBase = "http://127.0.0.1:8000"; // 也可以考虑从环境变量或配置中获取

    if (url.includes("storage/outputs/")) {
      const filename = url.split("storage/outputs/").pop();
      return `${backendBase}/media/${filename}`;
    }
    if (url.includes("storage/uploads/")) {
      const filename = url.split("storage/uploads/").pop();
      return `${backendBase}/uploads/${filename}`;
    }

    // 兼容简单的文件名
    if (
      !url.includes("/") &&
      (url.endsWith(".mp4") || url.endsWith(".jpg") || url.endsWith(".png"))
    ) {
      return `${backendBase}/media/${url}`;
    }

    return url;
  };

  const connectedCount = platforms.filter((p) => p.connected).length;
  const imageUrls = mediaUrls.filter(
    (url) => !/\.(mp4|webm|mov|avi)$/i.test(url),
  );
  const videoUrls = mediaUrls.filter((url) =>
    /\.(mp4|webm|mov|avi)$/i.test(url),
  );

  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const contentNode = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-0 sm:p-4">
      <div className="bg-white rounded-none sm:rounded-3xl shadow-2xl w-full max-w-5xl h-full sm:h-[85vh] overflow-hidden flex flex-col transform transition-all animate-in zoom-in-95 duration-200">
        {/* 头部 */}
        <div className="flex items-center justify-between px-8 py-6 border-b border-gray-100 bg-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
              <Send size={20} className="text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">
                内容一键分发
              </h2>
              <p className="text-sm font-medium text-slate-500 mt-0.5">
                多平台同步发布 · 覆盖全球主流媒体
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2.5 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-all"
          >
            <X size={24} />
          </button>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-full min-h-[400px]">
              <div className="relative">
                <div className="w-16 h-16 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <Share2 size={24} className="text-blue-600 animate-pulse" />
                </div>
              </div>
              <p className="text-slate-500 font-bold mt-6 text-lg">
                正在探测可用平台渠道...
              </p>
            </div>
          ) : showResults ? (
            <div className="p-8 space-y-4">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-slate-900">
                  发布状态报告
                </h3>
                <div className="px-3 py-1 bg-blue-50 text-blue-700 text-xs font-bold rounded-full uppercase tracking-wider">
                  Live Status
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.entries(publishResults).map(([platformId, result]) => {
                  const platform = platforms.find((p) => p.id === platformId);
                  return (
                    <div
                      key={platformId}
                      className={`flex items-center gap-4 p-5 rounded-2xl border-2 transition-all ${
                        result.success
                          ? "bg-emerald-50 border-emerald-100"
                          : "bg-rose-50 border-rose-100"
                      }`}
                    >
                      <div className="p-2 bg-white rounded-xl shadow-sm italic">
                        {platform?.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-slate-900">
                          {platform?.name}
                        </div>
                        <div
                          className={`text-sm font-medium mt-0.5 ${result.success ? "text-emerald-600" : "text-rose-600"}`}
                        >
                          {result.message}
                        </div>
                      </div>
                      {result.success ? (
                        <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-200">
                          <Check size={18} className="text-white" />
                        </div>
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-rose-500 flex items-center justify-center shadow-lg shadow-rose-200">
                          <AlertCircle size={18} className="text-white" />
                        </div>
                      )}
                      {result.url && (
                        <a
                          href={result.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2.5 bg-white text-blue-600 hover:text-blue-700 rounded-xl shadow-sm border border-blue-100 transition-all hover:scale-105"
                        >
                          <ExternalLink size={18} />
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
              {isPublishing && (
                <div className="flex items-center justify-center py-4">
                  <Loader2
                    size={20}
                    className="animate-spin text-blue-600 mr-2"
                  />
                  <span className="text-gray-600">正在执行全网分发...</span>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* 内容预览与具体选择并排 */}
              <div className="grid grid-cols-1 lg:grid-cols-12 h-full">
                {/* 左侧预览 (4列) */}
                <div className="lg:col-span-5 bg-slate-50/50 p-8 border-r border-slate-100 h-full">
                  <div className="sticky top-0">
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-widest mb-6">
                      <FileText size={14} />
                      <span>发布内容详情预阅</span>
                    </div>

                    <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 flex flex-col">
                      <div className="mb-4 bg-slate-50/50 rounded-xl p-2 border border-slate-100 hover:border-blue-200 transition-colors focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 flex items-center">
                        <input
                          type="text"
                          value={title}
                          onChange={(e) => onTitleChange?.(e.target.value)}
                          placeholder="请输入发布标题..."
                          className="w-full text-lg font-black text-slate-900 bg-transparent border-none px-2 py-1 outline-none focus:ring-0 placeholder:text-slate-300"
                        />
                      </div>

                      <div className="space-y-4 flex-1 flex flex-col">
                        <div className="flex flex-wrap gap-2">
                          <span className="px-3 py-1 bg-slate-100 text-slate-600 text-xs font-bold rounded-lg">
                            字数 {content?.length || 0}
                          </span>
                          <span className="px-3 py-1 bg-slate-100 text-slate-600 text-xs font-bold rounded-lg">
                            预计阅读 {Math.ceil((content?.length || 0) / 300)}{" "}
                            分
                          </span>
                        </div>

                        <textarea
                          value={content}
                          onChange={(e) => onContentChange?.(e.target.value)}
                          placeholder="请输入正文内容..."
                          className="w-full min-h-[160px] flex-1 text-sm text-slate-700 bg-slate-50/50 hover:bg-white border border-slate-100 hover:border-blue-200 rounded-xl p-4 outline-none transition-colors focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 resize-none leading-relaxed"
                        />

                        {/* 媒体预览 */}
                        {mediaUrls.length > 0 && (
                          <div className="grid grid-cols-2 gap-3 mt-4">
                            {imageUrls.slice(0, 4).map((url, idx) => (
                              <div
                                key={idx}
                                className="relative group aspect-square rounded-2xl overflow-hidden border border-slate-200"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element -- dynamic backend media preview URL */}
                                <img
                                  src={getMediaUrl(url)}
                                  alt={`预览 ${idx + 1}`}
                                  className="w-full h-full object-cover transition-transform group-hover:scale-110"
                                />
                                {idx === 3 && imageUrls.length > 4 && (
                                  <div className="absolute inset-0 bg-slate-900/60 flex items-center justify-center text-white text-lg font-black">
                                    +{imageUrls.length - 4}
                                  </div>
                                )}
                              </div>
                            ))}
                            {videoUrls.slice(0, 2).map((url, idx) => (
                              <div
                                key={`v${idx}`}
                                className="relative aspect-video lg:aspect-square bg-slate-900 rounded-2xl flex items-center justify-center overflow-hidden border border-slate-200"
                              >
                                <video
                                  src={getMediaUrl(url)}
                                  controls
                                  autoPlay
                                  muted
                                  loop
                                  className="w-full h-full object-cover"
                                >
                                  您的浏览器不支持视频播放。
                                </video>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-8 flex items-center gap-3 p-4 bg-amber-50 rounded-2xl border border-amber-100 text-amber-800 text-sm">
                      <AlertCircle size={20} className="flex-shrink-0" />
                      <p className="font-medium">
                        温馨提示：发布前请确保您的内容已通过法律合规审核。
                      </p>
                    </div>
                  </div>
                </div>

                {/* 右侧选择 (7列) */}
                <div className="lg:col-span-7 p-8 overflow-y-auto">
                  <div className="flex items-center justify-between mb-8">
                    <div>
                      <h3 className="text-xl font-bold text-slate-900">
                        选择分发渠道
                      </h3>
                      <p className="text-sm text-slate-500 mt-1">
                        已连接 {connectedCount} 个可用媒体号
                      </p>
                    </div>
                    <button
                      onClick={onSelectAll}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-900 text-xs font-bold rounded-xl transition-all"
                    >
                      全选已连接
                    </button>
                  </div>

                  {platforms.length === 0 ? (
                    <div className="text-center py-20 bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200">
                      <Globe
                        className="mx-auto text-slate-300 mb-4"
                        size={48}
                      />
                      <p className="text-slate-900 font-bold text-lg mb-2">
                        暂无可用触达渠道
                      </p>
                      <p className="text-slate-500 text-sm max-w-[200px] mx-auto">
                        请先前往“平台管理”页面绑定您的社交媒体账号。
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-1 gap-4">
                      {platforms.map((platform) => (
                        <div
                          key={platform.id}
                          onClick={() =>
                            platform.connected && onTogglePlatform(platform.id)
                          }
                          className={`group relative flex items-center gap-5 p-5 rounded-2xl border-2 transition-all duration-200 ${
                            platform.connected
                              ? selectedPlatforms.includes(platform.id)
                                ? "border-blue-600 bg-blue-50/30"
                                : "border-slate-100 hover:border-blue-200 bg-white hover:shadow-md cursor-pointer"
                              : "border-slate-50 opacity-50 bg-slate-50/50 grayscale cursor-not-allowed"
                          }`}
                        >
                          <div
                            className={`p-3 rounded-2xl transition-all shadow-sm ${platform.connected ? "bg-white" : "bg-slate-100"}`}
                          >
                            {platform.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-bold text-slate-900 text-lg">
                              {platform.name}
                            </div>
                            <div className="text-sm text-slate-500 flex items-center gap-2 mt-1">
                              <div
                                className={`w-2 h-2 rounded-full ${platform.connected ? "bg-emerald-500 shadow-emerald-200 shadow-[0_0_8px]" : "bg-slate-300"}`}
                              />
                              {platform.connected
                                ? platform.account_info?.nickname ||
                                  "账号授权中..."
                                : "点击右侧去连接"}
                            </div>
                          </div>

                          {platform.connected ? (
                            <div
                              className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all ${
                                selectedPlatforms.includes(platform.id)
                                  ? "bg-blue-600 border-blue-600 shadow-lg shadow-blue-200"
                                  : "border-slate-200 group-hover:border-blue-400 bg-white"
                              }`}
                            >
                              {selectedPlatforms.includes(platform.id) && (
                                <Check size={16} className="text-white" />
                              )}
                            </div>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onConnect(platform.id);
                              }}
                              className="px-4 py-2 text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl transition-all border border-blue-100"
                            >
                              去连接
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* 底部按钮 */}
        {!showResults ? (
          <div className="flex items-center justify-between px-10 py-8 border-t border-slate-100 bg-slate-50/80 backdrop-blur-sm">
            <div className="flex items-center gap-6">
              <div className="hidden sm:block">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-tighter mb-1">
                  已选发布量
                </p>
                <p className="text-lg font-black text-slate-900">
                  {selectedPlatforms.length} 个渠道
                </p>
              </div>
              <button
                onClick={onClose}
                className="px-6 py-3 text-slate-500 hover:text-slate-900 font-bold transition-all"
              >
                放弃发布
              </button>
            </div>

            <div className="flex items-center gap-4">
              <button
                onClick={onPublish}
                disabled={selectedPlatforms.length === 0 || isPublishing}
                className="group relative flex items-center gap-3 px-12 py-5 bg-gradient-to-br from-blue-600 to-indigo-700 text-white rounded-2xl hover:scale-[1.02] active:scale-95 disabled:opacity-40 disabled:grayscale disabled:scale-100 transition-all font-black text-lg shadow-2xl shadow-blue-500/30 overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]" />
                {isPublishing ? (
                  <>
                    <Loader2 size={24} className="animate-spin" />
                    正在飞速发布...
                  </>
                ) : (
                  <>
                    <Send
                      size={24}
                      className="group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform"
                    />
                    启动全网发布 🚀
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-200 bg-gray-50">
            {!isPublishing && (
              <button
                onClick={onBack}
                className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
              >
                返回
              </button>
            )}
            <button
              onClick={onClose}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              {isPublishing ? "关闭" : "完成"}
            </button>
          </div>
        )}
      </div>
    </div>
  );

  if (!mounted || typeof document === "undefined") return null;
  return createPortal(contentNode, document.body);
}
