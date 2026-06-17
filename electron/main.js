'use strict';

/**
 * AI Media Agent – Electron Main Process
 *
 * Responsibilities:
 *  1. First-run setup: copy backend sources → APP_DATA, create Python venv, pip install
 *  2. Spawn and manage 5 services (Backend, OCR, Parser, Directory, Frontend)
 *  3. System tray icon with status indicator
 *  4. Status / Setup windows via BrowserWindow
 */

const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  shell,
  ipcMain,
  dialog,
  Notification,
} = require('electron');
const path  = require('path');
const fs    = require('fs');
const fsp   = fs.promises;
const crypto = require('crypto');
const { spawn, execFile, execFileSync, execSync } = require('child_process');
const http  = require('http');

// ─── Paths ────────────────────────────────────────────────────────────────────

const IS_DEV   = !app.isPackaged;
// Force userData to a consistent lowercase-hyphenated path regardless of productName capitalisation
app.setPath('userData', path.join(app.getPath('appData'), 'ai-media-agent'));
const APP_DATA = app.getPath('userData');   // ~/Library/Application Support/ai-media-agent
const RESOURCES = IS_DEV
  ? path.join(__dirname, 'resources')
  : path.join(process.resourcesPath, 'resources');

// Writable runtime directories (inside APP_DATA)
const VENV_DIR        = path.join(APP_DATA, 'venv');
const BACKEND_DATA    = path.join(APP_DATA, 'backend');       // copied from RESOURCES
const OCR_DATA        = path.join(APP_DATA, 'services', 'ocr');
const STORAGE_DIR     = path.join(APP_DATA, 'storage');
const LOGS_DIR        = path.join(APP_DATA, 'logs');
const INSTALL_LOG_FILE = path.join(LOGS_DIR, 'install.log');
const DESKTOP_PET_DIR = path.join(APP_DATA, 'desktop-pet');
const BROWSERS_DIR    = path.join(APP_DATA, '.browsers');
const ENV_FILE        = path.join(APP_DATA, 'backend', '.env');
const SETUP_DONE_FILE = path.join(APP_DATA, '.setup_done');
const VERSION_FILE    = path.join(APP_DATA, '.app_version');
const CONFIG_DONE_FILE = path.join(APP_DATA, '.config_done');
const NODE_BIN_FILE   = path.join(APP_DATA, '.node_bin');   // cached path to node executable
const NODE_LOCAL_DIR  = path.join(APP_DATA, 'node');        // portable node download dir
const NODE_MAC_BIN    = path.join(NODE_LOCAL_DIR, 'bin', 'node');
const NODE_WIN_BIN    = path.join(NODE_LOCAL_DIR, 'node.exe');
const NODE_BUNDLE_DIR = path.join(RESOURCES, 'node');
const NODE_BUNDLE_RUNTIME = path.join(NODE_BUNDLE_DIR, 'runtime');
const NODE_VERSION    = '22.15.0';
const IS_WIN     = process.platform === 'win32';
const PYTHON_BUNDLE_DIR = path.join(RESOURCES, 'python');
const LARK_CLI_DIR    = path.join(APP_DATA, 'lark-cli');
const LARK_CLI_PKG    = '@larksuite/cli';
const LARK_CLI_PKG_VER = '^1.0.12';
const RESOURCE_BUNDLE_STAMP = path.join(BACKEND_DATA, '.resource_bundle_version');
const PIP_STAMP_FILE      = path.join(APP_DATA, '.pip_stamp');

// Resource (read-only) directories inside the .app bundle
const RES_BACKEND     = path.join(RESOURCES, 'backend');
const RES_OCR         = path.join(RESOURCES, 'ocr-service');
const RES_GENERATED   = path.join(RESOURCES, 'generated');
const RES_WEB         = path.join(RESOURCES, 'web-standalone');
const RES_BIN         = path.join(RESOURCES, 'bin');
const RES_AGENT_SKILLS     = path.join(RESOURCES, 'agent-skills');     // bundled .agent/skills
const RES_STORAGE_DEFAULTS = path.join(RESOURCES, 'storage-defaults'); // seed mcp_servers.json / skills_enabled.json
const RES_PYTHON_RUNTIME   = path.join(PYTHON_BUNDLE_DIR, 'runtime');
const RES_VENV_PREBUILT    = path.join(PYTHON_BUNDLE_DIR, 'venv-prebuilt');
const RES_PIP_WHEELS       = path.join(RESOURCES, IS_WIN ? 'pip-wheels-win' : 'pip-wheels-mac');
const RES_LARK_CLI_BUNDLED = path.join(RESOURCES, 'lark-cli');
const RES_MCP_BUNDLED      = path.join(RESOURCES, 'mcp-bundled');
const AGENT_SKILLS_DIR     = path.join(APP_DATA, '.agent', 'skills');  // legacy copy target (dev / fallback)

// Python paths (inside venv) — differ by platform
const PYTHON_BIN = IS_WIN
  ? path.join(VENV_DIR, 'Scripts', 'python.exe')
  : path.join(VENV_DIR, 'bin', 'python3');
const PATH_SEP   = IS_WIN ? ';' : ':';

// ─── macOS Python auto-install (python-build-standalone) ─────────────────────
// When Python 3.10+ is not found on macOS, we download a portable CPython from
// https://github.com/astral-sh/python-build-standalone  (no admin rights needed).
const PYTHON_STANDALONE_VERSION = '3.12.13';
const PYTHON_STANDALONE_TAG     = '20260510';
const PYTHON_STANDALONE_DIR     = path.join(APP_DATA, 'python-dist');
const PYTHON_STANDALONE_ROOT    = path.join(PYTHON_STANDALONE_DIR, 'python');
const PYTHON_STANDALONE_BIN     = IS_WIN
  ? path.join(PYTHON_STANDALONE_ROOT, 'python.exe')
  : path.join(PYTHON_STANDALONE_ROOT, 'bin', 'python3');
const PYTHON_STANDALONE_BIN_DIR = IS_WIN
  ? PYTHON_STANDALONE_ROOT
  : path.join(PYTHON_STANDALONE_ROOT, 'bin');
const PYTHON_BIN_FILE           = path.join(APP_DATA, '.python_bin');

function pythonStandaloneTarName() {
  const archTag = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  if (IS_WIN) {
    return `cpython-${PYTHON_STANDALONE_VERSION}+${PYTHON_STANDALONE_TAG}-${archTag}-pc-windows-msvc-install_only.tar.gz`;
  }
  return `cpython-${PYTHON_STANDALONE_VERSION}+${PYTHON_STANDALONE_TAG}-${archTag}-apple-darwin-install_only.tar.gz`;
}

function bundledPythonTarPath() {
  return path.join(PYTHON_BUNDLE_DIR, pythonStandaloneTarName());
}

function pythonStandaloneDownloadUrl() {
  const fileName = pythonStandaloneTarName().replace(/\+/g, '%2B');
  return `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_STANDALONE_TAG}/${fileName}`;
}

// App version – used to detect when source files need refreshing
const APP_VERSION = require('./package.json').version;

// Storage subdirectories that must exist
const STORAGE_SUBDIRS = [
  'outputs', 'uploads', 'temp', 'rag', 'memory', 'scheduler',
  'traces', 'profiles', 'chroma_db', 'computer', 'evolution',
  'knowledge', 'approvals', 'tasks', 'debug', 'tmp',
];

// ─── Service Definitions ─────────────────────────────────────────────────────

const SERVICES = {
  backend: {
    key: 'backend', name: 'Backend API',
    port: 8000, proc: null, status: 'stopped', lastError: '',
  },
  ocr: {
    key: 'ocr', name: 'OCR Service',
    port: 50051, proc: null, status: 'stopped', lastError: '',
  },
  parser: {
    key: 'parser', name: 'Parser Service',
    port: 50052, proc: null, status: 'stopped', lastError: '',
  },
  directory: {
    key: 'directory', name: 'Directory Service',
    port: 50053, proc: null, status: 'stopped', lastError: '',
  },
  frontend: {
    key: 'frontend', name: 'Frontend',
    port: 3000, proc: null, status: 'stopped', lastError: '',
  },
  nativeSidecar: {
    key: 'nativeSidecar', name: 'Native Desktop Sidecar',
    port: 0, proc: null, status: 'stopped', lastError: '',
  },
  desktopPet: {
    key: 'desktopPet', name: 'Desktop Pet (Boni)',
    port: 0, proc: null, status: 'stopped', lastError: '',
  },
  tunnel: {
    key: 'tunnel', name: 'Cloudflare Tunnel',
    port: 0, proc: null, status: 'stopped', lastError: '',
  },
};

let tunnelLaunchScheduled = false;

const SERVICE_PORTS = () => Object.values(SERVICES).map(s => s.port).filter(p => p > 0);
const BACKEND_PORT_FILE = path.join(APP_DATA, '.backend_port');
const BACKEND_PORT_CANDIDATES = [8000, 8010, 8020, 8030, 8080, 8888, 18000];

// ─── Global UI State ──────────────────────────────────────────────────────────

let tray         = null;
let statusWindow = null;
let setupWindow  = null;
let dashboardWindow = null;
let dashboardOpenScheduled = false;
let dashboardAutoOpened = false;
let splashWindow = null;
let setupUiReady = false;
let setupProgressQueue = [];
let setupInstallPending = false;
let runSetupInFlight = null;
let isShuttingDown = false;
let desktopPetProc = null;
let desktopPetMonitorTimer = null;
let desktopPetLaunchGraceUntil = 0;

// ─── Utility Helpers ─────────────────────────────────────────────────────────

/** Try common binary locations for an executable (cross-platform) */
function findExecutable(...names) {
  const { spawnSync } = require('child_process');

  const unixDirs = [
    '/opt/homebrew/bin', '/opt/homebrew/sbin',
    '/usr/local/bin', '/usr/local/sbin',
    '/usr/bin', '/bin',
  ];
  const winDirs = [
    'C:\\Python313', 'C:\\Python312', 'C:\\Python311', 'C:\\Python310',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Python', 'Python313') : '',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Python', 'Python312') : '',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Python', 'Python311') : '',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Python', 'Python310') : '',
  ].filter(Boolean);

  if (IS_WIN) {
    // 1. Try the Windows Python Launcher ONLY for python/python3/py searches.
    //    Guard added because calling py.exe for non-Python names (e.g. 'node')
    //    returns a Python path, making nodeBin point to python.exe.
    const isPythonSearch = names.some(n => /^python3?$|^py$/i.test(n));
    if (isPythonSearch) {
      for (const ver of ['-3.13', '-3.12', '-3.11', '-3.10']) {
        const r = spawnSync('py', [ver, '-c', 'import sys; print(sys.executable)'],
          { encoding: 'utf8', timeout: 5000 });
        if (r.status === 0) {
          const p = r.stdout.trim().split('\n')[0];
          if (p && !p.toLowerCase().includes('windowsapps')) return p;
        }
      }
    }
    // 2. Fall back to where.exe, skipping Windows Store stubs
    for (const name of names) {
      const r = spawnSync('where', [name], { encoding: 'utf8', timeout: 3000 });
      if (r.status === 0) {
        for (const line of r.stdout.split('\n')) {
          const p = line.trim();
          if (!p) continue;
          if (p.toLowerCase().includes('windowsapps')) continue; // skip Store stub
          return p;
        }
      }
    }
    // 3. Check explicit known install dirs
    for (const name of names) {
      for (const dir of winDirs) {
        const full = path.join(dir, `${name}.exe`);
        try { fs.accessSync(full, fs.constants.X_OK); return full; } catch (_) {}
      }
    }
    return null;
  }

  // macOS / Linux
  for (const name of names) {
    const r = spawnSync('which', [name], { encoding: 'utf8', timeout: 3000 });
    if (r.status === 0) {
      const found = r.stdout.trim().split('\n')[0];
      if (found) return found;
    }
    for (const dir of unixDirs) {
      const full = path.join(dir, name);
      try { fs.accessSync(full, fs.constants.X_OK); return full; } catch (_) {}
    }
  }
  return null;
}

/** Parse "3.12.1" style version strings. */
function pythonVersionOk(raw) {
  const cleaned = (raw || '').replace(/^Python\s+/i, '').trim();
  const [maj, min] = cleaned.split('.').map(Number);
  return Boolean(cleaned) && !isNaN(maj) && (maj > 3 || (maj === 3 && min >= 10));
}

/** Remove env vars that break venv / portable Python (causes "No module named encodings"). */
function stripBrokenPythonEnv(env) {
  const clean = { ...env };
  delete clean.PYTHONHOME;
  delete clean.PYTHONPATH;
  delete clean.VIRTUAL_ENV;
  delete clean.PYTHONEXECUTABLE;
  return clean;
}

/** Env for invoking a specific Python binary (venv creation, version checks). */
function envForPythonExe(exe, extras = {}) {
  const pyBinDir = path.dirname(exe);
  const base = stripBrokenPythonEnv(buildEnv(extras));
  base.PATH = [pyBinDir, base.PATH].filter(Boolean).join(PATH_SEP);
  return base;
}

/** Env for venv python / pip / backend services — never set PYTHONHOME. */
function envForVenv(extras = {}) {
  const base = stripBrokenPythonEnv(buildEnv(extras));
  if (fs.existsSync(VENV_DIR)) base.VIRTUAL_ENV = VENV_DIR;
  const venvBin = IS_WIN
    ? path.join(VENV_DIR, 'Scripts')
    : path.join(VENV_DIR, 'bin');
  if (fs.existsSync(venvBin)) {
    base.PATH = [venvBin, base.PATH].filter(Boolean).join(PATH_SEP);
  }
  return base;
}

/** Run `python --version` synchronously; returns null when the binary is unusable. */
function getPythonVersionSync(exe) {
  try {
    const out = execSync(`"${exe}" --version`, {
      encoding: 'utf8',
      timeout: 8000,
      env: envForPythonExe(exe),
    });
    return (out || '').replace(/^Python\s+/i, '').trim();
  } catch (err) {
    const text = [err.stdout, err.stderr, err.message].filter(Boolean).join('\n');
    const m = text.match(/Python\s+([\d.]+)/i);
    return m ? m[1] : null;
  }
}

/** Collect candidate Python executables (may include old system 3.9). */
function enumeratePythonCandidates() {
  const seen = new Set();
  const add = (p) => {
    if (!p || seen.has(p)) return;
    try {
      fs.accessSync(p, fs.constants.X_OK);
      seen.add(p);
    } catch (_) {}
  };

  if (fs.existsSync(PYTHON_STANDALONE_BIN)) add(PYTHON_STANDALONE_BIN);

  if (IS_WIN) {
    const { spawnSync } = require('child_process');
    for (const ver of ['-3.13', '-3.12', '-3.11', '-3.10']) {
      const r = spawnSync('py', [ver, '-c', 'import sys; print(sys.executable)'],
        { encoding: 'utf8', timeout: 5000 });
      if (r.status === 0) {
        const p = r.stdout.trim().split('\n')[0];
        if (p && !p.toLowerCase().includes('windowsapps')) add(p);
      }
    }
    for (const name of ['python3', 'python']) {
      const p = findExecutable(name);
      if (p) add(p);
    }
    return [...seen];
  }

  const names = ['python3.13', 'python3.12', 'python3.11', 'python3.10', 'python3', 'python'];
  const dirs  = [
    '/opt/homebrew/bin', '/opt/homebrew/sbin',
    '/usr/local/bin', '/usr/local/sbin',
    '/usr/bin', '/bin',
  ];
  for (const name of names) {
    for (const dir of dirs) {
      add(path.join(dir, name));
    }
  }
  return [...seen];
}

/** @deprecated Use resolvePythonForSetup — kept for any legacy callers */
function findPython() {
  for (const exe of enumeratePythonCandidates()) {
    if (pythonVersionOk(getPythonVersionSync(exe))) return exe;
  }
  return null;
}

/**
 * Download portable CPython 3.12 (python-build-standalone).
 * Prefers tarball bundled in the .app; falls back to GitHub download.
 */
let pythonDownloadInFlight = null;

async function materializePythonTarball(sendProgress) {
  if (pythonDownloadInFlight) return pythonDownloadInFlight;

  pythonDownloadInFlight = (async () => {
    ensureDirs();
    const tarPath = path.join(APP_DATA, '_python-dist.tar.gz');
    const bundled = bundledPythonTarPath();

    if (fs.existsSync(bundled)) {
      sendProgress(17, '使用安装包内置 Python…', path.basename(bundled));
      await fsp.copyFile(bundled, tarPath);
      return tarPath;
    }

    const url = pythonStandaloneDownloadUrl();
    sendProgress(
      16,
      `正在下载 Python ${PYTHON_STANDALONE_VERSION}（约 35 MB）…`,
      '首次安装将自动配置 Python 环境，请保持网络连接'
    );

    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        if (attempt > 1) {
          sendProgress(16, `正在重试下载 Python（第 ${attempt}/3 次）…`, url);
          await new Promise(r => setTimeout(r, 1500 * attempt));
        }
        await downloadFile(url, tarPath, pct => {
          sendProgress(16 + Math.round(pct * 0.09), `正在下载 Python ${PYTHON_STANDALONE_VERSION}… ${pct}%`);
        });
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        try { if (fs.existsSync(tarPath)) fs.unlinkSync(tarPath); } catch (_) {}
        writeLog('backend', `[python] download attempt ${attempt} failed: ${err.message}\n`);
      }
    }

    if (lastErr) {
      throw new Error(
        `Python 下载失败：${lastErr.message}\n\n`
        + '请检查网络连接；若无法访问 GitHub，请使用包含内置 Python 的最新安装包重新安装。'
      );
    }

    return tarPath;
  })();

  try {
    return await pythonDownloadInFlight;
  } finally {
    pythonDownloadInFlight = null;
  }
}

async function downloadPythonStandalone(sendProgress) {
  if (fs.existsSync(PYTHON_STANDALONE_BIN)) {
    const cached = getPythonVersionSync(PYTHON_STANDALONE_BIN);
    if (pythonVersionOk(cached)) return PYTHON_STANDALONE_BIN;
  }

  const tarPath = await materializePythonTarball(sendProgress);

  if (!fs.existsSync(tarPath)) {
    throw new Error(`Python 安装包不存在：\n  ${tarPath}`);
  }
  const tarSize = fs.statSync(tarPath).size;
  if (tarSize < 1024 * 1024) {
    throw new Error(`Python 安装包损坏（${tarSize} bytes）\n  ${tarPath}`);
  }

  sendProgress(26, '正在解压 Python…', '');
  if (fs.existsSync(PYTHON_STANDALONE_DIR)) {
    fs.rmSync(PYTHON_STANDALONE_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(PYTHON_STANDALONE_DIR, { recursive: true });
  const tarBin = IS_WIN ? 'tar' : '/usr/bin/tar';
  await runCommand(tarBin, ['-xzf', tarPath, '-C', PYTHON_STANDALONE_DIR]);
  try { fs.unlinkSync(tarPath); } catch (_) {}

  if (!fs.existsSync(PYTHON_STANDALONE_BIN)) {
    throw new Error(
      `Python 解压失败。\n未找到:\n  ${PYTHON_STANDALONE_BIN}\n\n请检查网络后重试，或手动安装 Python 3.10+。`
    );
  }
  const ver = getPythonVersionSync(PYTHON_STANDALONE_BIN);
  if (!pythonVersionOk(ver)) {
    throw new Error(`下载的 Python 版本无效: ${ver || '(unknown)'}`);
  }
  return PYTHON_STANDALONE_BIN;
}

function bundledPythonRuntimeExe() {
  return IS_WIN
    ? path.join(RES_PYTHON_RUNTIME, 'python.exe')
    : path.join(RES_PYTHON_RUNTIME, 'bin', 'python3');
}

function hasBundledPythonRuntime() {
  return fs.existsSync(bundledPythonRuntimeExe());
}

function countPipWheels() {
  try {
    return fs.readdirSync(RES_PIP_WHEELS).filter(f => f.endsWith('.whl')).length;
  } catch {
    return 0;
  }
}

function hasOfflinePipWheels() {
  return countPipWheels() >= 5;
}

function hasBundledVenvPrebuilt() {
  const marker = IS_WIN
    ? path.join(RES_VENV_PREBUILT, 'Scripts', 'python.exe')
    : path.join(RES_VENV_PREBUILT, 'bin', 'python3');
  return fs.existsSync(marker);
}

function hasBundledLarkCli() {
  return fs.existsSync(path.join(RES_LARK_CLI_BUNDLED, 'node_modules', LARK_CLI_PKG, 'package.json'));
}

function hasBundledMcpNode() {
  return fs.existsSync(path.join(RES_MCP_BUNDLED, 'node_modules', 'supergateway', 'package.json'));
}

function bundledSkillsUseInPlace() {
  return !IS_DEV && fs.existsSync(RES_AGENT_SKILLS) && countSkillDirs(RES_AGENT_SKILLS) > 0;
}

function resolveBundledSkillsDir() {
  if (bundledSkillsUseInPlace()) return RES_AGENT_SKILLS;
  if (fs.existsSync(AGENT_SKILLS_DIR) && countSkillDirs(AGENT_SKILLS_DIR) > 0) return AGENT_SKILLS_DIR;
  return RES_AGENT_SKILLS;
}

async function materializeBundledPythonRuntime(sendProgress) {
  if (!hasBundledPythonRuntime()) return null;
  if (fs.existsSync(PYTHON_STANDALONE_BIN)) {
    const cached = getPythonVersionSync(PYTHON_STANDALONE_BIN);
    if (pythonVersionOk(cached)) {
      sendProgress(15, `使用内置 Python ${cached}`, PYTHON_STANDALONE_BIN);
      return PYTHON_STANDALONE_BIN;
    }
  }
  sendProgress(17, '复制预解压 Python 运行时…', bundledPythonRuntimeExe());
  if (fs.existsSync(PYTHON_STANDALONE_DIR)) {
    fs.rmSync(PYTHON_STANDALONE_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(PYTHON_STANDALONE_DIR, { recursive: true });
  await copyDir(RES_PYTHON_RUNTIME, PYTHON_STANDALONE_ROOT);
  if (!fs.existsSync(PYTHON_STANDALONE_BIN)) {
    throw new Error(`内置 Python 复制失败：\n  ${PYTHON_STANDALONE_BIN}`);
  }
  const ver = getPythonVersionSync(PYTHON_STANDALONE_BIN);
  if (!pythonVersionOk(ver)) {
    throw new Error(`内置 Python 版本无效: ${ver || '(unknown)'}`);
  }
  return PYTHON_STANDALONE_BIN;
}

/**
 * Pick Python for setup: packaged app always uses portable 3.12 (never Homebrew 3.13).
 * Dev mode may use system Python 3.10+.
 */
async function resolvePythonForSetup(sendProgress) {
  if (fs.existsSync(PYTHON_STANDALONE_BIN)) {
    const cached = getPythonVersionSync(PYTHON_STANDALONE_BIN);
    if (pythonVersionOk(cached)) {
      sendProgress(15, `使用内置 Python ${cached}`, PYTHON_STANDALONE_BIN);
      return PYTHON_STANDALONE_BIN;
    }
  }

  if (!IS_DEV) {
    const bundled = await materializeBundledPythonRuntime(sendProgress);
    if (bundled) return bundled;
    sendProgress(15, `正在准备 Python ${PYTHON_STANDALONE_VERSION}…`, '不使用系统 Python，避免 venv/pip 不兼容');
    return downloadPythonStandalone(sendProgress);
  }

  let bestOld = null;
  for (const exe of enumeratePythonCandidates()) {
    if (exe === PYTHON_STANDALONE_BIN) continue;
    const ver = getPythonVersionSync(exe);
    if (pythonVersionOk(ver)) {
      sendProgress(15, `检测到 Python ${ver}`, exe);
      return exe;
    }
    if (ver && !bestOld) bestOld = { exe, ver };
  }

  if (bestOld) {
    sendProgress(16, `系统 Python ${bestOld.ver} 过低，正在安装 Python ${PYTHON_STANDALONE_VERSION}…`,
      `路径: ${bestOld.exe}`);
  } else {
    sendProgress(16, `未找到 Python 3.10+，正在安装 Python ${PYTHON_STANDALONE_VERSION}…`, '');
  }

  return downloadPythonStandalone(sendProgress);
}

/** Remove venv when it was created with an older interpreter. */
function venvNeedsRecreate(python3) {
  if (!getPythonBin()) return false;
  const cfgPath = path.join(VENV_DIR, 'pyvenv.cfg');
  if (!fs.existsSync(cfgPath)) return true;

  const cfg = fs.readFileSync(cfgPath, 'utf8');
  const homeMatch = cfg.match(/^home\s*=\s*(.+)$/m);
  if (homeMatch) {
    const home = homeMatch[1].trim();
    const pyDir = path.dirname(python3);
    if (home !== pyDir && !python3.startsWith(home)) return true;
  }

  const v = getPythonVersionSync(getPythonBin());
  return !pythonVersionOk(v);
}

function readCachedPython3() {
  if (!fs.existsSync(PYTHON_BIN_FILE)) return null;
  const p = fs.readFileSync(PYTHON_BIN_FILE, 'utf8').trim();
  return p && fs.existsSync(p) ? p : null;
}

function cachePythonBin(python3) {
  try {
    fs.writeFileSync(PYTHON_BIN_FILE, python3);
  } catch (_) {}
}

/** Packaged app venv must match portable Python 3.12, not Homebrew 3.13. */
function packagedVenvUsesWrongPython() {
  if (IS_DEV || !fs.existsSync(VENV_DIR)) return false;
  const cfgPath = path.join(VENV_DIR, 'pyvenv.cfg');
  if (!fs.existsSync(cfgPath)) return false;
  const cfg = fs.readFileSync(cfgPath, 'utf8');
  const homeMatch = cfg.match(/^home\s*=\s*(.+)$/m);
  if (!homeMatch) return false;
  const home = homeMatch[1].trim();
  if (home.includes(APP_DATA)) return false;
  if (fs.existsSync(PYTHON_STANDALONE_BIN)) {
    const expected = path.dirname(PYTHON_STANDALONE_BIN);
    return home !== expected && !PYTHON_STANDALONE_BIN.startsWith(home);
  }
  return home.includes('homebrew') || home.includes('/opt/') || home.includes('/usr/local/');
}

function venvSitePackagesDir() {
  if (!fs.existsSync(VENV_DIR)) return null;
  if (IS_WIN) {
    const sp = path.join(VENV_DIR, 'Lib', 'site-packages');
    return fs.existsSync(sp) ? sp : null;
  }
  const libDir = path.join(VENV_DIR, 'lib');
  if (!fs.existsSync(libDir)) return null;
  const pyDir = fs.readdirSync(libDir).find(d => d.startsWith('python'));
  if (!pyDir) return null;
  const sp = path.join(libDir, pyDir, 'site-packages');
  return fs.existsSync(sp) ? sp : null;
}

/** Leftover from failed pip upgrade (e.g. ~ip) — breaks subsequent installs. */
function venvHasPipCorruption() {
  const sp = venvSitePackagesDir();
  if (!sp) return false;
  try {
    return fs.readdirSync(sp).some(name => name.startsWith('~'));
  } catch {
    return false;
  }
}

function isVenvPipUsable(pyBin = getPythonBin()) {
  if (!pyBin) return false;
  try {
    execSync(`"${pyBin}" -m pip --version`, {
      encoding: 'utf8',
      timeout: 20000,
      env: envForVenv(),
    });
    return true;
  } catch {
    return false;
  }
}

function pythonSupportsVenvUpgradeDeps(python3) {
  const ver = getPythonVersionSync(python3);
  const m = ver && ver.match(/^3\.(\d+)/);
  return !!(m && parseInt(m[1], 10) >= 9);
}

/** Resolve venv interpreter (python3 or python on macOS). */
function getPythonBin() {
  if (fs.existsSync(PYTHON_BIN)) return PYTHON_BIN;
  if (!IS_WIN) {
    const alt = path.join(VENV_DIR, 'bin', 'python');
    if (fs.existsSync(alt)) return alt;
  }
  return null;
}

/** True when venv python + pip are usable (not just encodings). */
function isPythonRuntimeReady() {
  const bin = getPythonBin();
  if (!bin || venvHasPipCorruption()) return false;
  try {
    const ver = getPythonVersionSync(bin);
    if (!pythonVersionOk(ver)) return false;
    execSync(`"${bin}" -c "import encodings"`, {
      encoding: 'utf8',
      timeout: 15000,
      env: envForVenv(),
    });
    return isVenvPipUsable(bin);
  } catch {
    return false;
  }
}

function isVenvHealthy() {
  return isPythonRuntimeReady();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isDirRemoveBusyError(err) {
  const blob = `${err?.code || ''} ${err?.message || ''}`;
  return /EBUSY|EPERM|ENOTEMPTY|EACCES|resource busy|locked/i.test(blob);
}

/** Kill processes whose executable lives under dir (Windows venv lock during reinstall). */
async function killProcessesUsingDir(dir) {
  if (!dir || !fs.existsSync(dir)) return;
  if (IS_WIN) {
    const winDir = dir.replace(/\//g, '\\').replace(/'/g, "''");
    const ps = [
      `$root = '${winDir}'`,
      'Get-CimInstance Win32_Process -ErrorAction SilentlyContinue',
      '| Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) }',
      '| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
    ].join(' ');
    await new Promise(resolve => {
      execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
        windowsHide: true,
        timeout: 30000,
      }, () => resolve());
    });
    await sleep(800);
  }
}

async function removeDirSafe(dir, { label } = {}) {
  if (!dir || !fs.existsSync(dir)) return;
  const tag = label || path.basename(dir);
  const attempts = IS_WIN ? 8 : 4;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) {
      await killProcessesUsingDir(dir);
      await sleep(350 * i);
    }
    try {
      fs.rmSync(dir, {
        recursive: true,
        force: true,
        maxRetries: IS_WIN ? 5 : 1,
        retryDelay: 300,
      });
      if (!fs.existsSync(dir)) return;
    } catch (err) {
      if (!isDirRemoveBusyError(err)) throw err;
      if (i === attempts - 1) {
        const trash = `${dir}.trash.${Date.now()}`;
        try {
          fs.renameSync(dir, trash);
          writeLog('backend', `[install] ${tag} locked — renamed to ${path.basename(trash)}\n`);
          return;
        } catch (_) {
          throw new Error(
            `${tag} 目录被占用无法删除。请先完全退出 AI Media Agent（含系统托盘），`
            + `或在任务管理器中结束 python.exe 后重试。\n(${err.message})`,
          );
        }
      }
    }
  }
}

async function stopServicesBeforeInstall() {
  stopAllServices(true);
  await Promise.all([
    killProcessesUsingDir(VENV_DIR),
    killProcessesUsingDir(PYTHON_STANDALONE_DIR),
  ]);
  await sleep(IS_WIN ? 900 : 300);
}

/**
 * Auto-reset before install — mirrors manual:
 *   rm -rf ~/Library/Application Support/ai-media-agent/{venv,python-dist}
 *   rm -f  .../.setup_done
 */
async function autoCleanupBeforeInstall(sendProgress) {
  const prevVersion = fs.existsSync(VERSION_FILE)
    ? fs.readFileSync(VERSION_FILE, 'utf8').trim()
    : '';
  const versionChanged = prevVersion !== '' && prevVersion !== APP_VERSION;
  const incompleteSetup = !fs.existsSync(SETUP_DONE_FILE);
  const venvBroken = !isPythonRuntimeReady()
    || packagedVenvUsesWrongPython();
  const pythonDistBroken = fs.existsSync(PYTHON_STANDALONE_BIN)
    && !pythonVersionOk(getPythonVersionSync(PYTHON_STANDALONE_BIN));
  const nodeBroken = !IS_DEV && !isNodeRuntimeReady();

  const fullReset = versionChanged || incompleteSetup;
  const partialReset = !fullReset && (venvBroken || pythonDistBroken || nodeBroken);
  if (!fullReset && !partialReset) return;

  sendProgress(3, '自动清理旧环境…', '移除损坏或过期的 Python / venv');

  if (fullReset) {
    for (const dir of [VENV_DIR, PYTHON_STANDALONE_DIR, NODE_LOCAL_DIR]) {
      if (fs.existsSync(dir)) await removeDirSafe(dir);
    }
    for (const file of [
      SETUP_DONE_FILE,
      PYTHON_BIN_FILE,
      path.join(APP_DATA, '_python-dist.tar.gz'),
      path.join(APP_DATA, '_node-dist.tar.gz'),
      path.join(APP_DATA, '_node-dist.zip'),
      NODE_BIN_FILE,
      PIP_STAMP_FILE,
      RESOURCE_BUNDLE_STAMP,
    ]) {
      try {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } catch (_) {}
    }
  } else {
    if (venvBroken && fs.existsSync(VENV_DIR)) {
      await removeDirSafe(VENV_DIR, { label: 'venv' });
    }
    if (pythonDistBroken && fs.existsSync(PYTHON_STANDALONE_DIR)) {
      await removeDirSafe(PYTHON_STANDALONE_DIR, { label: 'python-dist' });
    }
    if (nodeBroken && fs.existsSync(NODE_LOCAL_DIR)) {
      await removeDirSafe(NODE_LOCAL_DIR, { label: 'node' });
    }
    try {
      if (fs.existsSync(PYTHON_BIN_FILE)) fs.unlinkSync(PYTHON_BIN_FILE);
      if (nodeBroken && fs.existsSync(NODE_BIN_FILE)) fs.unlinkSync(NODE_BIN_FILE);
    } catch (_) {}
  }

  sendProgress(4, '旧环境已清理', versionChanged
    ? `版本 ${prevVersion} → ${APP_VERSION}`
    : nodeBroken ? '将重新安装 Node.js 运行时' : '将重新安装 Python 与依赖');
}

async function bootstrapVenvPip(pyBin, sendProgress) {
  if (!pyBin) return;
  if (isVenvPipUsable(pyBin)) return;
  sendProgress(21, '初始化 pip…', '');
  await runCommand(pyBin, ['-m', 'ensurepip', '--upgrade'], {
    cwd: APP_DATA,
    env: envForVenv(),
  });
  if (!isVenvPipUsable(pyBin)) {
    throw new Error('pip 初始化失败，请检查网络后重试');
  }
}

function rewriteVenvHomeForBasePython(venvDir, basePythonExe) {
  if (!basePythonExe || !fs.existsSync(basePythonExe)) return;
  const cfgPath = path.join(venvDir, 'pyvenv.cfg');
  if (!fs.existsSync(cfgPath)) return;
  const home = path.dirname(basePythonExe);
  let cfg = fs.readFileSync(cfgPath, 'utf8');
  if (/^home\s*=/m.test(cfg)) {
    cfg = cfg.replace(/^home\s*=.*$/m, `home = ${home}`);
  } else {
    cfg = `home = ${home}\n${cfg}`;
  }
  if (/^executable\s*=/m.test(cfg)) {
    cfg = cfg.replace(/^executable\s*=.*$/m, `executable = ${basePythonExe}`);
  }
  fs.writeFileSync(cfgPath, cfg);
}

async function copyPrebuiltVenv(sendProgress, basePythonExe) {
  if (!hasBundledVenvPrebuilt()) return false;
  sendProgress(20, '复制预构建 Python 虚拟环境…', RES_VENV_PREBUILT);
  if (fs.existsSync(VENV_DIR)) {
    await removeDirSafe(VENV_DIR, { label: 'venv' });
  }
  await copyDir(RES_VENV_PREBUILT, VENV_DIR);
  rewriteVenvHomeForBasePython(VENV_DIR, basePythonExe);
  const pyBin = getPythonBin();
  if (!pyBin || !pythonDepsImportable(pyBin)) {
    writeLog('backend', '[venv] prebuilt copy incomplete — will recreate venv\n');
    await removeDirSafe(VENV_DIR, { label: 'venv' });
    return false;
  }
  markPipDepsInstalled();
  writeLog('backend', `[venv] prebuilt venv copied from ${RES_VENV_PREBUILT}\n`);
  return true;
}

async function ensurePythonVenv(python3, sendProgress) {
  if (!getPythonBin() && hasBundledVenvPrebuilt()) {
    if (await copyPrebuiltVenv(sendProgress, python3)) {
      cachePythonBin(python3);
      return;
    }
  }

  const mustRecreate = venvNeedsRecreate(python3)
    || venvHasPipCorruption()
    || (getPythonBin() && !isVenvPipUsable());

  if (mustRecreate && fs.existsSync(VENV_DIR)) {
    sendProgress(19, '移除损坏的 Python 虚拟环境…', '');
    await removeDirSafe(VENV_DIR, { label: 'venv' });
  }
  if (!getPythonBin()) {
    sendProgress(20, '创建 Python 虚拟环境…', python3);
    const venvArgs = ['-m', 'venv'];
    if (pythonSupportsVenvUpgradeDeps(python3)) venvArgs.push('--upgrade-deps');
    venvArgs.push(VENV_DIR);
    await runCommand(python3, venvArgs, {
      cwd: APP_DATA,
      env: envForPythonExe(python3),
    });
  }
  await bootstrapVenvPip(getPythonBin(), sendProgress);
  cachePythonBin(python3);
}

/** Run pip inside venv. macOS/Linux use `python -m pip` (avoids missing venv/bin/pip ENOENT). */
async function runVenvPip(pyBin, sslPipScript, pipArgs, opts = {}, onLine) {
  if (IS_WIN) {
    await runCommand(pyBin, [sslPipScript, ...pipArgs], opts, onLine);
  } else {
    await runCommand(pyBin, ['-m', 'pip', ...pipArgs], opts, onLine);
  }
}

/** PyPI mirrors — tried in order until one succeeds (Windows/CN networks often block a single mirror). */
const PIP_MIRROR_CANDIDATES = [
  {
    id: 'aliyun',
    label: '阿里云镜像',
    index: 'https://mirrors.aliyun.com/pypi/simple/',
    trustedHosts: ['mirrors.aliyun.com', 'files.pythonhosted.org'],
  },
  {
    id: 'pypi',
    label: 'PyPI 官方',
    index: 'https://pypi.org/simple/',
    trustedHosts: ['pypi.org', 'pypi.python.org', 'files.pythonhosted.org'],
  },
  {
    id: 'tuna',
    label: '清华镜像',
    index: 'https://pypi.tuna.tsinghua.edu.cn/simple/',
    trustedHosts: ['pypi.tuna.tsinghua.edu.cn', 'files.pythonhosted.org'],
  },
  {
    id: 'ustc',
    label: '中科大镜像',
    index: 'https://pypi.mirrors.ustc.edu.cn/simple/',
    trustedHosts: ['pypi.mirrors.ustc.edu.cn', 'files.pythonhosted.org'],
  },
  {
    id: 'tencent',
    label: '腾讯云镜像',
    index: 'https://mirrors.cloud.tencent.com/pypi/simple/',
    trustedHosts: ['mirrors.cloud.tencent.com', 'files.pythonhosted.org'],
  },
];

function pipMirrorCliArgs(mirror) {
  const args = ['-i', mirror.index, '--default-timeout', '120'];
  for (const host of mirror.trustedHosts) {
    args.push('--trusted-host', host);
  }
  return args;
}

function isPipTransportError(err) {
  const msg = String(err?.message || err || '');
  return /timed?\s*out|connect timeout|ConnectionError|Connection to|Max retries exceeded|Could not find a version|No matching distribution|Temporary failure|Name or service not known|getaddrinfo|Network is unreachable|ConnectTimeout|Failed to establish a new connection|RemoteDisconnected|Connection reset|SSLError|SSL:|CERTIFICATE_VERIFY_FAILED|403 Client Error|404 Client Error|502 Bad Gateway|503 Service Unavailable|504 Gateway/i.test(msg);
}

async function runVenvPipWithMirrors(pyBin, sslPipScript, pipArgs, opts = {}, onLine, sendProgress) {
  const errors = [];
  for (let i = 0; i < PIP_MIRROR_CANDIDATES.length; i++) {
    const mirror = PIP_MIRROR_CANDIDATES[i];
    if (sendProgress) {
      sendProgress(
        opts.progressBase ?? 35,
        i === 0 ? (opts.progressLabel || '安装 Python 依赖…') : `切换 pip 源：${mirror.label}`,
        i > 0 ? `第 ${i + 1}/${PIP_MIRROR_CANDIDATES.length} 个下载源` : (opts.progressDetail || ''),
        'pip',
      );
    }
    appendInstallLog('pip', opts.progressBase ?? 35, `尝试 pip 源：${mirror.label}`, mirror.index);
    try {
      await runVenvPip(
        pyBin,
        sslPipScript,
        [...pipArgs, ...pipMirrorCliArgs(mirror)],
        opts,
        onLine,
      );
      writeLog('backend', `[pip] OK via ${mirror.id} (${mirror.index})\n`);
      return mirror;
    } catch (err) {
      const brief = String(err.message || err).replace(/\s+/g, ' ').slice(-240);
      errors.push(`${mirror.label}: ${brief}`);
      writeLog('backend', `[pip] failed via ${mirror.id}: ${brief}\n`);
      if (!isPipTransportError(err)) throw err;
    }
  }
  throw new Error(
    '所有 pip 下载源均不可用，请检查网络或关闭代理/VPN 后重试。\n\n'
    + errors.slice(-3).join('\n\n'),
  );
}

async function installPipOfflineFromWheels(pyBin, sslPipScript, reqFile, PIP_EXTRA, sendProgress) {
  if (!hasOfflinePipWheels()) return false;
  sendProgress(35, `离线安装 Python 依赖（${countPipWheels()} 个 wheel）…`, RES_PIP_WHEELS, 'pip');
  let pkgCount = 0;
  try {
    await runVenvPip(
      pyBin,
      sslPipScript,
      ['install', '--no-index', '--find-links', RES_PIP_WHEELS, '-r', reqFile, ...PIP_EXTRA],
      {
        cwd: APP_DATA,
        env: envForVenv(),
        timeout: 25 * 60 * 1000,
        progressBase: 35,
        progressLabel: '离线安装 Python 依赖…',
      },
      line => {
        if (installLoggingActive && line.trim()) {
          appendInstallLog('pip', -1, line.trim(), '');
        }
        const collecting = line.match(/Collecting\s+(\S+)/);
        if (collecting) {
          pkgCount += 1;
          sendProgress(35 + Math.min(pkgCount, 40), `离线安装：${collecting[1]}…`, '', 'pip');
        }
        if (line.startsWith('Successfully installed')) {
          sendProgress(75, 'Python 依赖离线安装完成 ✓', line.slice(0, 120), 'pip');
        }
      },
    );
    if (pythonDepsImportable(pyBin)) {
      markPipDepsInstalled();
      writeLog('backend', `[pip] offline install OK (${countPipWheels()} wheels)\n`);
      return true;
    }
  } catch (err) {
    writeLog('backend', `[pip] offline install failed: ${err.message}\n`);
  }
  return false;
}

/** pip + requirements + optional Playwright (shared by setup wizard and silent repair). */
async function installPythonDependencies(sendProgress, python3Hint) {
  let pyBin = getPythonBin();
  if (!pyBin) throw new Error('Python 虚拟环境未创建');

  if (venvHasPipCorruption() || packagedVenvUsesWrongPython()) {
    sendProgress(24, '清理损坏的 Python 环境…', '');
    await removeDirSafe(VENV_DIR, { label: 'venv' });
    const basePy = python3Hint || readCachedPython3();
    if (!basePy) throw new Error('Python 解释器不可用，请重新运行安装');
    await ensurePythonVenv(basePy, sendProgress);
    pyBin = getPythonBin();
    if (!pyBin) throw new Error('Python 虚拟环境未创建');
  } else if (!isVenvPipUsable(pyBin)) {
    sendProgress(24, '修复 pip 环境…', '');
    await bootstrapVenvPip(pyBin, sendProgress);
    if (!isVenvPipUsable(pyBin)) {
      await removeDirSafe(VENV_DIR, { label: 'venv' });
      const basePy = python3Hint || readCachedPython3();
      if (!basePy) throw new Error('pip 环境损坏，请删除应用数据目录后重试');
      await ensurePythonVenv(basePy, sendProgress);
      pyBin = getPythonBin();
    }
  }

  const SSL_RUNNER_PY = [
    'import ssl, locale, runpy',
    '_orig_wrap = ssl.SSLContext.wrap_socket',
    'def _safe_wrap(self, sock, *args, **kwargs):',
    '    sn = kwargs.get("server_hostname") or (args[3] if len(args) > 3 else None)',
    '    if not sn and getattr(self, "check_hostname", False):',
    '        self.check_hostname = False',
    '        if self.verify_mode != ssl.CERT_NONE:',
    '            self.verify_mode = ssl.CERT_NONE',
    '    return _orig_wrap(self, sock, *args, **kwargs)',
    'ssl.SSLContext.wrap_socket = _safe_wrap',
    'ssl._create_default_https_context = ssl._create_unverified_context',
    'locale.getpreferredencoding = lambda *a, **k: "utf-8"',
  ].join('\n');
  const sslPipScript = path.join(APP_DATA, '_ssl_pip.py');
  const sslPwScript  = path.join(APP_DATA, '_ssl_pw.py');
  fs.writeFileSync(sslPipScript, SSL_RUNNER_PY + '\nrunpy.run_module("pip", run_name="__main__", alter_sys=True)\n');
  fs.writeFileSync(sslPwScript,  SSL_RUNNER_PY + '\nrunpy.run_module("playwright", run_name="__main__", alter_sys=True)\n');

  const reqFile = path.join(BACKEND_DATA, 'requirements.txt');
  if (!fs.existsSync(reqFile)) {
    throw new Error(`requirements.txt 不存在: ${reqFile}`);
  }

  const PIP_EXTRA = ['--prefer-binary'];
  if (IS_WIN) PIP_EXTRA.push('--no-warn-script-location');

  if (pipDepsInstalled() && pythonDepsImportable(pyBin)) {
    sendProgress(80, 'Python 依赖已就绪，跳过重复安装', '');
  } else if (await installPipOfflineFromWheels(pyBin, sslPipScript, reqFile, PIP_EXTRA, sendProgress)) {
    sendProgress(80, 'Python 依赖已就绪（离线 wheel）', '');
  } else {
    let skipPipUpgrade = false;
    try {
      const pipVerLine = IS_WIN
        ? execSync(`"${pyBin}" "${sslPipScript}" --version`, {
            encoding: 'utf8', timeout: 15000, env: envForVenv(), windowsHide: true,
          }).trim()
        : execSync(`"${pyBin}" -m pip --version`, {
            encoding: 'utf8', timeout: 15000, env: envForVenv(),
          }).trim();
      const m = pipVerLine.match(/pip\s+(\d+)\.(\d+)/i);
      if (m) {
        const major = parseInt(m[1], 10);
        const minor = parseInt(m[2], 10);
        skipPipUpgrade = major > 23 || (major === 23 && minor >= 2);
      }
    } catch (_) {}

    if (!skipPipUpgrade) {
      sendProgress(28, '升级 pip…');
      try {
        await runVenvPipWithMirrors(
          pyBin,
          sslPipScript,
          ['install', '--upgrade', 'pip', '--quiet', ...PIP_EXTRA],
          { cwd: APP_DATA, env: envForVenv(), progressBase: 28, progressLabel: '升级 pip…' },
          null,
          sendProgress,
        );
      } catch (err) {
        writeLog('backend', `[pip] upgrade skipped: ${err.message}\n`);
      }
    }

    sendProgress(35, IS_WIN ? '安装 Python 依赖（与 Node.js 并行）…' : '安装 Python 依赖（约 3–5 分钟）…');
    let pkgCount = 0;
    await runVenvPipWithMirrors(
      pyBin,
      sslPipScript,
      ['install', '-r', reqFile, ...PIP_EXTRA],
      {
        cwd: APP_DATA,
        env: envForVenv(),
        timeout: 25 * 60 * 1000,
        progressBase: 35,
        progressLabel: IS_WIN ? '安装 Python 依赖（与 Node.js 并行）…' : '安装 Python 依赖（约 3–5 分钟）…',
      },
      line => {
        if (installLoggingActive && line.trim()) {
          appendInstallLog('pip', -1, line.trim(), '');
        }
        const collecting = line.match(/Collecting\s+(\S+)/);
        if (collecting) {
          pkgCount += 1;
          sendProgress(35 + Math.min(pkgCount, 40), `正在安装：${collecting[1]}…`, '', 'pip');
        }
        if (line.startsWith('Successfully installed')) {
          pkgCount += line.split(' ').length - 2;
          sendProgress(35 + Math.min(pkgCount, 40), `已安装 ${pkgCount} 个包…`, '', 'pip');
        }
      },
      sendProgress,
    );
    markPipDepsInstalled();
  }

  if (IS_WIN) {
    sendProgress(82, 'Playwright 将在后台安装', '可先完成配置并开始使用');
    schedulePlaywrightInstall();
    return;
  }

  await installPlaywrightBrowsers(sendProgress, pyBin, sslPwScript);
}

async function installPlaywrightBrowsers(sendProgress, pyBin, sslPwScript) {
  if (!pyBin) pyBin = getPythonBin();
  if (!pyBin) return;

  if (!sslPwScript) {
    const SSL_RUNNER_PY = [
      'import ssl, locale, runpy',
      '_orig_wrap = ssl.SSLContext.wrap_socket',
      'def _safe_wrap(self, sock, *args, **kwargs):',
      '    sn = kwargs.get("server_hostname") or (args[3] if len(args) > 3 else None)',
      '    if not sn and getattr(self, "check_hostname", False):',
      '        self.check_hostname = False',
      '        if self.verify_mode != ssl.CERT_NONE:',
      '            self.verify_mode = ssl.CERT_NONE',
      '    return _orig_wrap(self, sock, *args, **kwargs)',
      'ssl.SSLContext.wrap_socket = _safe_wrap',
      'ssl._create_default_https_context = ssl._create_unverified_context',
      'locale.getpreferredencoding = lambda *a, **k: "utf-8"',
    ].join('\n');
    sslPwScript = path.join(APP_DATA, '_ssl_pw.py');
    fs.writeFileSync(sslPwScript, SSL_RUNNER_PY + '\nrunpy.run_module("playwright", run_name="__main__", alter_sys=True)\n');
  }

  sendProgress(82, '安装 Playwright 浏览器…', '正在连接下载服务器…');
  try {
    let pwPct = 0;
    await runCommand(
      pyBin,
      [sslPwScript, 'install', 'chromium'],
      {
        cwd: APP_DATA,
        timeout: 8 * 60 * 1000,
        streamStderr: true,
        env: envForVenv({
          PLAYWRIGHT_BROWSERS_PATH: BROWSERS_DIR,
          PLAYWRIGHT_DOWNLOAD_HOST: 'https://playwright.download.prss.microsoft.com',
        }),
      },
      line => {
        if (!line) return;
        writeLog('backend', `[playwright] ${line}\n`);
        const pctMatch = line.match(/(\d+)\s*%/);
        if (pctMatch) {
          pwPct = parseInt(pctMatch[1], 10);
          sendProgress(
            82 + Math.round(pwPct * 0.10),
            `安装 Playwright 浏览器… ${pwPct}%`,
            line.replace(/\[=+\s*\]\s*/, '').slice(0, 80)
          );
        } else {
          sendProgress(82 + Math.round(pwPct * 0.10), '安装 Playwright 浏览器（Chromium）…', line.slice(0, 80));
        }
      }
    );
    sendProgress(93, 'Playwright 浏览器就绪 ✓', '');
    markPlaywrightBrowsersInstalled();
  } catch (playwrightErr) {
    writeLog('backend', `[setup] Playwright install skipped: ${playwrightErr.message}\n`);
    sendProgress(82, 'Playwright 已跳过（可稍后在设置中安装）…', playwrightErr.message.slice(0, 80));
    await new Promise(r => setTimeout(r, 1500));
  }
}

function schedulePlaywrightInstall() {
  setImmediate(async () => {
    try {
      writeLog('backend', '[playwright] Background install started\n');
      await installPlaywrightBrowsers(
        (pct, msg, detail = '') => writeLog('backend', `[playwright] ${pct}% ${msg}${detail ? ` — ${detail}` : ''}\n`),
        getPythonBin()
      );
      writeLog('backend', '[playwright] Background install finished\n');
      if (isPlaywrightChromiumReady()) markPlaywrightBrowsersInstalled();
    } catch (err) {
      writeLog('backend', `[playwright] Background install failed: ${err.message}\n`);
    }
  });
}

let pythonRepairInFlight = null;

/** Recreate venv + deps when .setup_done exists but venv/bin/python3 is missing (ENOENT). */
async function repairPythonRuntimeSilently() {
  if (isPythonRuntimeReady()) return true;
  if (pythonRepairInFlight) return pythonRepairInFlight;

  pythonRepairInFlight = (async () => {
    try {
      writeLog('backend', '[runtime] Python venv missing or broken — repairing…\n');
      const logProgress = (pct, msg, detail = '') => {
        writeLog('backend', `[repair] ${pct >= 0 ? `${pct}% ` : ''}${msg}${detail ? ` — ${detail}` : ''}\n`);
      };

      await stopServicesBeforeInstall();
      await autoCleanupBeforeInstall(logProgress);
      ensureDirs();

      await syncAppResources(logProgress);

      const python3 = await resolvePythonForSetup(logProgress);
      await ensurePythonVenv(python3, logProgress);

      if (!getPythonBin()) throw new Error('venv 创建失败');

      try {
        execSync(`"${getPythonBin()}" -c "import uvicorn"`, {
          encoding: 'utf8',
          timeout: 20000,
          env: envForVenv(),
        });
      } catch {
        await installPythonDependencies(logProgress, python3);
      }

      const ok = isPythonRuntimeReady();
      if (ok) writeLog('backend', '[runtime] Python repair complete\n');
      return ok;
    } catch (e) {
      writeLog('backend', `[runtime] Python repair failed: ${e.message}\n`);
      return false;
    } finally {
      pythonRepairInFlight = null;
    }
  })();

  return pythonRepairInFlight;
}

/**
 * Download portable Node.js (official nodejs.org build).
 * Prefers archive bundled in the installer; falls back to network download.
 */
let nodeDownloadInFlight = null;

async function materializeNodeArchive(sendProgress) {
  if (nodeDownloadInFlight) return nodeDownloadInFlight;

  nodeDownloadInFlight = (async () => {
    const archiveName = nodeStandaloneArchiveName();
    const destExt = IS_WIN ? '.zip' : '.tar.gz';
    const archivePath = path.join(APP_DATA, `_node-dist${destExt}`);
    const bundled = bundledNodeArchivePath();

    if (fs.existsSync(bundled)) {
      sendProgress(94, '使用安装包内置 Node.js…', path.basename(bundled));
      await fsp.copyFile(bundled, archivePath);
      return archivePath;
    }

    const url = IS_WIN
      ? `https://nodejs.org/dist/v${NODE_VERSION}/${archiveName}`
      : `https://nodejs.org/dist/v${NODE_VERSION}/${archiveName}`;

    sendProgress(
      94,
      `正在下载 Node.js v${NODE_VERSION}（约 40 MB）…`,
      '首次安装将自动配置 Node.js，请保持网络连接'
    );

    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        if (attempt > 1) {
          sendProgress(94, `正在重试下载 Node.js（第 ${attempt}/3 次）…`, url);
          await new Promise(r => setTimeout(r, 1500 * attempt));
        }
        await downloadFile(url, archivePath, pct => {
          sendProgress(94 + Math.round(pct * 0.03), `正在下载 Node.js… ${pct}%`);
        });
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        try { if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath); } catch (_) {}
        writeLog('backend', `[node] download attempt ${attempt} failed: ${err.message}\n`);
      }
    }

    if (lastErr) {
      throw new Error(
        `Node.js 下载失败：${lastErr.message}\n\n`
        + '请检查网络连接；若无法访问 nodejs.org，请使用包含内置 Node.js 的最新安装包。'
      );
    }

    return archivePath;
  })();

  try {
    return await nodeDownloadInFlight;
  } finally {
    nodeDownloadInFlight = null;
  }
}

async function installNodeFromBundledRuntime(sendProgress) {
  const bundledExe = bundledNodeRuntimeExe();
  if (!fs.existsSync(bundledExe)) return null;

  sendProgress(94, '复制内置 Node.js 运行时…', path.basename(bundledExe));
  if (fs.existsSync(NODE_LOCAL_DIR)) {
    fs.rmSync(NODE_LOCAL_DIR, { recursive: true, force: true });
  }
  await copyDir(NODE_BUNDLE_RUNTIME, NODE_LOCAL_DIR);

  const nodeBin = findPortableNodeExe(NODE_LOCAL_DIR);
  if (!nodeBin) {
    throw new Error(`内置 Node.js 复制后未找到 node.exe：\n  ${NODE_LOCAL_DIR}`);
  }
  cacheNodeBin(nodeBin);
  return nodeBin;
}

async function extractNodeZipPowerShell(zipPath, destDir) {
  const tmpDir = path.join(APP_DATA, '_node-extract-tmp');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const psZip = zipPath.replace(/'/g, "''");
  const psTmp = tmpDir.replace(/'/g, "''");
  const ps = `$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath '${psZip}' -DestinationPath '${psTmp}' -Force`;
  await runCommand(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
    { env: process.env, timeout: 5 * 60 * 1000 }
  );

  const entries = fs.readdirSync(tmpDir, { withFileTypes: true });
  let srcRoot = tmpDir;
  if (entries.length === 1 && entries[0].isDirectory()) {
    srcRoot = path.join(tmpDir, entries[0].name);
  }
  await copyDir(srcRoot, destDir);
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const nodeBin = findPortableNodeExe(destDir);
  if (!nodeBin) {
    throw new Error(`Node.js 解压后未找到 node.exe：\n  ${destDir}`);
  }
}

async function extractNodeArchive(archivePath, destDir) {
  if (IS_WIN) {
    const tarBin = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'tar.exe');
    if (fs.existsSync(tarBin)) {
      try {
        await runCommand(
          tarBin,
          ['-xf', archivePath, '-C', destDir, '--strip-components=1'],
          { env: process.env, timeout: 5 * 60 * 1000 }
        );
        if (findPortableNodeExe(destDir)) return;
      } catch (err) {
        writeLog('backend', `[node] tar extract failed: ${err.message}\n`);
      }
    }
    await extractNodeZipPowerShell(archivePath, destDir);
    return;
  }

  await runCommand(
    '/usr/bin/tar',
    ['-xzf', archivePath, '-C', destDir, '--strip-components=1'],
    { timeout: 5 * 60 * 1000 }
  );
}

async function downloadNodeStandalone(sendProgress) {
  const existing = resolvePortableNodeBin();
  if (existing) return existing;

  const fromRuntime = await installNodeFromBundledRuntime(sendProgress);
  if (fromRuntime) return fromRuntime;

  const archivePath = await materializeNodeArchive(sendProgress);
  if (!fs.existsSync(archivePath)) {
    throw new Error(`Node.js 安装包不存在：\n  ${archivePath}`);
  }

  sendProgress(97, '正在解压 Node.js…', '');
  if (fs.existsSync(NODE_LOCAL_DIR)) {
    fs.rmSync(NODE_LOCAL_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(NODE_LOCAL_DIR, { recursive: true });
  await extractNodeArchive(archivePath, NODE_LOCAL_DIR);
  try { fs.unlinkSync(archivePath); } catch (_) {}

  const nodeBin = findPortableNodeExe(NODE_LOCAL_DIR);
  if (!nodeBin) {
    throw new Error(`Node.js 解压失败。\n未找到 node.exe：\n  ${NODE_LOCAL_DIR}`);
  }
  cacheNodeBin(nodeBin);
  return nodeBin;
}

function cacheNodeBin(nodePath) {
  if (!nodePath || !fs.existsSync(nodePath)) return;
  try {
    fs.mkdirSync(APP_DATA, { recursive: true });
    fs.writeFileSync(NODE_BIN_FILE, nodePath, 'utf8');
  } catch (_) {}
}

function isNodeRuntimeReady() {
  const bin = resolveNodeBin();
  return Boolean(verifyNodeBinary(bin));
}

let nodeRepairInFlight = null;

/** Packaged builds always use portable Node under APP_DATA (never system/Homebrew). */
async function ensureNodeRuntime(sendProgress = () => {}) {
  const bundledExe = bundledNodeRuntimeExe();
  if (fs.existsSync(bundledExe) && verifyNodeBinary(bundledExe)) {
    cacheNodeBin(bundledExe);
    sendProgress?.(85, '使用安装包内置 Node.js…', bundledExe);
    return bundledExe;
  }

  if (isNodeRuntimeReady()) return resolveNodeBin();

  const portable = resolvePortableNodeBin();
  if (portable) {
    cacheNodeBin(portable);
    if (isNodeRuntimeReady()) return portable;
  }

  if (!IS_DEV) {
    sendProgress(94, '正在安装 Node.js 运行时…', '前端需要 Node.js');
    try {
      const n = await downloadNodeStandalone(sendProgress);
      cacheNodeBin(n);
      if (isNodeRuntimeReady()) return n;
      throw new Error(`Node.js 已安装但无法运行：\n  ${n}`);
    } catch (e) {
      writeLog('backend', `[node] install failed: ${e.message}\n`);
      throw e;
    }
  }

  const found = findExecutable('node');
  if (found) {
    cacheNodeBin(found);
    if (isNodeRuntimeReady()) return found;
  }

  sendProgress(94, '正在下载 Node.js 运行时…', '');
  try {
    const n = await downloadNodeStandalone(sendProgress);
    cacheNodeBin(n);
    return isNodeRuntimeReady() ? n : null;
  } catch (e) {
    writeLog('backend', `[node] install failed: ${e.message}\n`);
    return null;
  }
}

async function repairNodeRuntimeSilently() {
  if (nodeRepairInFlight) return nodeRepairInFlight;
  nodeRepairInFlight = (async () => {
    const n = await ensureNodeRuntime((pct, msg) => writeLog('backend', `[node] ${msg}\n`));
    return Boolean(n && isNodeRuntimeReady());
  })();
  try {
    return await nodeRepairInFlight;
  } finally {
    nodeRepairInFlight = null;
  }
}

function larkCliRunJs() {
  return path.join(LARK_CLI_DIR, 'node_modules', LARK_CLI_PKG, 'scripts', 'run.js');
}

function larkCliNativeBin() {
  const ext = IS_WIN ? '.exe' : '';
  return path.join(LARK_CLI_DIR, 'node_modules', LARK_CLI_PKG, 'bin', `lark-cli${ext}`);
}

function resolveLarkCliBin() {
  const searchRoots = [];
  if (fs.existsSync(path.join(LARK_CLI_DIR, 'node_modules', LARK_CLI_PKG, 'package.json'))) {
    searchRoots.push(LARK_CLI_DIR);
  }
  if (hasBundledLarkCli()) searchRoots.push(RES_LARK_CLI_BUNDLED);

  for (const root of searchRoots) {
    const ext = IS_WIN ? '.exe' : '';
    const native = path.join(root, 'node_modules', LARK_CLI_PKG, 'bin', `lark-cli${ext}`);
    if (fs.existsSync(native)) return native;
    const runJs = path.join(root, 'node_modules', LARK_CLI_PKG, 'scripts', 'run.js');
    if (fs.existsSync(runJs)) return runJs;
    if (IS_WIN) {
      const cmdBin = path.join(root, 'node_modules', '.bin', 'lark-cli.cmd');
      if (fs.existsSync(cmdBin)) return cmdBin;
    } else {
      const localBin = path.join(root, 'node_modules', '.bin', 'lark-cli');
      if (fs.existsSync(localBin)) return localBin;
    }
  }
  return findExecutable('lark-cli') || null;
}

function larkCliExecEnv(nodeBin) {
  const pathParts = [];
  if (nodeBin && fs.existsSync(nodeBin)) {
    pathParts.push(path.dirname(nodeBin));
  }
  const nodeBinDir = path.join(NODE_LOCAL_DIR, 'bin');
  if (fs.existsSync(nodeBinDir)) pathParts.push(nodeBinDir);
  const larkCliBinDir = path.join(LARK_CLI_DIR, 'node_modules', '.bin');
  if (fs.existsSync(larkCliBinDir)) pathParts.push(larkCliBinDir);
  const bundledBinDir = path.join(RES_LARK_CLI_BUNDLED, 'node_modules', '.bin');
  if (fs.existsSync(bundledBinDir)) pathParts.push(bundledBinDir);
  if (!IS_WIN) {
    pathParts.push('/opt/homebrew/bin', '/usr/local/bin');
  }
  pathParts.push(process.env.PATH || '');
  return {
    ...process.env,
    HOME: process.env.HOME || require('os').homedir(),
    PATH: pathParts.filter(Boolean).join(PATH_SEP),
  };
}

function isWindowsCmdScript(bin) {
  if (!IS_WIN || !bin) return false;
  const ext = path.extname(bin).toLowerCase();
  return ext === '.cmd' || ext === '.bat';
}

function verifyLarkCliBin(bin, nodeBin) {
  if (!bin || !fs.existsSync(bin)) return false;
  const ext = path.extname(bin).toLowerCase();
  const env = larkCliExecEnv(nodeBin);
  try {
    if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
      const nb = nodeBin || resolveNodeBin();
      if (!nb || !fs.existsSync(nb)) return false;
      execFileSync(nb, [bin, '--version'], {
        env,
        timeout: 20000,
        stdio: 'pipe',
        windowsHide: true,
      });
      return true;
    }
    if (isWindowsCmdScript(bin)) {
      execSync(`"${bin}" --version`, {
        env,
        timeout: 20000,
        stdio: 'pipe',
        windowsHide: true,
      });
      return true;
    }
    execFileSync(bin, ['--version'], {
      env,
      timeout: 20000,
      stdio: 'pipe',
      windowsHide: true,
    });
    return true;
  } catch (_) {
    return false;
  }
}

function isLarkCliReady(nodeBin) {
  return verifyLarkCliBin(resolveLarkCliBin(), nodeBin);
}

async function bootstrapLarkCliBinary(sendProgress, nodeBin) {
  const nb = nodeBin || resolveNodeBin();
  if (!nb || !fs.existsSync(nb)) return;
  const nativeBin = path.join(LARK_CLI_DIR, 'node_modules', LARK_CLI_PKG, 'bin', IS_WIN ? 'lark-cli.exe' : 'lark-cli');
  if (fs.existsSync(nativeBin)) return;
  const runJs = larkCliRunJs();
  if (!fs.existsSync(runJs)) return;
  sendProgress(97, '正在下载 lark-cli 二进制…', '');
  await runCommand(nb, [runJs, '--version'], {
    cwd: LARK_CLI_DIR,
    timeout: 3 * 60 * 1000,
    env: larkCliExecEnv(nb),
  });
}

async function materializeBundledLarkCli(sendProgress, nodeBin) {
  if (!hasBundledLarkCli()) return false;

  const installedMarker = path.join(LARK_CLI_DIR, 'node_modules', LARK_CLI_PKG, 'package.json');
  if (!fs.existsSync(installedMarker)) {
    sendProgress(96, '复制内置 lark-cli…', path.basename(RES_LARK_CLI_BUNDLED));
    if (fs.existsSync(LARK_CLI_DIR)) {
      fs.rmSync(LARK_CLI_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(LARK_CLI_DIR, { recursive: true });
    await copyDir(RES_LARK_CLI_BUNDLED, LARK_CLI_DIR);
  } else {
    sendProgress(96, '使用已复制的 lark-cli…', LARK_CLI_DIR);
  }

  await bootstrapLarkCliBinary(sendProgress, nodeBin);
  return isLarkCliReady(nodeBin);
}

let larkCliRepairInFlight = null;

async function ensureLarkCli(sendProgress = () => {}, nodeBin) {
  const nb = nodeBin || resolveNodeBin();
  if (isLarkCliReady(nb)) return resolveLarkCliBin();

  if (hasBundledLarkCli()) {
    sendProgress(96, '使用安装包内置 lark-cli…', RES_LARK_CLI_BUNDLED);
    if (await materializeBundledLarkCli(sendProgress, nb)) {
      return resolveLarkCliBin();
    }
  }

  if (!nb || !fs.existsSync(nb)) {
    throw new Error('Node.js 未就绪，无法安装 lark-cli');
  }

  sendProgress(96, '正在在线安装 lark-cli…', '飞书工作台需要');
  fs.mkdirSync(LARK_CLI_DIR, { recursive: true });

  const pkgPath = path.join(LARK_CLI_DIR, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    fs.writeFileSync(
      pkgPath,
      JSON.stringify(
        {
          name: 'ai-media-agent-lark-cli',
          private: true,
          dependencies: { [LARK_CLI_PKG]: LARK_CLI_PKG_VER },
        },
        null,
        2,
      ),
    );
  }

  const npmBin = IS_WIN
    ? path.join(path.dirname(nb), 'npm.cmd')
    : path.join(path.dirname(nb), 'npm');
  const npmArgs = ['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'];

  if (fs.existsSync(npmBin)) {
    await runCommand(
      npmBin,
      npmArgs,
      { cwd: LARK_CLI_DIR, timeout: 8 * 60 * 1000, streamStderr: true },
      line => {
        if (/lark|@larksuite|cli/i.test(line)) {
          sendProgress(96, '正在安装 lark-cli…', line.slice(0, 96));
        }
      },
    );
  } else {
    const npmCli = path.join(path.dirname(nb), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
    await runCommand(nb, [npmCli, ...npmArgs], {
      cwd: LARK_CLI_DIR,
      timeout: 8 * 60 * 1000,
    });
  }

  const runJs = larkCliRunJs();
  if (fs.existsSync(runJs) && !fs.existsSync(larkCliNativeBin())) {
    await bootstrapLarkCliBinary(sendProgress, nb);
  }

  if (!isLarkCliReady(nb)) {
    throw new Error('lark-cli 安装后仍无法运行，请检查网络后重试');
  }
  return resolveLarkCliBin();
}

async function repairLarkCliSilently() {
  if (larkCliRepairInFlight) return larkCliRepairInFlight;
  if (isLarkCliReady()) return true;

  larkCliRepairInFlight = (async () => {
    try {
      const nodeBin = await ensureNodeRuntime((pct, msg) => writeLog('frontend', `[lark-cli] ${msg}\n`));
      if (!nodeBin) return false;
      await ensureLarkCli(() => {}, nodeBin);
      return isLarkCliReady();
    } catch (err) {
      writeLog('frontend', `[lark-cli] repair failed: ${err.message}\n`);
      return false;
    }
  })();

  try {
    return await larkCliRepairInFlight;
  } finally {
    larkCliRepairInFlight = null;
  }
}

/** Parse a .env file into a plain object (skips comments and blanks) */
function parseDotEnv(filePath) {
  const result = {};
  if (!fs.existsSync(filePath)) return result;
  for (const raw of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val   = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) val = val.slice(1, -1);
    result[key] = val;
  }
  return result;
}

const API_KEY_FIELDS = [
  'ZHIPUAI_API_KEY', 'OPENROUTER_API_KEY', 'GOOGLE_API_KEY', 'DEEPSEEK_API_KEY',
  'BYTEDANCE_API_KEY', 'ALIBABA_API_KEY', 'DASHSCOPE_API_KEY',
];

function hasApiKeyConfigured() {
  const env = parseDotEnv(ENV_FILE);
  return API_KEY_FIELDS.some(k => (env[k] || '').trim().length > 0);
}

/** Merge key=value updates into an existing .env file */
function updateEnvFile(updates) {
  const lines = fs.existsSync(ENV_FILE)
    ? fs.readFileSync(ENV_FILE, 'utf8').split('\n')
    : [];
  const pending = { ...updates };
  const out = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const eq = trimmed.indexOf('=');
    if (eq < 0) return line;
    const key = trimmed.slice(0, eq).trim();
    if (Object.prototype.hasOwnProperty.call(pending, key)) {
      const val = pending[key];
      delete pending[key];
      return `${key}=${val}`;
    }
    return line;
  });
  for (const [key, val] of Object.entries(pending)) {
    out.push(`${key}=${val}`);
  }
  fs.mkdirSync(path.dirname(ENV_FILE), { recursive: true });
  fs.writeFileSync(ENV_FILE, out.join('\n').replace(/\n*$/, '\n'));
}

const DEFAULT_MEAL_WEB_BASE_URL = 'https://tech-huhao.tech';
const DEFAULT_CLOUDFLARE_TUNNEL_NAME = 'gosteam-tech';

/** Merge missing keys from bundled .env.bundled (build-time backend/.env) into APP_DATA .env */
function mergeBundledEnvDefaults() {
  const bundledPath = path.join(RES_BACKEND, '.env.bundled');
  if (!fs.existsSync(bundledPath)) return;
  const bundled = parseDotEnv(bundledPath);
  const existing = parseDotEnv(ENV_FILE);
  const updates = {};
  for (const [key, val] of Object.entries(bundled)) {
    if (!val || !String(val).trim()) continue;
    if (!(existing[key] || '').trim()) updates[key] = val;
  }
  if (!Object.keys(updates).length) return;
  updateEnvFile(updates);
  writeLog('backend', `[env] merged bundled defaults: ${Object.keys(updates).join(', ')}\n`);
}

/** 桌面包飞书餐费提醒：表单链接必须用公网域名，不能是 localhost:3000 */
function ensureMealPublicWebBaseUrl() {
  if (IS_DEV) return;
  const existing = parseDotEnv(ENV_FILE);
  const updates = {};
  if (!(existing.MEAL_WEB_BASE_URL || '').trim()) {
    updates.MEAL_WEB_BASE_URL = DEFAULT_MEAL_WEB_BASE_URL;
  }
  if (!(existing.CLOUDFLARE_TUNNEL_ENABLED || '').trim()) {
    updates.CLOUDFLARE_TUNNEL_ENABLED = '1';
  }
  if (!Object.keys(updates).length) return;
  updateEnvFile(updates);
  writeLog('backend', `[env] packaged defaults: ${Object.keys(updates).join(', ')}\n`);
}

function defaultCloudflaredConfigPath() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return home ? path.join(home, '.cloudflared', 'config.yml') : '';
}

function resolveCloudflaredBin() {
  return findExecutable('cloudflared');
}

function mealUsesPublicWebBase() {
  const dotenv = parseDotEnv(ENV_FILE);
  const base = (dotenv.MEAL_WEB_BASE_URL || DEFAULT_MEAL_WEB_BASE_URL || '').trim();
  return !!base && !/localhost|127\.0\.0\.1/i.test(base);
}

function isCloudflareTunnelEnabled() {
  const dotenv = parseDotEnv(ENV_FILE);
  const flag = String(dotenv.CLOUDFLARE_TUNNEL_ENABLED || '').trim().toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'no') return false;
  if (flag === '1' || flag === 'true' || flag === 'yes') return true;
  return !IS_DEV && mealUsesPublicWebBase();
}

function resolveCloudflaredTunnelName() {
  const dotenv = parseDotEnv(ENV_FILE);
  return (dotenv.CLOUDFLARE_TUNNEL_NAME || DEFAULT_CLOUDFLARE_TUNNEL_NAME).trim();
}

function resolveCloudflaredConfigPath() {
  const dotenv = parseDotEnv(ENV_FILE);
  const raw = (dotenv.CLOUDFLARE_TUNNEL_CONFIG || '').trim();
  return raw || defaultCloudflaredConfigPath();
}

function maybeStartCloudflareTunnel() {
  if (tunnelLaunchScheduled || isShuttingDown) return;
  if (SERVICES.tunnel.proc) return;
  if (SERVICES.frontend.status !== 'running') return;

  if (!isCloudflareTunnelEnabled()) {
    SERVICES.tunnel.status = 'unavailable';
    SERVICES.tunnel.lastError = '内网穿透未启用（CLOUDFLARE_TUNNEL_ENABLED=0）';
    broadcastStatus();
    return;
  }

  const bin = resolveCloudflaredBin();
  const configPath = resolveCloudflaredConfigPath();
  const tunnelName = resolveCloudflaredTunnelName();

  if (!bin) {
    SERVICES.tunnel.status = 'error';
    SERVICES.tunnel.lastError = '未安装 cloudflared（macOS: brew install cloudflared）';
    broadcastStatus();
    writeLog('tunnel', '[tunnel] cloudflared binary not found\n');
    return;
  }
  if (!configPath || !fs.existsSync(configPath)) {
    SERVICES.tunnel.status = 'error';
    SERVICES.tunnel.lastError = `隧道配置缺失: ${configPath || '(HOME 未设置)'}`;
    broadcastStatus();
    writeLog('tunnel', `[tunnel] missing config: ${configPath}\n`);
    return;
  }

  tunnelLaunchScheduled = true;
  writeLog('tunnel', `[tunnel] starting ${tunnelName} via ${bin}\n`);
  sendStartupProgress('正在启动 Cloudflare Tunnel…', '公网域名 tech-huhao.tech', 'tunnel');
  spawnService('tunnel', bin, [
    'tunnel', '--config', configPath, '--protocol', 'http2', 'run', tunnelName,
  ], { cwd: APP_DATA });
}

/** Remove Gatekeeper quarantine from the running .app bundle (macOS) */
function removeSelfQuarantine() {
  if (IS_DEV || process.platform !== 'darwin') return;
  try {
    const exe = app.getPath('exe');
    const appBundle = path.resolve(exe, '../../..');
    execSync(`xattr -cr ${JSON.stringify(appBundle)}`, { stdio: 'ignore' });
  } catch (_) {}
}

function sendSetupPhase(phase) {
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.webContents.send('setup-phase', { phase });
  }
}

function needsInstallSetup() {
  if (!fs.existsSync(SETUP_DONE_FILE)) return true;
  if (!fs.existsSync(VERSION_FILE)) return true;
  if (fs.readFileSync(VERSION_FILE, 'utf8').trim() !== APP_VERSION) return true;
  if (!isPythonRuntimeReady()) return true;
  if (!IS_DEV && !isNodeRuntimeReady()) return true;
  return false;
}

function resolveWizardInitialPhase() {
  if (needsInstallSetup()) {
    // Skip welcome when setup was done but venv/python is missing (ENOENT on other Macs)
    if (fs.existsSync(SETUP_DONE_FILE)) return 'install';
    return 'welcome';
  }
  if (!hasApiKeyConfigured() && !fs.existsSync(CONFIG_DONE_FILE)) return 'config';
  return null;
}

let wizardOnComplete = null;

async function finishWizard({ openDashboard = false, skippedConfig = false } = {}) {
  if (skippedConfig && !fs.existsSync(CONFIG_DONE_FILE)) {
    fs.writeFileSync(CONFIG_DONE_FILE, `skipped:${new Date().toISOString()}`);
  }
  if (setupWindow && !setupWindow.isDestroyed()) setupWindow.close();
  syncDockVisibility();
  startAllServices();
  if (!IS_DEV) scheduleShowStatusWindow(2800);
  if (openDashboard) scheduleOpenDashboard(1500);
  if (wizardOnComplete) wizardOnComplete();
  wizardOnComplete = null;
}

/**
 * Build the environment object for spawned processes.
 * Merges .env file, required paths, and optional extras.
 */
function buildEnv(extras = {}) {
  const dotenv = parseDotEnv(ENV_FILE);
  const mealWebBase = (dotenv.MEAL_WEB_BASE_URL || '').trim()
    || (IS_DEV ? 'http://localhost:3000' : DEFAULT_MEAL_WEB_BASE_URL);
  const pathParts = IS_WIN
    ? [path.join(APP_DATA, 'bin')]
    : [path.join(APP_DATA, 'bin')];

  if (fs.existsSync(PYTHON_STANDALONE_BIN_DIR)) {
    pathParts.unshift(PYTHON_STANDALONE_BIN_DIR);
  }
  const venvBin = IS_WIN
    ? path.join(VENV_DIR, 'Scripts')
    : path.join(VENV_DIR, 'bin');
  if (fs.existsSync(venvBin)) pathParts.unshift(venvBin);

  const nodeBinDir = path.join(NODE_LOCAL_DIR, 'bin');
  if (fs.existsSync(nodeBinDir)) pathParts.unshift(nodeBinDir);
  if (IS_WIN && fs.existsSync(NODE_LOCAL_DIR)) pathParts.unshift(NODE_LOCAL_DIR);
  const resolvedNodeBin = resolveNodeBin();
  if (resolvedNodeBin && fs.existsSync(resolvedNodeBin)) {
    pathParts.unshift(path.dirname(resolvedNodeBin));
  } else if (fs.existsSync(NODE_BUNDLE_RUNTIME)) {
    pathParts.unshift(NODE_BUNDLE_RUNTIME);
  }

  const larkCliBinDir = path.join(LARK_CLI_DIR, 'node_modules', '.bin');
  if (fs.existsSync(larkCliBinDir)) pathParts.unshift(larkCliBinDir);
  const larkBundledBinDir = path.join(RES_LARK_CLI_BUNDLED, 'node_modules', '.bin');
  if (fs.existsSync(larkBundledBinDir)) pathParts.unshift(larkBundledBinDir);

  if (!IS_WIN) {
    pathParts.push(
      '/opt/homebrew/bin', '/opt/homebrew/sbin',
      '/usr/local/bin', '/usr/local/sbin',
      '/usr/bin', '/bin'
    );
  }
  pathParts.push(process.env.PATH || '');

  const larkBin = resolveLarkCliBin();
  const nodeBinForEnv = resolveNodeBin();
  const npxBundled = nodeBinForEnv
    ? path.join(path.dirname(nodeBinForEnv), IS_WIN ? 'npx.cmd' : 'npx')
    : (IS_WIN ? path.join(NODE_BUNDLE_RUNTIME, 'npx.cmd') : path.join(NODE_BUNDLE_RUNTIME, 'bin', 'npx'));

  return {
    HOME:    process.env.HOME,
    USER:    process.env.USER,
    LOGNAME: process.env.LOGNAME || process.env.USER,
    TMPDIR:  process.env.TMPDIR || (IS_WIN ? process.env.TEMP || 'C:\\Temp' : '/tmp'),
    LANG:    'en_US.UTF-8',
    LC_ALL:  'en_US.UTF-8',
    AI_MEDIA_AGENT_HOME: APP_DATA,
    AI_MEDIA_AGENT_SKILLS_DIR: resolveBundledSkillsDir(),
    ...(hasBundledMcpNode() ? { AI_MEDIA_AGENT_MCP_PREFIX: RES_MCP_BUNDLED } : {}),
    ...(fs.existsSync(npxBundled) ? { AI_MEDIA_AGENT_NPX: npxBundled } : {}),
    ...(larkBin ? { LARK_CLI_BIN: larkBin } : {}),
    // Force UTF-8 mode on Windows (prevents GBK decode errors on Chinese locale)
    PYTHONUTF8:        '1',
    PYTHONIOENCODING:  'utf-8',
    // Disable Python SSL cert hostname check — fixes proxy-related SSL errors on Windows
    PYTHONHTTPSVERIFY: '0',
    PIP_TRUSTED_HOST: [
      'pypi.org', 'pypi.python.org', 'files.pythonhosted.org',
      'mirrors.aliyun.com', 'pypi.tuna.tsinghua.edu.cn',
      'pypi.mirrors.ustc.edu.cn', 'mirrors.cloud.tencent.com',
    ].join(' '),
    // Do NOT set PYTHONHOME here — breaks venv (ModuleNotFoundError: encodings).
    PATH: pathParts.filter(Boolean).join(PATH_SEP),
    STORAGE_DIR:              STORAGE_DIR,
    PLAYWRIGHT_BROWSERS_PATH: BROWSERS_DIR,
    NEXT_TELEMETRY_DISABLED:  '1',
    ...dotenv,
    ...extras,
    MEAL_WEB_BASE_URL:        (dotenv.MEAL_WEB_BASE_URL || extras.MEAL_WEB_BASE_URL || '').trim() || mealWebBase,
    PUBLIC_BASE_URL:          (dotenv.PUBLIC_BASE_URL || extras.PUBLIC_BASE_URL || '').trim() || mealWebBase,
    // Bypass ALL proxies — must come last so dotenv/extras can't override.
    // On Windows, Python's urllib calls getproxies_registry() when no proxy
    // env vars are set, picking up Clash/V2Ray/etc. from the registry even if
    // the proxy app isn't running. Setting no_proxy=* makes
    // getproxies_environment() return a non-empty dict, which short-circuits
    // the registry fallback. requests then sees no_proxy='*' and skips proxy
    // for all hosts.
    no_proxy:     '*',
    NO_PROXY:     '*',
    PIP_NO_PROXY: '*',
    HTTP_PROXY:   '',
    HTTPS_PROXY:  '',
    http_proxy:   '',
    https_proxy:  '',
    ALL_PROXY:    '',
    all_proxy:    '',
  };
}

/** Append text to a per-service log file */
function writeLog(key, text) {
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    fs.appendFileSync(path.join(LOGS_DIR, `${key}.log`), text);
  } catch (_) {}
}

/** Human-readable labels for install wizard steps (also written to install.log). */
const SETUP_STEP_LABELS = {
  init: '初始化',
  cleanup: '清理旧环境',
  dirs: '准备目录',
  parallel: '并行安装',
  sync: '同步应用文件',
  skills: 'Agent 技能',
  pyPrep: 'Python 环境',
  pip: 'Python 依赖',
  node: 'Node.js',
  lark: 'lark-cli',
  playwright: 'Playwright',
  env: '环境变量',
  finish: '安装完成',
  error: '安装失败',
};

let installLoggingActive = false;

function writeInstallLogRaw(text) {
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    fs.appendFileSync(INSTALL_LOG_FILE, text);
  } catch (_) {}
}

function formatInstallLogLine(step, pct, msg, detail) {
  const ts = new Date().toISOString();
  const stepLabel = SETUP_STEP_LABELS[step] || step || '—';
  const pctPart = pct >= 0 ? ` ${pct}%` : '';
  const detailPart = detail ? ` | ${detail}` : '';
  return `${ts} [${stepLabel}]${pctPart} ${msg}${detailPart}`;
}

function appendInstallLog(step, pct, msg, detail = '') {
  if (!installLoggingActive) return;
  writeInstallLogRaw(`${formatInstallLogLine(step, pct, msg, detail)}\n`);
}

function beginInstallLogSession() {
  installLoggingActive = true;
  writeInstallLogRaw(
    `\n${'='.repeat(72)}\n`
    + `[${new Date().toISOString()}] AI Media Agent 安装会话开始\n`
    + `版本: ${APP_VERSION} | 平台: ${process.platform}\n`
    + `APP_DATA: ${APP_DATA}\n`
    + `日志文件: ${INSTALL_LOG_FILE}\n`
    + `${'='.repeat(72)}\n`,
  );
}

function endInstallLogSession(success, message = '') {
  const status = success ? '成功' : '失败';
  writeInstallLogRaw(
    `[${new Date().toISOString()}] 安装会话结束 — ${status}`
    + (message ? `: ${message}` : '')
    + '\n\n',
  );
  installLoggingActive = false;
}

function loadPersistedBackendPort() {
  try {
    if (!fs.existsSync(BACKEND_PORT_FILE)) return;
    const port = parseInt(String(fs.readFileSync(BACKEND_PORT_FILE, 'utf8')).trim(), 10);
    if (Number.isFinite(port) && port > 0) {
      SERVICES.backend.port = port;
      writeDesktopPetConfig();
    }
  } catch (_) {}
}

/** 统计餐费 SQLite 行数（用于判断是否需要从开发目录迁移） */
function countMealReceiptRows(dbPath) {
  if (!fs.existsSync(dbPath)) return 0;
  try {
    const out = execSync(
      `sqlite3 ${JSON.stringify(dbPath)} "SELECT COUNT(*) FROM meal_receipts;"`,
      { encoding: 'utf8', timeout: 8000 },
    );
    return parseInt(String(out).trim(), 10) || 0;
  } catch {
    return 0;
  }
}

function copyDirSync(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

/**
 * 桌面版 storage 在 APP_DATA；本地 dev（start_local / 飞书监听）写在项目 storage/。
 * 首次打开桌面包且应用库为空时，自动迁入 ~/Documents/agent/storage 或仓库 storage。
 */
function migrateLegacyMealStorageIfNeeded() {
  const targetMeal = path.join(STORAGE_DIR, 'meal');
  const targetDb = path.join(targetMeal, 'meal_receipts.db');
  if (countMealReceiptRows(targetDb) > 0) return;

  const legacyRoots = [
    path.join(app.getPath('documents'), 'agent', 'storage'),
    path.join(__dirname, '..', 'storage'),
  ];

  for (const legacyRoot of legacyRoots) {
    const legacyDb = path.join(legacyRoot, 'meal', 'meal_receipts.db');
    const legacyCount = countMealReceiptRows(legacyDb);
    if (legacyCount <= 0) continue;

    const legacyMeal = path.join(legacyRoot, 'meal');
    fs.mkdirSync(targetMeal, { recursive: true });
    for (const name of fs.readdirSync(legacyMeal)) {
      fs.copyFileSync(path.join(legacyMeal, name), path.join(targetMeal, name));
    }

    const legacyUploads = path.join(legacyRoot, 'uploads', 'meal');
    const targetUploads = path.join(STORAGE_DIR, 'uploads', 'meal');
    if (fs.existsSync(legacyUploads)) {
      copyDirSync(legacyUploads, targetUploads);
    }

    writeLog(
      'backend',
      `[meal] migrated ${legacyCount} receipt(s) from ${legacyRoot} → ${STORAGE_DIR}\n`,
    );
    return;
  }
}

/** Create all required directories */
function ensureDirs() {
  [APP_DATA, STORAGE_DIR, LOGS_DIR, BROWSERS_DIR, DESKTOP_PET_DIR].forEach(d =>
    fs.mkdirSync(d, { recursive: true })
  );
  STORAGE_SUBDIRS.forEach(sub =>
    fs.mkdirSync(path.join(STORAGE_DIR, sub), { recursive: true })
  );
  seedDefaultStorageConfigs();
  migrateLegacyMealStorageIfNeeded();
  loadPersistedBackendPort();
}

/**
 * Count skill directories that contain SKILL.md under a root folder.
 */
function countSkillDirs(rootDir) {
  if (!rootDir || !fs.existsSync(rootDir)) return 0;
  try {
    return fs.readdirSync(rootDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.')
        && fs.existsSync(path.join(rootDir, e.name, 'SKILL.md')))
      .length;
  } catch {
    return 0;
  }
}

function bundledSkillsNeedInstall() {
  if (bundledSkillsUseInPlace()) return false;
  const bundled = countSkillDirs(RES_AGENT_SKILLS);
  if (bundled === 0) return false;
  return countSkillDirs(AGENT_SKILLS_DIR) < bundled;
}

function readJsonFileSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * 播种/合并打包内置的 MCP 与技能开关配置。
 * MCP：缺失、为空或缺少内置 preset 时自动写入/合并（不删用户自定义项）。
 * skills_enabled：仅在文件不存在时写入，保留用户开关。
 */
function seedDefaultStorageConfigs() {
  if (!fs.existsSync(RES_STORAGE_DEFAULTS)) return;

  const mcpSrc = path.join(RES_STORAGE_DEFAULTS, 'mcp_servers.json');
  const mcpDst = path.join(STORAGE_DIR, 'mcp_servers.json');
  if (fs.existsSync(mcpSrc)) {
    const bundled = readJsonFileSafe(mcpSrc, { servers: [] });
    const bundledServers = Array.isArray(bundled.servers) ? bundled.servers : [];
    if (bundledServers.length === 0) return;

    const sanitizePreset = (server) => {
      const row = { ...server };
      row.status = '';
      row.status_msg = '';
      delete row.server_name;
      delete row.server_version;
      return row;
    };

    if (!fs.existsSync(mcpDst)) {
      fs.writeFileSync(mcpDst, `${JSON.stringify({ servers: bundledServers.map(sanitizePreset) }, null, 2)}\n`);
      writeLog('backend', `[seed] MCP config installed (${bundledServers.length} presets)\n`);
    } else {
      const current = readJsonFileSafe(mcpDst, { servers: [] });
      const currentServers = Array.isArray(current.servers) ? current.servers : [];
      if (currentServers.length === 0) {
        fs.writeFileSync(mcpDst, `${JSON.stringify({ servers: bundledServers.map(sanitizePreset) }, null, 2)}\n`);
        writeLog('backend', `[seed] replaced empty MCP config (${bundledServers.length} presets)\n`);
      } else {
        const existingIds = new Set(currentServers.map(s => String(s.id || '')));
        let added = 0;
        for (const server of bundledServers) {
          if (!server?.id || existingIds.has(String(server.id))) continue;
          currentServers.push(sanitizePreset(server));
          existingIds.add(String(server.id));
          added += 1;
        }
        if (added > 0) {
          fs.writeFileSync(mcpDst, `${JSON.stringify({ servers: currentServers }, null, 2)}\n`);
          writeLog('backend', `[seed] merged ${added} bundled MCP preset(s)\n`);
        }
      }
    }
  }

  const skillsSrc = path.join(RES_STORAGE_DEFAULTS, 'skills_enabled.json');
  const skillsDst = path.join(STORAGE_DIR, 'skills_enabled.json');
  if (fs.existsSync(skillsSrc) && !fs.existsSync(skillsDst)) {
    fs.copyFileSync(skillsSrc, skillsDst);
    writeLog('backend', '[seed] skills_enabled.json installed\n');
  }
}

/** Copy bundled agent skills into APP_DATA/.agent/skills when missing or outdated. */
async function installBundledAgentSkills(sendProgress) {
  if (bundledSkillsUseInPlace()) {
    sendProgress?.(12, `使用安装包内置 Agent 技能（${countSkillDirs(RES_AGENT_SKILLS)} 个）…`, RES_AGENT_SKILLS);
    writeLog('backend', `[sync] agent skills in-place → ${RES_AGENT_SKILLS}\n`);
    return false;
  }
  if (!fs.existsSync(RES_AGENT_SKILLS) || !bundledSkillsNeedInstall()) return false;
  const bundled = countSkillDirs(RES_AGENT_SKILLS);
  appendInstallLog('skills', 12, `安装 Agent 技能（${bundled} 个）…`, AGENT_SKILLS_DIR);
  sendProgress?.(12, `安装 Agent 技能（${bundled} 个）…`, AGENT_SKILLS_DIR);
  fs.mkdirSync(path.dirname(AGENT_SKILLS_DIR), { recursive: true });
  await copyDir(RES_AGENT_SKILLS, AGENT_SKILLS_DIR);
  const installed = countSkillDirs(AGENT_SKILLS_DIR);
  writeLog('backend', `[sync] agent skills → ${AGENT_SKILLS_DIR} (${installed}/${bundled})\n`);
  return true;
}

/** Recursively copy a directory src → dst (parallel file copies on Windows). */
async function copyDir(src, dst, concurrency = IS_WIN ? 16 : 8) {
  await fsp.mkdir(dst, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  const subdirs = [];
  const files = [];
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) subdirs.push([s, d]);
    else files.push([s, d]);
  }
  for (let i = 0; i < files.length; i += concurrency) {
    await Promise.all(files.slice(i, i + concurrency).map(([s, d]) => fsp.copyFile(s, d)));
  }
  await Promise.all(subdirs.map(([s, d]) => copyDir(s, d, concurrency)));
}

function hashFile(filePath) {
  if (!fs.existsSync(filePath)) return '';
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function pipDepsInstalled() {
  if (!fs.existsSync(PIP_STAMP_FILE)) return false;
  const reqFile = path.join(BACKEND_DATA, 'requirements.txt');
  const expected = hashFile(reqFile);
  if (!expected) return false;
  return fs.readFileSync(PIP_STAMP_FILE, 'utf8').trim() === expected;
}

function markPipDepsInstalled() {
  const reqFile = path.join(BACKEND_DATA, 'requirements.txt');
  const stamp = hashFile(reqFile);
  if (stamp) fs.writeFileSync(PIP_STAMP_FILE, stamp);
}

const PLAYWRIGHT_BROWSER_STAMP = path.join(APP_DATA, '.playwright_browser_stamp');

function playwrightChromiumExecutable() {
  try {
    if (!fs.existsSync(BROWSERS_DIR)) return null;
    const chromiumDir = fs.readdirSync(BROWSERS_DIR).find(e => e.startsWith('chromium-'));
    if (!chromiumDir) return null;
    if (IS_WIN) {
      const exe = path.join(BROWSERS_DIR, chromiumDir, 'chrome-win', 'chrome.exe');
      return fs.existsSync(exe) ? exe : null;
    }
    const armExe = path.join(
      BROWSERS_DIR, chromiumDir, 'chrome-mac-arm64',
      'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing',
    );
    if (fs.existsSync(armExe)) return armExe;
    const x64Exe = path.join(
      BROWSERS_DIR, chromiumDir, 'chrome-mac-x64',
      'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing',
    );
    return fs.existsSync(x64Exe) ? x64Exe : null;
  } catch {
    return null;
  }
}

function isPlaywrightChromiumReady() {
  return Boolean(playwrightChromiumExecutable());
}

function readPlaywrightPackageVersion() {
  const pyBin = getPythonBin();
  if (!pyBin) return '';
  try {
    return execSync(
      `"${pyBin}" -c "import importlib.metadata as m; print(m.version('playwright'))"`,
      { encoding: 'utf8', timeout: 20000, env: envForVenv() },
    ).trim();
  } catch {
    return '';
  }
}

function markPlaywrightBrowsersInstalled() {
  const ver = readPlaywrightPackageVersion();
  if (ver) fs.writeFileSync(PLAYWRIGHT_BROWSER_STAMP, ver);
}

function playwrightBrowsersNeedInstall() {
  if (!isPlaywrightChromiumReady()) return true;
  if (!fs.existsSync(PLAYWRIGHT_BROWSER_STAMP)) return true;
  const ver = readPlaywrightPackageVersion();
  if (!ver) return false;
  try {
    return fs.readFileSync(PLAYWRIGHT_BROWSER_STAMP, 'utf8').trim() !== ver;
  } catch {
    return true;
  }
}

async function ensurePlaywrightBrowsersReady(sendProgress) {
  if (!isPythonRuntimeReady()) return;
  if (!playwrightBrowsersNeedInstall()) return;
  const log = sendProgress || ((pct, msg, detail = '') => {
    writeLog('backend', `[playwright] ${pct >= 0 ? `${pct}% ` : ''}${msg}${detail ? ` — ${detail}` : ''}\n`);
  });
  writeLog('backend', '[playwright] Chromium missing or stale — installing…\n');
  if (IS_WIN) {
    schedulePlaywrightInstall();
    return;
  }
  await installPlaywrightBrowsers(log, getPythonBin());
  if (isPlaywrightChromiumReady()) markPlaywrightBrowsersInstalled();
}

function pythonDepsImportable(pyBin) {
  if (!pyBin) return false;
  try {
    execSync(
      `"${pyBin}" -c "import uvicorn, fastapi, pandas, openpyxl"`,
      { encoding: 'utf8', timeout: 20000, env: envForVenv() },
    );
    return true;
  } catch {
    return false;
  }
}

function readBundledBackendRevision() {
  const revFile = path.join(RES_BACKEND, '.bundle_revision');
  if (fs.existsSync(revFile)) {
    return fs.readFileSync(revFile, 'utf8').trim();
  }
  return APP_VERSION;
}

/** Copy bundled backend/OCR when bundle revision changed or files missing. */
async function syncAppResources(sendProgress) {
  const bundledRev = readBundledBackendRevision();
  const stamp = fs.existsSync(RESOURCE_BUNDLE_STAMP)
    ? fs.readFileSync(RESOURCE_BUNDLE_STAMP, 'utf8').trim()
    : '';
  const backendReady = fs.existsSync(path.join(BACKEND_DATA, 'main.py'));
  const langGraphReady = fs.existsSync(path.join(BACKEND_DATA, 'routers', 'agent_chat_router.py'));
  const skillsReady = bundledSkillsUseInPlace() || !bundledSkillsNeedInstall();
  if (stamp === bundledRev && backendReady && langGraphReady && skillsReady) {
    sendProgress(10, '后端文件已就绪', bundledRev);
    await installBundledAgentSkills(sendProgress);
    seedDefaultStorageConfigs();
    return false;
  }

  sendProgress(10, '复制后端文件…', bundledRev);
  if (fs.existsSync(RES_BACKEND)) {
    await copyDir(RES_BACKEND, BACKEND_DATA);
  }
  if (fs.existsSync(RES_OCR)) {
    await copyDir(RES_OCR, OCR_DATA);
  }
  const genDst = path.join(BACKEND_DATA, 'generated');
  if (fs.existsSync(RES_GENERATED) && !fs.existsSync(genDst)) {
    await copyDir(RES_GENERATED, genDst);
  }
  await installBundledAgentSkills(sendProgress);
  seedDefaultStorageConfigs();
  fs.writeFileSync(RESOURCE_BUNDLE_STAMP, bundledRev);
  writeLog('backend', `[sync] backend bundle updated → ${bundledRev}\n`);
  return true;
}

function nodeStandaloneArchiveName() {
  if (IS_WIN) return `node-v${NODE_VERSION}-win-x64.zip`;
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return `node-v${NODE_VERSION}-darwin-${arch}.tar.gz`;
}

function bundledNodeArchivePath() {
  return path.join(NODE_BUNDLE_DIR, nodeStandaloneArchiveName());
}

function bundledNodeRuntimeExe() {
  return IS_WIN
    ? path.join(NODE_BUNDLE_RUNTIME, 'node.exe')
    : path.join(NODE_BUNDLE_RUNTIME, 'bin', 'node');
}

function findPortableNodeExe(rootDir = NODE_LOCAL_DIR) {
  if (!rootDir || !fs.existsSync(rootDir)) return null;
  const direct = IS_WIN
    ? path.join(rootDir, 'node.exe')
    : path.join(rootDir, 'bin', 'node');
  if (fs.existsSync(direct)) return direct;
  if (!IS_WIN) {
    const alt = path.join(rootDir, 'node');
    if (fs.existsSync(alt)) return alt;
  }
  try {
    for (const name of fs.readdirSync(rootDir)) {
      const nested = IS_WIN
        ? path.join(rootDir, name, 'node.exe')
        : path.join(rootDir, name, 'bin', 'node');
      if (fs.existsSync(nested)) return nested;
    }
  } catch (_) {}
  return null;
}

function resolvePortableNodeBin() {
  return findPortableNodeExe(NODE_LOCAL_DIR);
}

function nodeCheckEnv() {
  const env = { ...process.env };
  if (fs.existsSync(NODE_LOCAL_DIR)) {
    env.PATH = `${NODE_LOCAL_DIR}${PATH_SEP}${env.PATH || ''}`;
  }
  return env;
}

function verifyNodeBinary(bin) {
  if (!bin || !fs.existsSync(bin)) return null;
  try {
    return execSync(`"${bin}" --version`, {
      encoding: 'utf8',
      timeout: 15000,
      env: nodeCheckEnv(),
      windowsHide: true,
    }).trim();
  } catch (err) {
    writeLog('backend', `[node] verify failed for ${bin}: ${err.message}\n`);
    return null;
  }
}

/** Download a file via HTTPS, following redirects, with optional progress callback */
function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const https = require('https');
    const http  = require('http');
    const tmpPath = `${destPath}.part`;
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}

    const finishOk = () => {
      try {
        if (!fs.existsSync(tmpPath)) {
          reject(new Error(`Download produced no file: ${url}`));
          return;
        }
        const size = fs.statSync(tmpPath).size;
        if (size < 1024) {
          fs.unlinkSync(tmpPath);
          reject(new Error(`Download incomplete (${size} bytes): ${url}`));
          return;
        }
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        fs.renameSync(tmpPath, destPath);
        resolve();
      } catch (err) {
        reject(err);
      }
    };

    const fail = (err) => {
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
      reject(err);
    };

    const doGet = (reqUrl, redirectsLeft = 8) => {
      if (redirectsLeft <= 0) return fail(new Error(`Too many redirects for ${url}`));

      const client = reqUrl.startsWith('https') ? https : http;
      const req = client.get(reqUrl, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          res.resume();
          const location = res.headers.location;
          if (!location) {
            return fail(new Error(`Redirect without location (HTTP ${res.statusCode})`));
          }
          const nextUrl = location.startsWith('http') ? location : new URL(location, reqUrl).href;
          return doGet(nextUrl, redirectsLeft - 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return fail(new Error(`Download failed: HTTP ${res.statusCode} for ${reqUrl}`));
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let received = 0;
        const file = fs.createWriteStream(tmpPath);
        res.on('data', chunk => {
          received += chunk.length;
          if (onProgress && total) onProgress(Math.round(received / total * 100));
        });
        res.pipe(file);
        file.on('finish', () => file.close(finishOk));
        file.on('error', fail);
        res.on('error', fail);
      });
      req.on('error', fail);
      req.setTimeout(10 * 60 * 1000, () => {
        req.destroy(new Error(`Download timed out: ${reqUrl}`));
      });
    };
    doGet(url);
  });
}

function spawnCli(bin, args, opts) {
  if (isWindowsCmdScript(bin)) {
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', bin, ...args], opts);
  }
  return spawn(bin, args, opts);
}

/** Run a command and return a promise; optional onLine callback for stdout lines */
function runCommand(bin, args, opts = {}, onLine) {
  return new Promise((resolve, reject) => {
    const isVenvPython = bin === PYTHON_BIN
      || String(bin).includes(path.join('venv', IS_WIN ? 'Scripts' : 'bin'));
    const baseEnv = isVenvPython ? envForVenv() : buildEnv();
    const env = { ...baseEnv, ...(opts.env || {}) };
    const proc = spawnCli(bin, args, {
      cwd:   opts.cwd || APP_DATA,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let timer;
    if (opts.timeout) {
      timer = setTimeout(() => {
        try { proc.kill(); } catch (_) {}
        reject(new Error(`Command timed out after ${Math.round(opts.timeout / 1000)}s`));
      }, opts.timeout);
    }
    proc.stdout.on('data', d => {
      const t = d.toString();
      if (onLine) onLine(t.trim());
    });
    let stderr = '';
    proc.stderr.on('data', d => {
      const t = d.toString();
      stderr += t;
      // Forward stderr lines to onLine when requested (e.g. playwright download progress)
      if (onLine && opts.streamStderr) {
        for (const line of t.split('\n')) {
          const l = line.trim();
          if (l) onLine(l);
        }
      }
    });
    proc.on('close', code => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.slice(-400) || `exit code ${code}`));
    });
    proc.on('error', err => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}

// ─── Tray ────────────────────────────────────────────────────────────────────

/** Load a menu-bar icon; falls back to app .icns if tray PNG missing. */
function loadTrayImage(name) {
  const iconsDir = path.join(RESOURCES, 'icons');
  for (const file of [`${name}.png`, 'icon_512.png']) {
    const p = path.join(iconsDir, file);
    if (!fs.existsSync(p)) continue;
    const img = nativeImage.createFromPath(p);
    if (!img.isEmpty()) {
      const size = img.getSize();
      if (size.width > 22 || size.height > 22) {
        return img.resize({ width: 22, height: 22 });
      }
      return img;
    }
  }
  const icns = path.join(process.resourcesPath, 'icon.icns');
  if (fs.existsSync(icns)) {
    const img = nativeImage.createFromPath(icns);
    if (!img.isEmpty()) return img.resize({ width: 22, height: 22 });
  }
  return nativeImage.createEmpty();
}

function overallStatus() {
  const ss = Object.values(SERVICES).map(s => s.status);
  if (ss.every(s => s === 'running'))   return 'running';
  if (ss.some(s => s === 'starting'))   return 'starting';
  if (ss.some(s => s === 'running'))    return 'partial';
  if (ss.some(s => s === 'error'))      return 'error';
  return 'stopped';
}

function updateTray() {
  if (!tray) return;
  const st   = overallStatus();
  const name = {
    running: 'tray-green', starting: 'tray-yellow',
    partial: 'tray-yellow', error: 'tray-red', stopped: 'tray-red',
  }[st] || 'tray-red';

  const icon = loadTrayImage(name);
  if (!icon.isEmpty()) tray.setImage(icon);
  tray.setToolTip(`AI Media Agent · ${st}`);
  tray.setContextMenu(buildTrayMenu(st));
}

function isPidAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return !!(err && err.code === 'EPERM');
  }
}

function isDesktopPetProcessRunning() {
  try {
    if (IS_WIN) {
      if (desktopPetProc?.pid && isPidAlive(desktopPetProc.pid)) return true;
      const queries = [
        'tasklist /FI "IMAGENAME eq ai-media-agent-desktop-pet.exe" /NH',
        'tasklist /FI "IMAGENAME eq AI-Media-Agent-Desktop-Pet.exe" /NH',
      ];
      for (const cmd of queries) {
        try {
          const out = execSync(cmd, { encoding: 'utf8', timeout: 5000 });
          if (/ai-media-agent-desktop-pet\.exe/i.test(out)) return true;
        } catch (_) {
          /* try next query */
        }
      }
      return false;
    }
    execSync('pgrep -f ai-media-agent-desktop-pet', { stdio: 'ignore', timeout: 3000 });
    return true;
  } catch (_) {
    return false;
  }
}

function isDesktopPetDevRunning() {
  try {
    if (process.platform === 'win32') {
      const out = execSync('netstat -ano | findstr :1420', { encoding: 'utf8', timeout: 3000 });
      return out.includes(':1420');
    }
    execSync('lsof -ti:1420', { stdio: 'ignore', timeout: 3000 });
    return true;
  } catch (_) {
    return false;
  }
}

function isDesktopPetRunning() {
  return isDesktopPetProcessRunning() || isDesktopPetDevRunning();
}

function setDesktopPetStatus(status, lastError = '') {
  SERVICES.desktopPet.status = status;
  SERVICES.desktopPet.lastError = lastError || '';
  broadcastStatus();
}

function bundledDesktopPetSourceDir() {
  const bundled = bundledDesktopPetBinary();
  return bundled ? path.dirname(bundled) : null;
}

function ensureDesktopPetRuntime() {
  const srcDir = bundledDesktopPetSourceDir();
  if (!srcDir) return null;

  const exe = path.join(srcDir, 'ai-media-agent-desktop-pet.exe');
  const dll = path.join(srcDir, 'WebView2Loader.dll');
  if (!fs.existsSync(exe)) return null;
  if (IS_WIN && !fs.existsSync(dll)) {
    writeLog('backend', '[desktop-pet] missing WebView2Loader.dll beside bundled exe\n');
  }
  // APP_DATA only holds config.json + open-console.signal — no exe copy on first launch.
  fs.mkdirSync(DESKTOP_PET_DIR, { recursive: true });
  return exe;
}

function waitForDesktopPetRunning(timeoutMs = 20000, pid = null) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (isDesktopPetProcessRunning() || (pid && isPidAlive(pid))) {
        resolve({ ok: true });
        return;
      }
      if (
        !IS_WIN &&
        desktopPetProc &&
        desktopPetProc.exitCode != null &&
        Date.now() > desktopPetLaunchGraceUntil
      ) {
        resolve({ ok: false, error: `exit_${desktopPetProc.exitCode}` });
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        if (pid && isPidAlive(pid)) {
          resolve({ ok: true });
          return;
        }
        if (isDesktopPetProcessRunning()) {
          resolve({ ok: true });
          return;
        }
        resolve({ ok: false, error: 'timeout' });
        return;
      }
      setTimeout(tick, 400);
    };
    tick();
  });
}

function syncDesktopPetStatus() {
  if (isDesktopPetRunning()) {
    setDesktopPetStatus('running');
  }
  startDesktopPetMonitor();
}

function startDesktopPetMonitor() {
  if (desktopPetMonitorTimer) return;
  desktopPetMonitorTimer = setInterval(() => {
    const running = isDesktopPetProcessRunning();
    if (running) {
      if (SERVICES.desktopPet.status !== 'running') {
        setDesktopPetStatus('running');
      }
      return;
    }
    if (SERVICES.desktopPet.status === 'running') {
      setDesktopPetStatus('stopped');
    } else if (
      SERVICES.desktopPet.status === 'starting' &&
      Date.now() > desktopPetLaunchGraceUntil + 30000
    ) {
      setDesktopPetStatus('error', '桌宠未检测到运行，请查看 desktop-pet.log');
    }
  }, 4000);
}

function spawnDesktopPetExe(runtimeExe, launchDir, petLog) {
  const logFd = fs.openSync(petLog, 'a');
  desktopPetLaunchGraceUntil = Date.now() + 10000;
  desktopPetProc = spawn(runtimeExe, [], {
    cwd: launchDir,
    env: {
      ...process.env,
      AI_MEDIA_AGENT_APP_DATA: APP_DATA,
      AI_MEDIA_AGENT_BACKEND_URL: `http://127.0.0.1:${SERVICES.backend.port || 8000}`,
      AI_MEDIA_AGENT_CONSOLE_URL: `http://127.0.0.1:${SERVICES.frontend.port || 3000}/companion`,
      VITE_BACKEND_URL: `http://127.0.0.1:${SERVICES.backend.port || 8000}`,
      VITE_CONSOLE_URL: `http://127.0.0.1:${SERVICES.frontend.port || 3000}/companion`,
    },
    detached: true,
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
  });

  desktopPetProc.on('error', (err) => {
    setDesktopPetStatus('error', err.message);
  });

  desktopPetProc.on('exit', (code) => {
    if (Date.now() < desktopPetLaunchGraceUntil) {
      if (isDesktopPetProcessRunning() || isPidAlive(desktopPetProc?.pid)) {
        setDesktopPetStatus('running');
        return;
      }
    }
    if (IS_WIN && SERVICES.desktopPet.status === 'starting') {
      if (isDesktopPetProcessRunning()) {
        setDesktopPetStatus('running');
      }
      desktopPetProc = null;
      return;
    }
    if (SERVICES.desktopPet.status === 'running') {
      setDesktopPetStatus('stopped');
    } else if (SERVICES.desktopPet.status === 'starting' && !isDesktopPetProcessRunning()) {
      setDesktopPetStatus('error', `进程已退出 (${code ?? 'unknown'})`);
    }
    desktopPetProc = null;
  });

  desktopPetProc.unref();
  return desktopPetProc.pid;
}

async function finalizeDesktopPetLaunch(runtimeExe, petLog, pid = null) {
  startDesktopPetMonitor();
  const check = await waitForDesktopPetRunning(20000, pid);
  if (check.ok || (pid && isPidAlive(pid))) {
    setDesktopPetStatus('running');
    return {
      ok: true,
      mode: 'exe',
      path: runtimeExe,
      pid: pid || desktopPetProc?.pid,
      log: petLog,
      message: '桌宠已启动',
    };
  }

  // openPath / spawn succeeded but slow WebView2 cold start — stay optimistic
  setDesktopPetStatus('starting', '桌宠正在加载…');
  return {
    ok: true,
    mode: 'launching',
    path: runtimeExe,
    pid,
    log: petLog,
    message: '桌宠正在启动，请稍候…',
  };
}

function desktopPetProjectDir() {
  const candidates = [];
  const appPath = safeAppPath();

  if (IS_DEV) {
    // 开发模式：优先相对于 main.js 所在目录，再尝试若干常见位置
    candidates.push(
      path.join(__dirname, '..', 'desktop-pet'),
      path.join(process.env.ORIGINAL_PROJECT_DIR || '', 'desktop-pet'),
      path.join(process.cwd(), 'desktop-pet'),
      appPath ? path.join(appPath, '..', 'desktop-pet') : '',
      appPath ? path.join(appPath, 'desktop-pet') : ''
    );
  } else {
    // 生产模式：优先打包资源目录；也允许在 .app 旁边保留源码目录（便于测试）
    candidates.push(
      path.join(process.resourcesPath, 'desktop-pet'),
      appPath ? path.join(appPath, '..', '..', '..', 'desktop-pet') : '', // .app/Contents/Resources/app.asar -> .app 同级
      appPath ? path.join(appPath, '..', 'desktop-pet') : ''             // Resources/ 同级
    );
  }

  for (const dir of candidates) {
    if (dir && fs.existsSync(path.join(dir, 'package.json'))) return dir;
  }
  return null;
}

function safeAppPath() {
  try {
    return app.getAppPath();
  } catch (_) {
    return '';
  }
}

function bundledDesktopPetBinary() {
  const candidates = [];
  if (process.platform === 'darwin') {
    candidates.push(
      path.join(RESOURCES, 'desktop-pet', 'AI Media Agent Pet.app'),
      path.join(process.resourcesPath, 'desktop-pet', 'AI Media Agent Pet.app'),
      path.join(process.resourcesPath, 'AI Media Agent Pet.app'),
    );
  } else if (IS_WIN) {
    candidates.push(
      path.join(RESOURCES, 'desktop-pet', 'ai-media-agent-desktop-pet.exe'),
      path.join(process.resourcesPath, 'desktop-pet', 'ai-media-agent-desktop-pet.exe'),
      path.join(process.resourcesPath, 'resources', 'desktop-pet', 'ai-media-agent-desktop-pet.exe'),
    );
  }
  for (const binPath of candidates) {
    if (binPath && fs.existsSync(binPath)) return binPath;
  }
  return null;
}

function writeDesktopPetConfig() {
  try {
    fs.mkdirSync(DESKTOP_PET_DIR, { recursive: true });
    const config = {
      backendUrl: `http://127.0.0.1:${SERVICES.backend.port || 8000}`,
      consoleUrl: `http://127.0.0.1:${SERVICES.frontend.port || 3000}/companion`,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(DESKTOP_PET_DIR, 'config.json'), JSON.stringify(config, null, 2));
  } catch (err) {
    writeLog('backend', `[desktop-pet] config write failed: ${err.message}\n`);
  }
}

function launchBundledDesktopPet(bundledPath) {
  writeDesktopPetConfig();
  const petLog = path.join(LOGS_DIR, 'desktop-pet.log');
  try { fs.mkdirSync(LOGS_DIR, { recursive: true }); } catch (_) {}

  const runtimeExe = ensureDesktopPetRuntime() || bundledPath;
  const launchDir = path.dirname(runtimeExe);
  const stamp = new Date().toISOString();
  fs.appendFileSync(petLog, `\n[${stamp}] launch ${runtimeExe}\n`);

  if (IS_WIN && runtimeExe.toLowerCase().endsWith('.exe')) {
    setDesktopPetStatus('starting');

    return (async () => {
      try {
        const pid = spawnDesktopPetExe(runtimeExe, launchDir, petLog);
        return finalizeDesktopPetLaunch(runtimeExe, petLog, pid);
      } catch (spawnErr) {
        writeLog('backend', `[desktop-pet] spawn failed, trying shell.openPath: ${spawnErr.message}\n`);
      }

      const openErr = await shell.openPath(runtimeExe);
      if (openErr) {
        setDesktopPetStatus('error', openErr);
        return { ok: false, error: openErr, log: petLog };
      }
      return finalizeDesktopPetLaunch(runtimeExe, petLog, null);
    })();
  }

  return shell.openPath(runtimeExe).then((err) => {
    if (err) {
      setDesktopPetStatus('error', err);
      return { ok: false, error: err };
    }
    setDesktopPetStatus('running');
    return { ok: true, mode: 'app', path: runtimeExe };
  });
}

async function launchDesktopPet() {
  if (isDesktopPetRunning() || (desktopPetProc && desktopPetProc.exitCode == null && !desktopPetProc.killed)) {
    setDesktopPetStatus('running');
    return { ok: true, mode: 'already_running' };
  }

  const bundledBinary = bundledDesktopPetBinary();
  const backendUp = SERVICES.backend.status === 'running' || SERVICES.backend.status === 'partial';

  if (bundledBinary) {
    if (!backendUp) {
      await dialog.showMessageBox({
        type: 'warning',
        title: '启动桌宠',
        message: 'Backend 尚未就绪',
        detail: '请先等待 AI Media Agent 服务启动完成，再启动桌宠。',
      });
      return { ok: false, error: 'backend_down' };
    }
    return launchBundledDesktopPet(bundledBinary);
  }

  if (!backendUp) {
    await dialog.showMessageBox({
      type: 'warning',
      title: '启动桌宠',
      message: 'Backend 尚未就绪',
      detail: '请先等待 AI Media Agent 服务启动完成，再启动桌宠。',
    });
    return { ok: false, error: 'backend_down' };
  }

  const petDir = desktopPetProjectDir();
  if (!petDir) {
    await dialog.showMessageBox({
      type: 'info',
      title: '启动桌宠',
      message: '未找到桌宠应用',
      detail: '开发环境请确保项目根目录存在 desktop-pet/，或运行 ./start_local.sh。\n打包版需将桌宠放入 resources/desktop-pet/（macOS: AI Media Agent Pet.app · Windows: ai-media-agent-desktop-pet.exe）。',
    });
    return { ok: false, error: 'not_found' };
  }

  const backendPort = SERVICES.backend.port || 8000;
  const frontendPort = SERVICES.frontend.port || 3000;
  const petLog = path.join(LOGS_DIR, 'desktop-pet.log');
  try { fs.mkdirSync(LOGS_DIR, { recursive: true }); } catch (_) {}
  const logFd = fs.openSync(petLog, 'a');

  const npm = IS_WIN ? 'npm.cmd' : 'npm';
  desktopPetProc = spawn(npm, ['run', 'tauri:dev'], {
    cwd: petDir,
    env: {
      ...process.env,
      VITE_BACKEND_URL: `http://127.0.0.1:${backendPort}`,
      VITE_CONSOLE_URL: `http://127.0.0.1:${frontendPort}/companion`,
    },
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  desktopPetProc.unref();

  return { ok: true, mode: 'dev', pid: desktopPetProc.pid, log: petLog };
}

function buildTrayMenu(st) {
  const running = st === 'running' || st === 'partial';
  return Menu.buildFromTemplate([
    { label: 'AI Media Agent', enabled: false },
    { type: 'separator' },
    {
      label:   '⚡  Open Dashboard',
      click:   () => openDashboard(),
      enabled: SERVICES.frontend.status === 'running',
    },
    {
      label:   '🐾  启动桌宠 (Boni)',
      click:   () => { launchDesktopPet().catch(() => {}); },
      enabled: SERVICES.backend.status === 'running' || SERVICES.backend.status === 'partial',
    },
    { label: '📊  Service Status', click: showStatusWindow },
    { type: 'separator' },
    {
      label: running ? '⟳  Restart Services' : '▶  Start Services',
      click: running ? restartServices : startAllServices,
    },
    {
      label:   '⏹  Stop Services',
      click:   stopAllServices,
      enabled: running,
    },
    { type: 'separator' },
    { label: '⚙️  Edit Config (.env)', click: () => shell.openPath(ENV_FILE) },
    { label: '📋  Open Logs Folder',   click: () => shell.openPath(LOGS_DIR) },
    { type: 'separator' },
    { label: 'Quit', click: quitApp },
  ]);
}

// ─── Status Window ───────────────────────────────────────────────────────────

function rendererWebPreferences() {
  return {
    preload:          path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration:  false,
  };
}

function appIconPath() {
  const ico = path.join(process.resourcesPath, 'resources', 'icons', 'icon.ico');
  const icns = path.join(process.resourcesPath, 'resources', 'icons', 'icon.icns');
  if (IS_WIN && fs.existsSync(ico)) return ico;
  if (!IS_WIN && fs.existsSync(icns)) return icns;
  return undefined;
}

function darkTitleBarOverlay() {
  return {
    color:       '#0f0f1a',
    symbolColor: '#cbd5e1',
    height:      38,
  };
}

function rendererWindowOptions({ width, height, title, resizable = false }) {
  const base = {
    width,
    height,
    resizable,
    title,
    show: false,
    backgroundColor: '#0f0f1a',
    icon: appIconPath(),
    webPreferences: rendererWebPreferences(),
  };
  if (IS_WIN) {
    return {
      ...base,
      titleBarStyle: 'hidden',
      titleBarOverlay: darkTitleBarOverlay(),
      autoHideMenuBar: true,
    };
  }
  return {
    ...base,
    titleBarStyle: 'hiddenInset',
    vibrancy:      'under-window',
  };
}

function loadRendererPage(win, htmlFile) {
  win.loadFile(path.join(__dirname, 'renderer', htmlFile));
}

function sendStartupProgress(msg, detail = '', step = '') {
  writeLog('backend', `[startup] ${msg}${detail ? ` — ${detail}` : ''}\n`);
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('startup-progress', { msg, detail, step });
  }
}

function showSplashWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.show();
    splashWindow.focus();
    return;
  }
  splashWindow = new BrowserWindow({
    width: 400,
    height: 320,
    resizable: false,
    frame: false,
    center: true,
    show: false,
    backgroundColor: '#0f0f1a',
    icon: appIconPath(),
    webPreferences: rendererWebPreferences(),
  });
  loadRendererPage(splashWindow, 'splash.html');
  splashWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.show();
      splashWindow.focus();
    }
  });
  splashWindow.on('closed', () => { splashWindow = null; });
}

function closeSplashWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
  splashWindow = null;
}

function dashboardUrl(pathSuffix = '/') {
  const p = pathSuffix && pathSuffix.startsWith('/') ? pathSuffix : `/${pathSuffix || ''}`;
  return `http://127.0.0.1:${SERVICES.frontend.port || 3000}${p}`;
}

function dashboardWindowNeedsReload(url) {
  if (!dashboardWindow || dashboardWindow.isDestroyed()) return true;
  try {
    const current = dashboardWindow.webContents.getURL();
    if (!current || current === 'about:blank') return true;
    return new URL(current).origin !== new URL(url).origin;
  } catch {
    return true;
  }
}

function dashboardOnPath(targetPath) {
  if (!dashboardWindow || dashboardWindow.isDestroyed()) return false;
  try {
    const current = new URL(dashboardWindow.webContents.getURL());
    return current.pathname === targetPath || current.pathname.startsWith(targetPath);
  } catch {
    return false;
  }
}

function openDashboardWindow({ reload = false, path = '/' } = {}) {
  const url = dashboardUrl(path);
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    // Never reload on every health poll — that wipes in-progress chat input.
    // Reload only when forced, origin changed, or we need a different page.
    if (reload || dashboardWindowNeedsReload(url) || !dashboardOnPath(path)) {
      dashboardWindow.loadURL(url).catch(() => {});
    }
    dashboardWindow.show();
    dashboardWindow.focus();
    return;
  }
  dashboardWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    title: 'AI Media Agent',
    backgroundColor: '#0f0f1a',
    icon: appIconPath(),
    autoHideMenuBar: true,
    // 标准标题栏：避免 titleBarOverlay 盖住页面右上角按钮（对话设置等）
    ...(IS_WIN || process.platform === 'darwin' ? { frame: true } : {}),
    webPreferences: rendererWebPreferences(),
  });
  dashboardWindow.loadURL(url);
  dashboardWindow.once('ready-to-show', () => {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      dashboardWindow.show();
      dashboardWindow.focus();
    }
  });
  dashboardWindow.on('closed', () => { dashboardWindow = null; });
}

function openDashboard() {
  openDashboardWindow();
}

let desktopPetConsoleWatcher = null;
function startDesktopPetConsoleWatcher() {
  if (desktopPetConsoleWatcher) return;
  const signal = path.join(DESKTOP_PET_DIR, 'open-console.signal');
  desktopPetConsoleWatcher = setInterval(() => {
    let exists = false;
    try { exists = fs.existsSync(signal); } catch { exists = false; }
    if (!exists) return;

    let targetPath = '/companion';
    try {
      const obj = JSON.parse(fs.readFileSync(signal, 'utf8'));
      if (obj && typeof obj.path === 'string' && obj.path.startsWith('/')) {
        targetPath = obj.path;
      }
    } catch (_) {
      /* malformed signal — fall back to /companion */
    }
    try { fs.unlinkSync(signal); } catch (_) {}

    openDashboardWindow({ path: targetPath });
  }, 1000);
}

function scheduleOpenDashboard(delayMs = 0) {
  if (dashboardOpenScheduled) return;
  dashboardOpenScheduled = true;
  setTimeout(() => {
    dashboardOpenScheduled = false;
    if (SERVICES.frontend.status === 'running') openDashboard();
  }, delayMs);
}

function scheduleShowStatusWindow(delayMs = 0) {
  setTimeout(() => {
    if (statusWindow && !statusWindow.isDestroyed()) {
      statusWindow.show();
      statusWindow.focus();
      return;
    }
    showStatusWindow();
  }, delayMs);
}

function maybeAutoOpenDashboard(key) {
  if (key !== 'frontend') return;
  if (SERVICES.frontend.status !== 'running') return;
  if (dashboardAutoOpened) return;
  dashboardAutoOpened = true;
  sendStartupProgress('控制台已就绪', '正在打开界面…', 'ready');
  closeSplashWindow();
  openDashboardWindow();
  if (statusWindow && !statusWindow.isDestroyed()) statusWindow.hide();
}

function showStatusWindow() {
  if (statusWindow && !statusWindow.isDestroyed()) {
    statusWindow.show();
    statusWindow.focus();
    return;
  }
  if (app.dock) app.dock.show();
  statusWindow = new BrowserWindow(rendererWindowOptions({
    width: 520,
    height: 500,
    title: 'AI Media Agent',
  }));
  loadRendererPage(statusWindow, 'status.html');
  statusWindow.on('closed', () => { statusWindow = null; });
}

function broadcastStatus() {
  const data = Object.fromEntries(
    Object.entries(SERVICES).map(([k, s]) => [
      k, { name: s.name, status: s.status, port: s.port, lastError: s.lastError || '' },
    ])
  );
  if (statusWindow && !statusWindow.isDestroyed()) {
    statusWindow.webContents.send('status-update', data);
  }
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.webContents.send('status-update', data);
  }
  updateTray();
}

// ─── First-Run Setup ─────────────────────────────────────────────────────────

function showSetupWindow(onComplete, initialPhase = 'welcome') {
  wizardOnComplete = onComplete || null;
  setupUiReady = false;
  setupProgressQueue = [];
  setupInstallPending = initialPhase === 'install';
  if (app.dock) app.dock.show();
  setupWindow = new BrowserWindow(rendererWindowOptions({
    width: 560,
    height: 640,
    title: 'AI Media Agent – 安装向导',
  }));
  loadRendererPage(setupWindow, 'setup.html');
  setupWindow.once('ready-to-show', () => {
    setupWindow.show();
    setupWindow.focus();
    app.focus({ steal: true });
  });
  setupWindow.webContents.on('did-finish-load', () => {
    setupWindow.webContents.send('setup-phase', { phase: initialPhase });
  });
  setupWindow.on('closed', () => {
    setupWindow = null;
    setupUiReady = false;
    setupProgressQueue = [];
    setupInstallPending = false;
  });
}

function flushSetupProgressQueue() {
  if (!setupWindow || setupWindow.isDestroyed()) return;
  for (const payload of setupProgressQueue) {
    setupWindow.webContents.send('setup-progress', payload);
  }
  setupProgressQueue = [];
}

function sendProgress(pct, msg, detail = '', step = '') {
  const stepLabel = SETUP_STEP_LABELS[step] || step || '';
  const payload = {
    pct,
    msg,
    detail,
    step,
    stepLabel,
    logPath: INSTALL_LOG_FILE,
  };
  if (installLoggingActive) {
    appendInstallLog(step, pct, msg, detail);
    payload.logLine = formatInstallLogLine(step, pct, msg, detail);
  }
  if (!setupUiReady) {
    setupProgressQueue.push(payload);
    return;
  }
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.webContents.send('setup-progress', payload);
  }
}

/** Merge parallel install tracks into one setup progress bar. */
function createParallelSetupProgress(tracks) {
  const state = Object.create(null);
  return (trackId, pct, msg, detail = '') => {
    state[trackId] = {
      pct: Math.max(0, Math.min(100, Number(pct) || 0)),
      msg: msg || '',
      detail: detail || '',
    };
    let overall = 0;
    for (const t of tracks) {
      const s = state[t.id] || { pct: 0, msg: '', detail: '' };
      overall += t.base + (s.pct / 100) * t.span;
    }
    const current = state[trackId] || { msg: '', detail: '' };
    const trackLabel = SETUP_STEP_LABELS[trackId] || trackId;
    sendProgress(
      Math.min(98, Math.round(overall)),
      current.msg || `${trackLabel}…`,
      current.detail,
      trackId,
    );
  };
}

async function setupPythonPrepTrack(onProgress) {
  const python3 = await resolvePythonForSetup(onProgress);
  const pythonVer = getPythonVersionSync(python3);
  if (!pythonVersionOk(pythonVer)) {
    throw new Error(
      `Python ${pythonVer || '(unknown)'} 不可用，需要 3.10+\n路径: ${python3}`
    );
  }
  await ensurePythonVenv(python3, onProgress);
  return python3;
}

async function setupNodeTrack(onProgress) {
  onProgress(0, '检测 Node.js 运行时…');
  const nodeBin = await ensureNodeRuntime(onProgress);
  if (!nodeBin || !isNodeRuntimeReady()) {
    throw new Error(
      'Node.js 安装失败，前端无法启动。\n\n'
      + '请确认安装包包含 resources/node/runtime，或检查网络后重试。'
    );
  }
  onProgress(85, 'Node.js 就绪 ✓', nodeBin);
  try {
    await ensureLarkCli(onProgress, nodeBin);
    onProgress(100, 'lark-cli 就绪 ✓', LARK_CLI_DIR);
  } catch (err) {
    writeLog('backend', `[lark-cli] install failed: ${err.message}\n`);
    onProgress(100, 'lark-cli 安装未完成', '飞书功能可能不可用，启动后会自动重试');
  }
  return nodeBin;
}

async function maybeStartPendingSetup() {
  if (!setupInstallPending || !setupUiReady) return;
  setupInstallPending = false;
  await runSetup();
}

async function runSetup(onComplete) {
  if (runSetupInFlight) return runSetupInFlight;

  runSetupInFlight = (async () => {
  beginInstallLogSession();
  try {
    sendProgress(0, '安装向导启动', INSTALL_LOG_FILE, 'init');
    // 0. Stop services and auto-clean broken / stale venv & portable Python
    await stopServicesBeforeInstall();
    await autoCleanupBeforeInstall((p, m, d) => sendProgress(p, m, d, 'cleanup'));

    // 1. Ensure directories exist
    ensureDirs();
    sendProgress(5, '准备目录…', APP_DATA, 'dirs');

    // 2–9. Parallel install: sync + Python prep + pip ∥ Node/lark-cli
    sendProgress(8, '正在并行准备环境…', '应用文件、Python 与 Node.js 同时进行', 'parallel');

    const installProgress = createParallelSetupProgress([
      { id: 'sync', base: 8, span: 10 },
      { id: 'pyPrep', base: 8, span: 12 },
      { id: 'pip', base: 20, span: 72 },
      { id: 'node', base: 20, span: 72 },
    ]);

    const nodeTask = setupNodeTrack((p, m, d) => installProgress('node', p, m, d));

    const [, python3] = await Promise.all([
      syncAppResources((p, m, d) => installProgress('sync', p, m, d)),
      setupPythonPrepTrack((p, m, d) => installProgress('pyPrep', p, m, d)),
    ]);

    mergeBundledEnvDefaults();
    ensureMealPublicWebBaseUrl();
    sendProgress(78, '合并环境变量默认值…', ENV_FILE, 'env');

    if (!fs.existsSync(ENV_FILE)) {
      const src = path.join(BACKEND_DATA, '.env.example');
      const tpl = fs.existsSync(src)
        ? fs.readFileSync(src, 'utf8')
        : '# AI Media Agent Configuration\n# Set at least one LLM provider key:\n\nLLM_PROVIDER=zhipu\nZHIPUAI_API_KEY=\n';
      fs.writeFileSync(ENV_FILE, tpl);
    }

    await Promise.all([
      installPythonDependencies(
        (p, m, d) => installProgress('pip', p, m, d),
        python3,
      ),
      nodeTask,
    ]);

    // Mark install as done
    sendProgress(98, '收尾中…', SETUP_DONE_FILE, 'finish');
    fs.writeFileSync(VERSION_FILE, APP_VERSION);
    fs.writeFileSync(SETUP_DONE_FILE, new Date().toISOString());

    sendProgress(100, '环境安装完成！', '', 'finish');
    endInstallLogSession(true);
    if (hasApiKeyConfigured()) {
      sendSetupPhase('done');
      setTimeout(() => finishWizard({ openDashboard: true }), 1200);
    } else {
      sendSetupPhase('config');
    }
    if (onComplete) onComplete();
  } catch (err) {
    appendInstallLog('error', -1, err.message, err.stack ? String(err.stack).split('\n')[0] : '');
    endInstallLogSession(false, err.message);
    sendProgress(-1, `安装失败：${err.message}`, INSTALL_LOG_FILE, 'error');
    dialog.showErrorBox('安装失败', `${err.message}\n\n详细日志：${INSTALL_LOG_FILE}`);
  }
  })();

  try {
    return await runSetupInFlight;
  } finally {
    runSetupInFlight = null;
  }
}

// ─── Service Management ──────────────────────────────────────────────────────

function isBenignServiceLog(line) {
  const s = String(line || '').trim();
  if (!s) return true;
  if (/Scheduler (service )?stopped/i.test(s)) return true;
  if (/Scheduler stopped on app shutdown/i.test(s)) return true;
  if (/\bINFO\b.*Scheduler/i.test(s)) return true;
  if (/Started server process/i.test(s)) return true;
  if (/Waiting for application startup/i.test(s)) return true;
  if (/Application startup complete/i.test(s)) return true;
  if (/Uvicorn running on/i.test(s)) return true;
  if (/Shutting down/i.test(s)) return true;
  if (/Finished server process/i.test(s)) return true;
  // Python app logs (uvicorn --log-level warning does not suppress app loggers)
  if (/ - INFO - /i.test(s)) return true;
  if (/ - DEBUG - /i.test(s)) return true;
  if (/\[mcp-managed\]/i.test(s)) return true;
  if (/KuaishouConnector source:/i.test(s)) return true;
  if (/Scheduler started on app startup/i.test(s)) return true;
  if (/Initializing platform connectors/i.test(s)) return true;
  if (/Multi-agent graph pre-warmed/i.test(s)) return true;
  if (/Graph pre-warm skipped/i.test(s)) return true;
  if (/Meal reminder schedule skipped/i.test(s)) return true;
  if (/Session DB init skipped/i.test(s)) return true;
  if (/端口冲突，已切换到/i.test(s)) return true;
  return false;
}

function isServiceErrorLog(line) {
  const s = String(line || '').trim();
  if (!s || isBenignServiceLog(s)) return false;
  if (/Traceback \(most recent call last\)/i.test(s)) return true;
  if (/\b(ERROR|CRITICAL)\b/.test(s)) return true;
  if (/ModuleNotFoundError|ImportError|SyntaxError|IndentationError|PermissionError/i.test(s)) return true;
  if (/Exception:|RuntimeError:|Fatal error|Process error:/i.test(s)) return true;
  if (/error while attempting to bind|10013|10048|EADDRINUSE|Health check failed/i.test(s)) return true;
  if (/无法绑定 Backend 端口/i.test(s)) return true;
  return false;
}

function summarizeServiceStderr(stderrText) {
  const lines = String(stderrText || '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !isBenignServiceLog(l));
  const errorLines = lines.filter(isServiceErrorLog);
  const pool = errorLines.length ? errorLines : lines;
  if (!pool.length) return '';
  return pool.slice(-2).join(' | ').slice(0, 120);
}

function killServiceProcess(proc) {
  if (!proc || !proc.pid) return Promise.resolve();
  const pid = proc.pid;
  if (IS_WIN) {
    const { exec } = require('child_process');
    return new Promise(resolve => {
      exec(`taskkill /F /PID ${pid} /T`, () => resolve());
    });
  }
  try { proc.kill('SIGTERM'); } catch (_) {}
  return new Promise(resolve => {
    setTimeout(() => {
      try { process.kill(pid, 'SIGKILL'); } catch (_) {}
      resolve();
    }, 500);
  });
}

function spawnService(key, bin, args, opts = {}) {
  const svc = SERVICES[key];
  // Kill any existing process
  if (svc.proc) {
    killServiceProcess(svc.proc);
    svc.proc = null;
  }

  if (!bin || !fs.existsSync(bin)) {
    svc.status = 'error';
    svc.lastError = 'Python 环境未就绪，正在自动修复…';
    writeLog(key, `Executable not found: ${bin || '(empty)'}\n`);
    broadcastStatus();
    repairPythonRuntimeSilently().then(ok => {
      if (ok) restartServices();
      else if (!setupWindow || setupWindow.isDestroyed()) {
        showSetupWindow(null, 'install');
      }
    });
    return null;
  }

  svc.status = 'starting';
  svc.lastError = '';
  broadcastStatus();
  if (key === 'backend') sendStartupProgress('正在启动 Backend…', `端口 ${svc.port}`, 'backend');
  if (key === 'frontend') sendStartupProgress('正在启动 Frontend…', '加载控制台界面', 'frontend');
  if (key === 'tunnel') sendStartupProgress('正在连接 Cloudflare Tunnel…', 'tech-huhao.tech', 'tunnel');

  const venvDir = path.join('venv', IS_WIN ? 'Scripts' : 'bin');
  const isVenvPython = bin === PYTHON_BIN || bin === getPythonBin()
    || String(bin).includes(venvDir);
  const baseEnv = isVenvPython ? envForVenv() : buildEnv();
  const proc = spawn(bin, args, {
    cwd:   opts.cwd || APP_DATA,
    env:   { ...baseEnv, ...(opts.env || {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  svc.proc = proc;

  proc.stdout.on('data', d => writeLog(key, d.toString()));
  let _stderrBuf = '';
  proc.stderr.on('data', d => {
    if (svc.proc !== proc) return;
    const t = d.toString();
    writeLog(key, t);
    _stderrBuf += t;
    if (_stderrBuf.length > 300) _stderrBuf = _stderrBuf.slice(-300);
    if (svc.status !== 'running') {
      const summary = summarizeServiceStderr(_stderrBuf);
      if (summary) svc.lastError = summary;
    }
    if (key === 'backend' && isBackendBindError(t) && !proc._portRetryScheduled) {
      proc._portRetryScheduled = true;
      const idx = BACKEND_PORT_CANDIDATES.indexOf(SERVICES.backend.port);
      const nextIdx = idx >= 0 ? idx + 1 : 1;
      if (nextIdx < BACKEND_PORT_CANDIDATES.length) {
        writeLog('backend', `[ports] Bind failed on ${SERVICES.backend.port}, retrying next port…\n`);
        setTimeout(() => {
          retryBackendOnNextPort(proc, nextIdx).catch(err => {
            writeLog('backend', `[ports] Port retry failed: ${err.message}\n`);
            if (svc.proc === proc) {
              svc.status = 'error';
              svc.lastError = err.message.slice(0, 120);
              broadcastStatus();
            }
          });
        }, 400);
      }
    }
  });

  proc.on('close', code => {
    if (isShuttingDown) return;
    if (svc.proc !== proc) return;
    svc.status = code === 0 ? 'stopped' : 'error';
    if (code !== 0) {
      const summary = summarizeServiceStderr(_stderrBuf);
      if (summary) svc.lastError = summary;
    }
    svc.proc = null;
    broadcastStatus();
  });
  proc.on('error', err => {
    if (isShuttingDown) return;
    if (svc.proc !== proc) return;
    svc.status = 'error';
    svc.lastError = err.message.slice(0, 120);
    svc.proc = null;
    writeLog(key, `Process error: ${err.message}\n`);
    broadcastStatus();
  });

  // Begin health polling after a short grace period
  const delay = IS_WIN
    ? { backend: 4000, frontend: 3000, ocr: 2000, parser: 1200, directory: 1200, tunnel: 2000 }[key] || 2000
    : { backend: 3000, frontend: 3500, ocr: 2500, parser: 1500, directory: 1500, tunnel: 2500 }[key] || 2500;
  setTimeout(() => pollHealth(key, 0), delay);
  return proc;
}

/** Poll HTTP health for backend/frontend; process-alive check for gRPC services */
function pollHealth(key, attempts) {
  const svc = SERVICES[key];
  if (!svc.proc || isShuttingDown) return;

  // gRPC / tunnel: verify process is alive
  if ([50051, 50052, 50053].includes(svc.port) || key === 'tunnel') {
    if (svc.proc && svc.proc.exitCode === null) {
      svc.status = 'running';
      if (key === 'tunnel') svc.lastError = '';
      broadcastStatus();
      if (key === 'tunnel' && svc.status === 'running') {
        setTimeout(() => pollHealth(key, 0), 15_000);
      }
    }
    return;
  }

  const url = svc.key === 'backend'
    ? `http://127.0.0.1:${svc.port}/health`
    : 'http://127.0.0.1:3000/';

  const req = http.get(url, res => {
    svc.status = res.statusCode < 500 ? 'running' : 'error';
    if (svc.status === 'running') svc.lastError = '';
    broadcastStatus();
    if (key === 'frontend' && svc.status === 'running') {
      maybeStartCloudflareTunnel();
      if (!IS_WIN) {
        sendStartupProgress('服务已就绪', '可通过托盘打开控制台', 'ready');
        closeSplashWindow();
        if (!statusWindow || statusWindow.isDestroyed()) showStatusWindow();
      }
    }
    maybeAutoOpenDashboard(key);
    // Keep re-checking every 10 s while running
    if (svc.status === 'running' && svc.proc) {
      setTimeout(() => pollHealth(key, 0), 10_000);
    }
  });
  req.on('error', () => {
    const maxAttempts = key === 'backend'
      ? (IS_WIN ? 120 : 45)
      : (IS_WIN ? 30 : 25);
    const retryMs = attempts < 5 ? 1000 : 2000;
    if (attempts < maxAttempts && svc.proc) {
      setTimeout(() => pollHealth(key, attempts + 1), retryMs);
    } else if (!isShuttingDown) {
      svc.status = svc.proc ? 'error' : 'stopped';
      if (svc.status === 'error' && !svc.lastError) {
        svc.lastError = `Health check failed on port ${svc.port}（Backend 启动较慢，可稍等或重启）`;
      }
      broadcastStatus();
    }
  });
  req.setTimeout(3000, () => req.destroy());
}

/** Prefer bundled Node (avoids Homebrew dylib errors like libsimdjson). */
function resolveNodeBin() {
  const bundledExe = bundledNodeRuntimeExe();
  if (fs.existsSync(bundledExe) && verifyNodeBinary(bundledExe)) {
    return bundledExe;
  }
  if (fs.existsSync(NODE_BIN_FILE)) {
    const cached = fs.readFileSync(NODE_BIN_FILE, 'utf8').trim();
    if (cached && fs.existsSync(cached) && cached.startsWith(APP_DATA)) {
      return cached;
    }
  }
  if (fs.existsSync(NODE_MAC_BIN)) return NODE_MAC_BIN;
  const portable = findPortableNodeExe(NODE_LOCAL_DIR);
  if (portable) return portable;
  if (IS_DEV) {
    const found = findExecutable('node');
    if (found) return found;
  }
  return null;
}

function killPids(pids, signal = 'SIGKILL') {
  for (const pid of pids) {
    const n = Number(pid);
    if (!n || n === process.pid) continue;
    try { process.kill(n, signal); } catch (_) {}
  }
}

function collectPidsOnPort(port) {
  return new Promise(resolve => {
    const { exec } = require('child_process');
    const found = new Set();
    if (IS_WIN) {
      exec('netstat -ano -p tcp', { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }, (_err, stdout) => {
        const portNeedle = `:${port}`;
        for (const line of (stdout || '').split('\n')) {
          if (!line.includes(portNeedle)) continue;
          const upper = line.toUpperCase();
          if (!upper.includes('LISTENING') && !line.includes('侦听')) continue;
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (/^\d+$/.test(pid) && pid !== '0') found.add(pid);
        }
        resolve([...found]);
      });
      return;
    }
    const cmds = [
      `lsof -nP -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null`,
      `lsof -ti :${port} 2>/dev/null`,
      `lsof -t -iTCP:${port} 2>/dev/null`,
    ];
    let idx = 0;
    const next = () => {
      if (idx >= cmds.length) return resolve([...found]);
      exec(cmds[idx++], (_err, stdout) => {
        for (const line of (stdout || '').split('\n')) {
          const pid = line.trim();
          if (/^\d+$/.test(pid) && pid !== '0') found.add(pid);
        }
        next();
      });
    };
    next();
  });
}

function isPortFree(port) {
  return new Promise(resolve => {
    const net = require('net');
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

async function waitUntilPortsFree(ports, maxMs = 10000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const results = await Promise.all(ports.map(isPortFree));
    if (results.every(Boolean)) return true;
    await new Promise(r => setTimeout(r, 350));
  }
  return false;
}

async function killPortHolders(port) {
  const { exec } = require('child_process');
  const pids = await collectPidsOnPort(port);
  if (!pids.length) return;
  writeLog('backend', `[ports] Port ${port}: killing ${pids.join(', ')}\n`);
  if (IS_WIN) {
    await new Promise(res => {
      exec(`taskkill /F /PID ${pids.join(' /PID ')} /T`, () => res());
    });
  } else {
    killPids(pids, 'SIGTERM');
    await new Promise(r => setTimeout(r, 400));
    killPids(await collectPidsOnPort(port), 'SIGKILL');
  }
  await waitUntilPortsFree([port], IS_WIN ? 15000 : 8000);
}

async function resolveBackendPort(startIndex = 0) {
  for (let i = startIndex; i < BACKEND_PORT_CANDIDATES.length; i++) {
    const port = BACKEND_PORT_CANDIDATES[i];
    if (!(await isPortFree(port))) {
      await killPortHolders(port);
    }
    if (await isPortFree(port)) {
      SERVICES.backend.port = port;
      try { fs.writeFileSync(BACKEND_PORT_FILE, String(port)); } catch (_) {}
      writeDesktopPetConfig();
      writeLog('backend', `[ports] Backend will use port ${port}\n`);
      return port;
    }
    writeLog('backend', `[ports] Port ${port} still busy, trying next candidate…\n`);
  }
  throw new Error(`无法绑定 Backend 端口（已尝试: ${BACKEND_PORT_CANDIDATES.join(', ')}）`);
}

function isBackendBindError(text) {
  return /10013|10048|EADDRINUSE|attempting to bind on address|访问权限不允许|以一种访问权限不允许的方式/i.test(text);
}

async function retryBackendOnNextPort(failedProc, startIndex) {
  const pyBin = getPythonBin();
  if (!pyBin) return;
  if (failedProc && SERVICES.backend.proc === failedProc) {
    await killServiceProcess(failedProc);
    SERVICES.backend.proc = null;
  }
  const port = await resolveBackendPort(startIndex);
  SERVICES.backend.status = 'starting';
  SERVICES.backend.lastError = `端口冲突，已切换到 ${port}…`;
  broadcastStatus();
  spawnService('backend', pyBin,
    ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(port), '--log-level', 'warning'],
    { cwd: BACKEND_DATA, env: { PYTHONPATH: BACKEND_DATA } }
  );
}

/**
 * Kill any processes occupying our service ports; wait until ports are bindable.
 */
async function killOccupiedPorts() {
  const ports = SERVICE_PORTS();
  writeLog('backend', `[ports] Releasing: ${ports.join(', ')}\n`);

  if (IS_WIN) {
    for (const port of ports) {
      await killPortHolders(port);
    }
    await waitUntilPortsFree(ports, 15000);
    return;
  }

  for (const port of ports) {
    let pids = await collectPidsOnPort(port);
    if (pids.length) {
      writeLog('backend', `[ports] Port ${port}: SIGTERM → ${pids.join(' ')}\n`);
      killPids(pids, 'SIGTERM');
      await new Promise(r => setTimeout(r, 400));
      killPids(pids, 'SIGKILL');
      pids = await collectPidsOnPort(port);
      if (pids.length) killPids(pids, 'SIGKILL');
    }
  }

  await new Promise(r => setTimeout(r, 500));
  const free = await waitUntilPortsFree(ports, 12000);
  if (!free) {
    writeLog('backend', '[ports] Warning: some ports still busy — forcing another kill round\n');
    for (const port of ports) {
      killPids(await collectPidsOnPort(port), 'SIGKILL');
    }
    await waitUntilPortsFree(ports, 5000);
  }
}

/** Stop child services, release ports, then start fresh. */
async function prepareServiceLaunch() {
  const hadRunning = Object.values(SERVICES).some(s => s.proc);
  isShuttingDown = true;
  stopAllServices(true);
  const settleMs = hadRunning ? (IS_WIN ? 1200 : 900) : (IS_WIN ? 250 : 150);
  await new Promise(r => setTimeout(r, settleMs));
  if (hadRunning) {
    await killOccupiedPorts();
    if (IS_WIN) await new Promise(r => setTimeout(r, 400));
  }
  isShuttingDown = false;
}

async function launchAllServices() {
  const pyBin = getPythonBin();
  if (!pyBin || !isPythonRuntimeReady()) {
    const msg = 'Python 环境未就绪，正在自动修复…';
    SERVICES.backend.status = 'error';
    SERVICES.backend.lastError = msg;
    SERVICES.ocr.status = 'error';
    SERVICES.ocr.lastError = msg;
    broadcastStatus();
    const ok = await repairPythonRuntimeSilently();
    if (ok) {
      await restartServices();
    } else if (!setupWindow || setupWindow.isDestroyed()) {
      showSetupWindow(null, 'install');
    }
    return;
  }

  // ── 1. FastAPI backend
  let backendPort = 8000;
  try {
    backendPort = await resolveBackendPort(0);
  } catch (err) {
    SERVICES.backend.status = 'error';
    SERVICES.backend.lastError = err.message.slice(0, 120);
    broadcastStatus();
    writeLog('backend', `[ports] ${err.message}\n`);
    return;
  }
  spawnService('backend', pyBin,
    ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(backendPort), '--log-level', 'warning'],
    { cwd: BACKEND_DATA, env: { PYTHONPATH: BACKEND_DATA } }
  );

  // ── 1b. Native desktop automation sidecar (localhost HTTP)
  setTimeout(() => {
    const sidecar = path.join(BACKEND_DATA, 'services', 'native_sidecar_server.py');
    if (fs.existsSync(sidecar)) {
      spawnService('nativeSidecar', pyBin, [sidecar],
        { cwd: BACKEND_DATA, env: { PYTHONPATH: BACKEND_DATA } }
      );
    } else {
      SERVICES.nativeSidecar.status = 'unavailable';
      broadcastStatus();
    }
  }, IS_WIN ? 200 : 1000);

  // ── 2. OCR gRPC service
  setTimeout(() => {
    const ocr = path.join(OCR_DATA, 'server.py');
    if (fs.existsSync(ocr)) {
      spawnService('ocr', pyBin, [ocr],
        { cwd: OCR_DATA, env: { PYTHONPATH: OCR_DATA + PATH_SEP + BACKEND_DATA } }
      );
    } else {
      SERVICES.ocr.status = 'unavailable';
      broadcastStatus();
    }
  }, IS_WIN ? 150 : 800);

  // ── 3. Rust parser-service binary
  setTimeout(() => {
    const bin = path.join(RES_BIN, IS_WIN ? 'parser-service.exe' : 'parser-service');
    if (fs.existsSync(bin)) {
      if (!IS_WIN) { try { fs.chmodSync(bin, 0o755); } catch (_) {} }
      spawnService('parser', bin, [], { cwd: APP_DATA });
    } else {
      SERVICES.parser.status = 'unavailable';
      broadcastStatus();
    }
  }, IS_WIN ? 250 : 1200);

  // ── 4. Go directory-service binary
  setTimeout(() => {
    const bin = path.join(RES_BIN, IS_WIN ? 'directory-service.exe' : 'directory-service');
    if (fs.existsSync(bin)) {
      if (!IS_WIN) { try { fs.chmodSync(bin, 0o755); } catch (_) {} }
      spawnService('directory', bin, [], { cwd: APP_DATA });
    } else {
      SERVICES.directory.status = 'unavailable';
      broadcastStatus();
    }
  }, IS_WIN ? 250 : 1200);

  // ── 5. Next.js standalone frontend (bundled Node only in packaged builds)
  setTimeout(async () => {
    const serverJs = path.join(RES_WEB, 'server.js');
    if (fs.existsSync(serverJs)) {
      let nodeBin = resolveNodeBin();
      if (!nodeBin || !isNodeRuntimeReady()) {
        nodeBin = await ensureNodeRuntime((pct, msg) => writeLog('backend', `[node] ${msg}\n`));
      }
      if (!nodeBin) {
        SERVICES.frontend.status = 'error';
        SERVICES.frontend.lastError = 'Node.js 未安装，请重新运行安装向导';
        broadcastStatus();
        if (!setupWindow || setupWindow.isDestroyed()) {
          showSetupWindow(null, 'install');
        }
        return;
      }
      if (!IS_DEV) {
        repairLarkCliSilently().catch(err => {
          writeLog('backend', `[lark-cli] background repair skipped: ${err.message}\n`);
        });
      }
      spawnService('frontend', nodeBin, [serverJs],
        {
          cwd: RES_WEB,
          env: {
            PORT: '3000',
            HOSTNAME: '127.0.0.1',
            BACKEND_URL: `http://127.0.0.1:${SERVICES.backend.port}`,
            STORAGE_DIR,
            AI_MEDIA_AGENT_HOME: APP_DATA,
            AI_MEDIA_AGENT_RESOURCES: RESOURCES,
            AI_MEDIA_AGENT_PACKAGED: IS_DEV ? '0' : '1',
            AI_MEDIA_AGENT_LOGS_DIR: LOGS_DIR,
          },
        }
      );
    } else {
      SERVICES.frontend.status = 'unavailable';
      broadcastStatus();
    }
  }, IS_WIN ? 350 : 1500);
}

async function startAllServices() {
  const showSplash = !IS_DEV && (!setupWindow || setupWindow.isDestroyed());
  if (showSplash) showSplashWindow();
  sendStartupProgress('正在准备启动…', '', 'sync');

  await prepareServiceLaunch();
  try {
    const logProgress = (pct, msg, detail = '') => {
      if (detail) writeLog('backend', `[sync] ${pct >= 0 ? `${pct}% ` : ''}${msg} — ${detail}\n`);
      if (pct >= 0 && pct <= 100) {
        sendStartupProgress(msg, detail, pct < 90 ? 'sync' : 'backend');
      }
    };
    const backendSynced = await syncAppResources(logProgress);
    mergeBundledEnvDefaults();
    ensureMealPublicWebBaseUrl();
    const postSyncTasks = [];
    if (backendSynced && isPythonRuntimeReady()) {
      writeLog('backend', '[sync] refreshing Python deps after backend update…\n');
      sendStartupProgress('更新 Python 依赖…', '与 Node.js 检查并行进行', 'sync');
      postSyncTasks.push(installPythonDependencies(logProgress, getPythonBin()));
    }
    if (!IS_DEV && !isNodeRuntimeReady()) {
      postSyncTasks.push(repairNodeRuntimeSilently());
    }
    if (postSyncTasks.length) {
      await Promise.all(postSyncTasks);
    }
    if (playwrightBrowsersNeedInstall()) {
      sendStartupProgress('Playwright 将在后台安装', '不影响控制台使用', 'sync');
      if (IS_WIN) schedulePlaywrightInstall();
      else {
        ensurePlaywrightBrowsersReady(logProgress).catch(err => {
          writeLog('backend', `[playwright] background install failed: ${err.message}\n`);
        });
      }
    }
  } catch (err) {
    writeLog('backend', `[sync] resource sync failed: ${err.message}\n`);
  }
  if (!isPythonRuntimeReady()) {
    const ok = await repairPythonRuntimeSilently();
    if (!ok) {
      closeSplashWindow();
      if (!setupWindow || setupWindow.isDestroyed()) {
        showSetupWindow(null, 'install');
      }
      return;
    }
  }
  if (!IS_DEV && !isNodeRuntimeReady()) {
    const nodeOk = isNodeRuntimeReady() || await repairNodeRuntimeSilently();
    if (!nodeOk) {
      closeSplashWindow();
      SERVICES.frontend.status = 'error';
      SERVICES.frontend.lastError = 'Node.js 未安装，请重新运行安装向导';
      broadcastStatus();
      if (!setupWindow || setupWindow.isDestroyed()) {
        showSetupWindow(null, 'install');
      }
    }
  }
  sendStartupProgress('正在启动服务…', 'Backend / Frontend / OCR', 'backend');
  await launchAllServices();
}

function stopAllServices(keepShuttingDown = false) {
  isShuttingDown = true;
  tunnelLaunchScheduled = false;
  for (const svc of Object.values(SERVICES)) {
    if (svc.proc) {
      killServiceProcess(svc.proc);
      svc.proc = null;
      svc.status = 'stopped';
      svc.lastError = '';
    }
  }
  // If caller is restarting, keep isShuttingDown=true so stale close-events are ignored
  if (!keepShuttingDown) isShuttingDown = false;
  broadcastStatus();
}

async function restartServices() {
  await prepareServiceLaunch();
  await launchAllServices();
}

function quitApp() {
  isShuttingDown = true;
  stopAllServices();
  setTimeout(() => app.quit(), 500);
}

/** When launched from a DMG, offer one-click install to /Applications. */
async function offerInstallFromDmg() {
  if (IS_DEV || process.platform !== 'darwin' || !app.isPackaged) return false;

  const bundlePath = path.resolve(app.getPath('exe'), '../../..');
  if (!bundlePath.startsWith('/Volumes/')) return false;

  const appName  = path.basename(bundlePath);
  const destPath = path.join('/Applications', appName);
  if (bundlePath === destPath) return false;

  const { response } = await dialog.showMessageBox({
    type:    'question',
    buttons: ['安装到「应用程序」', '暂不安装'],
    defaultId: 0,
    cancelId:  1,
    title:   'AI Media Agent 安装',
    message: '检测到从安装镜像运行',
    detail:  '建议安装到「应用程序」文件夹。安装后会自动解除安全限制并重新启动。',
  });
  if (response !== 0) return false;

  try {
    if (fs.existsSync(destPath)) {
      execSync(`rm -rf ${JSON.stringify(destPath)}`);
    }
    execSync(`ditto ${JSON.stringify(bundlePath)} ${JSON.stringify(destPath)}`);
    execSync(`xattr -cr ${JSON.stringify(destPath)}`);
    execSync(`open ${JSON.stringify(destPath)}`);
    app.quit();
    return true;
  } catch (err) {
    dialog.showErrorBox('安装失败', `${err.message}\n\n请双击 DMG 中的「Install AI Media Agent」完成安装。`);
    return false;
  }
}

// ─── App Lifecycle ────────────────────────────────────────────────────────────

app.setName('AI Media Agent');

// Hide Dock only after setup is complete (first launch shows Dock + wizard window).
function syncDockVisibility() {
  if (!app.dock) return;
  if (IS_DEV || resolveWizardInitialPhase()) app.dock.show();
  else app.dock.hide();
}

// Single-instance lock
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.on('second-instance', () => showStatusWindow());

app.whenReady().then(async () => {
  removeSelfQuarantine();
  syncDockVisibility();
  if (IS_WIN) Menu.setApplicationMenu(null);
  if (await offerInstallFromDmg()) return;

  // ── Create system tray
  let trayIcon = loadTrayImage('tray-red');
  if (trayIcon.isEmpty()) {
    const icns = path.join(process.resourcesPath, 'icon.icns');
    if (fs.existsSync(icns)) {
      trayIcon = nativeImage.createFromPath(icns).resize({ width: 22, height: 22 });
    }
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('AI Media Agent · stopped');
  tray.setContextMenu(buildTrayMenu('stopped'));
  tray.on('click', showStatusWindow);

  ensureDirs();
  startDesktopPetConsoleWatcher();

  const wizardPhase = resolveWizardInitialPhase();
  if (wizardPhase) {
    if (Notification.isSupported()) {
      new Notification({
        title: 'AI Media Agent',
        body: '应用已启动，请按照安装向导完成配置。',
      }).show();
    }
    showSetupWindow(null, wizardPhase);
  } else {
    syncDockVisibility();
    startAllServices();
    syncDesktopPetStatus();
    if (!IS_DEV) scheduleShowStatusWindow(3500);
  }
});

// Keep app running even when all windows are closed
app.on('window-all-closed', e => e.preventDefault());

app.on('before-quit', () => {
  isShuttingDown = true;
  stopAllServices();
});

// ─── IPC Handlers ────────────────────────────────────────────────────────────

ipcMain.handle('get-wizard-state', () => ({
  initialPhase: resolveWizardInitialPhase() || 'welcome',
  hasApiKey: hasApiKeyConfigured(),
  installLogPath: INSTALL_LOG_FILE,
}));
ipcMain.handle('setup-ui-ready', async () => {
  setupUiReady = true;
  flushSetupProgressQueue();
  await maybeStartPendingSetup();
  return { ok: true };
});
ipcMain.handle('start-install', async () => {
  setupInstallPending = false;
  await runSetup();
});
ipcMain.handle('save-api-config', (_, { provider, apiKey }) => {
  const PROVIDER_MAP = {
    alibaba:    { LLM_PROVIDER: 'alibaba',    ALIBABA_API_KEY: apiKey, DASHSCOPE_API_KEY: apiKey },
    zhipu:      { LLM_PROVIDER: 'zhipu',      ZHIPUAI_API_KEY: apiKey },
    openrouter: { LLM_PROVIDER: 'openrouter', OPENROUTER_API_KEY: apiKey },
    google:     { LLM_PROVIDER: 'google',     GOOGLE_API_KEY: apiKey },
    deepseek:   { LLM_PROVIDER: 'deepseek',   DEEPSEEK_API_KEY: apiKey },
  };
  const updates = PROVIDER_MAP[provider];
  if (!updates) throw new Error(`Unknown provider: ${provider}`);
  if (!fs.existsSync(ENV_FILE)) {
    fs.writeFileSync(ENV_FILE, '# AI Media Agent\n');
  }
  updateEnvFile(updates);
  fs.writeFileSync(CONFIG_DONE_FILE, new Date().toISOString());
  return { ok: true };
});
ipcMain.handle('finish-wizard', (_, opts) => finishWizard(opts || {}));
ipcMain.handle('open-external', (_, url) => shell.openExternal(url));
ipcMain.handle('get-status', () =>
  Object.fromEntries(
    Object.entries(SERVICES).map(([k, s]) => [
      k, { name: s.name, status: s.status, port: s.port, lastError: s.lastError || '' },
    ])
  )
);
ipcMain.handle('restart-services', restartServices);
ipcMain.handle('stop-services', stopAllServices);
ipcMain.handle('start-services', startAllServices);
ipcMain.handle('open-dashboard', () => { openDashboard(); return { ok: true }; });
ipcMain.handle('launch-desktop-pet', () => launchDesktopPet());
ipcMain.handle('open-config',    () => shell.openPath(ENV_FILE));
ipcMain.handle('open-logs',      () => shell.openPath(LOGS_DIR));
ipcMain.handle('open-install-log', () => shell.openPath(INSTALL_LOG_FILE));
ipcMain.handle('get-install-log-path', () => INSTALL_LOG_FILE);
ipcMain.handle('open-support',   () => shell.openPath(APP_DATA));

const WORKSPACE_PROJECTS_FILE = path.join(APP_DATA, 'workspace-projects.json');

ipcMain.handle('workspace:pick-folder', async () => {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null;
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths?.[0]) {
    return { ok: false, canceled: true };
  }
  const folderPath = result.filePaths[0];
  return {
    ok: true,
    path: folderPath,
    label: path.basename(folderPath),
  };
});

ipcMain.handle('workspace:pick-file', async () => {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null;
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths?.[0]) {
    return { ok: false, canceled: true };
  }
  const filePath = result.filePaths[0];
  return {
    ok: true,
    path: filePath,
    label: path.basename(filePath),
  };
});

ipcMain.handle('workspace:get-projects', async () => {
  try {
    const raw = await fsp.readFile(WORKSPACE_PROJECTS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return { ok: true, projects: Array.isArray(data) ? data : [] };
  } catch {
    return { ok: true, projects: [] };
  }
});

ipcMain.handle('workspace:save-projects', async (_, rows) => {
  const list = Array.isArray(rows) ? rows : [];
  await fsp.mkdir(APP_DATA, { recursive: true });
  await fsp.writeFile(WORKSPACE_PROJECTS_FILE, JSON.stringify(list, null, 2), 'utf8');
  return { ok: true };
});

const SYSTEM_COMMAND_ALLOWLIST = new Set([
  'brew', 'winget', 'choco', 'ping', 'nslookup', 'scutil', 'networksetup',
  'dscacheutil', 'ipconfig', 'curl', 'node', 'python', 'python3', 'git', 'which', 'where',
]);

function validateSystemArgv(argv) {
  if (!Array.isArray(argv) || !argv.length) {
    throw new Error('argv is required');
  }
  const exe = String(argv[0] || '').toLowerCase().replace(/\.exe$/, '');
  if (!SYSTEM_COMMAND_ALLOWLIST.has(exe)) {
    throw new Error(`command not allowlisted: ${exe}`);
  }
  return argv.map((part) => String(part));
}

ipcMain.handle('system:platform-info', () => ({
  platform: process.platform,
  arch: process.arch,
  isElectron: true,
}));

ipcMain.handle('system:run', async (_, payload) => {
  const argv = validateSystemArgv(payload?.argv || []);
  const timeoutMs = Math.min(Math.max(Number(payload?.timeoutMs) || 30000, 1000), 600000);
  const cwd = payload?.cwd ? String(payload.cwd) : require('os').homedir();
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      shell: false,
      env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        returncode: code,
        stdout: stdout.slice(0, 16384),
        stderr: stderr.slice(0, 16384),
        argv,
        timeoutMs,
      });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: String(err), argv, stdout, stderr });
    });
  });
});
