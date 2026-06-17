/**
 * 仅用于 Next Route Handler（服务端）。将 localhost 规范为 127.0.0.1，避免 Node fetch 走 IPv6(::1) 而后端只监听 IPv4 时连不上。
 */
export function getBackendBaseUrl(): string {
  const raw = (process.env.BACKEND_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
  try {
    const u = new URL(raw);
    if (u.hostname === "localhost") {
      u.hostname = "127.0.0.1";
    }
    return u.toString().replace(/\/$/, "");
  } catch {
    return raw;
  }
}

export async function fetchBackend(
  path: string,
  init?: RequestInit,
  options?: { retries?: number; timeoutMs?: number },
): Promise<Response> {
  const base = getBackendBaseUrl();
  const url = path.startsWith("http") ? path : `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const retries = Math.max(1, options?.retries ?? 4);
  const timeoutMs = options?.timeoutMs ?? 10000;
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      lastErr = e;
      if (i < retries - 1) {
        await new Promise((r) => setTimeout(r, (i + 1) * 500));
      }
    }
  }
  throw lastErr;
}
