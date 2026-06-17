"""
Start/stop optional localhost MCP subprocesses for catalog presets (Streamable HTTP).
State: storage/mcp_managed.json · logs: storage/temp/mcp_preset_<id>.log
"""

from __future__ import annotations

import json
import os
import re
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, Optional

from services.mcp_presets import MCP_PRESET_SPECS, preset_public_url

from utils.logger import setup_logger

logger = setup_logger("mcp_managed_launcher")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
STATE_PATH = PROJECT_ROOT / "storage" / "mcp_managed.json"
LOG_DIR = PROJECT_ROOT / "storage" / "temp"

_LISTEN_PLAYWRIGHT_S = 120.0
# uvx / pip 首次拉包在 Windows 上常超过 50s（杀毒扫描、网络慢）
_LISTEN_DUCK_S = 180.0 if sys.platform == "win32" else 120.0
_LISTEN_OFFICIAL_GATEWAY_S = 150.0 if sys.platform == "win32" else 120.0
_LISTEN_OFFICIAL_EVERYTHING_S = 120.0 if sys.platform == "win32" else 90.0

_state_lock = threading.Lock()
_preset_locks_guard = threading.Lock()
_preset_locks: dict[str, threading.Lock] = {}
_SUPERGATEWAY_SESSION_MS = 86_400_000  # 24h — long-lived local agent sessions


_LOG_NOISE_RE = re.compile(
    r"ev_poll_posix|FD from fork parent still in poll list",
    re.I,
)


def _format_log_error_hint(log_tail: str, *, max_chars: int = 1200) -> str:
    """Extract actionable stderr from preset launch logs; drop inherited gRPC fork noise."""
    text = (log_tail or "").strip()
    if not text:
        return ""
    lines = [ln for ln in text.splitlines() if ln.strip() and not _LOG_NOISE_RE.search(ln)]
    if not lines:
        return ""
    joined = "\n".join(lines)
    tb_idx = joined.rfind("Traceback (most recent call last):")
    if tb_idx >= 0:
        joined = joined[tb_idx:]
    err_lines = [
        ln
        for ln in lines
        if ln.startswith(("Traceback", "  File ", "ModuleNotFoundError", "ImportError", "Error:", "RuntimeError"))
    ]
    if err_lines:
        joined = "\n".join(err_lines[-12:])
    return joined.strip()[-max_chars:]


def _preset_lock(preset_id: str) -> threading.Lock:
    with _preset_locks_guard:
        if preset_id not in _preset_locks:
            _preset_locks[preset_id] = threading.Lock()
        return _preset_locks[preset_id]


def _venv_bin_dir() -> Path:
    return PROJECT_ROOT / "venv" / ("Scripts" if sys.platform == "win32" else "bin")


def _discover_executable(name: str) -> Optional[str]:
    """Resolve CLI on PATH or project venv (Electron 桌面包 PATH 可能不含全局 Node/uv)。"""
    found = shutil.which(name)
    if found:
        return found
    bindir = _venv_bin_dir()
    if not bindir.is_dir():
        return None
    for stem in (name, f"{name}.exe", f"{name}.cmd", f"{name}.bat"):
        candidate = bindir / stem
        if candidate.is_file():
            return str(candidate)
    return None


def _bundled_mcp_prefix() -> Optional[Path]:
    raw = os.environ.get("AI_MEDIA_AGENT_MCP_PREFIX", "").strip()
    if not raw:
        return None
    p = Path(raw).expanduser()
    if p.is_dir() and (p / "node_modules").is_dir():
        return p.resolve()
    return None


def _resolve_npx() -> str:
    explicit = os.environ.get("AI_MEDIA_AGENT_NPX", "").strip()
    if explicit and Path(explicit).is_file():
        return explicit
    p = _discover_executable("npx")
    if not p:
        raise RuntimeError(
            "未找到 npx（需安装 Node.js 18+）：https://nodejs.org/ · "
            "Windows 安装包应包含 resources/node/runtime"
        )
    return p


def _strip_npx_online_flags(args: list[str]) -> list[str]:
    out: list[str] = []
    for token in args:
        if token in ("-y", "--yes"):
            continue
        if token.endswith("@latest"):
            out.append(token[: -len("@latest")])
        else:
            out.append(token)
    return out


def _compose_npx_argv(args: list[str]) -> list[str]:
    """Prefer offline `npx --prefix mcp-bundled` when Electron ships preinstalled MCP npm packages."""
    npx = _resolve_npx()
    expanded = _strip_npx_online_flags(list(args))
    prefix = _bundled_mcp_prefix()
    if prefix:
        return [npx, "--prefix", str(prefix), *expanded]
    if "-y" not in args and "--yes" not in args:
        expanded = ["-y", *expanded]
    return [npx, *expanded]


def _compose_uvx_argv(args: list[str]) -> list[str]:
    """Prefer venv console scripts for MCP pip packages bundled at build time."""
    if not args:
        raise RuntimeError("uvx argv empty")
    pkg = str(args[0])
    tail = [str(x) for x in args[1:]]

    exe = _discover_executable(pkg)
    if exe:
        return [exe, *tail]

    module_map = {
        "duckduckgo-mcp-server": "duckduckgo_mcp_server.server",
    }
    module = module_map.get(pkg)
    if module:
        py = _discover_executable("python") or sys.executable
        return [py, "-m", module, *tail]

    uvx = _discover_executable("uvx")
    if uvx:
        return [uvx, pkg, *tail]
    raise RuntimeError(
        f"未找到 uvx 或 pip 包 `{pkg}`。请先安装：https://docs.astral.sh/uv/ "
        f"或执行 pip install {pkg}"
    )


def _prepare_subprocess_argv(argv: list[str]) -> list[str]:
    """Windows: npx/uvx 常为 .cmd，须经 cmd.exe /c 启动。"""
    if not argv or sys.platform != "win32":
        return argv
    exe = argv[0]
    ext = os.path.splitext(exe)[1].lower()
    if ext in (".cmd", ".bat"):
        return ["cmd.exe", "/c", *argv]
    return argv


def _windows_creationflags() -> int:
    if sys.platform != "win32":
        return 0
    flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    flags |= getattr(subprocess, "CREATE_NO_WINDOW", 0)
    return flags


def _load_state() -> dict[str, Any]:
    if not STATE_PATH.exists():
        return {"processes": {}}
    try:
        raw = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        return raw if isinstance(raw, dict) and "processes" in raw else {"processes": {}}
    except Exception:
        return {"processes": {}}


def _save_state(processes: dict[str, Any]) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(
        json.dumps({"processes": processes}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _mutate_process_state(
    preset_id: str,
    *,
    upsert: Optional[dict[str, Any]] = None,
    remove: bool = False,
) -> dict[str, Any]:
    """Thread-safe read-modify-write for mcp_managed.json."""
    with _state_lock:
        state = _load_state()
        procs: dict[str, Any] = dict(state.get("processes") or {})
        if remove:
            procs.pop(preset_id, None)
        elif upsert is not None:
            procs[preset_id] = upsert
        _save_state(procs)
        return procs


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.settimeout(0.3)
        return sock.connect_ex((host, port)) == 0
    finally:
        sock.close()


_MANAGED_PORT_SCAN = 48


def _reserved_peer_default_ports(for_preset_id: str) -> set[int]:
    """避免预设动态抢占用其他内置预设的默认 catalog 端口。"""
    return {
        int(spec["default_port"])
        for pid, spec in MCP_PRESET_SPECS.items()
        if pid != for_preset_id
    }


def _first_free_managed_port(
    preferred: int,
    preset_id: str,
    host: str = "127.0.0.1",
) -> Optional[int]:
    """
    Prefer `preferred`, then preferred+1 … 直到端口无监听，且尽量不占用同伴预设默认端口。
    """
    low = max(1, min(int(preferred), 65535))
    hi = min(65535, low + max(8, _MANAGED_PORT_SCAN) - 1)
    peers = _reserved_peer_default_ports(preset_id)
    for cand in range(low, hi + 1):
        if cand in peers:
            continue
        if not _port_in_use(cand, host):
            return cand
    return None


def _terminate(pid: int) -> None:
    if pid <= 0:
        return
    try:
        if sys.platform == "win32":
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                capture_output=True,
                timeout=12,
                check=False,
            )
        else:
            os.kill(pid, signal.SIGTERM)
            deadline = time.time() + 4.0
            while time.time() < deadline and _pid_alive(pid):
                time.sleep(0.1)
            if _pid_alive(pid):
                os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    except Exception as e:
        logger.warning(f"[mcp-managed] Failed to terminate pid={pid}: {e}")


def _which_or_raise(name: str, install_hint: str) -> str:
    p = _discover_executable(name)
    if not p:
        raise RuntimeError(install_hint)
    return p


def _joined_stdio_command(argv: list[str]) -> str:
    """Compose a single `--stdio` string for supergateway (cross-platform quoting)."""
    if sys.platform == "win32":
        return subprocess.list2cmdline(argv)
    return shlex.join(argv)


def _expand_stdio_args(parts: list[str]) -> list[str]:
    """Replace `{project_root}` with absolute PROJECT_ROOT."""
    root = str(PROJECT_ROOT.resolve())
    return [p.replace("{project_root}", root) for p in parts]


def _compose_stdio_inner_argv(exec_name: str, args: list[str]) -> list[str]:
    expanded = _expand_stdio_args(list(args))
    if exec_name == "npx":
        return _compose_npx_argv(expanded)
    if exec_name == "uvx":
        return _compose_uvx_argv(expanded)
    exe = _which_or_raise(
        exec_name,
        f"未找到 `{exec_name}`。官方 MCP Python 预设需 Astral uv（https://docs.astral.sh/uv/）；"
        f"Node 预设需 Node.js：https://nodejs.org/",
    )
    return [exe, *expanded]


def _build_playwright_mcp_cmd(port: int, host: str = "127.0.0.1") -> list[str]:
    """microsoft/playwright-mcp：HTTP MCP（Streamable）；优先使用安装包内预装 npm 包。"""
    return [
        *_compose_npx_argv(["@playwright/mcp"]),
        "--host",
        host,
        "--port",
        str(port),
        "--allowed-hosts",
        "*",
    ]


def _build_duckduckgo_launch_cmd(preset_id: str, port: int, host: str = "127.0.0.1") -> list[str]:
    spec = MCP_PRESET_SPECS.get(preset_id)
    if not spec:
        raise ValueError(f"Unknown preset: {preset_id}")
    if preset_id != "duckduckgo":
        raise ValueError(f"Internal: not duckduckgo preset ({preset_id})")

    pkg = str(spec["uvx_package"])
    cli = str(spec["cli_name"])
    tail = [
        "--transport",
        "streamable-http",
        "--host",
        host,
        "--port",
        str(port),
        "--fetch-backend",
        "httpx",
    ]
    try:
        return _compose_uvx_argv([pkg, *tail])
    except RuntimeError:
        pass

    exe = _discover_executable(cli)
    if exe:
        return [exe, *tail]

    py = _discover_executable("python") or sys.executable
    if py:
        return [py, "-m", "duckduckgo_mcp_server.server", *tail]

    raise RuntimeError(
        "未找到 uvx，也未找到 duckduckgo-mcp-server 命令。请先安装：https://docs.astral.sh/uv/"
        " 或执行 pip install duckduckgo-mcp-server"
    )


def _build_everything_npx(port: int) -> tuple[list[str], dict[str, str]]:
    cmd = [
        *_compose_npx_argv(["@modelcontextprotocol/server-everything"]),
        "streamableHttp",
    ]
    return cmd, {"PORT": str(port)}


def _build_supergateway_stdio_cmd(inner_argv: list[str], port: int) -> list[str]:
    """stdio MCP → Streamable HTTP，供 memory / filesystem 等仅有 stdio 的官方包。"""
    stdio_str = _joined_stdio_command(inner_argv)
    return [
        *_compose_npx_argv(["supergateway"]),
        "--stdio",
        stdio_str,
        "--outputTransport",
        "streamableHttp",
        "--stateful",
        "--sessionTimeout",
        str(_SUPERGATEWAY_SESSION_MS),
        "--port",
        str(port),
        "--streamableHttpPath",
        "/mcp",
        "--logLevel",
        "none",
    ]


def _compose_launch_vectors(
    preset_id: str,
    spec: dict[str, Any],
    port: int,
    host_bind: str,
) -> tuple[list[str], dict[str, str], float, str]:
    """
    argv, env_overrides, listen_deadline_s, preset_label_for_errors
    env_overlays merge onto os.environ in Popen.
    """
    launcher = spec.get("launcher") if isinstance(spec.get("launcher"), dict) else {}
    hint = spec.get("name_zh") or spec.get("name_en") or preset_id

    if preset_id == "playwright":
        return _build_playwright_mcp_cmd(port, host_bind), {}, _LISTEN_PLAYWRIGHT_S, hint

    if preset_id == "duckduckgo":
        return _build_duckduckgo_launch_cmd(preset_id, port, host_bind), {}, _LISTEN_DUCK_S, hint

    if preset_id == "codegraph":
        from services.codegraph_service import build_mcp_stdio_command

        inner = build_mcp_stdio_command()
        return _build_supergateway_stdio_cmd(inner, port), {}, _LISTEN_OFFICIAL_GATEWAY_S, hint

    kind = str(launcher.get("kind") or "")

    if kind == "everything_npx":
        cmd, env_o = _build_everything_npx(port)
        return cmd, env_o, _LISTEN_OFFICIAL_EVERYTHING_S, hint

    if kind == "supergateway":
        st = launcher.get("stdio")
        if not isinstance(st, dict):
            raise RuntimeError(f"预设 {preset_id} 缺少 launcher.stdio")
        exe_name = str(st.get("executable") or "").strip()
        raw_args = st.get("args")
        if not exe_name or not isinstance(raw_args, list):
            raise RuntimeError(f"预设 {preset_id} launcher.stdio 配置无效")
        args = [str(x) for x in raw_args]
        inner = _compose_stdio_inner_argv(exe_name, args)
        return _build_supergateway_stdio_cmd(inner, port), {}, _LISTEN_OFFICIAL_GATEWAY_S, hint

    if kind == "python_module":
        module = str(launcher.get("module") or "").strip()
        if not module:
            raise RuntimeError(f"预设 {preset_id} 缺少 launcher.module")
        backend_dir = PROJECT_ROOT / "backend"
        cmd = [sys.executable, "-m", module]
        env_o = {
            "PYTHONPATH": str(backend_dir),
            "MEDIA_MCP_PORT": str(port),
            "MEDIA_MCP_HOST": host_bind,
        }
        return cmd, env_o, _LISTEN_OFFICIAL_GATEWAY_S, hint

    raise RuntimeError(f"No launcher for preset: {preset_id}")


def managed_process_snapshot() -> dict[str, dict[str, Any]]:
    """preset_id -> { pid, port, alive, cmd }"""
    raw = _load_state().get("processes") or {}
    out: dict[str, dict[str, Any]] = {}
    for preset_id, entry in raw.items():
        pid = int(entry.get("pid", 0))
        port = int(entry.get("port", 0))
        alive = _pid_alive(pid) and bool(port) and _port_in_use(port)
        out[preset_id] = {
            "pid": pid,
            "port": port,
            "alive": alive,
            "cmd": entry.get("cmd") or "",
        }
    return out


def stop_managed_preset(preset_id: str) -> None:
    with _preset_lock(preset_id):
        with _state_lock:
            state = _load_state()
            procs = state.get("processes") or {}
            entry = procs.get(preset_id)
        if not entry:
            return
        pid = int(entry.get("pid", 0))
        _terminate(pid)
        _mutate_process_state(preset_id, remove=True)


def _start_managed_preset_unlocked(preset_id: str) -> dict[str, Any]:
    """
    Spawn subprocess if needed. Returns { success, preset_id, port, pid, cmd, url, error }
    Caller must hold _preset_lock(preset_id).
    """
    spec = MCP_PRESET_SPECS.get(preset_id)
    if not spec:
        return {"success": False, "error": f"Unknown preset: {preset_id}"}

    pref_port = int(spec["default_port"])
    host_bind = "127.0.0.1"

    with _state_lock:
        state = _load_state()
        procs: dict[str, Any] = dict(state.get("processes") or {})
    stale = procs.get(preset_id)
    stale_pid = int(stale.get("pid", 0)) if stale else 0
    if stale and not _pid_alive(stale_pid):
        _mutate_process_state(preset_id, remove=True)
        procs.pop(preset_id, None)

    prev = procs.get(preset_id)
    prev_pid = int(prev.get("pid", 0)) if prev else 0
    if prev_pid and _pid_alive(prev_pid):
        run_port = int(prev.get("port", pref_port))
        if _port_in_use(run_port, host_bind):
            url = preset_public_url(spec, run_port, host_bind)
            return {
                "success": True,
                "preset_id": preset_id,
                "pid": prev_pid,
                "port": run_port,
                "cmd": prev.get("cmd", ""),
                "url": url,
                "already_running": True,
            }
        logger.warning(
            "[mcp-managed] preset=%s pid=%s marked alive but tcp %s:%s refused — restarting",
            preset_id,
            prev_pid,
            host_bind,
            run_port,
        )
        _terminate(prev_pid)
        _mutate_process_state(preset_id, remove=True)

    port = _first_free_managed_port(pref_port, preset_id, host_bind)
    if port is None:
        return {
            "success": False,
            "error": (
                f"{host_bind} 上从端口 {pref_port} 起连续扫描未找到可用端口"
                f"（至多约 {_MANAGED_PORT_SCAN} 个），请手动释放占用或使用卸载清理旧实例"
            ),
        }
    if port != pref_port:
        logger.info(
            "[mcp-managed] preset=%s preferred_port=%s in use → using %s",
            preset_id,
            pref_port,
            port,
        )

    try:
        cmd, env_overlay, listen_deadline_s, label_hint = _compose_launch_vectors(
            preset_id, spec, port, host_bind
        )
    except Exception as e:
        return {"success": False, "error": str(e)}

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_fp = LOG_DIR / f"mcp_preset_{preset_id}.log"

    spawn_argv = _prepare_subprocess_argv(cmd)
    creationflags = _windows_creationflags()

    stderr_f = None
    try:
        stderr_f = open(log_fp, "ab", buffering=0)  # noqa: SIM115
        env_child = os.environ.copy()
        env_child.update(env_overlay)
        venv_bin = _venv_bin_dir()
        if venv_bin.is_dir():
            sep = ";" if sys.platform == "win32" else ":"
            env_child["PATH"] = f"{venv_bin}{sep}{env_child.get('PATH', '')}"
        # 与后端 Playwright 配置一致时可复用浏览器缓存目录
        if env_child.get("PLAYWRIGHT_BROWSERS_PATH", "").strip() == "":
            proj_browsers = PROJECT_ROOT / ".browsers"
            if proj_browsers.is_dir():
                env_child["PLAYWRIGHT_BROWSERS_PATH"] = str(proj_browsers)
        popen_kw: dict[str, Any] = {
            "args": spawn_argv,
            "stdin": subprocess.DEVNULL,
            "stdout": subprocess.DEVNULL,
            "stderr": stderr_f,
            "env": env_child,
            "start_new_session": sys.platform != "win32",
        }
        if sys.platform == "win32":
            popen_kw["creationflags"] = creationflags
        proc = subprocess.Popen(**popen_kw)  # noqa: S603
    except Exception as e:
        if stderr_f:
            stderr_f.close()
        return {"success": False, "error": str(e)}

    if stderr_f:
        stderr_f.close()

    pid = int(proc.pid)

    port_ready = False
    t_listen = time.monotonic()
    sleep_step = 0.35 if listen_deadline_s >= 90.0 else 0.28
    while time.monotonic() - t_listen < listen_deadline_s:
        ex = proc.poll()
        if ex is not None:
            try:
                log_tail = log_fp.read_text(encoding="utf-8", errors="replace")[-2000:] if log_fp.exists() else ""
            except Exception:
                log_tail = ""
            hint = f"\n末尾日志:\n{_format_log_error_hint(log_tail)}" if _format_log_error_hint(log_tail) else ""
            _terminate(pid)
            return {
                "success": False,
                "error": f"{label_hint} 子进程退出（exit={ex}）。{hint}".strip(),
            }
        if _port_in_use(port, host_bind):
            port_ready = True
            break
        time.sleep(sleep_step)

    if not port_ready:
        _terminate(pid)
        try:
            log_tail = log_fp.read_text(encoding="utf-8", errors="replace")[-2000:] if log_fp.exists() else ""
        except Exception:
            log_tail = ""
        hint = f"\n末尾日志:\n{_format_log_error_hint(log_tail)}" if _format_log_error_hint(log_tail) else ""
        return {
            "success": False,
            "error": (
                f"{listen_deadline_s:.0f}s 内未监听 {host_bind}:{port}（{label_hint}）。"
                f"请查看 storage/temp/{log_fp.name}{hint}"
            ).strip(),
        }

    if not _pid_alive(pid):
        return {
            "success": False,
            "error": f"MCP 子进程已结束（pid={pid}）。请查看 storage/temp/{log_fp.name}",
        }

    _mutate_process_state(
        preset_id,
        upsert={
            "pid": int(pid),
            "port": port,
            "cmd": " ".join(cmd),
            "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        },
    )

    url = preset_public_url(spec, port, host_bind)
    logger.info(f"[mcp-managed] Started preset={preset_id} pid={pid} url={url}")
    return {
        "success": True,
        "preset_id": preset_id,
        "pid": int(pid),
        "port": port,
        "cmd": " ".join(cmd),
        "url": url,
        "already_running": False,
    }


def start_managed_preset(preset_id: str) -> dict[str, Any]:
    """Thread-safe entry; different presets may install in parallel."""
    with _preset_lock(preset_id):
        return _start_managed_preset_unlocked(preset_id)
