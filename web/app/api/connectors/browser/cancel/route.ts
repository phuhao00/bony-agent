import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        console.log("[Browser Cancel] Cancelling session:", body.session_id);

        const res = await fetch(`${BACKEND_URL}/connectors/browser/cancel`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });

        const data = await res.json();
        return NextResponse.json(data);
    } catch (error: any) {
        console.error("[Browser Cancel] Error:", error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}
