import { getBackendBaseUrl } from "@/lib/server/backend-proxy";

export const runtime = "nodejs";

export async function GET() {
  const base = getBackendBaseUrl().replace(/\/$/, "");
  const resp = await fetch(`${base}/agent/assistant-catalog`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const text = await resp.text();
  return new Response(text, {
    status: resp.status,
    headers: {
      "Content-Type": resp.headers.get("content-type") || "application/json",
    },
  });
}

