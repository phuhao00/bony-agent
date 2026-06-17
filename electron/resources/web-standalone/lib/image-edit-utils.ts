/** Extract displayable image URL from generation history result text. */
export function extractMediaPathFromResult(result: string): string | null {
  if (!result) return null;

  const localMatch = result.match(
    /storage[/\\]outputs[/\\]([^\s)\n'"*]+\.(?:jpg|jpeg|png|gif|webp))/i,
  );
  if (localMatch) {
    const filename = localMatch[1].split(/[/\\]/).pop();
    if (filename) return `/api/media/${filename}`;
  }

  const directDisplay = result.match(/\*\*直接显示:\*\*\s*(.+?)(?:\n|$)/);
  if (directDisplay) {
    const path = directDisplay[1].trim();
    const fname = path.split(/[/\\]/).pop();
    if (fname?.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
      return `/api/media/${fname}`;
    }
  }

  const urlMatch = result.match(
    /https?:\/\/[^\s)"'*\n]+\.(?:png|jpg|jpeg|webp|gif)(?:\?[^\s)"'*\n]*)?/i,
  );
  return urlMatch ? urlMatch[0] : null;
}

export function extractImageUrls(result: string, imageUrls?: string[]): string[] {
  if (imageUrls?.length) return imageUrls;
  const urls: string[] = [];
  const localMatches = result.matchAll(
    /storage[/\\]outputs[/\\]([^\s)\n'"*]+\.(?:jpg|jpeg|png|gif|webp))/gi,
  );
  for (const match of localMatches) {
    const filename = match[1].split(/[/\\]/).pop();
    if (filename) urls.push(`/api/media/${filename}`);
  }
  if (urls.length) return urls;
  const urlMatches = result.matchAll(
    /https?:\/\/[^\s)"'*\n]+\.(?:png|jpg|jpeg|webp|gif)/gi,
  );
  for (const match of urlMatches) urls.push(match[0]);
  return urls;
}
