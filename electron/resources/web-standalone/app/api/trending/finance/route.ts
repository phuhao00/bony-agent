import { NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function GET() {
  try {
    const response = await fetch(`${BACKEND_URL}/financial-news`, {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Backend responded with status: ${response.status}`);
    }
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Failed to fetch financial news from backend:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
