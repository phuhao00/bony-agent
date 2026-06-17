import { NextRequest } from "next/server";
import { getBackendBaseUrl } from "@/lib/server/backend-proxy";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const base = getBackendBaseUrl().replace(/\/$/, "");
    const res = await fetch(`${base}/creative-apps/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      plan?: Record<string, unknown>;
      detail?: string;
      error?: string;
    };

    if (!res.ok) {
      return new Response(
        JSON.stringify({
          success: false,
          error: data.detail || data.error || `Backend error ${res.status}`,
        }),
        { status: res.status, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
