import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

// Platform metadata for supported platforms
const PLATFORM_METADATA: Record<string, { name: string; icon: string; category: string }> = {
    bilibili: { name: "Bilibili", icon: "bilibili", category: "video" },
    douyin: { name: "抖音", icon: "douyin", category: "video" },
    xiaohongshu: { name: "小红书", icon: "xiaohongshu", category: "social" },
    weibo: { name: "微博", icon: "weibo", category: "social" },
    youtube: { name: "YouTube", icon: "youtube", category: "video" },
    tiktok: { name: "TikTok", icon: "tiktok", category: "video" },
    twitter: { name: "Twitter/X", icon: "twitter", category: "social" },
    instagram: { name: "Instagram", icon: "instagram", category: "social" },
    wechat: { name: "微信公众号", icon: "wechat", category: "social" },
    kuaishou: { name: "快手", icon: "kuaishou", category: "video" },
};

export async function GET(req: NextRequest) {
    try {
        const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

        // Proxy request to the Python backend to get the source of truth
        const response = await fetch(`${BACKEND_URL}/connectors/platforms`, {
            cache: 'no-store'
        });

        if (!response.ok) {
            throw new Error(`Backend returned ${response.status}`);
        }

        const data = await response.json();
        const backendPlatforms = data.platforms || [];

        // Build platforms list from backend data, merging with frontend metadata
        const platforms = backendPlatforms.map((bp: any) => {
            const metadata = PLATFORM_METADATA[bp.platform_id] || {
                name: bp.platform_name || bp.platform_id,
                icon: bp.platform_id,
                category: "other",
            };

            return {
                ...bp,
                platform_name: metadata.name,
                icon: metadata.icon,
                category: metadata.category,
                // Ensure boolean types
                connected: !!bp.connected,
            };
        });

        // Add any platforms that exist in metadata but not in backend (should be rare)
        Object.keys(PLATFORM_METADATA).forEach((platformId) => {
            if (!platforms.find((p: any) => p.platform_id === platformId)) {
                const metadata = PLATFORM_METADATA[platformId];
                platforms.push({
                    platform_id: platformId,
                    platform_name: metadata.name,
                    icon: metadata.icon,
                    category: metadata.category,
                    connected: false,
                    supports_oauth: false,
                    status: "disconnected",
                    account_info: null,
                });
            }
        });

        return NextResponse.json({ platforms });
    } catch (error: any) {
        console.error("Get platforms error (proxy):", error);
        // Fallback or empty list
        return NextResponse.json(
            { error: error.message, platforms: [] },
            { status: 500 },
        );
    }
}
