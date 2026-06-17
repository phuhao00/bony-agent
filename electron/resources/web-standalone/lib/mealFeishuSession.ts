/** 飞书上传：token 链接（推荐）+ 飞书内 H5 JSAPI 免登（lark-cli） */

import { parseJsonResponse } from "@/lib/apiJson";

export type MealEmployeeProfile = {
  open_id?: string;
  name?: string;
  nickname?: string;
  team?: string;
  departments?: string;
};

export type MealUploadSession = {
  ok?: boolean;
  token?: string;
  profile?: MealEmployeeProfile;
  requires_manual_name?: boolean;
  error?: string;
  detail?: string;
  open_in_feishu_url?: string;
};

/** 官方 H5 JSSDK（旧 bytegoofy 域名已下线） */
const H5_SDK_URLS = [
  "https://lf-scm-cn.feishucdn.com/lark/op/h5-js-sdk-1.5.44.js",
  "https://lf-package-sg.larksuitecdn.com/obj/lark-static-sgsaas/lark/op/h5-js-sdk-1.5.44.js",
];

type FeishuWindow = Window & {
  tt?: {
    requestAccess?: (opts: {
      appID: string;
      scopeList: string[];
      success: (res: { code?: string }) => void;
      fail: (err: { errno?: number; errString?: string }) => void;
    }) => void;
    requestAuthCode?: (opts: {
      appId: string;
      success: (res: { code?: string }) => void;
      fail: (err: unknown) => void;
    }) => void;
  };
  h5sdk?: { ready: (fn: () => void) => void };
};

function feishuWin(): FeishuWindow | null {
  if (typeof window === "undefined") return null;
  return window as FeishuWindow;
}

function hasFeishuJsApi(): boolean {
  const w = feishuWin();
  if (!w) return false;
  return Boolean(w.tt?.requestAuthCode || w.tt?.requestAccess);
}

export function mealUploadRedirectUri(): string {
  if (typeof window === "undefined") return "";
  const u = new URL(window.location.href);
  u.search = "";
  u.hash = "";
  return u.toString();
}

/** 飞书内打开（侧边栏，避免 window 模式跳系统浏览器） */
export function feishuApplinkUrl(target?: string): string {
  const page = target || mealUploadRedirectUri();
  return `https://applink.feishu.cn/client/web_url/open?mode=sidebar-semi&url=${encodeURIComponent(page)}`;
}

function isExternalBrowser(): boolean {
  if (typeof window === "undefined") return true;
  if (hasFeishuJsApi()) return false;
  const ua = navigator.userAgent || "";
  if (/Lark|Feishu|飞书|Bytedance|LarkLocale/i.test(ua)) return false;
  return true;
}

function loadScriptOnce(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("no document"));
      return;
    }
    const existing = document.querySelector(
      `script[data-meal-feishu-sdk="${src}"]`,
    ) as HTMLScriptElement | null;
    if (existing?.dataset.loaded === "1") {
      resolve();
      return;
    }
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error(`飞书 SDK 加载失败: ${src}`)),
      );
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.setAttribute("data-meal-feishu-sdk", src);
    s.onload = () => {
      s.dataset.loaded = "1";
      resolve();
    };
    s.onerror = () => reject(new Error(`飞书 SDK 加载失败: ${src}`));
    document.head.appendChild(s);
  });
}

function waitForFeishuJsApi(timeoutMs = 4000): Promise<boolean> {
  if (hasFeishuJsApi()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (hasFeishuJsApi()) {
        resolve(true);
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        resolve(false);
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
}

async function ensureFeishuH5Sdk(): Promise<void> {
  if (await waitForFeishuJsApi(2500)) return;

  let lastErr: Error | null = null;
  for (const src of H5_SDK_URLS) {
    try {
      await loadScriptOnce(src);
      if (await waitForFeishuJsApi(2000)) return;
      await waitH5SdkReady(3000);
      if (hasFeishuJsApi()) return;
      lastErr = new Error("SDK 已加载但未暴露 tt.requestAuthCode");
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr || new Error("飞书 JSAPI 不可用");
}

function hasFeishuBridge(): boolean {
  if (hasFeishuJsApi()) return true;
  if (typeof window === "undefined") return false;
  if (feishuWin()?.h5sdk) return true;
  return /Lark|Feishu|飞书|Bytedance|LarkLocale/i.test(navigator.userAgent || "");
}

export async function fetchFeishuEntry(): Promise<{
  app_id?: string;
  feishu_open_url?: string;
  feishu_applink_url?: string;
  upload_page_url?: string;
  hint?: string;
}> {
  try {
    const res = await fetch("/api/meal/feishu/entry", { cache: "no-store" });
    return await parseJsonResponse(res);
  } catch {
    return {};
  }
}

async function sessionFromToken(token: string): Promise<MealUploadSession> {
  const res = await fetch(
    `/api/meal/feishu/session?token=${encodeURIComponent(token)}`,
    { cache: "no-store" },
  );
  return parseJsonResponse(res);
}

async function sessionFromCode(code: string): Promise<MealUploadSession> {
  const res = await fetch("/api/meal/feishu/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      h5_jsapi: true,
      auth_source: "h5_jsapi",
    }),
  });
  return parseJsonResponse(res);
}

function waitH5SdkReady(timeoutMs = 8000): Promise<void> {
  return new Promise((resolve) => {
    const w = feishuWin();
    if (!w) {
      resolve();
      return;
    }
    if (w.h5sdk?.ready) {
      w.h5sdk.ready(() => resolve());
      return;
    }
    const start = Date.now();
    const tick = () => {
      if (w.h5sdk?.ready) {
        w.h5sdk.ready(() => resolve());
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
}

function formatAuthFail(err: unknown): string {
  if (err && typeof err === "object") {
    const o = err as { errno?: number; errString?: string; message?: string };
    const parts = [
      o.errString,
      o.message,
      o.errno != null ? `errno=${o.errno}` : "",
    ].filter(Boolean);
    if (parts.length) return parts.join(" · ");
  }
  return err instanceof Error ? err.message : String(err);
}

function requestFeishuAuthCode(appId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const tt = feishuWin()?.tt;
    if (!tt?.requestAuthCode && !tt?.requestAccess) {
      reject(new Error("无飞书 JSAPI，请回复「餐费」获取专属链接"));
      return;
    }
    const onCode = (code?: string) => {
      if (code) resolve(code);
      else reject(new Error("未获取授权码"));
    };
    const fail = (err: unknown) =>
      reject(new Error(formatAuthFail(err) || "飞书授权失败"));
    const runAuthCode = () => {
      tt.requestAuthCode?.({
        appId,
        success: (res) => onCode(res.code),
        fail,
      });
    };
    if (tt.requestAccess) {
      tt.requestAccess({
        appID: appId,
        scopeList: [],
        success: (res) => onCode(res.code),
        fail: (err) => {
          if (err?.errno === 103) runAuthCode();
          else fail(err);
        },
      });
    } else {
      runAuthCode();
    }
  });
}

async function tryFeishuSdkAuth(appId: string): Promise<MealUploadSession & { source: string }> {
  try {
    await ensureFeishuH5Sdk();
    await waitH5SdkReady();
    const code = await requestFeishuAuthCode(appId);
    const s = await sessionFromCode(code);
    if (s.ok) return { ...s, source: "lark_cli_sdk" };
    return {
      ...s,
      source: "lark_cli_sdk_failed",
      error: s.error || s.detail || "lark-cli 换取身份失败",
    };
  } catch (e) {
    return {
      ok: false,
      source: "lark_cli_sdk_error",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function resolveUploadSession(params: {
  tokenFromUrl: string;
  codeFromUrl: string;
}): Promise<MealUploadSession & { source: string }> {
  const { tokenFromUrl, codeFromUrl } = params;
  const entry = await fetchFeishuEntry();
  const appId = (entry.app_id || "").trim();
  const pageUrl = entry.upload_page_url || mealUploadRedirectUri();
  const applinkUrl =
    entry.feishu_applink_url ||
    entry.feishu_open_url ||
    feishuApplinkUrl(pageUrl);

  if (codeFromUrl) {
    const s = await sessionFromCode(codeFromUrl);
    if (s.ok) return { ...s, source: "lark_cli_code" };
    return { ...s, source: "lark_cli_code_failed", error: s.error || s.detail };
  }

  if (tokenFromUrl) {
    const s = await sessionFromToken(tokenFromUrl);
    if (s.ok) return { ...s, source: "token" };
    return {
      ...s,
      source: "token_failed",
      error: s.error || "链接已失效，请在飞书内重新发送「餐费」",
    };
  }

  if (isExternalBrowser()) {
    return {
      ok: false,
      requires_manual_name: true,
      source: "external_browser",
      error:
        entry.hint ||
        "请勿在外部浏览器打开。请在飞书 App 内对本机器人或所在群回复「餐费」，使用机器人回复的专属链接上传。",
      open_in_feishu_url: applinkUrl,
    };
  }

  if (appId && hasFeishuBridge()) {
    const sdk = await tryFeishuSdkAuth(appId);
    if (sdk.ok) return sdk;
    return {
      ...sdk,
      requires_manual_name: true,
      source: "in_feishu_auth_failed",
      error:
        sdk.error ||
        "飞书内自动识别失败。请在本群或私聊回复「餐费」获取带身份的专属链接。",
      open_in_feishu_url: applinkUrl,
    };
  }

  return {
    ok: false,
    requires_manual_name: true,
    source: "manual",
    error: "请在飞书内回复「餐费」获取专属上传链接",
    open_in_feishu_url: applinkUrl,
  };
}
