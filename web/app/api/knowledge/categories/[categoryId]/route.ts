import { errorMessage } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ categoryId: string }> },
) {
  try {
    const { categoryId } = await params;
    const response = await fetch(
      `${BACKEND_URL}/knowledge/categories/${categoryId}`,
      { method: "DELETE" },
    );
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: unknown) {
    console.error("Delete knowledge category error:", error);
    return NextResponse.json(
      { success: false, error: errorMessage(error) },
      { status: 500 },
    );
  }
}
