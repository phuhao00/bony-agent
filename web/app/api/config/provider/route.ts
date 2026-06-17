import { NextResponse, NextRequest } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";

// Retry fetch with backoff — solves startup race condition
async function fetchWithRetry(url: string, options?: RequestInit, maxRetries = 3): Promise<Response> {
    let lastError: Error | null = null;
    for (let i = 0; i < maxRetries; i++) {
        try {
            const res = await fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
            return res;
        } catch (err: any) {
            lastError = err;
            if (i < maxRetries - 1) {
                // Wait 1s, 2s, 3s before next retry
                await new Promise(r => setTimeout(r, (i + 1) * 1000));
            }
        }
    }
    throw lastError;
}

export async function GET() {
    try {
        const response = await fetchWithRetry(`${BACKEND_URL}/config/provider`);
        const data = await response.json();
        return NextResponse.json(data);
    } catch (error: any) {
        console.warn("[Config] Backend not ready yet, returning local defaults:", error.code || error.message);
        // 如果后端不可用，返回前端可预测的空列表
        return NextResponse.json({
            current: {
                id: "unknown",
                name: "后端未就位",
                model: "none",
                has_key: false,
            },
            available: [
                {
                    id: "local_wait",
                    name: "请检查后端是否正常启动",
                    default_model: "n/a",
                    models: ["n/a"],
                    has_key: false
                }
            ],
            _fallback: true,
            _error: error.message
        });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const response = await fetchWithRetry(`${BACKEND_URL}/config/provider`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const data = await response.json();
        if (!response.ok) {
            return NextResponse.json(data, { status: response.status });
        }
        return NextResponse.json(data);
    } catch (error: any) {
        console.error("Provider config update error:", error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}
