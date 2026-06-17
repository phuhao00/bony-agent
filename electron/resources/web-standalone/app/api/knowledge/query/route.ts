import { errorMessage } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { query, top_k, category, doc_id } = body;

    const response = await fetch(`${BACKEND_URL}/knowledge/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        top_k: top_k || 3,
        category: category || null,
        doc_id: doc_id || null,
      }),
    });

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: unknown) {
    console.error("Knowledge query error:", error);
    return NextResponse.json(
      { success: false, error: errorMessage(error), answer: "" },
      { status: 500 },
    );
  }
}
