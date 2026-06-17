import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { join } from "path";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

// Check if backend is running
async function isBackendAvailable(): Promise<boolean> {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(`${BACKEND_URL}/health`, { signal: controller.signal });
        clearTimeout(timeoutId);
        return res.ok;
    } catch {
        return false;
    }
}

// Get required cookies for each platform
function getCookieRequirements(platform: string): string[] {
    const requirements: Record<string, string[]> = {
        bilibili: ["SESSDATA", "bili_jct", "DedeUserID", "buvid3"],
        douyin: ["sessionid", "passport_csrf_token", "ttwid"],
        xiaohongshu: ["web_session", "a1", "webId"],
        weibo: ["SUB", "SUBP", "XSRF-TOKEN"],
        kuaishou: ["did", "kuaishou.user_st", "userId"],
        twitter: ["auth_token", "ct0"],
        youtube: ["SID", "HSID", "SSID", "APISID", "SAPISID", "LOGIN_INFO"],
        tiktok: ["sessionid"],
        video_channel: ["sessionid"],
    };
    return requirements[platform] || ["session", "token"];
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const platform = body.platform;
        console.log("[Browser Start] Starting interactive login for:", platform);

        // Check if backend is available
        const backendAvailable = await isBackendAvailable();

        if (!backendAvailable) {
            console.log("[Browser Start] Backend not available, using system browser");

            // Platform login URLs (creator pages for better login detection)
            const loginUrls: Record<string, string> = {
                douyin: "https://creator.douyin.com/",
                bilibili: "https://member.bilibili.com/",
                xiaohongshu: "https://creator.xiaohongshu.com/",
                weibo: "https://weibo.com/",
                kuaishou: "https://cp.kuaishou.com/",
                twitter: "https://x.com/login",
                youtube: "https://studio.youtube.com/",
                tiktok: "https://www.tiktok.com/login",
                video_channel: "https://channels.weixin.qq.com/",
            };

            const loginUrl = loginUrls[platform] || `https://www.${platform}.com/`;

            // Try to open the URL in the system browser
            try {
                const { exec } = require("child_process");
                exec(`open "${loginUrl}"`);
                console.log(`[Browser Start] Opened ${loginUrl} in system browser`);
            } catch (e) {
                console.log("[Browser Start] Failed to open browser automatically");
            }

            // Generate session ID for tracking
            const sessionId = `auto-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            return NextResponse.json({
                success: true,
                auto_mode: true,
                session_id: sessionId,
                browser_opened: true,
                message: "浏览器已打开，完成登录后点击扩展保存Cookie",
                login_url: loginUrl,
                platform: platform,
                instructions: [
                    "1. 在打开的浏览器中完成登录",
                    "2. 登录成功后，点击浏览器右上角的 Cookie Saver 扩展图标",
                    "3. 点击「保存 Cookie」按钮，系统会自动同步",
                    "4. 无需手动操作，等待页面提示连接成功即可",
                ],
                extension_path: "tools/chrome-extension",
                required_cookies: getCookieRequirements(platform),
            });
        }

        const res = await fetch(`${BACKEND_URL}/connectors/browser/start`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });

        const data = await res.json();
        console.log("[Browser Start] Backend response status:", res.status);

        if (!res.ok) {
            console.log("[Browser Start] Backend error:", data);
            return NextResponse.json(
                { success: false, error: data.detail || "启动浏览器失败" },
                { status: res.status }
            );
        }

        return NextResponse.json(data);
    } catch (error: any) {
        console.error("[Browser Start] Error:", error);
        return NextResponse.json(
            { success: false, error: error.message || "请求失败" },
            { status: 500 }
        );
    }
}

