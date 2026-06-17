import { NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST() {
  try {
    const res = await fetch(`${BACKEND_URL}/financial-news/refresh`, {
      method: "POST",
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
      { error: "Failed to refresh financial news", detail: String(err) },
      { status: 500 },
    );
  }
}
