import { errorMessage } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

// GET /api/scheduler/jobs  — list all jobs
// POST /api/scheduler/jobs — create job
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const logs = searchParams.get("logs");
  const jobId = searchParams.get("job_id");

  let backendPath = "/scheduler/jobs";
  if (logs !== null) {
    backendPath = `/scheduler/logs${jobId ? `?job_id=${jobId}&limit=50` : "?limit=50"}`;
  }

  try {
    const res = await fetch(`${BACKEND_URL}${backendPath}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await fetch(`${BACKEND_URL}/scheduler/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
