/** 安全解析 API 响应（避免 500 返回纯文本时 JSON.parse 报错） */
export async function parseJsonResponse<T = Record<string, unknown>>(
  res: Response,
): Promise<T> {
  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    const preview = text.slice(0, 120).replace(/\s+/g, " ");
    throw new Error(
      res.ok
        ? `响应不是 JSON：${preview}`
        : `服务错误 (${res.status})：${preview}`,
    );
  }
}
