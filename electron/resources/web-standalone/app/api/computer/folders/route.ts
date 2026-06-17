import { fetchBackend } from "@/lib/server/backend-proxy";
import { errorMessage } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  try {
    const res = await fetchBackend("/computer/folders");
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errorMessage(error), folders: [] },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await fetchBackend("/computer/folders", {
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
