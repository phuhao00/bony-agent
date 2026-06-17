"use client";

import { ChatBackgroundActivity } from "@/components/ChatBackgroundActivity";
import { useAuth } from "@/contexts/AuthContext";
import { useTranslation } from "@/hooks/useTranslation";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";

// 不需要 Shell（侧边栏、导航等）的路径前缀
const PUBLIC_PATHS = ["/login"];

// 隐藏侧边栏、全屏沉浸的页面（含飞书 H5 餐费上传/历史）
const IMMERSIVE_PATHS = [
  "/companion",
  "/architecture",
  "/meal/upload",
  "/customer-service",
  "/media/opencut",
  "/create/podcast",
  "/media/music",
  "/media/short-drama",
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const { t } = useTranslation();

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  const isImmersive = IMMERSIVE_PATHS.some((p) => pathname.startsWith(p));

  // 公开页面（登录页）：直接全屏渲染，不带任何 Shell
  if (isPublic) {
    return <>{children}</>;
  }

  // 业务页面：认证加载中时，用遮罩阻止内容闪现
  if (loading) {
    return (
      <div className="brand-shell-bg flex h-screen w-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-orange-400 border-r-pink-400 border-t-violet-500 border-b-transparent border-l-orange-300/40" />
          <p className="text-sm text-gray-400">{t("appShell.verifying")}</p>
        </div>
      </div>
    );
  }

  // 已登录或已关闭认证：渲染完整 Shell
  return (
    <div className="brand-shell-bg flex h-screen">
      {!isImmersive && <Sidebar />}
      <main className="workspace-main-fill flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-y-contain">
        {children}
      </main>
      <ChatBackgroundActivity />
    </div>
  );
}
