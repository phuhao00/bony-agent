/** Launch Boni desktop pet from web (Electron IPC or dev API). */

export type LaunchDesktopPetResult = {
  ok: boolean;
  mode?: string;
  message?: string;
  error?: string;
};

type ElectronDesktopPetApi = {
  launchDesktopPet?: () => Promise<{
    ok: boolean;
    mode?: string;
    error?: string;
    message?: string;
  }>;
};

export async function launchDesktopPet(): Promise<LaunchDesktopPetResult> {
  const electronApi = (globalThis as typeof globalThis & { api?: ElectronDesktopPetApi })
    .api;

  if (electronApi?.launchDesktopPet) {
    const result = await electronApi.launchDesktopPet();
    if (result.ok) {
      const msg =
        result.message ||
        (result.mode === "already_running"
          ? "桌宠已在运行（可用 ⌘⇧B 唤醒）"
          : "桌宠正在启动…");
      return { ok: true, mode: result.mode, message: msg };
    }
    return {
      ok: false,
      error: result.error || "launch_failed",
      message: result.message || mapLaunchError(result.error),
    };
  }

  try {
    const res = await fetch("/api/desktop-pet/launch", { method: "POST" });
    const data = (await res.json()) as LaunchDesktopPetResult;
    return data;
  } catch (err) {
    return {
      ok: false,
      error: "network",
      message: err instanceof Error ? err.message : "启动请求失败",
    };
  }
}

export function mapLaunchError(code?: string): string {
  switch (code) {
    case "backend_down":
      return "请先启动 Backend 服务";
    case "not_found":
      return "未找到桌宠。打包版请用系统托盘「启动桌宠」，或确认安装包内含 desktop-pet";
    case "already_running":
      return "桌宠已在运行（可用 ⌘⇧B 唤醒）";
    case "launch_failed":
    case "timeout":
      return "桌宠仍在加载，请稍候或在 Service Status 查看 Desktop Pet 状态";
    default:
      return "桌宠启动失败，请查看 logs/desktop-pet.log";
  }
}
