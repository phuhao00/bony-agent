function triggerDownloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 导出用：在正文前插入文档标题（预览区不再重复渲染标题） */
export function wrapHtmlWithDocumentTitle(
  bodyInnerHtml: string,
  documentTitle: string,
): string {
  const t = documentTitle.trim();
  if (!t) return bodyInnerHtml;
  return `<h1 style="font-size:22px;font-weight:700;margin:0 0 18px 0;padding-bottom:12px;border-bottom:1px solid #e2e8f0;color:#0f172a;">${escapeHtmlText(t)}</h1>${bodyInnerHtml}`;
}

/** 将当前预览 DOM 导出为 PDF（克隆到离屏节点，避免滚动容器裁切） */
export async function exportHtmlToPdf(
  sourceElement: HTMLElement,
  filename: string,
  opts?: { documentTitle?: string },
): Promise<void> {
  const html2pdf = (await import("html2pdf.js")).default;
  const wrap = document.createElement("div");
  const inner =
    opts?.documentTitle != null && opts.documentTitle !== ""
      ? wrapHtmlWithDocumentTitle(
          sourceElement.innerHTML,
          opts.documentTitle,
        )
      : sourceElement.innerHTML;
  wrap.innerHTML = inner;
  wrap.style.cssText =
    "box-sizing:border-box;padding:28px 24px;max-width:820px;margin:0 auto;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.65;color:#0f172a;background:#fff;";
  document.body.appendChild(wrap);
  try {
    await html2pdf()
      .set({
        margin: [10, 10] as [number, number],
        filename: filename.endsWith(".pdf") ? filename : `${filename}.pdf`,
        image: { type: "jpeg" as const, quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, letterRendering: true },
        jsPDF: {
          unit: "mm" as const,
          format: "a4" as const,
          orientation: "portrait" as const,
        },
      })
      .from(wrap)
      .save();
  } finally {
    document.body.removeChild(wrap);
  }
}

/** HTML 片段（含标题与正文）→ Word .docx（经服务端转换，避免 html-to-docx 依赖 Node 内置模块） */
export async function exportHtmlToDocx(
  bodyInnerHtml: string,
  opts: { title: string; filename: string },
): Promise<void> {
  const html = wrapHtmlWithDocumentTitle(bodyInnerHtml, opts.title);
  const res = await fetch("/api/summary-export/docx", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      html,
      title: opts.title,
      filename: opts.filename,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(errText || `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const name = opts.filename.endsWith(".docx")
    ? opts.filename
    : `${opts.filename}.docx`;
  triggerDownloadBlob(blob, name);
}
