"""
创作软件（Blender / Unity / Unreal / Photoshop）元数据与「只规划不执行」的 CLI 模板。

实际执行须走本地电脑动作（shell_command / launch_app）并遵守 allowlist 与审批；此处仅提供
结构化计划供 Agent、前端能力页与人工核对使用。
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Optional

import os
import shlex


@dataclass(frozen=True)
class CreativeAppProfile:
    id: str
    name: str
    category: str
    script_languages: List[str]
    typical_entrypoints: List[str]
    risk_notes: List[str]
    capability_id: str
    doc_urls: List[str]

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


CREATIVE_APP_PROFILES: Dict[str, CreativeAppProfile] = {
    "blender": CreativeAppProfile(
        id="blender",
        name="Blender",
        category="3d_dcc",
        script_languages=["Python (bpy)"],
        typical_entrypoints=["blender -b <blend> -P <script.py>", "blender -b <blend> -o //out -F PNG -x 1 -a"],
        risk_notes=[
            "批量渲染会占满 CPU/GPU；脚本可访问文件系统，须在允许目录内放置 blend 与输出。",
            "-P 执行任意 Python，仅审批通过后在受控环境运行。",
        ],
        capability_id="creative_app_script",
        doc_urls=["https://docs.blender.org/manual/en/latest/advanced/command_line/arguments.html"],
    ),
    "unity": CreativeAppProfile(
        id="unity",
        name="Unity Editor",
        category="game_engine",
        script_languages=["C# (Editor / Batch)"],
        typical_entrypoints=[
            "Unity -batchmode -quit -projectPath <dir> -executeMethod Namespace.Class.Method",
            "unity-editor -batchmode -buildTarget StandaloneOSX -projectPath <dir> ...",
        ],
        risk_notes=[
            "executeMethod 可触发完整项目构建；需固定 projectPath 在登记目录内。",
            "不同 OS 下 Unity 可执行文件名不同（Unity / Unity.app/Contents/MacOS/Unity）。",
        ],
        capability_id="creative_app_script",
        doc_urls=["https://docs.unity3d.com/Manual/CommandLineArguments.html"],
    ),
    "unreal": CreativeAppProfile(
        id="unreal",
        name="Unreal Editor",
        category="game_engine",
        script_languages=["Python（UE 脚本）", "蓝图自动化多依赖编辑器会话"],
        typical_entrypoints=[
            "UnrealEditor-Cmd <project>.uproject -run=pythonscript -script=<script.py>",
            "UE4Editor-Cmd ... （版本与引擎前缀依安装路径而定）",
        ],
        risk_notes=[
            "无头运行依赖正确 Engine 与项目路径；错误参数可导致长时间阻塞或资产损坏。",
        ],
        capability_id="creative_app_script",
        doc_urls=["https://dev.epicgames.com/documentation/en-us/unreal-engine/command-line-arguments-in-unreal-engine"],
    ),
    "photoshop": CreativeAppProfile(
        id="photoshop",
        name="Adobe Photoshop",
        category="2d_dcc",
        script_languages=["ExtendScript (.jsx)", "UXP / CEP（插件）"],
        typical_entrypoints=[
            "Photoshop -r <script.jsx>（因版本/平台而异，需本机核对官方文档）",
            "通过 COM/AppleScript 桥（macOS）—— 高风险，默认仅人工或半自动。",
        ],
        risk_notes=[
            "脚本可批量改图与写盘；输出路径必须在沙箱根目录内。",
            "不同 Photoshop 版本 CLI 差异大，执行前需在目标机器验证。",
        ],
        capability_id="creative_app_script",
        doc_urls=["https://helpx.adobe.com/photoshop/using/scripting.html"],
    ),
    "figma": CreativeAppProfile(
        id="figma",
        name="Figma",
        category="design_tool",
        script_languages=[
            "Figma Plugin API (TypeScript/JavaScript)",
            "REST API",
            "Code Connect CLI (@figma/code-connect)",
        ],
        typical_entrypoints=[
            "https://www.figma.com/design/{file_key}",
            "figma://file/{file_key}",
            "npx figma connect publish --token=$FIGMA_ACCESS_TOKEN",
            "npx figma connect unpublish --node=NODE_URL --label=LABEL",
            "npx figma connect parse --file=src/Button.figma.tsx",
            "npx figma connect preview --file=src/Button.figma.tsx",
            "npx figma connect migrate",
            "npx figma connect create",
        ],
        risk_notes=[
            "Figma 插件、REST API 与 Code Connect CLI 需要个人 Access Token；Token 应存储在受控配置或 FIGMA_ACCESS_TOKEN 环境变量中。",
            "通过桌面端链接打开时，仅在当前用户已登录 Figma 桌面应用时生效。",
            "publish/unpublish 会修改设计文件中的 Code Connect 映射；建议在 CI/允许目录内执行并走审批。",
        ],
        capability_id="creative_app_script",
        doc_urls=["https://developers.figma.com/docs/code-connect/quickstart-guide/"],
    ),
}


def list_creative_app_profiles() -> List[Dict[str, Any]]:
    return [p.to_dict() for p in CREATIVE_APP_PROFILES.values()]


def get_creative_app_profile(app_id: str) -> Optional[Dict[str, Any]]:
    p = CREATIVE_APP_PROFILES.get((app_id or "").strip().lower())
    return p.to_dict() if p else None


def plan_creative_action(
    *,
    app_id: str,
    mode: str,
    blend_file: str = "",
    project_path: str = "",
    uproject_file: str = "",
    script_path: str = "",
    execute_method: str = "",
    output_dir: str = "",
    figma_token: str = "",
    figma_config_path: str = "",
    figma_dir: str = "",
    figma_file: str = "",
    figma_node_url: str = "",
    figma_label: str = "",
    figma_language: str = "",
    extra_args: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    生成可审计的规划结果（不包含已解析的绝对路径校验；由本地电脑层负责）。
    """
    aid = (app_id or "").strip().lower()
    m = (mode or "").strip().lower().replace("-", "_")
    if aid not in CREATIVE_APP_PROFILES:
        raise ValueError(f"Unknown creative app: {app_id}")
    prof = CREATIVE_APP_PROFILES[aid]
    extras = list(extra_args or [])

    plan: Dict[str, Any] = {
        "app_id": aid,
        "profile": prof.to_dict(),
        "mode": m,
        "capability_id": prof.capability_id,
        "requires_approval": True,
        "argv_template": [],
        "shell_suggestion": "",
        "checklist": [
            "确认可执行文件路径与版本与文档一致",
            "确认 blend / project / 脚本仅位于 My Computer 登记目录或用户明确允许的根",
            "优先在审批中附脚本全文或哈希，避免 unseen code execution",
        ],
    }

    if aid == "blender" and m in ("blender_batch_python", "batch_python", "python"):
        bf = (blend_file or "").strip()
        sp = (script_path or "").strip()
        if not bf or not sp:
            raise ValueError("blender batch_python requires blend_file and script_path")
        argv = ["blender", "-b", bf, "-P", sp] + extras
        plan["argv_template"] = argv
        plan["shell_suggestion"] = " ".join(shlex_join(argv))
        plan["script_path"] = sp

    elif aid == "blender" and m in ("blender_batch_render", "batch_render", "render"):
        bf = (blend_file or "").strip()
        if not bf:
            raise ValueError("blender batch_render requires blend_file")
        out = (output_dir or "").strip() or "//out"
        argv = ["blender", "-b", bf, "-o", out, "-F", "PNG", "-x", "1", "-a"] + extras
        plan["argv_template"] = argv
        plan["shell_suggestion"] = " ".join(shlex_join(argv))

    elif aid == "unity" and m in ("unity_batch_method", "batch_method", "batch"):
        pp = (project_path or "").strip()
        em = (execute_method or "").strip()
        if not pp or not em:
            raise ValueError("unity batch_method requires project_path and execute_method")
        argv = ["Unity", "-batchmode", "-quit", "-projectPath", pp, "-executeMethod", em] + extras
        plan["argv_template"] = argv
        plan["shell_suggestion"] = " ".join(shlex_join(argv))

    elif aid == "unreal" and m in ("unreal_editor_headless", "headless", "pythonscript"):
        up = (uproject_file or "").strip()
        sp = (script_path or "").strip()
        if not up or not sp:
            raise ValueError("unreal headless requires uproject_file and script_path")
        argv = ["UnrealEditor-Cmd", up, "-run=pythonscript", f"-script={sp}"] + extras
        plan["argv_template"] = argv
        plan["shell_suggestion"] = " ".join(shlex_join(argv))

    elif aid == "photoshop" and m in ("photoshop_extendscript", "jsx", "extendscript"):
        sp = (script_path or "").strip()
        if not sp:
            raise ValueError("photoshop jsx requires script_path")
        argv = ["Photoshop", "-r", sp] + extras
        plan["argv_template"] = argv
        plan["shell_suggestion"] = " ".join(shlex_join(argv))
        plan["checklist"].append("本机 Photoshop 是否支持 -r；否则改用 GUI 自动化或 ExtendScript Toolkit 工作流")

    elif aid == "figma" and m in ("figma_connect_publish", "connect_publish", "publish"):
        token = (figma_token or "").strip()
        config = (figma_config_path or "").strip()
        directory = (figma_dir or "").strip()
        label = (figma_label or "").strip()
        argv = ["npx", "figma", "connect", "publish"]
        env = {}
        if token:
            env["FIGMA_ACCESS_TOKEN"] = token
        elif not os.environ.get("FIGMA_ACCESS_TOKEN"):
            plan["checklist"].append("未提供 token，执行前请设置 FIGMA_ACCESS_TOKEN 环境变量")
        if config:
            argv.extend(["--config", config])
        if directory:
            argv.extend(["--dir", directory])
        if label:
            argv.extend(["--label", label])
        if figma_file:
            argv.extend(["--file", figma_file])
        argv += extras
        plan["argv_template"] = argv
        plan["shell_suggestion"] = _shell_suggestion_with_env(argv, env)
        plan["checklist"].append("确认 figma.config.json 存在且 include/label/language 配置正确")
        plan["checklist"].append("publish 会覆盖设计文件中相同 label 的 Code Connect 映射")

    elif aid == "figma" and m in ("figma_connect_unpublish", "connect_unpublish", "unpublish"):
        node_url = (figma_node_url or "").strip()
        label = (figma_label or "").strip()
        config = (figma_config_path or "").strip()
        directory = (figma_dir or "").strip()
        argv = ["npx", "figma", "connect", "unpublish"]
        env = {}
        if not node_url and not label:
            raise ValueError("figma connect unpublish requires figma_node_url or figma_label")
        if node_url:
            argv.extend(["--node", node_url])
        if label:
            argv.extend(["--label", label])
        if config:
            argv.extend(["--config", config])
        if directory:
            argv.extend(["--dir", directory])
        argv += extras
        plan["argv_template"] = argv
        plan["shell_suggestion"] = _shell_suggestion_with_env(argv, env)
        plan["checklist"].append("未指定 node_url 时可能取消发布整个目录下的 Code Connect 映射")

    elif aid == "figma" and m in ("figma_connect_parse", "connect_parse", "parse"):
        config = (figma_config_path or "").strip()
        directory = (figma_dir or "").strip()
        file = (figma_file or "").strip()
        out_file = (output_dir or "").strip()  # borrow output_dir as --out-file
        argv = ["npx", "figma", "connect", "parse"]
        if config:
            argv.extend(["--config", config])
        if directory:
            argv.extend(["--dir", directory])
        if file:
            argv.extend(["--file", file])
        if out_file:
            argv.extend(["--out-file", out_file])
        argv += extras
        plan["argv_template"] = argv
        plan["shell_suggestion"] = " ".join(shlex_join(argv))

    elif aid == "figma" and m in ("figma_connect_preview", "connect_preview", "preview"):
        file = (figma_file or "").strip()
        if not file:
            raise ValueError("figma connect preview requires figma_file")
        argv = ["npx", "figma", "connect", "preview", "--file", file] + extras
        plan["argv_template"] = argv
        plan["shell_suggestion"] = " ".join(shlex_join(argv))

    elif aid == "figma" and m in ("figma_connect_migrate", "connect_migrate", "migrate"):
        directory = (figma_dir or "").strip()
        argv = ["npx", "figma", "connect", "migrate"]
        if directory:
            argv.extend(["--dir", directory])
        argv += extras
        plan["argv_template"] = argv
        plan["shell_suggestion"] = " ".join(shlex_join(argv))

    elif aid == "figma" and m in ("figma_connect_create", "connect_create", "create"):
        directory = (figma_dir or "").strip()
        argv = ["npx", "figma", "connect", "create"]
        if directory:
            argv.extend(["--dir", directory])
        argv += extras
        plan["argv_template"] = argv
        plan["shell_suggestion"] = " ".join(shlex_join(argv))

    else:
        raise ValueError(f"Unsupported combination app_id={aid} mode={m}")

    od = (output_dir or "").strip()
    if od:
        plan["output_dir_hint"] = od[:2000]

    try:
        from core.app_command_policy import probe_app_executables

        resolved = probe_app_executables().get(aid)
        if resolved:
            plan["resolved_executable"] = resolved
    except Exception:
        pass
    return plan


def plan_app_automation(
    *,
    app_id: str,
    mode: str,
    blend_file: str = "",
    project_path: str = "",
    uproject_file: str = "",
    script_path: str = "",
    execute_method: str = "",
    output_dir: str = "",
    figma_token: str = "",
    figma_config_path: str = "",
    figma_dir: str = "",
    figma_file: str = "",
    figma_node_url: str = "",
    figma_label: str = "",
    figma_language: str = "",
    extra_args: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Generic app automation planner; wraps creative profiles."""
    return plan_creative_action(
        app_id=app_id,
        mode=mode,
        blend_file=blend_file,
        project_path=project_path,
        uproject_file=uproject_file,
        script_path=script_path,
        execute_method=execute_method,
        output_dir=output_dir,
        figma_token=figma_token,
        figma_config_path=figma_config_path,
        figma_dir=figma_dir,
        figma_file=figma_file,
        figma_node_url=figma_node_url,
        figma_label=figma_label,
        figma_language=figma_language,
        extra_args=extra_args,
    )


def probe_creative_apps() -> Dict[str, Any]:
    from core.app_command_policy import probe_app_executables

    installed = {}
    for app_id in CREATIVE_APP_PROFILES:
        exe = probe_app_executables().get(app_id)
        installed[app_id] = {
            "installed": bool(exe),
            "executable_path": exe,
            "profile": CREATIVE_APP_PROFILES[app_id].to_dict(),
        }
    return installed


def shlex_join(parts: List[str]) -> List[str]:
    return [shlex.quote(p) for p in parts]


def _shell_suggestion_with_env(argv: List[str], env: Dict[str, str]) -> str:
    """Generate shell suggestion that prefixes environment variables when needed."""
    prefix = " ".join(f"{k}={shlex.quote(v)}" for k, v in env.items())
    cmd = " ".join(shlex_join(argv))
    return f"{prefix} {cmd}".strip()
