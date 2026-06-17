/**
 * 前端认证工具：Token 存储 + API 调用封装
 */

const TOKEN_KEY = "ama_access_token";
const USER_KEY = "ama_user";

export interface User {
  id: string;
  username: string;
  email?: string;
  role: "admin" | "editor" | "viewer";
  is_active: number;
  created_at: string;
  updated_at: string;
  last_login?: string;
}

// ── Token 存储 ────────────────────────────────────────

export function saveToken(token: string) {
  if (typeof window !== "undefined") {
    localStorage.setItem(TOKEN_KEY, token);
  }
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function clearToken() {
  if (typeof window !== "undefined") {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }
}

export function saveUser(user: User) {
  if (typeof window !== "undefined") {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
}

export function getCachedUser(): User | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ── API Helpers ───────────────────────────────────────

function authHeaders(): HeadersInit {
  const token = getToken();
  return token
    ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
    : { "Content-Type": "application/json" };
}

/** 浏览器请求同源 Next 代理 /api/*，由服务端转发到 FastAPI，避免直连 :8000 出现 Failed to fetch */
function apiUrl(path: string): string {
  if (typeof window !== "undefined") {
    return `/api${path}`;
  }
  return `${process.env.BACKEND_URL || "http://127.0.0.1:8000"}${path}`;
}

function formatDetail(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((x) => (typeof x === "object" && x && "msg" in x ? String((x as { msg: string }).msg) : JSON.stringify(x))).join("; ");
  }
  if (detail && typeof detail === "object" && "message" in detail) {
    return String((detail as { message: string }).message);
  }
  return "";
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { detail?: unknown };
    const msg = formatDetail(body.detail) || `请求失败 (${res.status})`;
    throw new Error(msg);
  }
  return res.json();
}

// ── Auth API ──────────────────────────────────────────

export async function apiLogin(username: string, password: string) {
  const res = await fetch(apiUrl("/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await handleResponse<{ access_token: string; user: User }>(res);
  saveToken(data.access_token);
  saveUser(data.user);
  return data;
}

export async function apiLogout() {
  const token = getToken();
  if (token) {
    await fetch(apiUrl("/auth/logout"), {
      method: "POST",
      headers: authHeaders(),
    }).catch(() => {});
  }
  clearToken();
}

export async function apiGetMe(): Promise<User> {
  const res = await fetch(apiUrl("/auth/me"), { headers: authHeaders() });
  const data = await handleResponse<{ user: User }>(res);
  saveUser(data.user);
  return data.user;
}

export async function apiChangePassword(oldPassword: string, newPassword: string) {
  const res = await fetch(apiUrl("/auth/change-password"), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
  });
  return handleResponse(res);
}

// ── User Management API ───────────────────────────────

export async function apiListUsers(skip = 0, limit = 50) {
  const res = await fetch(apiUrl(`/users?skip=${skip}&limit=${limit}`), {
    headers: authHeaders(),
  });
  return handleResponse<{ users: User[]; total: number }>(res);
}

export async function apiCreateUser(payload: {
  username: string;
  password: string;
  role: string;
  email?: string;
}) {
  const res = await fetch(apiUrl("/auth/register"), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
}

export async function apiUpdateUser(
  id: string,
  payload: { email?: string; role?: string; is_active?: boolean }
) {
  const res = await fetch(apiUrl(`/users/${id}`), {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
}

export async function apiDeleteUser(id: string) {
  const res = await fetch(apiUrl(`/users/${id}`), {
    method: "DELETE",
    headers: authHeaders(),
  });
  return handleResponse(res);
}

export async function apiResetPassword(id: string, newPassword: string) {
  const res = await fetch(apiUrl(`/users/${id}/reset-password`), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ new_password: newPassword }),
  });
  return handleResponse(res);
}

// ── 角色标签 ──────────────────────────────────────────

export const ROLE_LABELS: Record<string, string> = {
  admin: "管理员",
  editor: "编辑",
  viewer: "只读",
};

export const ROLE_COLORS: Record<string, string> = {
  admin: "bg-purple-100 text-purple-700",
  editor: "bg-blue-100 text-blue-700",
  viewer: "bg-gray-100 text-gray-600",
};
