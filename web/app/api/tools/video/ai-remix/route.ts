import http from "http";
import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

// AI混剪需要较长时间，设置30分钟超时
export const maxDuration = 1800;

// 使用原生http请求以支持更长的超时
function makeRequest(url: string, data: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);

    const options: http.RequestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || 80,
      path: urlObj.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 30 * 60 * 1000, // 30分钟
    };

    const req = http.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        try {
          const json = JSON.parse(body);
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Backend error (${res.statusCode}): ${body}`));
          } else {
            resolve(json);
          }
        } catch {
          reject(new Error(`Invalid JSON response: ${body}`));
        }
      });
    });

    req.on("error", (e) => {
      reject(e);
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout after 30 minutes"));
    });

    req.write(JSON.stringify(data));
    req.end();
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    console.log("Starting AI remix request with native http...");
    const data = await makeRequest(`${BACKEND_URL}/tools/video/ai-remix`, body);

    return NextResponse.json(data);
  } catch (error) {
    console.error("AI Remix API error:", error);

    return NextResponse.json(
      {
        error: `Request failed: ${error instanceof Error ? error.message : error}`,
      },
      { status: 500 },
    );
  }
}
