import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export const maxDuration = 300;

type LongVideoSegmentPayload = Record<string, unknown> & {
  video_url?: string | null;
};

type LongVideoResultPayload = Record<string, unknown> & {
  final_video_url?: string | null;
  segments?: LongVideoSegmentPayload[];
};

type LongVideoTaskPayload = Record<string, unknown> & {
  result?: LongVideoResultPayload;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.cause instanceof Error ? error.cause.message : error.message;
  }
  return String(error);
}

function normalizeMediaUrl(url?: string | null): string | null | undefined {
  if (!url) {
    return url;
  }

  if (url.startsWith("/api/media/")) {
    return url;
  }

  if (url.startsWith("/media/")) {
    return `/api/media/${url.replace("/media/", "")}`;
  }

  const localMatch = url.match(/storage\/outputs\/([^/]+\.(mp4|webm|mov))/i);
  if (localMatch) {
    return `/api/media/${localMatch[1]}`;
  }

  return url;
}

function normalizeLongVideoTask(data: unknown) {
  if (!data || typeof data !== "object") {
    return data;
  }

  const task = data as LongVideoTaskPayload;

  if (task.result && typeof task.result === "object") {
    task.result.final_video_url = normalizeMediaUrl(
      task.result.final_video_url,
    );

    if (Array.isArray(task.result.segments)) {
      task.result.segments = task.result.segments.map((segment) => ({
        ...segment,
        video_url: normalizeMediaUrl(segment?.video_url),
      }));
    }
  }

  return task;
}

async function fetchLongVideoStatus(taskId: string) {
  return fetch(`${BACKEND_URL}/tools/video/long/${taskId}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const response = await fetch(`${BACKEND_URL}/tools/video/long`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = normalizeLongVideoTask(await response.json());
    return NextResponse.json(data, { status: response.status });
  } catch (error: unknown) {
    const msg = getErrorMessage(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const taskId = req.nextUrl.searchParams.get("task_id");
    if (!taskId) {
      return NextResponse.json(
        { error: "task_id is required" },
        { status: 400 },
      );
    }

    let response: Response;
    try {
      response = await fetchLongVideoStatus(taskId);
    } catch (error: unknown) {
      const msg = getErrorMessage(error);
      if (msg.toLowerCase().includes("econnreset")) {
        response = await fetchLongVideoStatus(taskId);
      } else {
        throw error;
      }
    }

    const data = normalizeLongVideoTask(await response.json());
    return NextResponse.json(data, { status: response.status });
  } catch (error: unknown) {
    const msg = getErrorMessage(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
