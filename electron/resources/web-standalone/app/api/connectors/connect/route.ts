import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const CREDENTIALS_PATH = join(process.cwd(), "..", "platform_credentials.json");

export async function OPTIONS() {
    return NextResponse.json({}, {
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        },
    });
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { platform, credentials } = body;

        if (!platform || !credentials) {
            return NextResponse.json(
                { success: false, error: "缺少平台ID或凭证" },
                {
                    status: 400,
                    headers: { "Access-Control-Allow-Origin": "*" }
                }
            );
        }

        // Read existing credentials
        let allCredentials: Record<string, any> = {};
        if (existsSync(CREDENTIALS_PATH)) {
            try {
                const fileContent = readFileSync(CREDENTIALS_PATH, "utf-8");
                allCredentials = JSON.parse(fileContent);
            } catch (e) {
                console.error("Error reading credentials file:", e);
            }
        }

        // Update with new credentials
        allCredentials[platform] = credentials;

        // Write back to file
        writeFileSync(CREDENTIALS_PATH, JSON.stringify(allCredentials, null, 2), "utf-8");

        console.log(`[Connect] Saved credentials for platform: ${platform}`);

        return NextResponse.json({
            success: true,
            message: `已保存 ${platform} 的凭证`,
            platform: platform
        }, {
            headers: {
                "Access-Control-Allow-Origin": "*",
            }
        });
    } catch (error: any) {
        console.error("Connect platform error:", error);
        return NextResponse.json(
            { success: false, error: error.message },
            {
                status: 500,
                headers: { "Access-Control-Allow-Origin": "*" }
            }
        );
    }
}

