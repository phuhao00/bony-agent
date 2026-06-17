import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_HTML = 600_000;

function asciiFilename(name: string): string {
  const base = name
    .trim()
    .replace(/[/\\?*:|"<>]/g, "-")
    .replace(/\s+/g, "_")
    .slice(0, 80);
  const withExt = base.toLowerCase().endsWith(".docx") ? base : `${base || "summary"}.docx`;
  return /^[\x00-\x7f]+$/.test(withExt)
    ? withExt
    : `summary-${Date.now()}.docx`;
}

export async function POST(request: Request) {
  let payload: { html?: string; title?: string; filename?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const html = payload.html;
  const title =
    typeof payload.title === "string" && payload.title.trim()
      ? payload.title.trim()
      : "Summary";
  if (!html || typeof html !== "string") {
    return NextResponse.json({ error: "html required" }, { status: 400 });
  }
  if (html.length > MAX_HTML) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }

  const safeTitle = title
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
  const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${safeTitle}</title></head><body>${html}</body></html>`;

  try {
    const HTMLtoDOCX = (await import("html-to-docx")).default;
    const buffer = await HTMLtoDOCX(fullHtml, null, {
      title,
      creator: "AI Media Agent / Lark CLI",
      lang: "zh-CN",
    });
    const u8 =
      buffer instanceof Uint8Array
        ? buffer
        : new Uint8Array(buffer as ArrayBuffer);
    const ab = u8.buffer.slice(
      u8.byteOffset,
      u8.byteOffset + u8.byteLength,
    ) as ArrayBuffer;
    const downloadName = asciiFilename(
      typeof payload.filename === "string" ? payload.filename : `${title}.docx`,
    );
    const outBlob = new Blob([ab], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    return new NextResponse(outBlob, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${downloadName}"`,
      },
    });
  } catch (e) {
    console.error("[summary-export/docx]", e);
    return NextResponse.json(
      { error: "docx generation failed" },
      { status: 500 },
    );
  }
}
