export type ImageExportFormat = "png" | "jpeg" | "psd";

export interface ImageExportOptions {
  imageUrl: string;
  format: ImageExportFormat;
  sourceImageUrl?: string;
  maskImageUrl?: string;
  jpegQuality?: number;
}

export interface ImageExportResult {
  download_url: string;
  filename: string;
  format: string;
  size_bytes?: number;
}

export async function exportImageFile(options: ImageExportOptions): Promise<ImageExportResult> {
  const res = await fetch("/api/tools/image/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_url: options.imageUrl,
      format: options.format,
      source_image_url: options.sourceImageUrl || undefined,
      mask_image_url: options.maskImageUrl || undefined,
      jpeg_quality: options.jpegQuality ?? 92,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || data.error || "导出失败");
  }
  return data as ImageExportResult;
}

export function triggerBrowserDownload(url: string, filename: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export async function downloadExportedImage(options: ImageExportOptions): Promise<void> {
  const result = await exportImageFile(options);
  triggerBrowserDownload(result.download_url, result.filename);
}

export function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
