"use client";

import {
    AlertCircle,
    Check,
    ChevronRight,
    ExternalLink,
    Globe,
    Loader2,
    LogOut,
    X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

interface Platform {
  platform_id: string;
  platform_name: string;
  supports_oauth: boolean;
  oauth_url?: string;
  status: string;
  connected: boolean;
  account_info: any;
}

export default function PlatformConnections() {
  const router = useRouter();
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedPlatform, setSelectedPlatform] = useState<Platform | null>(
    null,
  );
  const [isConnecting, setIsConnecting] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Manual mode state
  const [manualMode, setManualMode] = useState(false);
  const [loginUrl, setLoginUrl] = useState("");
  const [cookieInput, setCookieInput] = useState("");
  const [requiredCookies, setRequiredCookies] = useState<string[]>([]);
  const [manualInstructions, setManualInstructions] = useState<string[]>([]);

  useEffect(() => {
    loadPlatforms();
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const loadPlatforms = async () => {
    try {
      const res = await fetch("/api/connectors/platforms");
      const data = await res.json();
      setPlatforms(data.platforms || []);
    } catch (e) {
      console.error("Failed to load platforms:", e);
    } finally {
      setLoading(false);
    }
  };

  // OAuth 授权登录
  const handleOAuthConnect = async () => {
    if (!selectedPlatform) return;
    setIsConnecting(true);
    setError("");

    try {
      const res = await fetch(
        `/api/connectors/oauth/authorize/${selectedPlatform.platform_id}`,
      );
      const data = await res.json();

      if (data.authorization_url) {
        const width = 600,
          height = 700;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;

        const authWindow = window.open(
          data.authorization_url,
          `${selectedPlatform.platform_name}授权`,
          `width=${width},height=${height},left=${left},top=${top},scrollbars=yes`,
        );

        const checkClosed = setInterval(() => {
          if (authWindow?.closed) {
            clearInterval(checkClosed);
            setIsConnecting(false);
            loadPlatforms();
          }
        }, 500);
      } else {
        throw new Error(data.error || "无法获取授权URL");
      }
    } catch (e: any) {
      setError(e.message);
      setIsConnecting(false);
    }
  };

  // 交互式浏览器登录（核心功能！）
  const handleBrowserLogin = async () => {
    if (!selectedPlatform) return;
    setIsConnecting(true);
    setError("");
    setStatusMessage("正在启动浏览器...");

    try {
      // 1. 启动浏览器
      const res = await fetch("/api/connectors/browser/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: selectedPlatform.platform_id }),
      });

      const data = await res.json();

      if (!data.success) {
        // Check for detailed instructions (e.g., when backend is not running)
        if (data.instructions && Array.isArray(data.instructions)) {
          const instructionText = data.instructions.join("\n");
          throw new Error(
            `${data.error}\n\n${data.details || ""}\n\n${instructionText}`,
          );
        }
        throw new Error(data.error || "启动浏览器失败");
      }

      // Auto mode with extension - show instructions and poll for file changes
      if (data.auto_mode) {
        setManualMode(true);
        setLoginUrl(data.login_url);
        setManualInstructions(data.instructions || []);
        setRequiredCookies(data.required_cookies || []);
        setStatusMessage(data.message);
        setSessionId(data.session_id);

        // Start polling for credential file updates
        pollingRef.current = setInterval(async () => {
          try {
            const statusRes = await fetch("/api/connectors/browser/status", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                session_id: data.session_id,
                platform: selectedPlatform.platform_id,
              }),
            });
            const statusData = await statusRes.json();

            if (statusData.status === "success") {
              if (pollingRef.current) clearInterval(pollingRef.current);
              setStatusMessage("登录成功！Cookie已保存");
              setIsConnecting(false);
              await loadPlatforms();
              setTimeout(() => closeModal(), 1500);
            } else if (statusData.status === "timeout") {
              if (pollingRef.current) clearInterval(pollingRef.current);
              setStatusMessage("等待超时，请重试");
              setIsConnecting(false);
              setManualMode(false); // Go back or close
            }
          } catch (e) {
            // Stop polling on error to avoid infinite loop
            if (pollingRef.current) clearInterval(pollingRef.current);
            setStatusMessage("连接断开，请重试");
            setIsConnecting(false);
          }
        }, 2000);

        setIsConnecting(false);
        return;
      }

      // Legacy manual mode (fallback)
      if (data.manual_mode) {
        setManualMode(true);
        setLoginUrl(data.login_url);
        setManualInstructions(data.instructions || []);
        setRequiredCookies(data.required_cookies || []);
        setStatusMessage(data.message);
        setIsConnecting(false);
        return;
      }

      setSessionId(data.session_id);
      setStatusMessage(data.message || "请在弹出的浏览器中完成登录...");

      // 2. 开始轮询检查状态
      pollingRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch("/api/connectors/browser/status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              session_id: data.session_id,
              platform: selectedPlatform.platform_id,
            }),
          });
          const statusData = await statusRes.json();

          if (statusData.status === "success") {
            // 登录成功！
            if (pollingRef.current) clearInterval(pollingRef.current);
            setStatusMessage("登录成功！");
            setIsConnecting(false);
            await loadPlatforms();
            closeModal();
          } else if (
            statusData.status === "cancelled" ||
            statusData.status === "expired"
          ) {
            if (pollingRef.current) clearInterval(pollingRef.current);
            setError("浏览器已关闭");
            setIsConnecting(false);
          } else if (statusData.status === "timeout") {
            if (pollingRef.current) clearInterval(pollingRef.current);
            setError("登录超时，请重试");
            setIsConnecting(false);
          } else if (statusData.status === "error") {
            if (pollingRef.current) clearInterval(pollingRef.current);
            setError(statusData.error || "发生错误");
            setIsConnecting(false);
          } else {
            // 仍在等待
            setStatusMessage(
              `请在浏览器中完成登录... (${statusData.elapsed || 0}秒)`,
            );
          }
        } catch (e) {
          console.error("Status check failed:", e);
        }
      }, 2000);
    } catch (e: any) {
      setError(e.message);
      setIsConnecting(false);
    }
  };

  // Handle manual cookie submission
  const handleManualCookieSubmit = async () => {
    if (!selectedPlatform || !cookieInput.trim()) {
      setError("请输入Cookie");
      return;
    }

    setIsConnecting(true);
    setError("");

    try {
      // Parse cookie string to object
      const cookies: Record<string, string> = {};
      cookieInput.split(";").forEach((item) => {
        const [key, ...valueParts] = item.trim().split("=");
        if (key && valueParts.length > 0) {
          cookies[key.trim()] = valueParts.join("=").trim();
        }
      });

      // Save to platform credentials
      const res = await fetch("/api/connectors/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: selectedPlatform.platform_id,
          credentials: cookies,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setStatusMessage("连接成功！");
        await loadPlatforms();
        setTimeout(() => closeModal(), 1000);
      } else {
        throw new Error(data.error || "保存失败");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async (platformId: string) => {
    if (!confirm("确定要断开连接吗？")) return;
    try {
      await fetch(`/api/connectors/disconnect/${platformId}`, {
        method: "POST",
      });
      await loadPlatforms();
      closeModal();
    } catch (e) {
      console.error("Disconnect failed:", e);
    }
  };

  const openModal = (platform: Platform) => {
    setSelectedPlatform(platform);
    setError("");
    setStatusMessage("");
    setSessionId("");
    setManualMode(false);
    setCookieInput("");
    setLoginUrl("");
    setRequiredCookies([]);
    setManualInstructions([]);
    if (pollingRef.current) clearInterval(pollingRef.current);
  };

  const closeModal = () => {
    setSelectedPlatform(null);
    setManualMode(false);
    setCookieInput("");
    if (pollingRef.current) clearInterval(pollingRef.current);
    // 如果有正在进行的登录，取消它
    if (sessionId) {
      fetch("/api/connectors/browser/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      }).catch(() => {});
    }
  };

  const PLATFORM_LOGOS: Record<string, string> = {
    github: "/logos/github.svg",
    youtube: "/logos/youtube.svg",
    twitter: "/logos/twitter.svg",
    bilibili: "/logos/bilibili.svg",
    xiaohongshu: "/logos/xiaohongshu.svg",
    douyin: "/logos/douyin.svg",
    kuaishou: "/logos/kuaishou.svg",
    video_channel: "/logos/video_channel.svg",
    tiktok: "/logos/tiktok.svg",
    weibo: "/logos/weibo.svg",
    feishu: "/logos/feishu.svg",
    discord: "/logos/discord.svg",
    wechat: "/logos/wechat.svg",
    qq: "/logos/qq.svg",
    dingtalk: "/logos/dingtalk.svg",
    meta: "/logos/meta.svg",
    instagram: "/logos/instagram.svg",
  };

  const PLATFORM_EMOJIS: Record<string, string> = {
    bilibili: "📺",
    xiaohongshu: "📕",
    douyin: "🎵",
    weibo: "🥚",
    video_channel: "📹",
    twitter: "🐦",
    youtube: "▶️",
    meta: "♾️",
    github: "🐙",
    google: "G",
  };

  const getPlatformLogo = (platformId: string) => PLATFORM_LOGOS[platformId];
  const getPlatformIcon = (platformId: string) => PLATFORM_EMOJIS[platformId] || "🔗";

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="animate-spin text-gray-400" size={32} />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-8">
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
          <h1 className="text-2xl font-bold text-gray-800">平台连接</h1>
          <p className="text-gray-500 text-sm mt-1">管理您的社交媒体发布渠道</p>
        </div>
      </header>

      {/* Platform Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {platforms.map((platform) => (
          <div
            key={platform.platform_id}
            onClick={() => openModal(platform)}
            className={`
                            cursor-pointer group relative flex flex-col items-center justify-center p-6 rounded-2xl border transition-all duration-200
                            ${
                              platform.connected
                                ? "bg-white border-green-200 shadow-sm hover:shadow-md hover:border-green-300"
                                : "bg-white border-gray-100 shadow-sm hover:shadow-md hover:border-blue-200 hover:-translate-y-1"
                            }
                        `}
          >
            <div className="absolute top-3 right-3">
              {platform.connected ? (
                <div className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" />
              ) : (
                <div className="w-2.5 h-2.5 rounded-full bg-gray-200 group-hover:bg-gray-300" />
              )}
            </div>

            <div className="h-12 w-12 mb-3 flex items-center justify-center transition-transform group-hover:scale-110">
              {(() => {
                const logo = getPlatformLogo(platform.platform_id);
                return logo ? (
                  <img
                    src={logo}
                    alt={platform.platform_name}
                    className="h-10 w-10 object-contain"
                  />
                ) : (
                  <span className="text-4xl">{getPlatformIcon(platform.platform_id)}</span>
                );
              })()}
            </div>

            <h3 className="font-semibold text-gray-800 mb-1">
              {platform.platform_name}
            </h3>

            {platform.connected ? (
              <p className="text-xs text-green-600 font-medium">已连接</p>
            ) : (
              <p className="text-xs text-gray-400 font-medium flex items-center">
                点击连接 <ChevronRight size={10} className="ml-0.5" />
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Modal */}
      {selectedPlatform && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <div className="flex items-center gap-3">
                {(() => {
                  const logo = getPlatformLogo(selectedPlatform.platform_id);
                  return logo ? (
                    <img
                      src={logo}
                      alt={selectedPlatform.platform_name}
                      className="h-8 w-8 object-contain"
                    />
                  ) : (
                    <span className="text-2xl">{getPlatformIcon(selectedPlatform.platform_id)}</span>
                  );
                })()}
                <div>
                  <h3 className="font-bold text-gray-800 text-lg">
                    {selectedPlatform.connected
                      ? "管理连接"
                      : `连接 ${selectedPlatform.platform_name}`}
                  </h3>
                  {selectedPlatform.connected && (
                    <p className="text-xs text-green-600 flex items-center gap-1">
                      <Check size={10} /> 已连接
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={closeModal}
                className="p-1 hover:bg-gray-200 rounded-full"
              >
                <X size={20} className="text-gray-500" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6">
              {/* Error Message */}
              {error && (
                <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg flex items-start gap-2">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <span className="whitespace-pre-wrap">{error}</span>
                </div>
              )}

              {selectedPlatform.connected ? (
                // 已连接状态
                <div>
                  <div className="bg-green-50 rounded-xl p-4 mb-6 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
                      {(() => {
                        const logo = getPlatformLogo(selectedPlatform.platform_id);
                        return logo ? (
                          <img
                            src={logo}
                            alt={selectedPlatform.platform_name}
                            className="h-7 w-7 object-contain"
                          />
                        ) : (
                          <span className="text-2xl">{getPlatformIcon(selectedPlatform.platform_id)}</span>
                        );
                      })()}
                    </div>
                    <div>
                      <p className="font-bold text-gray-800">连接正常</p>
                      <p className="text-xs text-gray-500">
                        可以发布内容到此平台
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      handleDisconnect(selectedPlatform.platform_id)
                    }
                    className="w-full py-3 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 font-medium flex items-center justify-center gap-2"
                  >
                    <LogOut size={16} /> 断开连接
                  </button>
                </div>
              ) : (
                // 未连接状态
                <div className="text-center py-4">
                  {manualMode ? (
                    // Auto mode with extension
                    <div className="text-left">
                      <div className="mb-4 p-3 bg-green-50 rounded-lg border border-green-200">
                        <p className="text-sm text-green-800 font-medium mb-1">
                          ✅ 浏览器已打开
                        </p>
                        <p className="text-xs text-green-700">
                          请在浏览器中完成登录
                        </p>
                      </div>

                      <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                        <p className="text-sm text-blue-800 font-medium mb-2">
                          📋 操作步骤
                        </p>
                        <ol className="text-xs text-blue-700 space-y-1.5">
                          {manualInstructions.length > 0 ? (
                            manualInstructions.map((instruction, idx) => (
                              <li key={idx}>{instruction}</li>
                            ))
                          ) : (
                            <>
                              <li>1. 在浏览器中完成登录（扫码或密码）</li>
                              <li>2. 点击浏览器右上角的 Cookie Saver 扩展</li>
                              <li>3. 点击「保存 Cookie」按钮</li>
                              <li>4. 系统会自动检测并保存</li>
                            </>
                          )}
                        </ol>
                      </div>

                      {sessionId && (
                        <div className="mb-4 p-3 bg-purple-50 rounded-lg border border-purple-200">
                          <div className="flex items-center gap-2">
                            <Loader2
                              size={14}
                              className="text-purple-500 animate-spin"
                            />
                            <p className="text-xs text-purple-700">
                              正在监听登录状态...
                            </p>
                          </div>
                        </div>
                      )}

                      {statusMessage && (
                        <p className="text-xs text-center mb-3 text-gray-600">
                          {statusMessage}
                        </p>
                      )}

                      <div className="mb-4 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                        <p className="text-xs text-yellow-800 font-medium mb-1">
                          ⚠️ 首次使用需安装扩展
                        </p>
                        <p className="text-xs text-yellow-700">
                          Chrome → 更多工具 → 扩展程序 → 开发者模式 →
                          加载已解压的扩展 → 选择 tools/chrome-extension 文件夹
                        </p>
                      </div>

                      <button
                        onClick={() => {
                          const text = "copy(document.cookie)";
                          // Fallback for non-HTTPS environments
                          if (navigator.clipboard && window.isSecureContext) {
                            navigator.clipboard.writeText(text);
                          } else {
                            // Fallback using textarea
                            const textarea = document.createElement("textarea");
                            textarea.value = text;
                            textarea.style.position = "fixed";
                            textarea.style.opacity = "0";
                            document.body.appendChild(textarea);
                            textarea.select();
                            document.execCommand("copy");
                            document.body.removeChild(textarea);
                          }
                          setStatusMessage(
                            "脚本已复制！请粘贴到浏览器控制台执行",
                          );
                        }}
                        className="w-full mb-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-mono text-sm flex items-center justify-center gap-2 transition-all border border-gray-300"
                      >
                        📋 复制脚本: copy(document.cookie)
                      </button>

                      {statusMessage && (
                        <p className="text-xs text-green-600 text-center mb-3">
                          {statusMessage}
                        </p>
                      )}

                      <a
                        href={loginUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full mb-3 py-2 text-blue-600 hover:text-blue-800 text-sm flex items-center justify-center gap-1 transition-all"
                      >
                        <ExternalLink size={14} />
                        重新打开登录页面
                      </a>

                      <div className="mb-3">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          粘贴Cookie
                        </label>
                        <textarea
                          value={cookieInput}
                          onChange={(e) => setCookieInput(e.target.value)}
                          placeholder="从控制台复制的cookie会自动在这里..."
                          className="w-full h-20 p-3 border border-gray-200 rounded-lg text-sm font-mono resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          需要: {requiredCookies.join(", ")}
                        </p>
                      </div>

                      <div className="flex gap-3">
                        <button
                          onClick={handleManualCookieSubmit}
                          disabled={isConnecting || !cookieInput.trim()}
                          className="flex-1 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white rounded-xl font-medium flex items-center justify-center gap-2 transition-all"
                        >
                          {isConnecting ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : (
                            <Check size={16} />
                          )}
                          保存连接
                        </button>
                        <button
                          onClick={() => setManualMode(false)}
                          className="px-6 py-3 border border-gray-200 text-gray-600 rounded-xl font-medium hover:bg-gray-50"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : isConnecting ? (
                    // 正在连接中
                    <div>
                      <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Loader2
                          size={40}
                          className="text-blue-500 animate-spin"
                        />
                      </div>
                      <p className="text-gray-800 font-medium mb-2">
                        {statusMessage}
                      </p>
                      <p className="text-xs text-gray-500">
                        请在弹出的浏览器窗口中完成登录
                        <br />
                        登录成功后会自动关闭
                      </p>
                    </div>
                  ) : (
                    // 选择登录方式
                    <div>
                      <div className="w-20 h-20 bg-gradient-to-br from-blue-50 to-purple-50 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Globe size={40} className="text-blue-500" />
                      </div>

                      {/* 支持浏览器登录的国内平台 */}
                      {[
                        "douyin",
                        "xiaohongshu",
                        "bilibili",
                        "weibo",
                        "kuaishou",
                        "twitter",
                        "youtube",
                        "tiktok",
                        "video_channel",
                      ].includes(selectedPlatform.platform_id) ? (
                        <>
                          <p className="text-gray-600 text-sm mb-6">
                            点击下方按钮，将打开浏览器窗口
                            <br />
                            请在浏览器中完成登录（扫码或密码均可）
                          </p>

                          <button
                            onClick={handleBrowserLogin}
                            className="w-full py-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white rounded-xl font-bold shadow-lg shadow-blue-200 flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                          >
                            <Globe size={20} />
                            打开浏览器登录
                          </button>
                        </>
                      ) : selectedPlatform.supports_oauth ? (
                        // OAuth 平台
                        <>
                          <p className="text-gray-600 text-sm mb-6">
                            点击下方按钮进行授权
                            <br />
                            将跳转到 {selectedPlatform.platform_name}{" "}
                            官方授权页面
                          </p>

                          <button
                            onClick={handleOAuthConnect}
                            className="w-full py-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white rounded-xl font-bold shadow-lg shadow-blue-200 flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                          >
                            <ExternalLink size={20} />
                            使用 OAuth 授权
                          </button>
                        </>
                      ) : (
                        // 不支持的平台
                        <p className="text-gray-500 text-sm">
                          此平台暂不支持连接
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
