import { NextResponse, NextRequest } from "next/server";
import { fetchBackend, getBackendBaseUrl } from "@/lib/server/backend-proxy";

/** 后端 get_media_models_summary 冷启动时会拉 OpenRouter models（单次最多约 30s），须大于 Next 原先 10s 上限 */
const FETCH_OPTS = { timeoutMs: 45_000, retries: 3 } as const;
const FETCH_OPTS_POST = { timeoutMs: 20_000, retries: 2 } as const;

export async function GET() {
    try {
        const response = await fetchBackend(
            "/config/media-models",
            {},
            FETCH_OPTS,
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            return NextResponse.json(
                typeof data === "object" && data !== null ? data : { error: response.statusText },
                { status: response.status },
            );
        }
        return NextResponse.json(data);
    } catch (error: unknown) {
        const err = error as { name?: string; code?: string; message?: string };
        console.warn(
            "[MediaModels] Backend not ready:",
            err.name || err.code || err.message || String(error),
            `(${getBackendBaseUrl()})`,
        );
        return NextResponse.json({
            image: { models: [], current: "" },
            video: { models: [], current: "" },
            audio: { models: [], current: "" },
            _fallback: true,
        });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const response = await fetchBackend(
            "/config/media-models",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            },
            FETCH_OPTS_POST,
        );
        const data = await response.json().catch(() => ({}));
        return NextResponse.json(data, {
            status: response.ok ? 200 : response.status,
        });
    } catch (error: unknown) {
        const err = error as { message?: string };
        console.error("[MediaModels] Update error:", error);
        return NextResponse.json(
            { status: "error", message: err.message ?? "Request failed" },
            { status: 500 },
        );
    }
}
