import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST(req: NextRequest) {
    console.log("[Browser Login] 收到无头登录请求");

    try {
        const body = await req.json();
        console.log("[Browser Login] 平台:", body.platform);

        const response = await fetch(`${BACKEND_URL}/connectors/browser/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });

        console.log("[Browser Login] 后端响应状态:", response.status);

        const data = await response.json();

        if (!response.ok) {
            return NextResponse.json(data, { status: response.status });
        }

        return NextResponse.json(data);
    } catch (error: any) {
        console.error("[Browser Login] 错误:", error);
        return NextResponse.json(
            { success: false, error: error.message || "登录失败" },
            { status: 500 }
        );
    }
}
