/**
 * A2UI 媒体哨兵行：由服务端在流末尾注入，前端 MediaRenderer 解析，
 * 不依赖模型是否照抄 storage/outputs 路径。
 * 格式：每行 A2UI_MEDIA:image:/api/media/<file> 或 A2UI_MEDIA:video:...
 */

const RE_STORAGE_IMAGE =
  /storage[/\\]outputs[/\\]([^\s\)\n'"]+\.(?:jpg|jpeg|png|gif|webp))/gi;
const RE_STORAGE_VIDEO =
  /storage[/\\]outputs[/\\]([^\s\)\n'"]+\.(?:mp4|webm|mov|avi))/gi;
const RE_BACKEND_MEDIA_PATH =
  /\/media\/([^\s"'>\n]+\.(?:jpg|jpeg|png|gif|webp|mp4|webm|mov|avi))/gi;

/** 从后端工具返回文本中提取可展示的 /api/media 哨兵行（去重） */
export function buildA2uiLinesFromToolText(text: string): string[] {
  if (!text || typeof text !== "string") return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (kind: "image" | "video", filename: string) => {
    const line = `A2UI_MEDIA:${kind}:/api/media/${filename}`;
    if (seen.has(line)) return;
    seen.add(line);
    out.push(line);
  };
  for (const m of text.matchAll(RE_STORAGE_IMAGE)) add("image", m[1].replace(/\\/g, "/"));
  for (const m of text.matchAll(RE_STORAGE_VIDEO)) add("video", m[1].replace(/\\/g, "/"));
  for (const m of text.matchAll(RE_BACKEND_MEDIA_PATH)) {
    const fn = m[1].replace(/\\/g, "/");
    add(/\.(mp4|webm|mov|avi)$/i.test(fn) ? "video" : "image", `/api/media/${fn}`);
  }
  return out;
}

/** 从助手全文里解析哨兵行，得到图片 / 视频 URL 列表 */
export function parseA2uiMediaFromContent(content: string): {
  imageUrls: string[];
  videoUrls: string[];
} {
  const imageUrls: string[] = [];
  const videoUrls: string[] = [];
  const seenI = new Set<string>();
  const seenV = new Set<string>();
  const re = /^A2UI_MEDIA:(image|video):(\S+)$/gm;
  for (const m of content.matchAll(re)) {
    const kind = m[1];
    const url = m[2].trim();
    if (!url || url === "/") continue;
    if (kind === "image" && !seenI.has(url)) {
      seenI.add(url);
      imageUrls.push(url);
    } else if (kind === "video" && !seenV.has(url)) {
      seenV.add(url);
      videoUrls.push(url);
    }
  }
  return { imageUrls, videoUrls };
}

/** 从正文中移除哨兵行（避免用户看到机器行） */
export function stripA2uiMediaLines(content: string): string {
  return content.replace(/^A2UI_MEDIA:(image|video):\S+$/gm, "").trim();
}
