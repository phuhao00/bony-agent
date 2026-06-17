import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";



export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const response = await fetch(`${BACKEND_URL}/history/${id}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: error || "Failed to delete record" },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Delete record error:", error);
    return NextResponse.json(
      { error: "Failed to delete record" },
      { status: 500 },
    );
  }
}
