import { NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function GET() {
  try {
    const res = await fetch(`${BACKEND_URL}/financial-news`, {
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: "Backend error", status: res.status },
        { status: res.status },
      );
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to fetch financial news", detail: String(err) },
      { status: 500 },
    );
  }
}
