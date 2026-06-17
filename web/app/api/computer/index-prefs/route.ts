import { fetchBackend } from "@/lib/server/backend-proxy";
import { errorMessage } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  try {
    const res = await fetchBackend("/computer/index-prefs");
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await fetchBackend("/computer/index-prefs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
