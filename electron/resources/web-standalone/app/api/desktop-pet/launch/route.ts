import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

function projectRoot(): string {
  const cwd = process.cwd();
  if (cwd.endsWith(`${path.sep}web`)) {
    return path.dirname(cwd);
  }
  if (cwd.endsWith(`${path.sep}web-standalone`)) {
    return path.dirname(path.dirname(cwd));
  }
  return cwd;
}

function petDir(): string {
  return path.join(projectRoot(), "desktop-pet");
}

function bundledPetBinary(): string | null {
  const roots = new Set<string>();
  const envRoot = process.env.AI_MEDIA_AGENT_RESOURCES?.trim();
  if (envRoot) roots.add(envRoot);

  const cwd = process.cwd();
  roots.add(path.dirname(cwd)); // web-standalone → resources/
  roots.add(projectRoot());

  for (const root of roots) {
    if (!root) continue;
    const petDir = path.join(root, "desktop-pet");
    const winExe = path.join(petDir, "ai-media-agent-desktop-pet.exe");
    if (fs.existsSync(winExe)) return winExe;

    const macApp = path.join(petDir, "AI Media Agent Pet.app");
    if (fs.existsSync(macApp)) return macApp;
  }
  return null;
}

function bundledPetDir(): string | null {
  const bin = bundledPetBinary();
  return bin ? path.dirname(bin) : null;
}

function isPetDevRunning(): boolean {
  try {
    if (process.platform === "win32") {
      const out = execSync("netstat -ano | findstr :1420", { encoding: "utf8" });
      return out.includes(":1420");
    }
    execSync("lsof -ti:1420", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function launchBundledPet(binaryPath: string) {
  const logPath = path.join(
    process.env.AI_MEDIA_AGENT_LOGS_DIR ||
      path.join(process.env.APPDATA || process.env.HOME || projectRoot(), "ai-media-agent", "logs"),
    "desktop-pet.log",
  );
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const logFd = fs.openSync(logPath, "a");

  if (process.platform === "win32" && binaryPath.toLowerCase().endsWith(".exe")) {
    const petDir = path.dirname(binaryPath);
    const child = spawn(binaryPath, [], {
      cwd: petDir,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      windowsHide: true,
      env: { ...process.env },
    });
    child.unref();
    return child.pid;
  }

  if (process.platform === "darwin" && binaryPath.endsWith(".app")) {
    const child = spawn("open", ["-a", binaryPath], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return child.pid;
  }

  return null;
}

export async function POST() {
  if (isPetDevRunning()) {
    return Response.json({
      ok: true,
      mode: "already_running",
      message: "桌宠已在运行（可用 ⌘⇧B 或 Alt+Shift+B 唤醒）",
    });
  }

  const bundled = bundledPetBinary();
  if (bundled) {
    const pid = launchBundledPet(bundled);
    return Response.json({
      ok: true,
      mode: "bundled",
      pid,
      message: "桌宠正在启动…",
    });
  }

  const dir = petDir();
  if (!fs.existsSync(path.join(dir, "package.json"))) {
    return Response.json(
      {
        ok: false,
        error: "not_found",
        message:
          process.env.AI_MEDIA_AGENT_PACKAGED === "1"
            ? "未找到内置桌宠，请从系统托盘「启动桌宠 (Boni)」重试，或重新安装完整安装包"
            : "未找到 desktop-pet/，请在项目根目录运行 ./start_local.sh",
      },
      { status: 404 },
    );
  }

  const logPath = path.join(projectRoot(), "logs", "desktop-pet.log");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const logFd = fs.openSync(logPath, "a");

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(npm, ["run", "tauri:dev"], {
    cwd: dir,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      VITE_BACKEND_URL: process.env.VITE_BACKEND_URL || "http://127.0.0.1:8000",
      VITE_CONSOLE_URL:
        process.env.VITE_CONSOLE_URL || "http://127.0.0.1:3000/companion",
    },
  });
  child.unref();

  return Response.json({
    ok: true,
    mode: "dev",
    pid: child.pid,
    message: "桌宠 Sidecar 正在启动…首次编译可能需要 1–2 分钟",
  });
}
