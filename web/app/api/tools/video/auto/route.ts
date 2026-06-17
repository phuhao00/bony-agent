import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export const maxDuration = 300;

type AutoVideoResult = {
  video_url?: string | null;
  local_path?: string | null;
  script?: string;
  search_terms?: string[];
  duration_sec?: number;
};

type AutoVideoTask = {
  id?: string;
  status?: string;
  progress?: number;
  message?: string;
  error?: string | null;
  result?: AutoVideoResult;
};

function normalizeMediaUrl(url?: string | null): string | null | undefined {
  if (!url) return url;
  if (url.startsWith("/api/media/")) return url;
  if (url.startsWith("/media/")) return `/api/media/${url.replace("/media/", "")}`;
  const localMatch = url.match(/storage\/outputs\/([^/]+\.(mp4|webm|mov))/i);
  if (localMatch) return `/api/media/${localMatch[1]}`;
  return url;
}

function normalizeTask(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  const task = data as AutoVideoTask;
  if (task.result) {
    task.result.video_url = normalizeMediaUrl(task.result.video_url);
  }
  return task;
}

async function fetchTaskStatus(taskId: string) {
  return fetch(`${BACKEND_URL}/tools/video/auto/${taskId}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const response = await fetch(`${BACKEND_URL}/tools/video/auto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = normalizeTask(await response.json());
    return NextResponse.json(data, { status: response.status });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const taskId = req.nextUrl.searchParams.get("task_id");
    if (!taskId) {
      return NextResponse.json({ error: "task_id is required" }, { status: 400 });
    }
    const response = await fetchTaskStatus(taskId);
    const data = normalizeTask(await response.json());
    return NextResponse.json(data, { status: response.status });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
