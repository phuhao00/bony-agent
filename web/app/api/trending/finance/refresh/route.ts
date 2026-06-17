import { NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST() {
  try {
    const response = await fetch(`${BACKEND_URL}/financial-news/refresh`, {
      method: "POST",
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Backend responded with status: ${response.status}`);
    }
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Failed to refresh financial news:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
