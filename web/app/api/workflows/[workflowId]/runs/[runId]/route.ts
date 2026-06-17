import { NextRequest, NextResponse } from "next/server";
import { getBackendBaseUrl } from "@/lib/server/backend-proxy";

const base = () => getBackendBaseUrl().replace(/\/$/, "");

type Params = { params: Promise<{ workflowId: string; runId: string }> };

// GET /api/workflows/[workflowId]/runs/[runId]
export async function GET(_req: NextRequest, { params }: Params) {
  const { workflowId, runId } = await params;
  const resp = await fetch(`${base()}/workflows/${workflowId}/runs/${runId}`, { cache: "no-store" });
  const data = await resp.json();
  return NextResponse.json(data, { status: resp.status });
}

// POST /api/workflows/[workflowId]/runs/[runId]/cancel
export async function POST(_req: NextRequest, { params }: Params) {
  const { workflowId, runId } = await params;
  const resp = await fetch(`${base()}/workflows/${workflowId}/runs/${runId}/cancel`, { method: "POST" });
  const data = await resp.json();
  return NextResponse.json(data, { status: resp.status });
}
