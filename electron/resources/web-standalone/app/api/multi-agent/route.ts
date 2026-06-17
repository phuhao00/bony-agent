import { NextRequest } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

/**
 * 多Agent协作 API 代理
 * 前端 → /api/multi-agent → 后端 /multi-agent/invoke
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { input } = body;

        if (!input || typeof input !== "string") {
            return new Response(
                JSON.stringify({ error: "Missing 'input' field" }),
                { status: 400, headers: { "Content-Type": "application/json" } }
            );
        }

        const resp = await fetch(`${BACKEND_URL}/multi-agent/invoke`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ input }),
        });

        if (!resp.ok) {
            const errText = await resp.text().catch(() => "Unknown error");
            console.error(`[MultiAgent] Backend error ${resp.status}: ${errText}`);
            return new Response(
                JSON.stringify({ error: `Backend error: ${resp.status}`, detail: errText }),
                { status: resp.status, headers: { "Content-Type": "application/json" } }
            );
        }

        const data = await resp.json();
        return new Response(JSON.stringify(data), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (error: any) {
        console.error("[MultiAgent] Proxy error:", error);
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }
}

/**
 * 列出所有已注册 Agent
 */
export async function GET() {
    try {
        const resp = await fetch(`${BACKEND_URL}/multi-agent/agents`);
        const data = await resp.json();
        return new Response(JSON.stringify(data), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (error: any) {
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }
}
