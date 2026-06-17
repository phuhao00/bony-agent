import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Electron / 桌面版 userData（与 electron/main.js 中 app.setPath 一致） */
function agentHome(): string | null {
  const fromEnv =
    process.env.AI_MEDIA_AGENT_HOME?.trim() ||
    (process.env.STORAGE_DIR?.trim()
      ? process.env.STORAGE_DIR.replace(/[/\\]storage\/?$/, "")
      : "");
  if (fromEnv) return fromEnv;

  const home = homedir();
  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", "ai-media-agent");
  }
  if (process.platform === "win32") {
    const local =
      process.env.LOCALAPPDATA?.trim() || join(home, "AppData", "Local");
    return join(local, "ai-media-agent");
  }
  return join(home, ".config", "ai-media-agent");
}

function larkCliCandidates(): string[] {
  const home = homedir();
  const agent = agentHome();
  const ext = process.platform === "win32" ? ".exe" : "";
  const out: string[] = [];
  const push = (p?: string | null) => {
    if (p && !out.includes(p)) out.push(p);
  };

  push(process.env.LARK_CLI_BIN?.trim());

  if (agent) {
    push(
      join(
        agent,
        "lark-cli",
        "node_modules",
        "@larksuite",
        "cli",
        "bin",
        `lark-cli${ext}`,
      ),
    );
    push(
      join(
        agent,
        "lark-cli",
        "node_modules",
        "@larksuite",
        "cli",
        "scripts",
        "run.js",
      ),
    );
    push(
      join(
        agent,
        "lark-cli",
        "node_modules",
        ".bin",
        process.platform === "win32" ? "lark-cli.cmd" : "lark-cli",
      ),
    );
    push(join(agent, "bin", `lark-cli${ext}`));
  }

  push(join(home, ".local", "bin", "lark-cli"));
  push("/opt/homebrew/bin/lark-cli");
  push("/usr/local/bin/lark-cli");

  return out;
}

let cachedExecutable: string | null | undefined;

/**
 * lark-cli 可执行文件路径。
 * - 优先 LARK_CLI_BIN（start_local.sh / Electron 注入）
 * - 桌面版 APP_DATA/lark-cli（安装向导 npm 安装）
 * - 常见用户 PATH（~/.local/bin、homebrew 等）
 */
export function getLarkCliExecutable(): string {
  if (cachedExecutable !== undefined) {
    return cachedExecutable || "lark-cli";
  }

  for (const candidate of larkCliCandidates()) {
    if (existsSync(candidate)) {
      cachedExecutable = candidate;
      return candidate;
    }
  }

  const sep = process.platform === "win32" ? ";" : ":";
  const pathDirs = (getLarkCliChildEnv().PATH || "").split(sep);
  const names =
    process.platform === "win32"
      ? ["lark-cli.cmd", "lark-cli.exe", "lark-cli"]
      : ["lark-cli"];

  for (const dir of pathDirs) {
    if (!dir) continue;
    for (const name of names) {
      const full = join(dir, name);
      if (existsSync(full)) {
        cachedExecutable = full;
        return full;
      }
    }
  }

  cachedExecutable = null;
  return "lark-cli";
}

/** 子进程环境：显式 HOME + 桌面版 Node/lark-cli + 常见安装路径前置到 PATH */
export function getLarkCliChildEnv(): NodeJS.ProcessEnv {
  const home = process.env.HOME || homedir();
  const agent = agentHome();
  const sep = process.platform === "win32" ? ";" : ":";
  const extras = [
    agent ? join(agent, "lark-cli", "node_modules", ".bin") : "",
    agent ? join(agent, "node", "bin") : "",
    agent ? join(agent, "bin") : "",
    join(home, ".local", "bin"),
    join(home, ".fnm", "aliases", "default", "bin"),
    join(home, ".volta", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  const path = [...extras, process.env.PATH || ""].filter(Boolean).join(sep);
  return {
    ...process.env,
    HOME: home,
    PATH: path,
    ...(agent ? { AI_MEDIA_AGENT_HOME: agent } : {}),
  };
}
