import { NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function GET() {
  const res = await fetch(`${BACKEND_URL}/legal-advisor/suggestions`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json({ suggestions: [], environment: null }, { status: res.status });
  }
  return NextResponse.json(data);
}
