import { getBackendBaseUrl } from "@/lib/server/backend-proxy";
import { errorMessage } from "@/lib/server/errors";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  try {
    const res = await fetch(`${getBackendBaseUrl()}/meal/feishu/sync-lark-cli`, {
      method: "POST",
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: errorMessage(error) }, { status: 500 });
  }
}
