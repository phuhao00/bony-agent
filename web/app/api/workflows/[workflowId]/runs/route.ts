import { NextRequest, NextResponse } from "next/server";
import { getBackendBaseUrl } from "@/lib/server/backend-proxy";

const base = () => getBackendBaseUrl().replace(/\/$/, "");

type Params = { params: Promise<{ workflowId: string }> };

// POST /api/workflows/[workflowId]/runs — start a workflow run (SSE)
export const runtime = "nodejs";
export const maxDuration = 800;

export async function POST(req: NextRequest, { params }: Params) {
  const { workflowId } = await params;
  const body = await req.json().catch(() => ({}));

  const backendUrl = `${base()}/workflows/${workflowId}/runs`;

  const http = (await import("http")).default;
  const https = (await import("https")).default;
  const { Readable } = await import("stream");

  const url = new URL(backendUrl);
  const bodyStr = JSON.stringify(body);

  return new Promise<Response>((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const backReq = lib.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "Content-Length": Buffer.byteLength(bodyStr, "utf8"),
        },
        timeout: 0,
      },
      (incoming) => {
        const webStream = Readable.toWeb(
          incoming as InstanceType<typeof Readable>,
        );
        resolve(
          new Response(webStream as BodyInit, {
            status: incoming.statusCode ?? 502,
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
              "X-Accel-Buffering": "no",
            },
          }),
        );
      },
    );
    backReq.on("error", reject);
    backReq.setTimeout(0);
    backReq.write(bodyStr, "utf8");
    backReq.end();
  }).catch((err) => NextResponse.json({ error: String(err) }, { status: 502 }));
}

// GET /api/workflows/[workflowId]/runs — list runs
export async function GET(req: NextRequest, { params }: Params) {
  const { workflowId } = await params;
  const { searchParams } = new URL(req.url);
  const limit = searchParams.get("limit") ?? "20";
  const resp = await fetch(`${base()}/workflows/${workflowId}/runs?limit=${limit}`, { cache: "no-store" });
  const data = await resp.json();
  return NextResponse.json(data, { status: resp.status });
}
