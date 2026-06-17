import asyncio
import sys
import os
import threading
import re as _re
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Auto-bootstrap Claude Code runtime (config + claude-agent-sdk in active venv)
try:
    from services.claude_code_service import ensure_claude_code_runtime

    ensure_claude_code_runtime(install_sdk=True)
except Exception as bootstrap_exc:
    print(f"Claude Code bootstrap skipped: {bootstrap_exc}")

# Fix for broken playwright in Documents folder on macOS and EPERM errors
# Fix for playwright in Documents folder on macOS
def _apply_playwright_fix():
    try:
        project_root = Path(__file__).parent.parent

        # Ensure a project-local tmp directory exists for local operations
        tmp_dir = project_root / "storage" / "tmp"
        tmp_dir.mkdir(parents=True, exist_ok=True)

        # Set browser path (respect Electron/desktop env when already set)
        if not os.environ.get("PLAYWRIGHT_BROWSERS_PATH"):
            os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(project_root / ".browsers")
    except Exception as e:
        print(f"Playwright setup failed: {e}")

_apply_playwright_fix()


def _setup_ffmpeg():
    """Ensure 'ffmpeg' is resolvable via shutil.which().

    imageio-ffmpeg bundles a static ffmpeg binary for each platform, but names
    it like 'ffmpeg-macos-aarch64-v7.1' instead of 'ffmpeg'.  We create a
    symlink (or copy on Windows) named 'ffmpeg'/'ffmpeg.exe' inside
    APP_DATA/bin/ — which main.js already prepends to PATH — so that every
    subprocess call using the bare 'ffmpeg' command finds it.
    """
    import shutil
    if shutil.which('ffmpeg'):
        return  # already in PATH (system install or previous run)
    try:
        import imageio_ffmpeg
        ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
        if not os.path.isfile(ffmpeg_exe):
            return

        # APP_DATA is the parent of storage/ (STORAGE_DIR env var set by main.js)
        storage_dir = os.environ.get('STORAGE_DIR', '')
        if storage_dir:
            bin_dir = os.path.join(os.path.dirname(storage_dir), 'bin')
        else:
            # Fallback for direct `python main.py` invocation
            bin_dir = str(Path(__file__).parent.parent / 'storage' / 'bin')

        os.makedirs(bin_dir, exist_ok=True)

        link_name = 'ffmpeg.exe' if sys.platform == 'win32' else 'ffmpeg'
        link_path = os.path.join(bin_dir, link_name)

        if not os.path.exists(link_path):
            try:
                os.symlink(os.path.abspath(ffmpeg_exe), link_path)
            except (OSError, NotImplementedError):
                # Windows may require Developer Mode for symlinks — copy instead
                shutil.copy2(ffmpeg_exe, link_path)
                if sys.platform != 'win32':
                    os.chmod(link_path, 0o755)

        # Ensure bin_dir is in PATH (redundant when main.js prepends it, but
        # useful when running the backend directly during development)
        current_path = os.environ.get('PATH', '')
        if bin_dir not in current_path.split(os.pathsep):
            os.environ['PATH'] = bin_dir + os.pathsep + current_path
    except Exception:
        pass  # Non-fatal: ffmpeg may still be available in system PATH


_setup_ffmpeg()

import json
from typing import List, Dict, Any, Optional, Annotated, Literal
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, BackgroundTasks, Request, Query, Depends
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from langserve import add_routes
from pydantic import BaseModel, Field
from agents.bot import get_media_base_agent
from agents.planning_bot import get_planning_graph
from agents.reviewer_bot import get_reviewer_base_agent
from agents.video_editor_agent import get_video_editor_base_agent
from agents.long_video_agent import get_long_video_base_agent
from agents.general_agent import get_creative_base_agent
from utils.logger import setup_logger
from utils.media_resolver import normalize_publish_media
from utils.task_manager import task_manager
from utils.trace_store import append_trace_event, create_trace, finalize_trace, get_trace, list_traces, update_trace_metadata
from core.security_deps import require_auth_when_enabled
from services.approval_service import approval_service
from core.super_agent_api import (
    approve_approval_response,
    cancel_task_response,
    create_approval_response,
    create_task_response,
    deny_approval_response,
    get_approval_response,
    get_capability_response,
    get_task_resume_payload,
    get_task_response,
    list_approvals_response,
    list_capabilities_response,
    list_tasks_response,
)
from core.local_computer import LocalComputerError, local_computer_service
from core.platform_capabilities import get_platform_profile, list_platform_profiles
from core.platform_actions import PlatformActionError, request_platform_action, resume_approved_platform_action

# 导入工具
from tools.script_tools import generate_script, generate_script_variants, get_platform_info
from tools.publisher_tools import publish_content_tool, get_publish_accounts_tool
from tools.copywriting_tools import generate_copywriting, generate_titles, rewrite_content, get_platform_copywriting_guide
from tools.moderation_tools import check_content, quick_check_sensitive_words, get_platform_rules, fix_content
from tools.media_tools import (
    generate_image, generate_video, generate_video_from_image_internal,
    generate_happyhorse_t2v_internal, generate_happyhorse_i2v_internal,
    save_upload_file, UPLOAD_DIR, remix_videos, ai_remix_videos,
    get_available_bgm, VOICE_OPTIONS, NARRATION_STYLES, SUBTITLE_STYLES, generate_speech_edge_tts,
    cut_video_segment, split_video, merge_clips, change_video_speed,
    overlay_video, add_text_overlay, apply_video_filter, extract_audio_track,
    replace_audio_track, generate_opencut_project, execute_edit_script,
)
from tools.long_video_tools import create_long_video_task, get_long_video_task, run_long_video_task
from tools.material_tools import has_stock_api_keys
from services.auto_video_pipeline import (
    AutoVideoParams,
    create_auto_video_task,
    get_auto_video_task,
    list_voice_options,
    run_auto_video_task,
)
from tools.trend_tools import analyze_trends, generate_hashtags

# 导入历史记录管理器
from utils.generation_history import add_generation_record, get_generation_history, clear_generation_history, delete_generation_record

# 初始化日志
logger = setup_logger("server")


def _extract_media_url_from_messages(messages) -> str:
    """
    Scan all agent messages (including ToolMessages with raw tool output)
    for a generated media URL/path and return a frontend-compatible path.
    Falls back to an empty string if nothing is found.
    """
    all_text = "\n".join(str(getattr(m, "content", "") or "") for m in messages)
    # FastAPI 静态路径 /media/<file>（长视频 produce_long_video 等）
    media_static = _re.search(
        r"(/media/[^\s\"'>\n]+\.(?:mp4|webm|jpg|jpeg|png|gif|webp))",
        all_text, _re.IGNORECASE,
    )
    if media_static:
        return media_static.group(1)
    # Absolute or relative local path containing storage/outputs/
    local = _re.search(
        r"\.?/(?:[^/\s]*/)*storage/outputs/([^\s\"'>\n]+\.(?:mp4|webm|jpg|jpeg|png|gif|webp))",
        all_text, _re.IGNORECASE,
    )
    if local:
        return f"/storage/outputs/{local.group(1)}"
    # Plain HTTP URL ending in a media extension
    http = _re.search(
        r"https?://\S+\.(?:jpg|jpeg|png|gif|webp|mp4|webm)(?:\?[^\s\"')>\n]*)*",
        all_text, _re.IGNORECASE,
    )
    if http:
        return http.group(0)
    return ""


try:
    from services.scheduler import scheduler_service
except Exception as _sched_err:
    import logging as _sched_log
    _sched_log.getLogger('main').error('Scheduler import failed: %s', _sched_err)
    class _DummyScheduler:  # type: ignore
        def start(self): pass
        def stop(self): pass
        def get_all_jobs(self): return []
        def create_job(self, *a, **kw): return {}
        def update_job(self, *a, **kw): return {}
        def delete_job(self, *a, **kw): return True
        def toggle_job(self, *a, **kw): return {}
        def run_job_now(self, *a, **kw): return {}
        def get_logs(self, *a, **kw): return []
        def delete_log(self, *a, **kw): return True
        def batch_delete_logs(self, *a, **kw): return 0
    scheduler_service = _DummyScheduler()
from services.computer_use_service import dispatch_computer_use_session
from tools.connectors.manager import get_connector_manager

# 初始化平台连接管理器
connector_manager = get_connector_manager()


def _record_trace_reflection(trace_id: str) -> None:
    if not trace_id:
        return
    try:
        from services.reflection_loop import reflect_trace

        reflect_trace(trace_id)
    except Exception as exc:
        logger.warning("Trace reflection skipped for %s: %s", trace_id, exc)


# 初始化 FastAPI 应用
app = FastAPI(
    title="Media Generation Agent API",
    version="1.0",
    description="A2UI-ready API for Media Generation Agent"
)

# 配置 CORS
from core.cors_config import get_cors_origins

_cors_origins = get_cors_origins()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials="*" not in _cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Auth / users routers
from routers import auth_router, users_router

app.include_router(auth_router.router)
app.include_router(users_router.router)
from routers import knowledge_router, customer_service_router

app.include_router(knowledge_router.router)
app.include_router(customer_service_router.router)

# Chat Platform Bridge (Feishu / Discord AI bot)
from routers import chat_platform_router

app.include_router(chat_platform_router.router)

# Labs 项目与素材元数据路由
from routers import media_assets

app.include_router(media_assets.router)

# 挂载静态文件目录 (用于访问生成的媒体文件)
# 使用与 media_tools 一致的根目录逻辑
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORAGE_DIR  = Path(PROJECT_ROOT) / "storage"
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "storage", "outputs")
os.makedirs(OUTPUT_DIR, exist_ok=True)
app.mount("/media", StaticFiles(directory=OUTPUT_DIR), name="media")

# 挂载上传目录 (用于访问上传的文件)
UPLOAD_DIR = os.path.join(PROJECT_ROOT, "storage", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="storage/uploads")

# 获取 API Key (通过统一供应商配置)
from core.llm_provider import get_api_key, get_provider_config, print_provider_info
provider_info = print_provider_info()
api_key = get_api_key()

# --- 应用生命周期: 调度器启动/停止 ---
@app.on_event("startup")
async def startup_event():
    from utils.auth import validate_jwt_secret_on_startup

    validate_jwt_secret_on_startup()
    scheduler_service.start()
    logger.info("⏰ Scheduler started on app startup")
    try:
        import services.computer_service as _computer_svc

        _computer_svc.resume_pending_index_jobs()
        logger.info("📁 Resumed pending My Computer index jobs")
    except Exception as _computer_idx_err:
        logger.warning("My Computer index resume skipped: %s", _computer_idx_err)
    try:
        from services.meal_feishu_reminder import refresh_reminder_schedule

        refresh_reminder_schedule()
    except Exception as _meal_rem_err:
        logger.warning("Meal reminder schedule skipped: %s", _meal_rem_err)

    try:
        import asyncio

        from services.native_sidecar_manager import ensure_sidecar_running

        async def _boot_native_sidecar() -> None:
            result = await asyncio.to_thread(ensure_sidecar_running, timeout=10.0)
            if result.get("ok"):
                logger.info("Native desktop sidecar ready on port %s", result.get("port"))
            else:
                logger.warning("Native desktop sidecar not ready: %s", result.get("reason"))

        asyncio.create_task(_boot_native_sidecar())
    except Exception as _sidecar_err:
        logger.warning("Native sidecar bootstrap skipped: %s", _sidecar_err)

    # Start Figma plugin bridge so the plugin can connect as soon as it opens
    try:
        from services.figma_plugin_bridge import get_figma_plugin_bridge

        bridge = get_figma_plugin_bridge()
        bridge.ensure_started()
        logger.info("🎨 Figma plugin bridge ready on ws://%s:%s/figma-plugin", bridge.host, bridge.port)
    except Exception as _figma_bridge_err:
        logger.warning("Figma plugin bridge startup skipped: %s", _figma_bridge_err)

    # Restore MCP presets first so agents can bind MCP tools on first build
    await _restore_managed_mcp_presets_on_startup()

    try:
        from agents.checkpoint import setup_checkpointer
        from agents.orchestrator import build_multi_agent_graph, clear_graph_cache

        await setup_checkpointer()
        clear_graph_cache()
        build_multi_agent_graph()
        logger.info("✅ Multi-agent graph pre-warmed (with checkpointer)")
    except Exception as _e:
        logger.warning(f"Graph pre-warm skipped: {_e}")

    # 初始化平台连接 (异步运行)
    logger.info("🔌 Initializing platform connectors...")
    import asyncio

    asyncio.create_task(connector_manager.initialize_all())

    try:
        import asyncio as _aio
        from services.session_state_db import ensure_session_db_ready

        await _aio.to_thread(ensure_session_db_ready)
    except Exception as _sess_err:
        logger.warning("Session DB init skipped: %s", _sess_err)

    # 启动 Discord Gateway（如启用）
    try:
        import asyncio

        from services.chat_platform.agent_bridge import handle_platform_message
        from services.chat_platform.discord_adapter import DiscordPlatformAdapter

        _discord_adapter = DiscordPlatformAdapter()

        def _on_discord_msg(msg: Any) -> None:
            asyncio.create_task(handle_platform_message(msg, adapter=_discord_adapter))

        if _discord_adapter.enabled:
            _discord_adapter.start(_on_discord_msg)
            logger.info("🎮 Discord chat platform gateway starting...")
    except Exception as _discord_err:
        logger.warning("Discord chat platform gateway skipped: %s", _discord_err)

@app.on_event("shutdown")
async def shutdown_event():
    scheduler_service.stop()
    logger.info("⏰ Scheduler stopped on app shutdown")
    try:
        from agents.checkpoint import shutdown_checkpointer

        await shutdown_checkpointer()
    except Exception as exc:
        logger.warning("Checkpointer shutdown skipped: %s", exc)

if not api_key:
    provider_config = get_provider_config()
    logger.warning(f"{provider_config.api_key_env} not found in env. Requests might fail.")


def _register_base_agent_route(path: str, factory, label: str):
    if not api_key:
        return
    executor = factory(api_key).get_executor(api_key)
    add_routes(app, executor, path=path)
    logger.info(f"✅ Registered {label} route at {path}")

# --- 1. 注册 Standard Tool Agent ---
# 适用于简单的单步任务
try:
    _register_base_agent_route("/agent", get_media_base_agent, "Standard Agent")
except Exception as e:
    logger.error(f"Failed to initialize Standard Agent: {e}")

# --- 2. 注册 Planning Agent ---
# 适用于复杂的任务规划
try:
    if api_key:
        planning_graph = get_planning_graph(api_key)
        add_routes(
            app,
            planning_graph,
            path="/planning",
        )
except Exception as e:
    logger.error(f"Failed to initialize Planning Agent: {e}")

# --- 3. 注册 Reviewer Agent ---
# 适用于内容审查和优化
try:
    _register_base_agent_route("/reviewer", get_reviewer_base_agent, "Reviewer Agent")
except Exception as e:
    logger.error(f"Failed to initialize Reviewer Agent: {e}")

@app.get("/api/lobster/config")
async def get_lobster_config():
    """获取 OpenClaw 节点配置"""
    from tools.lobster_tools import get_nodes_config
    return {"success": True, "nodes": get_nodes_config()}

@app.post("/api/lobster/config")
async def update_lobster_config(nodes: list):
    """更新并持久化 OpenClaw 节点配置"""
    from tools.lobster_tools import save_nodes_config
    success = save_nodes_config(nodes)
    return {"success": success}

@app.get("/api/lobster/detect")
async def detect_local_nodes():
    """侦测本地 OpenClaw 节点"""
    from tools.lobster_tools import scan_local_nodes
    nodes = scan_local_nodes()
    return {"success": True, "nodes": nodes}

# ------------------------------------------------------------------
# WebSocket & Agent Loop (保持不变)
# ------------------------------------------------------------------

# --- 4. 注册 Video Editor Agent (New standardized style) ---
try:
    _register_base_agent_route("/video-editor", get_video_editor_base_agent, "Video Editor Agent")
    _register_base_agent_route("/long-video-agent", get_long_video_base_agent, "Long Video Workshop Agent")
except Exception as e:
    logger.error(f"Failed to initialize Video Editor Agent: {e}")

# --- 5. 注册 General Agent (New standardized style) ---
try:
    _register_base_agent_route("/general-agent", get_creative_base_agent, "General Agent")
except Exception as e:
    logger.error(f"Failed to initialize General Agent: {e}")

# ===========================================
# 6. 多Agent协作系统初始化
# ===========================================
from agents.registry import AgentRegistry

_registry = AgentRegistry()

def _init_multi_agent_registry():
    """将所有 Agent 注册到全局注册表"""
    from agents.bot import get_media_base_agent, AGENT_ID as MEDIA_ID, AGENT_DESCRIPTION as MEDIA_DESC, AGENT_CAPABILITIES as MEDIA_CAPS
    from agents.general_agent import get_creative_base_agent, AGENT_ID as CREATIVE_ID, AGENT_DESCRIPTION as CREATIVE_DESC, AGENT_CAPABILITIES as CREATIVE_CAPS
    from agents.reviewer_bot import get_reviewer_base_agent, AGENT_ID as REVIEWER_ID, AGENT_DESCRIPTION as REVIEWER_DESC, AGENT_CAPABILITIES as REVIEWER_CAPS
    from agents.video_editor_agent import get_video_editor_base_agent, AGENT_ID as VE_ID, AGENT_DESCRIPTION as VE_DESC, AGENT_CAPABILITIES as VE_CAPS
    from agents.opencut_agent import get_opencut_base_agent, AGENT_ID as OC_ID, AGENT_DESCRIPTION as OC_DESC, AGENT_CAPABILITIES as OC_CAPS
    from agents.image_edit_agent import get_image_edit_base_agent, AGENT_ID as IE_ID, AGENT_DESCRIPTION as IE_DESC, AGENT_CAPABILITIES as IE_CAPS
    from agents.image_sr_agent import get_image_sr_base_agent, AGENT_ID as ISR_ID, AGENT_DESCRIPTION as ISR_DESC, AGENT_CAPABILITIES as ISR_CAPS
    from agents.long_video_agent import get_long_video_base_agent, AGENT_ID as LV_ID, AGENT_DESCRIPTION as LV_DESC, AGENT_CAPABILITIES as LV_CAPS
    from agents.architect import get_architect_base_agent, AGENT_ID as ARCH_ID, AGENT_DESCRIPTION as ARCH_DESC, AGENT_CAPABILITIES as ARCH_CAPS
    from agents.code_analyst_agent import (
        get_code_analyst_base_agent,
        AGENT_ID as CODE_ANALYST_ID,
        AGENT_DESCRIPTION as CODE_ANALYST_DESC,
        AGENT_CAPABILITIES as CODE_ANALYST_CAPS,
    )
    from agents.copywriter_agent import get_copywriter_base_agent, AGENT_ID as COPY_ID, AGENT_DESCRIPTION as COPY_DESC, AGENT_CAPABILITIES as COPY_CAPS
    from agents.script_writer_agent import get_script_writer_base_agent, AGENT_ID as SCRIPT_ID, AGENT_DESCRIPTION as SCRIPT_DESC, AGENT_CAPABILITIES as SCRIPT_CAPS
    from agents.trend_analyst_agent import get_trend_analyst_base_agent, AGENT_ID as TREND_ID, AGENT_DESCRIPTION as TREND_DESC, AGENT_CAPABILITIES as TREND_CAPS
    from agents.system_assistant_agent import (
        get_system_assistant_base_agent,
        AGENT_ID as SYS_ID,
        AGENT_DESCRIPTION as SYS_DESC,
        AGENT_CAPABILITIES as SYS_CAPS,
    )
    from agents.desktop_operator_agent import (
        get_desktop_operator_base_agent,
        AGENT_ID as DESKTOP_OP_ID,
        AGENT_DESCRIPTION as DESKTOP_OP_DESC,
        AGENT_CAPABILITIES as DESKTOP_OP_CAPS,
    )
    from agents.creative_desktop_agent import (
        get_creative_desktop_base_agent,
        AGENT_ID as CREATIVE_DESKTOP_ID,
        AGENT_DESCRIPTION as CREATIVE_DESKTOP_DESC,
        AGENT_CAPABILITIES as CREATIVE_DESKTOP_CAPS,
    )
    from agents.programmer_agent import (
        get_programmer_base_agent,
        AGENT_ID as PROG_ID,
        AGENT_DESCRIPTION as PROG_DESC,
        AGENT_CAPABILITIES as PROG_CAPS,
    )
    from agents.product_manager_agent import (
        get_product_manager_base_agent,
        AGENT_ID as PM_ID,
        AGENT_DESCRIPTION as PM_DESC,
        AGENT_CAPABILITIES as PM_CAPS,
    )
    from agents.legal_agent import (
        get_legal_base_agent,
        AGENT_ID as LEGAL_ID,
        AGENT_DESCRIPTION as LEGAL_DESC,
        AGENT_CAPABILITIES as LEGAL_CAPS,
    )
    from agents.ad_campaign_agent import (
        get_ad_campaign_base_agent,
        AGENT_ID as AD_ID,
        AGENT_DESCRIPTION as AD_DESC,
        AGENT_CAPABILITIES as AD_CAPS,
    )
    from agents.business_partnership_agent import (
        get_business_partnership_base_agent,
        AGENT_ID as BP_ID,
        AGENT_DESCRIPTION as BP_DESC,
        AGENT_CAPABILITIES as BP_CAPS,
    )
    from agents.procurement_agent import (
        get_procurement_base_agent,
        AGENT_ID as PROC_ID,
        AGENT_DESCRIPTION as PROC_DESC,
        AGENT_CAPABILITIES as PROC_CAPS,
    )
    from agents.game_art_agent import (
        get_game_art_base_agent,
        AGENT_ID as GA_ID,
        AGENT_DESCRIPTION as GA_DESC,
        AGENT_CAPABILITIES as GA_CAPS,
    )
    from agents.game_design_agent import (
        get_game_design_base_agent,
        AGENT_ID as GD_ID,
        AGENT_DESCRIPTION as GD_DESC,
        AGENT_CAPABILITIES as GD_CAPS,
    )

    _registry.register(MEDIA_ID, get_media_base_agent, MEDIA_DESC, MEDIA_CAPS)
    _registry.register(CREATIVE_ID, get_creative_base_agent, CREATIVE_DESC, CREATIVE_CAPS)
    _registry.register(REVIEWER_ID, get_reviewer_base_agent, REVIEWER_DESC, REVIEWER_CAPS)
    _registry.register(VE_ID, get_video_editor_base_agent, VE_DESC, VE_CAPS)
    _registry.register(OC_ID, get_opencut_base_agent, OC_DESC, OC_CAPS)
    _registry.register(IE_ID, get_image_edit_base_agent, IE_DESC, IE_CAPS)
    _registry.register(ISR_ID, get_image_sr_base_agent, ISR_DESC, ISR_CAPS)
    _registry.register(LV_ID, get_long_video_base_agent, LV_DESC, LV_CAPS)
    _registry.register(ARCH_ID, get_architect_base_agent, ARCH_DESC, ARCH_CAPS)
    _registry.register(CODE_ANALYST_ID, get_code_analyst_base_agent, CODE_ANALYST_DESC, CODE_ANALYST_CAPS)
    _registry.register(COPY_ID, get_copywriter_base_agent, COPY_DESC, COPY_CAPS)
    _registry.register(SCRIPT_ID, get_script_writer_base_agent, SCRIPT_DESC, SCRIPT_CAPS)
    _registry.register(TREND_ID, get_trend_analyst_base_agent, TREND_DESC, TREND_CAPS)
    _registry.register(SYS_ID, get_system_assistant_base_agent, SYS_DESC, SYS_CAPS)
    _registry.register(DESKTOP_OP_ID, get_desktop_operator_base_agent, DESKTOP_OP_DESC, DESKTOP_OP_CAPS)
    _registry.register(CREATIVE_DESKTOP_ID, get_creative_desktop_base_agent, CREATIVE_DESKTOP_DESC, CREATIVE_DESKTOP_CAPS)
    _registry.register(PROG_ID, get_programmer_base_agent, PROG_DESC, PROG_CAPS)
    _registry.register(PM_ID, get_product_manager_base_agent, PM_DESC, PM_CAPS)
    _registry.register(LEGAL_ID, get_legal_base_agent, LEGAL_DESC, LEGAL_CAPS)
    _registry.register(AD_ID, get_ad_campaign_base_agent, AD_DESC, AD_CAPS)
    _registry.register(BP_ID, get_business_partnership_base_agent, BP_DESC, BP_CAPS)
    _registry.register(PROC_ID, get_procurement_base_agent, PROC_DESC, PROC_CAPS)
    _registry.register(GA_ID, get_game_art_base_agent, GA_DESC, GA_CAPS)
    _registry.register(GD_ID, get_game_design_base_agent, GD_DESC, GD_CAPS)

    # AI Short Drama / Podcast / Music
    from agents.short_drama_agent import get_short_drama_base_agent, AGENT_ID as SD_ID, AGENT_DESCRIPTION as SD_DESC, AGENT_CAPABILITIES as SD_CAPS
    from agents.podcast_agent import get_podcast_base_agent, AGENT_ID as POD_ID, AGENT_DESCRIPTION as POD_DESC, AGENT_CAPABILITIES as POD_CAPS
    from agents.music_agent import get_music_base_agent, AGENT_ID as MU_ID, AGENT_DESCRIPTION as MU_DESC, AGENT_CAPABILITIES as MU_CAPS
    _registry.register(SD_ID, get_short_drama_base_agent, SD_DESC, SD_CAPS)
    _registry.register(POD_ID, get_podcast_base_agent, POD_DESC, POD_CAPS)
    _registry.register(MU_ID, get_music_base_agent, MU_DESC, MU_CAPS)

    # 🦞 龙虾流水线 Agent
    from agents.lobster_bot import get_lobster_base_agent, AGENT_ID as LOBSTER_ID, AGENT_DESCRIPTION as LOBSTER_DESC, AGENT_CAPABILITIES as LOBSTER_CAPS
    _registry.register(LOBSTER_ID, get_lobster_base_agent, LOBSTER_DESC, LOBSTER_CAPS)

    logger.info(f"✅ Multi-agent registry initialized with {len(_registry.agent_ids)} agents")

try:
    _init_multi_agent_registry()
except Exception as e:
    logger.error(f"Failed to initialize multi-agent registry: {e}")


# --- 多Agent协作 API ---

class MultiAgentRequest(BaseModel):
    input: str
    agent_id: Optional[str] = None
    session_id: Optional[str] = None


class MemoryCreateRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=8000)
    memory_type: str = Field(default="fact", max_length=64)
    source: str = Field(default="user", max_length=64)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    inferred: bool = False


class EvolutionSignalRequest(BaseModel):
    target_type: str = Field(..., min_length=1, max_length=80)
    target_id: str = Field(..., min_length=1, max_length=200)
    signal: str = Field(..., min_length=1, max_length=32)
    comment: str = Field(default="", max_length=2000)
    source: str = Field(default="user", max_length=64)
    trace_id: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class LearningEventRequest(BaseModel):
    kind: str = Field(..., min_length=1, max_length=80)
    session_id: Optional[str] = None
    trace_id: Optional[str] = None
    source: str = Field(default="api", max_length=80)
    channel: str = Field(default="local", max_length=80)
    action: str = Field(default="", max_length=120)
    status: str = Field(default="ok", max_length=40)
    summary: str = Field(default="", max_length=2000)
    artifact_ref: Optional[str] = None
    token_usage: Dict[str, Any] = Field(default_factory=dict)
    cost: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class LearningCuratorRunRequest(BaseModel):
    dry_run: bool = True
    limit: int = Field(default=200, ge=1, le=1000)


class MemoryUsageOutcomeRequest(BaseModel):
    memory_id: str = Field(..., min_length=1, max_length=200)
    outcome: str = Field(..., min_length=1, max_length=40)
    trace_id: Optional[str] = None
    source: str = Field(default="user", max_length=80)
    comment: str = Field(default="", max_length=2000)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class KnowledgeLayerClassifyRequest(BaseModel):
    content: str = Field(default="", max_length=8000)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class SessionRecallSearchRequest(BaseModel):
    query: str = Field(default="", max_length=2000)
    role_filter: Optional[str] = Field(default=None, max_length=80)
    limit: int = Field(default=3, ge=1, le=20)
    current_session_id: str = Field(default="", max_length=200)
    current_trace_id: str = Field(default="", max_length=200)
    session_id: str = Field(default="", max_length=200)
    around_message_id: Optional[int] = Field(default=None, ge=1)
    window: int = Field(default=5, ge=1, le=20)


class TaskCreateRequest(BaseModel):
    task_type: str = Field(..., min_length=1, max_length=80)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ApprovalCreateRequest(BaseModel):
    capability_id: str
    proposed_action: str = Field(..., min_length=1)
    args: Dict[str, Any] = Field(default_factory=dict)
    trace_id: Optional[str] = None
    task_id: Optional[str] = None
    expires_in_seconds: int = Field(3600, ge=30, le=86400)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class MediaPipelineStartRequest(BaseModel):
    goal: str = Field(..., min_length=1, max_length=8000)
    trace_id: Optional[str] = None


class MediaPipelineStepRequest(BaseModel):
    step_id: str = Field(..., min_length=1, max_length=64)
    status: str = Field(..., min_length=1, max_length=32)
    artifact: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    message: Optional[str] = None
    persist_to_history: bool = False
    persist_to_knowledge: bool = False


class MediaPipelineResearchRequest(BaseModel):
    query: Optional[str] = Field(None, max_length=4000)
    max_results: int = Field(10, ge=1, le=20)
    region: str = Field("", max_length=32)


class MediaPipelineGateRequest(BaseModel):
    step_id: str = Field(..., min_length=1, max_length=64)
    artifact: Optional[Dict[str, Any]] = None
    note: str = Field("", max_length=4000)
    persist_to_history: bool = False
    persist_to_knowledge: bool = False


class ResearchWebSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=4000)
    max_results: int = Field(10, ge=1, le=20)
    region: str = Field("", max_length=32)
    trace_id: Optional[str] = None


class ResearchSaveToKnowledgeRequest(BaseModel):
    artifact: Dict[str, Any]
    filename_base: Optional[str] = Field(None, max_length=160)
    trace_id: Optional[str] = None


class ResearchContentPlanRequest(BaseModel):
    artifact: Optional[Dict[str, Any]] = None
    artifacts: Optional[List[Dict[str, Any]]] = None
    platform: str = Field(default="douyin", max_length=32)
    goal: str = Field(default="", max_length=4000)
    trace_id: Optional[str] = None


class Last30DaysResearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=4000)
    mode: Literal["quick", "deep"] = "quick"
    platform: str = Field(default="douyin", max_length=32)
    goal: str = Field(default="", max_length=4000)
    trace_id: Optional[str] = None


class CreativeAppsPlanRequest(BaseModel):
    app_id: str = Field(..., min_length=1, max_length=32)
    mode: str = Field(..., min_length=1, max_length=64)
    blend_file: str = Field("", max_length=4000)
    project_path: str = Field("", max_length=4000)
    uproject_file: str = Field("", max_length=4000)
    script_path: str = Field("", max_length=4000)
    execute_method: str = Field("", max_length=512)
    output_dir: str = Field("", max_length=4000)
    figma_token: str = Field("", max_length=2000)
    figma_config_path: str = Field("", max_length=4000)
    figma_dir: str = Field("", max_length=4000)
    figma_file: str = Field("", max_length=4000)
    figma_node_url: str = Field("", max_length=4000)
    figma_label: str = Field("", max_length=256)
    figma_language: str = Field("", max_length=64)
    extra_args: Optional[List[str]] = None


class DesktopAutomationPlanRequest(BaseModel):
    app_id: str = Field(..., min_length=1, max_length=64)
    mode: str = Field("", max_length=64)
    user_goal: str = Field("", max_length=4000)
    blend_file: str = Field("", max_length=4000)
    project_path: str = Field("", max_length=4000)
    uproject_file: str = Field("", max_length=4000)
    script_path: str = Field("", max_length=4000)
    execute_method: str = Field("", max_length=512)
    output_dir: str = Field("", max_length=4000)
    extra_args: Optional[List[str]] = None


class DesktopAutomationRunRequest(BaseModel):
    plan: Dict[str, Any]
    working_dir: str = Field(..., min_length=1, max_length=4000)
    trace_id: Optional[str] = None


class NativeUseRunRequest(BaseModel):
    goal: str = Field(..., min_length=1, max_length=4000)
    app_hint: str = Field("", max_length=256)
    trace_id: Optional[str] = None
    require_approval: bool = True


class CompanionPersonaBody(BaseModel):
    name: Optional[str] = Field(None, max_length=64)
    traits: Optional[str] = Field(None, max_length=500)
    tone: Optional[str] = Field(None, max_length=500)


class CompanionPreferencesBody(BaseModel):
    topics: Optional[List[str]] = None
    avoid: Optional[List[str]] = None


class CompanionMoodBody(BaseModel):
    label: Optional[str] = Field(None, max_length=32)
    note: Optional[str] = Field(None, max_length=2000)
    permission: Optional[Literal["default", "auto_audit", "full_access"]] = None


class CompanionPetBody(BaseModel):
    name: Optional[str] = Field(None, max_length=64)
    species: Optional[str] = Field(None, max_length=64)
    stage: Optional[str] = Field(None, max_length=32)
    care_score: Optional[int] = Field(default=None, ge=0, le=1_000_000)


class CompanionFeedbackBody(BaseModel):
    kind: str = Field(default="note", max_length=32)
    text: str = Field(..., min_length=1, max_length=2000)


class CompanionStatePatchRequest(BaseModel):
    persona: Optional[CompanionPersonaBody] = None
    preferences: Optional[CompanionPreferencesBody] = None
    mood: Optional[CompanionMoodBody] = None
    pet: Optional[CompanionPetBody] = None
    memory_tag_ids: Optional[List[str]] = None
    growth_add_xp: int = Field(0, ge=0, le=500)
    growth_set_title: Optional[str] = Field(None, max_length=64)
    append_feedback: Optional[CompanionFeedbackBody] = None


class ApprovalResolveRequest(BaseModel):
    approved_by: str = "local_user"
    reason: Optional[str] = None
    auto_resume_computer_use: bool = Field(
        default=False,
        description="批准后后台继续 Computer Use（仅 metadata.source=computer_use）",
    )
    auto_resume_platform_action: bool = Field(
        default=False,
        description="批准后后台执行 platform_action Resume（仅 metadata.source=platform_actions）",
    )
    auto_resume_local_computer: bool = Field(
        default=False,
        description="批准后后台执行本地电脑动作 Resume（仅 metadata.source=local_computer）",
    )
    auto_resume_system_assistant: bool = Field(
        default=False,
        description="批准后后台继续 System Assistant 任务（仅 metadata.source=system_assistant）",
    )
    auto_resume_programmer_agent: bool = Field(
        default=False,
        description="批准后后台继续 Programmer Agent 任务（仅 metadata.source=programmer_agent）",
    )
    auto_resume_native_use: bool = Field(
        default=False,
        description="批准后后台继续原生桌面自动化（仅 metadata.source=native_use）",
    )


def _persist_computer_use_task_result(task_id: str, result: Dict[str, Any]) -> None:
    if not isinstance(result, dict):
        return
    status = result.get("status")
    if status == "waiting_approval":
        task_manager.update_task(
            task_id,
            status="waiting_approval",
            result=result,
            message="等待审批",
        )
        return
    if status == "cancelled" or result.get("cancel_requested"):
        task_manager.update_task(
            task_id,
            status="cancelled",
            result=result,
            message="任务已取消",
        )
        return
    if result.get("success"):
        task_manager.update_task(
            task_id,
            status="completed",
            progress=100,
            result=result,
            message="Computer Use 会话完成",
        )
    else:
        task_manager.update_task(
            task_id,
            status="failed",
            result=result,
            error=str(result.get("error") or "执行失败")[:1000],
            message=str(result.get("error") or "执行失败")[:200],
        )


async def _execute_computer_use_resume_task(task_id: str) -> Dict[str, Any]:
    resume_payload = get_task_resume_payload(task_id)
    if not resume_payload:
        raise ValueError("Task not found")
    goal = resume_payload["goal"]
    start_url = resume_payload.get("start_url") or ""
    nav = (resume_payload.get("resume_navigation_url") or "").strip()
    page_ctx = resume_payload.get("page_context_at_block")
    if not goal or (not str(start_url).strip() and not nav):
        raise ValueError("Task resume payload is incomplete")
    eff_start = str(start_url).strip() or nav
    result = await dispatch_computer_use_session(
        goal=goal,
        start_url=eff_start,
        max_rounds=resume_payload["max_rounds"],
        headless=resume_payload["headless"],
        autoresearch=resume_payload["autoresearch"],
        require_approval=resume_payload["require_approval"],
        task_id=task_id,
        trace_id=resume_payload.get("trace_id"),
        resume_navigation_url=nav if nav else None,
        resume_page_context=page_ctx if isinstance(page_ctx, dict) else None,
    )
    if isinstance(result, dict):
        result.setdefault("task_id", task_id)
        result.setdefault("resumed_from_approval_id", resume_payload.get("approved_approval_id"))
        _persist_computer_use_task_result(task_id, result)
    return result


async def _background_computer_use_run(
    task_id: str,
    goal: str,
    start_url: str,
    max_rounds: int,
    headless: bool,
    autoresearch: bool,
    require_approval: bool,
    trace_id: Optional[str],
) -> None:
    try:
        result = await dispatch_computer_use_session(
            goal=goal,
            start_url=start_url,
            max_rounds=max_rounds,
            headless=headless,
            autoresearch=autoresearch,
            require_approval=require_approval,
            task_id=task_id,
            trace_id=trace_id,
        )
        if isinstance(result, dict):
            result.setdefault("task_id", task_id)
            _persist_computer_use_task_result(task_id, result)
    except Exception as exc:
        logger.error("Background Computer Use run failed for %s: %s", task_id, exc, exc_info=True)
        task_manager.update_task(task_id, status="failed", error=str(exc)[:1000])


async def _background_computer_use_resume(task_id: str) -> None:
    try:
        await _execute_computer_use_resume_task(task_id)
    except ValueError as exc:
        logger.warning("Background Computer Use resume skipped for %s: %s", task_id, exc)
    except Exception as exc:
        logger.error("Background Computer Use resume failed for %s: %s", task_id, exc, exc_info=True)


async def _background_platform_action_resume(task_id: str) -> None:
    try:
        await resume_approved_platform_action(task_id)
    except PlatformActionError as exc:
        logger.warning("Background platform_action resume skipped for %s: %s", task_id, exc)
    except Exception as exc:
        logger.error("Background platform_action resume failed for %s: %s", task_id, exc, exc_info=True)


def _background_local_computer_resume(task_id: str) -> None:
    try:
        local_computer_service.resume_approved_action(task_id)
    except LocalComputerError as exc:
        logger.warning("Background local_computer resume skipped for %s: %s", task_id, exc)
    except Exception as exc:
        logger.error("Background local_computer resume failed for %s: %s", task_id, exc, exc_info=True)


def _background_system_assistant_resume(task_id: str) -> None:
    try:
        from services import system_assistant_service

        system_assistant_service.resume_task(task_id)
    except ValueError as exc:
        logger.warning("Background system_assistant resume skipped for %s: %s", task_id, exc)
    except Exception as exc:
        logger.error("Background system_assistant resume failed for %s: %s", task_id, exc, exc_info=True)


def _background_programmer_agent_resume(task_id: str) -> None:
    try:
        from services import programmer_service

        programmer_service.resume_task(task_id)
    except ValueError as exc:
        logger.warning("Background programmer_agent resume skipped for %s: %s", task_id, exc)
    except Exception as exc:
        logger.error("Background programmer_agent resume failed for %s: %s", task_id, exc, exc_info=True)


def _background_native_use_resume(task_id: str) -> None:
    try:
        from services.native_use_service import resume_approved_native_use_task

        resume_approved_native_use_task(task_id)
    except ValueError as exc:
        logger.warning("Background native_use resume skipped for %s: %s", task_id, exc)
    except Exception as exc:
        logger.error("Background native_use resume failed for %s: %s", task_id, exc, exc_info=True)


@app.get("/capabilities")
async def api_list_capabilities():
    return list_capabilities_response()


@app.get("/capabilities/{capability_id}")
async def api_get_capability(capability_id: str):
    try:
        return get_capability_response(capability_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Capability not found")


@app.get("/creative-apps/profiles")
async def api_creative_apps_profiles():
    """Blender / Unity / Unreal / Photoshop 元数据矩阵（不含执行；执行走本地电脑 + 审批）。"""
    from core.creative_software import list_creative_app_profiles

    return {"profiles": list_creative_app_profiles()}


@app.get("/creative-apps/profiles/{app_id}")
async def api_creative_app_profile(app_id: str):
    from core.creative_software import get_creative_app_profile

    prof = get_creative_app_profile(app_id)
    if not prof:
        raise HTTPException(status_code=404, detail="Unknown creative app")
    return prof


@app.post("/creative-apps/plan")
async def api_creative_apps_plan(req: CreativeAppsPlanRequest):
    """生成 CLI argv 模板与 shell 引用建议；不启动进程。"""
    from core.creative_software import plan_creative_action

    try:
        plan = plan_creative_action(
            app_id=req.app_id,
            mode=req.mode,
            blend_file=req.blend_file,
            project_path=req.project_path,
            uproject_file=req.uproject_file,
            script_path=req.script_path,
            execute_method=req.execute_method,
            output_dir=req.output_dir,
            figma_token=req.figma_token,
            figma_config_path=req.figma_config_path,
            figma_dir=req.figma_dir,
            figma_file=req.figma_file,
            figma_node_url=req.figma_node_url,
            figma_label=req.figma_label,
            figma_language=req.figma_language,
            extra_args=req.extra_args,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"success": True, "plan": plan}


@app.get("/desktop/environment")
async def api_desktop_environment(ensure_sidecar: bool = False):
    """Desktop operator environment: platform, roots, creative apps, sidecar."""
    from services import desktop_operator_service

    return desktop_operator_service.get_environment(ensure_sidecar=ensure_sidecar)


@app.post("/desktop/sidecar/ensure")
async def api_desktop_sidecar_ensure():
    """Try to start native sidecar and return health status."""
    from services import desktop_operator_service

    return desktop_operator_service.get_environment(ensure_sidecar=True)


@app.get("/desktop/apps")
async def api_desktop_apps(q: str = "", limit: int = 50):
    from services import desktop_operator_service

    return {"apps": desktop_operator_service.search_apps(q, limit=min(limit, 200))}


@app.get("/figma-plugin/status")
async def api_figma_plugin_status():
    """Return the connection status of the AI Media Agent Figma plugin bridge."""
    from services.figma_plugin_bridge import get_figma_plugin_bridge

    bridge = get_figma_plugin_bridge()
    bridge.ensure_started()
    return bridge.status()


@app.post("/figma-plugin/register")
async def api_figma_plugin_register():
    """Register a new HTTP long-polling session for the Figma plugin."""
    import asyncio

    from services.figma_plugin_bridge import get_figma_plugin_bridge

    bridge = get_figma_plugin_bridge()
    session_id = await asyncio.to_thread(bridge.register_http_session)
    return {"session_id": session_id}


@app.get("/figma-plugin/poll/{session_id}")
async def api_figma_plugin_poll(session_id: str, timeout: float = 25.0):
    """Long-poll for the next command for a given Figma plugin session."""
    from services.figma_plugin_bridge import get_figma_plugin_bridge

    bridge = get_figma_plugin_bridge()
    command = await bridge.poll_http_command(session_id, timeout=min(timeout, 30.0))
    return {"command": command}


@app.post("/figma-plugin/response/{session_id}")
async def api_figma_plugin_response(session_id: str, body: dict):
    """Submit a plugin response via HTTP."""
    from services.figma_plugin_bridge import get_figma_plugin_bridge

    bridge = get_figma_plugin_bridge()
    ok = await bridge.submit_http_response(session_id, body)
    if not ok:
        raise HTTPException(status_code=404, detail="session not found")
    return {"ok": True}


@app.post("/desktop/automation/plan")
async def api_desktop_automation_plan(req: DesktopAutomationPlanRequest):
    from services import desktop_operator_service

    try:
        result = desktop_operator_service.plan_automation(
            app_id=req.app_id,
            mode=req.mode,
            user_goal=req.user_goal,
            blend_file=req.blend_file,
            project_path=req.project_path,
            uproject_file=req.uproject_file,
            script_path=req.script_path,
            execute_method=req.execute_method,
            output_dir=req.output_dir,
            extra_args=req.extra_args,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"success": True, **result}


@app.post("/desktop/automation/run")
async def api_desktop_automation_run(req: DesktopAutomationRunRequest):
    from services import desktop_operator_service

    try:
        result = desktop_operator_service.submit_cli_execution(
            req.plan,
            req.working_dir,
            trace_id=req.trace_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return result


@app.post("/native-use/run")
async def api_native_use_run(req: NativeUseRunRequest):
    from services.native_use_service import start_native_use_task

    try:
        return start_native_use_task(
            goal=req.goal,
            app_hint=req.app_hint,
            trace_id=req.trace_id,
            require_approval=req.require_approval,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/native-use/{task_id}/resume")
async def api_native_use_resume(task_id: str):
    """审批通过后继续执行原生桌面 GUI 自动化。"""
    from services.native_use_service import resume_approved_native_use_task

    try:
        return resume_approved_native_use_task(task_id)
    except ValueError as exc:
        detail = str(exc)
        if detail == "task not found":
            raise HTTPException(status_code=404, detail=detail)
        raise HTTPException(status_code=409, detail=detail)


@app.get("/native-use/{task_id}/session-log")
async def api_native_use_session_log(task_id: str):
    """获取原生桌面 GUI 自动化的完整会话日志（含逐步截图路径）。"""
    from services.native_use_session_log import load_session_log

    doc = load_session_log(task_id)
    if not doc:
        raise HTTPException(status_code=404, detail="session log not found")
    return doc


@app.get("/native-use/app-memory/{app_hint}")
async def api_native_use_app_memory(app_hint: str, goal: str = ""):
    """获取指定应用的历史成功操作记忆。"""
    from services.native_use_memory import get_app_memories

    return {"app_hint": app_hint, "memories": get_app_memories(app_hint, goal)}


@app.get("/native-use/media/{rel_path:path}")
async def api_native_use_media(rel_path: str):
    """Serve session screenshots under storage/desktop/ only."""
    from pathlib import Path

    project_root = Path(__file__).resolve().parent.parent
    safe = rel_path.replace("\\", "/").lstrip("/")
    if ".." in safe.split("/") or not safe.startswith("desktop/"):
        raise HTTPException(status_code=400, detail="invalid path")
    full = project_root / "storage" / safe
    if not full.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    from fastapi.responses import FileResponse

    return FileResponse(full, media_type="image/png")


@app.get("/companion/state")
async def api_companion_state_get():
    """AI 伙伴长期状态（人格、偏好、情绪、成长、宠物占位、复盘条目）。"""
    from core.companion_state import get_companion_state

    return get_companion_state()


@app.patch("/companion/state")
async def api_companion_state_patch(req: CompanionStatePatchRequest):
    """合并更新伙伴状态；不写 context memory 本体，可用 memory_tag_ids 挂接外部记忆 ID。"""
    from core.companion_state import patch_companion_state

    payload = req.model_dump(exclude_none=True)
    if "append_feedback" in payload and payload["append_feedback"] is not None:
        payload["append_feedback"] = dict(payload["append_feedback"])
    return patch_companion_state(payload)


@app.post("/companion/pet/chat/stream")
async def api_companion_pet_chat_stream(body: dict):
    """桌宠 Sidecar 结构化对话 SSE（轻量 pet graph + 可选 Agent 分流）。"""
    from routers.companion_pet_router import PetChatRequestBody, api_pet_chat_stream

    return await api_pet_chat_stream(PetChatRequestBody.model_validate(body))


@app.post("/companion/pet/context")
async def api_companion_pet_context(body: dict):
    """Tauri 感知上下文上报（前台 App、剪贴板、idle）。"""
    from routers.companion_pet_router import PetContextBody, api_pet_context_post

    return await api_pet_context_post(PetContextBody.model_validate(body))


@app.get("/companion/pet/status")
async def api_companion_pet_status():
    """桌宠混合大脑状态（Ollama 可用性、模型、care_score stage）。"""
    from routers.companion_pet_router import api_pet_status_get

    return await api_pet_status_get()


@app.post("/companion/pet/wake")
async def api_companion_pet_wake(body: dict | None = None):
    """唤醒波尼桌宠：返回问候 action/text（支持托盘、快捷键、定时 nudge）。"""
    from routers.companion_pet_router import PetWakeRequestBody, api_pet_wake_post

    payload = body or {}
    return await api_pet_wake_post(PetWakeRequestBody.model_validate(payload))


@app.get("/companion/pet/bootstrap")
async def api_companion_pet_bootstrap(source: str = "startup", fast: bool = True):
    """桌宠启动一次拉取：companion 状态 + 唤醒问候（fast 跳过 dream 以加速）。"""
    from routers.companion_pet_router import api_pet_bootstrap_get

    return await api_pet_bootstrap_get(source=source, fast=fast)


@app.post("/companion/pet/transcribe")
async def api_companion_pet_transcribe(body: dict):
    """桌宠语音输入：上传短录音，返回转写文本（Qwen-ASR / GLM-ASR / Whisper）。"""
    from routers.companion_pet_router import PetTranscribeBody, api_pet_transcribe_post

    return await api_pet_transcribe_post(PetTranscribeBody.model_validate(body))


@app.get("/companion/pet/transcribe/status")
async def api_companion_pet_transcribe_status():
    """桌宠 STT 诊断：API Key 与 ffmpeg 可用性。"""
    from routers.companion_pet_router import api_pet_transcribe_status_get

    return await api_pet_transcribe_status_get()


@app.post("/tasks")
async def api_create_task(req: TaskCreateRequest):
    return create_task_response(req.task_type, metadata=req.metadata)


@app.get("/tasks")
async def api_list_tasks(status: Optional[str] = None, limit: int = 100, count_only: bool = False):
    tasks = task_manager.list_tasks(status=status, limit=limit)
    if count_only:
        return {"count": len(tasks)}
    return {"tasks": tasks}


@app.get("/tasks/{task_id}")
async def api_get_task(task_id: str):
    task = get_task_response(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@app.post("/media-pipeline/start")
async def api_media_pipeline_start(req: MediaPipelineStartRequest):
    from core.media_pipeline import create_media_pipeline_task

    task_id = create_media_pipeline_task(req.goal, trace_id=req.trace_id)
    task = get_task_response(task_id)
    if not task:
        raise HTTPException(status_code=500, detail="Failed to create media pipeline task")
    return task


@app.post("/media-pipeline/{task_id}/step")
async def api_media_pipeline_step(task_id: str, req: MediaPipelineStepRequest):
    from core.media_pipeline import advance_media_pipeline_step

    try:
        return advance_media_pipeline_step(
            task_id,
            step_id=req.step_id,
            status=req.status,
            artifact=req.artifact,
            error=req.error,
            message=req.message,
            persist_to_history=req.persist_to_history,
            persist_to_knowledge=req.persist_to_knowledge,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@app.post("/media-pipeline/{task_id}/research")
async def api_media_pipeline_research(task_id: str, req: MediaPipelineResearchRequest):
    """多媒体流水线联网调研：默认使用任务 goal 作为检索词，结果写入任务 metadata 并可同步 trace。"""
    from core.media_pipeline import run_media_pipeline_research

    try:
        return run_media_pipeline_research(
            task_id,
            query=req.query,
            max_results=req.max_results,
            region=req.region,
        )
    except ValueError as exc:
        detail = str(exc)
        if detail == "Task not found":
            raise HTTPException(status_code=404, detail=detail)
        raise HTTPException(status_code=409, detail=detail)


@app.post("/media-pipeline/{task_id}/gate")
async def api_media_pipeline_gate(task_id: str, req: MediaPipelineGateRequest):
    """将指定流水线步骤提交人工审批（分镜/画面/成片/发布文案等闸口）。"""
    from core.media_pipeline import submit_media_pipeline_step_for_approval

    try:
        return submit_media_pipeline_step_for_approval(
            task_id,
            step_id=req.step_id,
            artifact=req.artifact,
            note=req.note,
            persist_to_history=req.persist_to_history,
            persist_to_knowledge=req.persist_to_knowledge,
        )
    except ValueError as exc:
        detail = str(exc)
        if detail == "Task not found":
            raise HTTPException(status_code=404, detail=detail)
        raise HTTPException(status_code=409, detail=detail)


@app.post("/research/web-search")
async def api_research_web_search(req: ResearchWebSearchRequest):
    """DuckDuckGo HTML 搜索，返回 research_artifact；可选写入 trace 事件。"""
    from utils.simple_ddg_search import ddg_html_search_research_artifact

    artifact = ddg_html_search_research_artifact(
        req.query,
        max_results=req.max_results,
        region=req.region,
        trace_id=req.trace_id,
    )
    if req.trace_id:
        if get_trace(req.trace_id):
            from core.research_artifact import research_trace_previews

            raw = artifact.get("raw") or {}
            previews = research_trace_previews(artifact)
            append_trace_event(
                req.trace_id,
                {
                    "type": "research_web_search",
                    "query": req.query,
                    "artifact_id": artifact.get("id"),
                    "hit_count": len(artifact.get("items") or []),
                    "ok": raw.get("ok"),
                    "summary_preview": previews.get("summary_preview"),
                    "items_preview": previews.get("items_preview"),
                },
            )
        else:
            logger.warning(
                "research/web-search: trace not found, skip event append trace_id=%s",
                req.trace_id,
            )
    return {"artifact": artifact, "text": artifact.get("summary") or ""}


@app.post("/research/save-to-knowledge")
async def api_research_save_to_knowledge(req: ResearchSaveToKnowledgeRequest):
    """将完整 research_artifact 转为 Markdown 并导入 RAG 知识库；可选写入 trace。"""
    from core.research_knowledge import ingest_research_artifact_to_knowledge

    result = ingest_research_artifact_to_knowledge(
        req.artifact,
        filename_base=req.filename_base,
    )
    if not result.get("success"):
        err = str(result.get("error") or "Unknown error")
        low = err.lower()
        if "not initialized" in low:
            raise HTTPException(status_code=503, detail=err)
        if "invalid" in low or "empty" in low or "failed to save" in low:
            raise HTTPException(status_code=400, detail=err)
        raise HTTPException(status_code=500, detail=err)

    if req.trace_id:
        if get_trace(req.trace_id):
            docs = result.get("documents") or []
            append_trace_event(
                req.trace_id,
                {
                    "type": "research_saved_to_knowledge",
                    "artifact_id": req.artifact.get("id") if isinstance(req.artifact, dict) else None,
                    "filename": result.get("filename"),
                    "kb_doc_ids": [d.get("id") for d in docs if isinstance(d, dict)],
                },
            )
        else:
            logger.warning(
                "research/save-to-knowledge: trace not found, skip event trace_id=%s",
                req.trace_id,
            )

    return {
        "success": True,
        "path": result.get("path"),
        "filename": result.get("filename"),
        "documents": result.get("documents") or [],
        "message": result.get("message"),
    }


@app.post("/research/content-plan")
async def api_research_content_plan(req: ResearchContentPlanRequest):
    """基于 research_artifact（或多篇合并）生成选题、脚本方向与发布计划 JSON。"""
    from core.research_content_plan import generate_research_content_plan, merge_artifacts_for_planning

    if req.artifact is not None and isinstance(req.artifact, dict) and req.artifact:
        art = req.artifact
    elif req.artifacts:
        art = merge_artifacts_for_planning(req.artifacts)
    else:
        raise HTTPException(
            status_code=400,
            detail="请提供 artifact（单篇）或 artifacts（多篇 research_artifact 列表）",
        )

    out = await generate_research_content_plan(
        art,
        platform=req.platform,
        goal=req.goal,
    )
    err = out.get("error")
    if err == "no_api_key":
        raise HTTPException(status_code=503, detail=out.get("detail"))
    if err in ("invalid_artifact", "empty_brief"):
        raise HTTPException(status_code=400, detail=out.get("detail"))
    if err == "invalid_json":
        raise HTTPException(
            status_code=502,
            detail={
                "parse_error": out.get("detail"),
                "preview": out.get("llm_preview"),
            },
        )
    if err:
        raise HTTPException(status_code=500, detail=out.get("detail"))

    if req.trace_id:
        if get_trace(req.trace_id):
            plan = out.get("plan") or {}
            append_trace_event(
                req.trace_id,
                {
                    "type": "research_content_plan",
                    "platform": req.platform,
                    "topic_idea_count": len(plan.get("topic_ideas") or []),
                },
            )
        else:
            logger.warning(
                "research/content-plan: trace not found, skip event trace_id=%s",
                req.trace_id,
            )

    return {"success": True, "plan": out["plan"]}


@app.get("/research/last30days/status")
async def api_last30days_status():
    """last30days skill availability and Python/runtime preflight."""
    from services.last30days_service import get_last30days_status

    return get_last30days_status()


@app.get("/research/last30days/history")
async def api_last30days_history(limit: int = Query(10, ge=1, le=30)):
    from services.last30days_service import list_last30days_history

    return {"history": list_last30days_history(limit=limit)}


@app.post("/research/last30days")
async def api_last30days_research(req: Last30DaysResearchRequest, background_tasks: BackgroundTasks):
    """Start async multi-source topic research via last30days skill."""
    from services.last30days_service import (
        create_last30days_research_task,
        schedule_last30days_research_task,
    )

    query = (req.query or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="query 不能为空")

    try:
        task_id = create_last30days_research_task(
            query=query,
            mode=req.mode,
            platform=req.platform,
            goal=req.goal,
            trace_id=req.trace_id,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    background_tasks.add_task(
        schedule_last30days_research_task,
        task_id,
        query=query,
        mode=req.mode,
        platform=req.platform,
        goal=req.goal,
        trace_id=req.trace_id,
    )
    logger.info(
        "[api] POST /research/last30days task_id=%s mode=%s query=%.80r",
        task_id,
        req.mode,
        query,
    )
    return {"task_id": task_id, "status": "pending"}


@app.get("/research/last30days/{task_id}")
async def api_last30days_research_task(task_id: str):
    from services.last30days_service import get_last30days_task_response

    payload = get_last30days_task_response(task_id)
    if not payload:
        raise HTTPException(status_code=404, detail="task not found")
    return payload


@app.post("/tasks/{task_id}/cancel")
async def api_cancel_task(task_id: str):
    task = cancel_task_response(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@app.post("/tasks/{task_id}/resume")
async def api_resume_task(task_id: str, background_tasks: BackgroundTasks):
    try:
        resume_payload = get_task_resume_payload(task_id)
        if not resume_payload:
            raise HTTPException(status_code=404, detail="Task not found")
        task_manager.update_task(
            task_id,
            status="pending",
            message="恢复任务已提交",
            cancel_requested=False,
        )
        background_tasks.add_task(_background_computer_use_resume, task_id)
        return {
            "success": True,
            "status": "pending",
            "task_id": task_id,
            "message": "Computer Use 恢复任务已提交，请轮询 GET /tasks/{id}",
        }
    except ValueError as exc:
        detail = str(exc)
        if detail == "Task not found":
            raise HTTPException(status_code=404, detail=detail)
        raise HTTPException(status_code=409, detail=detail)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Computer Use resume error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/approvals")
async def api_create_approval(req: ApprovalCreateRequest):
    try:
        return create_approval_response(
            capability_id=req.capability_id,
            proposed_action=req.proposed_action,
            args=req.args,
            trace_id=req.trace_id,
            task_id=req.task_id,
            expires_in_seconds=req.expires_in_seconds,
            metadata=req.metadata,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Capability not found")


@app.get("/approvals")
async def api_list_approvals(status: Optional[str] = None, limit: int = 100):
    return list_approvals_response(status=status, limit=limit)


@app.get("/approvals/{approval_id}")
async def api_get_approval(approval_id: str):
    approval = get_approval_response(approval_id)
    if not approval:
        raise HTTPException(status_code=404, detail="Approval not found")
    return approval


@app.post("/approvals/{approval_id}/approve")
async def api_approve(
    approval_id: str,
    background_tasks: BackgroundTasks,
    req: ApprovalResolveRequest = ApprovalResolveRequest(),
):
    try:
        result = approve_approval_response(approval_id, approved_by=req.approved_by)
        task_id = result.get("task_id")
        approval_meta = result.get("metadata") or {}
        if task_id:
            if req.auto_resume_computer_use and approval_meta.get("source") == "computer_use":
                background_tasks.add_task(_background_computer_use_resume, task_id)
            if req.auto_resume_platform_action and approval_meta.get("source") == "platform_actions":
                background_tasks.add_task(_background_platform_action_resume, task_id)
            if req.auto_resume_local_computer and approval_meta.get("source") in {
                "local_computer",
                "desktop_operator_ui",
                "app_automation",
            }:
                background_tasks.add_task(_background_local_computer_resume, task_id)
            if req.auto_resume_system_assistant and approval_meta.get("source") == "system_assistant":
                background_tasks.add_task(_background_system_assistant_resume, task_id)
            if req.auto_resume_programmer_agent and approval_meta.get("source") == "programmer_agent":
                background_tasks.add_task(_background_programmer_agent_resume, task_id)
            if req.auto_resume_native_use and approval_meta.get("source") == "native_use":
                background_tasks.add_task(_background_native_use_resume, task_id)
        return result
    except KeyError:
        raise HTTPException(status_code=404, detail="Approval not found")
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@app.post("/approvals/{approval_id}/deny")
async def api_deny(approval_id: str, req: ApprovalResolveRequest = ApprovalResolveRequest()):
    try:
        return deny_approval_response(approval_id, approved_by=req.approved_by, reason=req.reason)
    except KeyError:
        raise HTTPException(status_code=404, detail="Approval not found")
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@app.get("/multi-agent/agents")
async def api_list_agents():
    """列出所有已注册的 Agent"""
    return {"agents": _registry.list_all()}


@app.get("/multi-agent/traces")
async def api_list_multi_agent_traces(limit: int = 20):
    """列出最近的 multi-agent trace。"""
    safe_limit = max(1, min(limit, 100))
    return {"traces": list_traces(limit=safe_limit)}


@app.get("/multi-agent/traces/{trace_id}")
async def api_get_multi_agent_trace(trace_id: str):
    """获取单条 multi-agent trace 详情。"""
    trace = get_trace(trace_id)
    if not trace:
        raise HTTPException(status_code=404, detail="Trace not found")
    return trace


@app.post("/agent/chat/invoke")
async def api_agent_chat_invoke_route(body: dict):
    from routers.agent_chat_router import AgentChatRequestBody, api_agent_chat_invoke

    return await api_agent_chat_invoke(AgentChatRequestBody.model_validate(body))


@app.post("/agent/chat/stream")
async def api_agent_chat_stream_route(body: dict):
    from routers.agent_chat_router import AgentChatRequestBody, api_agent_chat_stream

    return await api_agent_chat_stream(AgentChatRequestBody.model_validate(body))


@app.get("/agent/assistant-catalog")
async def api_agent_assistant_catalog():
    from core.assistant_catalog import list_assistants

    return {"assistants": list_assistants()}


@app.post("/multi-agent/invoke")
async def api_invoke_multi_agent(req: MultiAgentRequest):
    """Legacy multi-agent invoke — forwards to unified LangGraph chat service."""
    from routers.agent_chat_router import api_agent_chat_invoke, legacy_multi_to_chat

    body = legacy_multi_to_chat(req.input, req.agent_id)
    from routers.agent_chat_router import AgentChatRequestBody

    return await api_agent_chat_invoke(
        AgentChatRequestBody(
            input=body.input,
            agent_id=body.agent_id,
            mode=body.mode,
            preferences=body.preferences.to_state_dict(),
            thread_id=req.session_id,
        )
    )


@app.post("/multi-agent/stream")
async def api_stream_multi_agent(req: MultiAgentRequest):
    """Legacy SSE entry — forwards to /agent/chat/stream (LangGraph Graph Router)."""
    from routers.agent_chat_router import AgentChatRequestBody, api_agent_chat_stream

    return await api_agent_chat_stream(
        AgentChatRequestBody(
            input=req.input,
            agent_id=req.agent_id,
            mode="multi",
            thread_id=req.session_id,
        )
    )


@app.get("/health")
async def health_check():
    return {"status": "ok"}


# ============================================================
# 定时任务调度器 API
# ============================================================

class SchedulerJobCreate(BaseModel):
    name: str
    content_type: str = "image"     # image | video | article | agent | companion_nudge
    prompt: str
    platforms: List[str] = []
    schedule_type: str = "cron"     # cron | interval
    cron_expr: str = "0 9 * * *"   # 默认每天9点
    interval_hours: int = 6
    interval_minutes: Optional[int] = None
    enabled: bool = True
    agent_config: Optional[Dict[str, Any]] = None


class SchedulerJobUpdate(BaseModel):
    name: Optional[str] = None
    content_type: Optional[str] = None
    prompt: Optional[str] = None
    platforms: Optional[List[str]] = None
    schedule_type: Optional[str] = None
    cron_expr: Optional[str] = None
    interval_hours: Optional[int] = None
    interval_minutes: Optional[int] = None
    enabled: Optional[bool] = None
    agent_config: Optional[Dict[str, Any]] = None

class BatchDeleteRequest(BaseModel):
    log_ids: List[str]

@app.get("/scheduler/jobs")
async def api_list_scheduler_jobs():
    """获取所有定时任务"""
    return {"jobs": scheduler_service.get_all_jobs()}

@app.post("/scheduler/jobs")
async def api_create_scheduler_job(req: SchedulerJobCreate):
    """创建新定时任务"""
    job = scheduler_service.create_job(req.model_dump())
    return {"success": True, "job": job}

@app.put("/scheduler/jobs/{job_id}")
async def api_update_scheduler_job(job_id: str, req: SchedulerJobUpdate):
    """更新定时任务（仅写入请求中出现的字段）"""
    updates = req.model_dump(exclude_unset=True)
    job = scheduler_service.update_job(job_id, updates)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return {"success": True, "job": job}

@app.delete("/scheduler/jobs/{job_id}")
async def api_delete_scheduler_job(job_id: str):
    """删除定时任务"""
    ok = scheduler_service.delete_job(job_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return {"success": True}

@app.post("/scheduler/jobs/{job_id}/run")
async def api_run_scheduler_job_now(job_id: str):
    """立即执行一次定时任务"""
    import asyncio
    result = await asyncio.to_thread(scheduler_service.run_job_now, job_id)
    return result

@app.get("/scheduler/logs")
async def api_get_scheduler_logs(job_id: Optional[str] = None, limit: int = 50):
    """获取执行日志"""
    return {"logs": scheduler_service.get_logs(job_id=job_id, limit=limit)}

@app.delete("/scheduler/logs/{log_id}")
async def api_delete_scheduler_log(log_id: str):
    """删除指定的执行日志"""
    logger.info(f"[Backend] Deleting log: {log_id}")
    ok = scheduler_service.delete_log(log_id)
    if not ok:
        logger.warning(f"[Backend] Log not found: {log_id}")
        raise HTTPException(status_code=404, detail=f"Log {log_id} not found")
    logger.info(f"[Backend] Successfully deleted log: {log_id}")
    return {"success": True}

@app.post("/scheduler/logs/batch-delete")
async def api_batch_delete_scheduler_logs(req: BatchDeleteRequest):
    """批量删除执行日志"""
    logger.info(f"[Backend] Batch deleting {len(req.log_ids)} logs")
    count = scheduler_service.batch_delete_logs(req.log_ids)
    return {"success": True, "count": count}


# ============================================================
# 游戏热点 API
# ============================================================

from tools.gaming_trending import load_trending, fetch_all_trending

@app.get("/trending/gaming")
async def api_get_gaming_trending():
    """获取缓存的游戏热点数据"""
    data = load_trending()
    if not data.get("fetched_at"):
        # 如果从没抓过，则同步抓取一次
        import asyncio
        data = await asyncio.to_thread(fetch_all_trending)
    return data

@app.post("/trending/gaming/refresh")
async def api_refresh_gaming_trending():
    """强制立刻抓取刷新游戏热点"""
    try:
        import asyncio
        data = await asyncio.to_thread(fetch_all_trending)
        return {"success": True, "data": data}
    except Exception as e:
        logger.error(f"Failed to refresh gaming trending: {e}")
        return {"success": False, "error": str(e)}


# ============================================================
# AI 资讯热榜 API
# ============================================================

from tools.ai_trending import load_ai_trending, fetch_all_ai_trending

@app.get("/trending/ai")
async def api_get_ai_trending():
    """获取缓存的 AI 资讯热榜（HuggingFace / GitHub / X AI）"""
    data = load_ai_trending()
    if not data.get("fetched_at"):
        import asyncio
        data = await asyncio.to_thread(fetch_all_ai_trending)
    return data

@app.post("/trending/ai/refresh")
async def api_refresh_ai_trending():
    """强制立刻抓取刷新 AI 资讯热榜"""
    try:
        import asyncio
        data = await asyncio.to_thread(fetch_all_ai_trending)
        return {"success": True, "data": data}
    except Exception as e:
        logger.error(f"Failed to refresh AI trending: {e}")
        return {"success": False, "error": str(e)}


# ============================================================
# 金融资讯 API (Bloomberg / Reuters / Wind)
# ============================================================

from tools.financial_news_tools import get_financial_news, fetch_all_financial_news

@app.get("/financial-news")
async def api_get_financial_news():
    """获取金融资讯缓存（彭博社 / 路透社 / Wind 类数据）"""
    import asyncio
    data = await asyncio.to_thread(get_financial_news)
    return data

@app.post("/financial-news/refresh")
async def api_refresh_financial_news():
    """强制立刻抓取刷新金融资讯"""
    try:
        import asyncio
        data = await asyncio.to_thread(fetch_all_financial_news)
        return {"success": True, "data": data}
    except Exception as e:
        logger.error(f"Failed to refresh financial news: {e}")
        return {"success": False, "error": str(e)}


# ============================================================
# 🦞 龙虾流水线 (Lobster Pipeline) API
# ============================================================

from tools.social_trending import load_social_trending, fetch_social_trending


class LobsterRunRequest(BaseModel):
    trend_platforms: List[str] = []
    publish_platforms: List[str] = []
    limit: int = 8


@app.post("/api/lobster/run")
async def api_run_lobster_pipeline(req: LobsterRunRequest):
    """
    🦞 启动龙虾流水线：热点收集 → AI克隆内容 → 自动发布。
    支持异步执行，返回完整流水线报告。
    """
    try:
        import asyncio
        from agents.lobster_bot import run_lobster_pipeline
        logger.info(f"🦞 Lobster pipeline started: trend={req.trend_platforms}, publish={req.publish_platforms}")
        result = await asyncio.to_thread(
            run_lobster_pipeline,
            req.trend_platforms,
            req.publish_platforms,
            req.limit,
        )
        return {"success": True, **result}
    except Exception as e:
        logger.error(f"Lobster pipeline error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/lobster/status")
async def api_lobster_status():
    """检查 OpenClaw (龙虾) 本地服务状态和最近的社交热点数据"""
    from tools.lobster_tools import check_openclaw_status
    openclaw_status = await asyncio.to_thread(check_openclaw_status.invoke, {})
    social_data = load_social_trending()
    return {
        "openclaw": openclaw_status,
        "social_trending": {
            "fetched_at": social_data.get("fetched_at"),
            "total": social_data.get("summary", {}).get("total", 0),
        }
    }


@app.get("/api/lobster/trending")
async def api_get_social_trending():
    """获取最近一次的社交热点数据缓存"""
    data = load_social_trending()
    if not data.get("fetched_at"):
        import asyncio
        data = await asyncio.to_thread(fetch_social_trending, ["bilibili"], 8)
    return data


@app.post("/api/lobster/trending/refresh")
async def api_refresh_social_trending():
    """强制刷新社交平台热点"""
    try:
        import asyncio
        data = await asyncio.to_thread(
            fetch_social_trending,
            ["bilibili", "douyin", "xiaohongshu"],
            10,
        )
        return {"success": True, "data": data}
    except Exception as e:
        logger.error(f"Failed to refresh social trending: {e}")
        return {"success": False, "error": str(e)}


class LobsterChatRequest(BaseModel):
    message: str
    node_id: str = "auto"

@app.post("/api/lobster/chat")
async def api_lobster_chat(req: LobsterChatRequest):
    """直接与 OpenClaw Agent 对话 (受控节点)"""
    from tools.lobster_tools import send_task_to_openclaw
    try:
        if not req.message or not req.message.strip():
            raise HTTPException(status_code=400, detail="Message cannot be empty")

        result = await asyncio.to_thread(send_task_to_openclaw.invoke, {"task": req.message, "node_id": req.node_id})
        return {"success": True, "reply": result}
    except Exception as e:
        logger.error(f"Lobster chat error: {e}")
        return {"success": False, "error": str(e)}

@app.get("/api/lobster/nodes")
async def api_lobster_nodes():
    """获取所有 OpenClaw 节点及其状态"""
    from tools.lobster_tools import get_nodes_config, OPENCLAW_TIMEOUT
    import requests
    import subprocess
    try:
        nodes = get_nodes_config()
        results = []
        enriched_nodes = []

        for node in nodes:
            node_id = node.get("id")
            url = node.get("url", "")
            name = node.get("name", node_id)

            status = {"online": False, "methods": []}

            # 检查网络
            try:
                # 快速检查 Web (只要有响应哪怕是 401 也算在线)
                r = requests.get(url, timeout=1)
                if r.status_code < 500:
                    status["online"] = True
                    status["methods"].append("Web")
                elif r.status_code == 502:
                    # 本地代理有时返回 502，但在本地端口段也算存在
                    status["online"] = True
                    status["methods"].append("ProxyHit")
            except:
                pass

            # 检查 REST (兼容 401 情况)
            try:
                # 只发一个 GET 试试 models 列表，比较轻量
                r = requests.get(f"{url.rstrip('/')}/v1/models", timeout=1)
                if r.status_code in [200, 401]:
                    status["online"] = True
                    status["methods"].append("REST")
            except:
                pass

            # 检查 CLI (仅限本地)
            if node.get("type") == "local":
                try:
                    r = subprocess.run(["openclaw", "--version"], capture_output=True, timeout=1)
                    if r.returncode == 0:
                        # 即使网络不通，CLI 通也算在线 (但目前前端主要调 API)
                        status["methods"].append("CLI")
                except:
                    pass

            node["online"] = status["online"]
            node["methods"] = status["methods"]
            enriched_nodes.append(node)

            icon = "✅" if status["online"] else "❌"
            results.append(f"{icon} **{name}** ({node_id}): {','.join(status['methods']) if status['methods'] else '无可用通信方式'}")

        return {
            "success": True,
            "nodes": enriched_nodes,
            "report": "🦞 **OpenClaw 节点状态报告:**\n\n" + "\n".join(results)
        }
    except Exception as e:
        logger.error(f"Failed to get lobster nodes: {e}")
        return {"success": False, "error": str(e)}

class LobsterGroupChatRequest(BaseModel):
    message: str

@app.post("/api/lobster/group-chat")
async def api_lobster_group_chat(req: LobsterGroupChatRequest):
    """OpenClaw A2A 群聊 (互动协同模式)"""
    from tools.lobster_tools import coordinate_a2a_discussion
    try:
        if not req.message or not req.message.strip():
            raise HTTPException(status_code=400, detail="Message cannot be empty")

        result = await asyncio.to_thread(coordinate_a2a_discussion.invoke, {"task": req.message})
        return {"success": True, "reply": result}
    except Exception as e:
        logger.error(f"Lobster group chat error: {e}")
        return {"success": False, "error": str(e)}


# --- Hermes Agent API ---

class HermesChatRequest(BaseModel):
    message: str
    instance_id: str = "local"


class HermesSidecarRequest(BaseModel):
    message: str
    session_source: Dict[str, Any] = Field(default_factory=dict)
    reply_target: Optional[str] = None
    agent_id: Optional[str] = None


class HermesSkillSyncRequest(BaseModel):
    direction: str = Field(default="from_hermes", description="from_hermes | to_hermes | both")
    dry_run: bool = False


@app.get("/api/hermes/config")
async def get_hermes_config():
    from services.hermes_runtime import get_instances_config

    return {"success": True, "instances": get_instances_config()}


@app.post("/api/hermes/config")
async def update_hermes_config(instances: list):
    from services.hermes_runtime import save_instances_config

    if save_instances_config(instances):
        return {"success": True, "message": "Hermes config saved"}
    raise HTTPException(status_code=500, detail="Failed to save Hermes config")


@app.get("/api/hermes/status")
async def api_hermes_status():
    from services.hermes_runtime import build_hermes_health, probe_gateway_status, probe_hermes_status

    health = build_hermes_health()
    return {
        "success": True,
        "hermes": health,
        "status": probe_hermes_status(),
        "gateway": probe_gateway_status(),
    }


@app.post("/api/hermes/credentials/sync")
async def api_hermes_credentials_sync():
    from services.hermes_env_bridge import credential_bridge_status, sync_hermes_dotenv

    result = await asyncio.to_thread(sync_hermes_dotenv)
    return {"success": bool(result.get("synced")), "sync": result, "bridge": credential_bridge_status()}


@app.post("/api/hermes/chat")
async def api_hermes_chat(req: HermesChatRequest):
    from tools.hermes_tools import send_task_to_hermes

    try:
        if not req.message or not req.message.strip():
            raise HTTPException(status_code=400, detail="Message cannot be empty")
        result = await asyncio.to_thread(
            send_task_to_hermes.invoke,
            {"task": req.message, "instance_id": req.instance_id},
        )
        return {"success": True, "reply": result}
    except Exception as e:
        logger.error("Hermes chat error: %s", e)
        return {"success": False, "error": str(e)}


@app.post("/api/hermes/sidecar/chat")
async def api_hermes_sidecar_chat(req: HermesSidecarRequest):
    from services.hermes_sidecar import run_sidecar_chat

    try:
        if not req.message or not req.message.strip():
            raise HTTPException(status_code=400, detail="Message cannot be empty")
        result = await run_sidecar_chat(
            req.message,
            session_source=req.session_source,
            reply_target=req.reply_target,
            agent_id=req.agent_id,
        )
        return result
    except Exception as e:
        logger.error("Hermes sidecar error: %s", e)
        return {"success": False, "error": str(e)}


@app.post("/api/hermes/skills/sync")
async def api_hermes_skills_sync(req: HermesSkillSyncRequest):
    from services.skill_sync import sync_from_hermes, sync_to_hermes

    direction = (req.direction or "from_hermes").lower()
    results: Dict[str, Any] = {"success": True, "direction": direction, "dry_run": req.dry_run}
    try:
        if direction in {"from_hermes", "both"}:
            results["from_hermes"] = await asyncio.to_thread(sync_from_hermes, dry_run=req.dry_run)
        if direction in {"to_hermes", "both"}:
            results["to_hermes"] = await asyncio.to_thread(sync_to_hermes, dry_run=req.dry_run)
        return results
    except Exception as e:
        logger.error("Hermes skill sync error: %s", e)
        return {"success": False, "error": str(e)}


@app.get("/config/provider")
async def api_get_provider_config():
    """获取当前 LLM 供应商配置"""
    import asyncio
    from core.llm_provider import get_provider_id, get_provider_config, get_api_key, get_current_model, get_vision_model, PROVIDERS, fetch_openrouter_models, _OPENROUTER_CACHE

    # 如果缓存为空则在后台异步刷新，不阻塞本次响应
    if not _OPENROUTER_CACHE.get("models"):
        asyncio.create_task(asyncio.to_thread(fetch_openrouter_models))

    config = get_provider_config()
    return {
        "current": {
            "id": get_provider_id(),
            "name": config.name,
            "model": get_current_model(),
            "vision_model": get_vision_model(),
            "has_key": bool(get_api_key()),
            "video_provider": os.getenv("VIDEO_PROVIDER", "auto"),
            "audio_provider": os.getenv("AUDIO_PROVIDER", "auto"),
        },
        "available": [
            {
                "id": pid,
                "name": p.name,
                "default_model": p.default_model,
                "models": p.available_models,
                "env_var": p.api_key_env,
                "has_key": bool(get_api_key(pid)),
                # 须含通义「ALIBABA 或 DASHSCOPE」合并结果，供 Next /api/chat 等只读单字段的消费者使用
                "api_key_value": (get_api_key(pid) or "").strip(),
                "base_url": p.base_url,
                "extra_keys": [
                    {
                        "env_var": k,
                        "has_key": bool(os.getenv(k)),
                        "value": os.getenv(k, "")
                    }
                    for k in (p.extra_keys or [])
                ]
            }
            for pid, p in PROVIDERS.items()
        ]
    }


class ProviderUpdateRequest(BaseModel):
    provider: Optional[str] = None   # e.g. "deepseek"
    model: Optional[str] = None      # e.g. "deepseek-reasoner"
    api_keys: Optional[Dict[str, str]] = None  # e.g. {"DEEPSEEK_API_KEY": "sk-xxx"}
    video_provider: Optional[str] = None
    audio_provider: Optional[str] = None


@app.post("/config/provider")
async def api_update_provider_config(req: ProviderUpdateRequest):
    """
    更新 LLM 供应商配置。
    - 修改当前供应商
    - 修改当前模型
    - 保存 API Key 到 .env 并注入到环境变量
    """
    from core.llm_provider import PROVIDERS, get_provider_config, get_api_key, get_provider_id, get_current_model

    changes = []

    # 1. 更新供应商
    if req.provider:
        if req.provider not in PROVIDERS:
            raise HTTPException(status_code=400, detail=f"Unknown provider: {req.provider}")
        os.environ["LLM_PROVIDER"] = req.provider
        changes.append(f"LLM_PROVIDER={req.provider}")
        logger.info(f"Switched LLM provider to: {req.provider}")

        # 切换供应商时，如果没有显式指定模型，自动清除自定义模型让它用新供应商默认的
        if not req.model:
            os.environ.pop("LLM_MODEL", None)
            changes.append("LLM_MODEL=<default>")

    # 2. 更新模型
    if req.model:
        os.environ["LLM_MODEL"] = req.model
        changes.append(f"LLM_MODEL={req.model}")
        logger.info(f"Switched LLM model to: {req.model}")

    # 3. 更新 API Keys
    if req.api_keys:
        valid_env_vars = {p.api_key_env for p in PROVIDERS.values()}
        for p in PROVIDERS.values():
            for k in p.extra_keys or []:
                valid_env_vars.add(k)
        for env_var, value in req.api_keys.items():
            if env_var not in valid_env_vars:
                raise HTTPException(status_code=400, detail=f"Unknown env var: {env_var}")
            if value:  # 非空才设置
                os.environ[env_var] = value
                changes.append(f"{env_var}=***")
                logger.info(f"Updated API key: {env_var}")

    # 4. 更新 Video/Audio Provider
    if req.video_provider:
        os.environ["VIDEO_PROVIDER"] = req.video_provider
        changes.append(f"VIDEO_PROVIDER={req.video_provider}")

    if req.audio_provider:
        os.environ["AUDIO_PROVIDER"] = req.audio_provider
        changes.append(f"AUDIO_PROVIDER={req.audio_provider}")

    # 5. 持久化到 .env
    env_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    _persist_env_changes(env_file, req.provider, req.model, req.api_keys, req.video_provider, req.audio_provider)

    # 6. Invalidate graph cache so the next request uses the new LLM config
    try:
        from agents.orchestrator import clear_graph_cache
        clear_graph_cache()
        logger.info("🗑️ Graph cache cleared after provider update")
    except Exception:
        pass

    # 7. RAG 使用启动时的 Embedding 配置单例；切换供应商/Key 后需重置以便下次按新配置初始化
    try:
        from utils.rag_manager import reset_rag_manager
        reset_rag_manager()
        logger.info("RAG manager singleton cleared after provider update")
    except Exception:
        pass

    # 8. 返回更新后的状态
    config = get_provider_config()
    return {
        "success": True,
        "changes": changes,
        "current": {
            "id": get_provider_id(),
            "name": config.name,
            "model": get_current_model(),
            "has_key": bool(get_api_key()),
            "video_provider": os.getenv("VIDEO_PROVIDER", "auto"),
            "audio_provider": os.getenv("AUDIO_PROVIDER", "auto"),
        }
    }


def _persist_env_changes(env_file: str, provider: Optional[str], model: Optional[str], api_keys: Optional[Dict[str, str]], video_provider: Optional[str] = None, audio_provider: Optional[str] = None):
    """将变更持久化写入 .env 文件"""
    # 读取现有内容
    existing = {}
    if os.path.exists(env_file):
        with open(env_file, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, _, val = line.partition('=')
                    existing[key.strip()] = val.strip()

    # 更新
    if provider:
        existing["LLM_PROVIDER"] = provider
        # 如果切供应商且没有指定模型，移除旧模型设置
        if not model and "LLM_MODEL" in existing:
            del existing["LLM_MODEL"]
    if model:
        existing["LLM_MODEL"] = model
    if video_provider:
        existing["VIDEO_PROVIDER"] = video_provider
    if audio_provider:
        existing["AUDIO_PROVIDER"] = audio_provider
    if api_keys:
        for k, v in api_keys.items():
            if v:  # 非空才写入
                existing[k] = v

    # 写回
    with open(env_file, 'w') as f:
        for k, v in existing.items():
            f.write(f"{k}={v}\n")

# ===========================================
# Coding 引擎配置 API（Claude Code 专用密钥，与主聊天 LLM 分离）
# ===========================================

class CodingConfigUpdateRequest(BaseModel):
    provider: Optional[str] = None  # auto | anthropic | openrouter | custom
    api_key: Optional[str] = None   # 写入 CODING_API_KEY
    base_url: Optional[str] = None    # 写入 CODING_BASE_URL
    model: Optional[str] = None       # 写入 CODING_MODEL


@app.get("/config/coding")
async def api_get_coding_config():
    from core.coding_provider import get_coding_config_summary

    return get_coding_config_summary()


@app.post("/config/coding")
async def api_update_coding_config(req: CodingConfigUpdateRequest):
    from core.coding_provider import (
        CODING_PROVIDERS,
        apply_coding_config_update,
        get_coding_config_summary,
        persist_coding_env,
    )

    try:
        changes = apply_coding_config_update(
            provider=req.provider,
            api_key=req.api_key,
            base_url=req.base_url,
            model=req.model,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    env_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    persist_coding_env(
        env_file,
        provider=req.provider,
        api_key=req.api_key,
        base_url=req.base_url,
        model=req.model,
    )

    for line in changes:
        logger.info("Coding config updated: %s", line)

    summary = get_coding_config_summary()
    return {"success": True, "changes": changes, **summary}


# ===========================================
# 媒体模型配置 API
# ===========================================

class MediaModelSetRequest(BaseModel):
    modality: str      # "image" / "video" / "audio"
    model_id: str      # 模型 ID, 如 "openrouter/google/gemini-3-pro-image-preview"


@app.get("/config/media-models")
async def api_get_media_models():
    """获取所有可用的媒体模型列表 + 当前选中"""
    import asyncio
    from core.media_models import get_media_models_summary
    try:
        result = await asyncio.to_thread(get_media_models_summary)
        return result
    except Exception as e:
        logger.error(f"Failed to get media models: {e}")
        return {"error": str(e)}


@app.post("/config/media-models")
async def api_set_media_model(req: MediaModelSetRequest):
    """设置某个 modality 的当前选中模型"""
    from core.media_models import set_current_media_model
    success = set_current_media_model(req.modality, req.model_id)
    if success:
        return {"status": "ok", "modality": req.modality, "model_id": req.model_id}
    return {"status": "error", "message": f"Model '{req.model_id}' not found for modality '{req.modality}'"}


# ===========================================
# 工具 API 端点
# ===========================================

# --- 请求模型 ---
class ScriptRequest(BaseModel):
    topic: str
    platform: str = "douyin"
    duration: int = 60
    style: str = "口播带货"
    industry: str = "通用"
    additional_info: str = ""

class CopywritingRequest(BaseModel):
    topic: str
    platform: str = "xiaohongshu"
    content_type: str = "种草推荐"
    target_audience: str = "年轻用户"
    additional_info: str = ""

class TitlesRequest(BaseModel):
    topic: str
    platform: str = "xiaohongshu"
    summary: str = ""
    count: int = 5

class ModerationRequest(BaseModel):
    content: str
    platform: str = "douyin"

class MediaRequest(BaseModel):
    prompt: str
    model: Optional[str] = None  # 可选指定模型 ID
    quality: Optional[str] = None  # standard | hd | ultra
    resolution: Optional[str] = None  # 720p | 1080p | 4k
    reference_image_url: Optional[str] = None  # 背景参考图 URL（上传后的绝对路径）


class ImageEditRequest(BaseModel):
    source_image_url: str
    prompt: str = ""
    mode: str = "instruction"
    mask_image_url: Optional[str] = None
    reference_image_urls: Optional[List[str]] = None
    reference_intent: str = "replace_material"
    reference_target: str = ""
    reference_roles: Optional[List[str]] = None
    expand_top: float = 1.0
    expand_bottom: float = 1.0
    expand_left: float = 1.0
    expand_right: float = 1.0
    strength: float = 0.5
    n: int = 1
    seed: Optional[int] = None
    upscale_factor: int = 2
    is_sketch: bool = False
    inpaint_ai_blend: bool = False
    watermark_mode: str = "auto"
    watermark_text: str = ""
    watermark_text_include_aliases: bool = False


class ImageExportRequest(BaseModel):
    image_url: str
    format: str = "png"
    source_image_url: Optional[str] = None
    mask_image_url: Optional[str] = None
    jpeg_quality: int = 92


class ImageSplitPsdRequest(BaseModel):
    image_url: str
    max_layers: int = 8
    include_ocr: bool = True
    high_quality: bool = False


class LogoMotionRequest(BaseModel):
    source_image_url: str
    motion_brief: str = "让 Logo 优雅地淡入并带有轻微的向上浮动感"
    style: str = "subtle"
    duration_ms: int = 1500


class LogoMotionTraceRequest(BaseModel):
    source_image_url: str


class LongVideoRequest(BaseModel):
    prompt: str
    duration_sec: int = 30
    style: str = "cinematic"


class HappyHorseVideoRequest(BaseModel):
    """欢乐马 HappyHorse 专用文生视频"""
    prompt: str
    duration: int = 5
    resolution: str = "720P"
    ratio: str = "16:9"
    watermark: bool = False
    seed: Optional[int] = None


class HappyHorseImageToVideoRequest(BaseModel):
    """欢乐马 HappyHorse 专用图生视频"""
    image_url: str
    prompt: str = ""
    duration: int = 5
    resolution: str = "720P"
    watermark: bool = False
    seed: Optional[int] = None


class AutoVideoRequest(BaseModel):
    """MoneyPrinterTurbo 风格一键短视频请求"""
    subject: str
    script: str = ""
    search_terms: List[str] = Field(default_factory=list)
    voice: str = "zh-CN-XiaoxiaoNeural"
    aspect_ratio: str = "9:16"
    material_source: str = "pexels"
    clip_duration: float = 3.0
    subtitle_enabled: bool = True
    subtitle_style: str = "default"
    bgm: str = "random"
    bgm_volume: float = 0.25
    language: str = "zh-CN"
    paragraph_number: int = 1

class TrendAnalysisRequest(BaseModel):
    category: str
    platform: str = "douyin"

class HashtagRequest(BaseModel):
    topic: str
    platform: str = "xiaohongshu"


class WebSearchFallbackRequest(BaseModel):
    """原生 HTML 兜底搜索（MCP 未启动或调用失败时使用）"""

    query: str
    max_results: int = Field(10, ge=1, le=20)
    region: str = ""


class ComputerUseRequest(BaseModel):
    """浏览器 Computer Use：自然语言目标 + 起始 URL，由 LLM 规划 Playwright 步骤。"""

    goal: str
    start_url: str = "https://html.duckduckgo.com/html/"
    max_rounds: int = 4
    headless: bool = True
    autoresearch: bool = True
    require_approval: bool = False
    task_id: Optional[str] = None
    trace_id: Optional[str] = None


# --- 脚本生成 API ---
@app.post("/tools/script")
async def api_generate_script(req: ScriptRequest):
    logger.info("[api] POST /tools/script topic=%r platform=%s style=%s",
                req.topic[:60], req.platform, req.style)
    try:
        result = await asyncio.to_thread(generate_script.invoke, {
            "topic": req.topic,
            "platform": req.platform,
            "duration": req.duration,
            "style": req.style,
            "industry": req.industry,
            "additional_info": req.additional_info
        })
        # 保存到历史记录
        add_generation_record(
            record_type="script",
            prompt=req.topic,
            result=result,
            metadata={"platform": req.platform, "style": req.style, "duration": req.duration}
        )
        return {"result": result}
    except Exception as e:
        logger.error("[api] /tools/script error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


# --- 文案生成 API ---
@app.post("/tools/copywriting")
async def api_generate_copywriting(req: CopywritingRequest):
    logger.info("[api] POST /tools/copywriting topic=%r platform=%s type=%s",
                req.topic[:60], req.platform, req.content_type)
    try:
        result = await asyncio.to_thread(generate_copywriting.invoke, {
            "topic": req.topic,
            "platform": req.platform,
            "content_type": req.content_type,
            "target_audience": req.target_audience,
            "additional_info": req.additional_info
        })
        # 保存到历史记录
        add_generation_record(
            record_type="copywriting",
            prompt=req.topic,
            result=result,
            metadata={"platform": req.platform, "content_type": req.content_type}
        )
        return {"result": result}
    except Exception as e:
        logger.error("[api] /tools/copywriting error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/tools/titles")
async def api_generate_titles(req: TitlesRequest):
    logger.info("[api] POST /tools/titles topic=%r platform=%s count=%s",
                req.topic[:60], req.platform, req.count)
    try:
        result = await asyncio.to_thread(generate_titles.invoke, {
            "topic": req.topic,
            "platform": req.platform,
            "summary": req.summary,
            "count": req.count
        })
        return {"result": result}
    except Exception as e:
        logger.error("[api] /tools/titles error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


# --- 内容审核 API ---
@app.post("/tools/moderation/check")
async def api_check_content(req: ModerationRequest):
    logger.info("[api] POST /tools/moderation/check platform=%s content_len=%d",
                req.platform, len(req.content))
    try:
        result = await asyncio.to_thread(check_content.invoke, {
            "content": req.content,
            "platform": req.platform
        })
        return {"result": result}
    except Exception as e:
        logger.error("[api] /tools/moderation/check error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/tools/moderation/fix")
async def api_fix_content(req: ModerationRequest):
    logger.info("[api] POST /tools/moderation/fix platform=%s content_len=%d",
                req.platform, len(req.content))
    try:
        result = await asyncio.to_thread(fix_content.invoke, {
            "content": req.content,
            "platform": req.platform
        })
        return {"result": result}
    except Exception as e:
        logger.error("[api] /tools/moderation/fix error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/computer-use/run")
async def api_computer_use_run(
    req: ComputerUseRequest,
    background_tasks: BackgroundTasks,
    _: Optional[dict] = Depends(require_auth_when_enabled),
):
    """
    Computer Use Agent：异步提交任务，立即返回 task_id；前端轮询 GET /tasks/{id} 获取进度。
    """
    if not (req.goal or "").strip():
        raise HTTPException(status_code=400, detail="goal 不能为空")
    try:
        from services.agent_s.config import get_engine, resolve_require_approval

        require_approval = resolve_require_approval(req.require_approval)
        task_id = req.task_id or task_manager.create_task(
            "computer_use",
            metadata={
                "goal": req.goal.strip(),
                "start_url": (req.start_url or "").strip(),
                "require_approval": require_approval,
                "engine": get_engine(),
                "max_rounds": req.max_rounds,
                "headless": req.headless,
                "autoresearch": req.autoresearch,
                "trace_id": req.trace_id,
            },
        )
        task_manager.update_task(
            task_id,
            status="pending",
            message="任务已提交",
        )
        background_tasks.add_task(
            _background_computer_use_run,
            task_id,
            req.goal.strip(),
            (req.start_url or "").strip(),
            req.max_rounds,
            req.headless,
            req.autoresearch,
            require_approval,
            req.trace_id,
        )
        return {
            "success": True,
            "status": "pending",
            "task_id": task_id,
            "require_approval": require_approval,
            "message": "Computer Use 任务已提交，请轮询 GET /tasks/{id}",
        }
    except Exception as e:
        logger.error(f"Computer Use error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/claude-code/health")
async def api_claude_code_health():
    from routers.claude_code_router import api_claude_code_health as _health

    return await _health()


@app.post("/claude-code/stream")
async def api_claude_code_stream(body: dict):
    from routers.claude_code_router import ClaudeCodeStreamBody, api_claude_code_stream as _stream

    return await _stream(ClaudeCodeStreamBody.model_validate(body))


@app.post("/claude-code/permission")
async def api_claude_code_permission(body: dict):
    from routers.claude_code_router import ClaudeCodePermissionBody, api_claude_code_permission as _perm

    return await _perm(ClaudeCodePermissionBody.model_validate(body))


@app.get("/claude-code/commands")
async def api_claude_code_commands(workspace_root: str = ""):
    from routers.claude_code_router import api_claude_code_commands as _commands

    return await _commands(workspace_root or None)


class GitCommitMessageRequest(BaseModel):
    branch: str = ""
    changed_files: list[str] = Field(default_factory=list)
    stat: str = ""
    diff: str = ""
    hint: str = ""


@app.post("/tools/git/commit-message")
async def api_git_commit_message(body: GitCommitMessageRequest):
    from services.git_commit_message import suggest_commit_message

    try:
        return await suggest_commit_message(
            branch=body.branch,
            changed_files=body.changed_files,
            stat=body.stat,
            diff=body.diff,
            hint=body.hint,
        )
    except Exception as e:
        logger.error("[api] /tools/git/commit-message error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/tools/moderation/rules")
async def api_get_rules(platform: str = "douyin"):
    try:
        result = await asyncio.to_thread(get_platform_rules.invoke, {"platform": platform})
        return {"result": result}
    except Exception as e:
        logger.error(f"Get rules error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# --- 趋势与标签 API ---
@app.post("/tools/trends/analyze")
async def api_analyze_trends(req: TrendAnalysisRequest):
    logger.info("[api] POST /tools/trends/analyze category=%s platform=%s",
                req.category, req.platform)
    try:
        result = await asyncio.to_thread(analyze_trends.invoke, {
            "category": req.category,
            "platform": req.platform
        })
        return {"result": result}
    except Exception as e:
        logger.error("[api] /tools/trends/analyze error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/tools/trends/hashtags")
async def api_generate_hashtags(req: HashtagRequest):
    logger.info("[api] POST /tools/trends/hashtags topic=%r platform=%s",
                req.topic[:60], req.platform)
    try:
        result = await asyncio.to_thread(generate_hashtags.invoke, {
            "topic": req.topic,
            "platform": req.platform
        })
        return {"result": result}
    except Exception as e:
        logger.error("[api] /tools/trends/hashtags error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/tools/web/ddg-html-search")
async def api_ddg_html_search_fallback(req: WebSearchFallbackRequest):
    """DuckDuckGo HTML 搜索（不走 MCP）；供 Next /api/chat 在 MCP 不可用时兜底。"""
    import asyncio
    import time

    from utils.simple_ddg_search import ddg_html_search_sync

    t0 = time.perf_counter()
    logger.info(
        "[api] ddg-html begin query_len=%d max_results=%s region=%r",
        len(req.query or ""),
        req.max_results,
        (req.region or "")[:24],
    )
    q = req.query.strip()
    if not q:
        raise HTTPException(status_code=400, detail="query required")
    try:
        text = await asyncio.to_thread(
            ddg_html_search_sync,
            q,
            req.max_results,
            req.region,
        )
        elapsed_ms = (time.perf_counter() - t0) * 1000
        if isinstance(text, str) and text.startswith("Error:"):
            logger.warning(
                "[api] ddg-html end status=upstream_error elapsed_ms=%.0f out_len=%s",
                elapsed_ms,
                len(text),
            )
        elif isinstance(text, str) and text.startswith("No results"):
            logger.warning(
                "[api] ddg-html end status=no_hits elapsed_ms=%.0f out_len=%s",
                elapsed_ms,
                len(text),
            )
        else:
            logger.info(
                "[api] ddg-html end status=ok elapsed_ms=%.0f out_chars=%s",
                elapsed_ms,
                len(text) if isinstance(text, str) else 0,
            )
        return {"success": True, "result": text}
    except Exception as e:
        logger.error("[api] /tools/web/ddg-html-search error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


# --- 媒体生成 API ---
@app.post("/tools/image")
async def api_generate_image(req: MediaRequest):
    logger.info("[api] POST /tools/image prompt=%r quality=%s",
                req.prompt[:80], req.quality)
    try:
        # If a reference background image was uploaded, read it and include
        # as base64 inline data for multimodal-capable models (e.g. Gemini),
        # or fall back to appending a text description to the prompt.
        enhanced_prompt = req.prompt
        inline_image_b64: Optional[str] = None
        inline_image_mime: str = "image/jpeg"
        if req.reference_image_url:
            try:
                # The URL is absolute (e.g. http://localhost:8000/uploads/xxx.png)
                # Try to read the file directly from disk first (faster, no HTTP).
                parsed_path = req.reference_image_url.split("/uploads/", 1)
                if len(parsed_path) == 2:
                    img_file = os.path.join(UPLOAD_DIR, os.path.basename(parsed_path[1]))
                    if os.path.exists(img_file):
                        import mimetypes as _mt, base64 as _b64
                        mime = _mt.guess_type(img_file)[0] or "image/jpeg"
                        with open(img_file, "rb") as _f:
                            img_bytes = _f.read()
                        inline_image_b64 = _b64.b64encode(img_bytes).decode()
                        inline_image_mime = mime
                        logger.info("[api] /tools/image reference image loaded: %s (%d bytes)", img_file, len(img_bytes))
                if not inline_image_b64:
                    # Fall back: HTTP fetch
                    import urllib.request as _ur
                    with _ur.urlopen(req.reference_image_url, timeout=10) as _resp:
                        img_bytes = _resp.read()
                    import mimetypes as _mt, base64 as _b64
                    mime = _mt.guess_type(req.reference_image_url)[0] or "image/jpeg"
                    inline_image_b64 = _b64.b64encode(img_bytes).decode()
                    inline_image_mime = mime
                    logger.info("[api] /tools/image reference image fetched: %s (%d bytes)", req.reference_image_url, len(img_bytes))
            except Exception as _e:
                logger.warning("[api] /tools/image could not load reference image: %s", _e)

        # If we have inline image data, check if the current model supports multimodal.
        # Attempt a direct Gemini multimodal call; otherwise append URL hint to prompt.
        if inline_image_b64:
            from core.media_models import get_current_media_model
            selected = get_current_media_model("image")
            api_type = selected.get("api_type", "none")
            if api_type == "google_native":
                # Try Google Gemini multimodal image generation with reference image
                try:
                    import base64 as _b64, requests as _req
                    api_key = os.getenv("GOOGLE_API_KEY", "")
                    model_id = selected.get("model_id", "gemini-2.0-flash-preview-image-generation")
                    api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_id}:generateContent"
                    payload = {
                        "contents": [{
                            "parts": [
                                {"text": enhanced_prompt},
                                {"inline_data": {"mime_type": inline_image_mime, "data": inline_image_b64}},
                            ]
                        }],
                        "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]},
                    }
                    resp = _req.post(api_url, headers={"x-goog-api-key": api_key, "Content-Type": "application/json"}, json=payload, timeout=120)
                    resp.raise_for_status()
                    data = resp.json()
                    candidates = data.get("candidates", [])
                    local_path = ""
                    remote_url = ""
                    for candidate in candidates:
                        for part in candidate.get("content", {}).get("parts", []):
                            if "inline_data" in part:
                                from tools.image_tools import save_base64_image
                                raw = part["inline_data"].get("data", "")
                                mt = part["inline_data"].get("mime_type", "image/png")
                                ext = mt.split("/")[-1] if "/" in mt else "png"
                                data_uri = f"data:{mt};base64,{raw}"
                                local_path = save_base64_image(data_uri, enhanced_prompt)
                            elif "file_data" in part:
                                remote_url = part["file_data"].get("file_uri", "")
                    if local_path or remote_url:
                        url_display = remote_url or local_path
                        result = f"✅ 海报生成成功（参考背景图）\n\n**直接显示:** {local_path or remote_url}\n\n来源: Google Gemini (multimodal with reference)"
                        add_generation_record(record_type="image", prompt=enhanced_prompt, result=result, metadata={"quality": req.quality, "reference_image_url": req.reference_image_url})
                        return {"result": result}
                except Exception as _ge:
                    logger.warning("[api] /tools/image Gemini multimodal failed, falling back: %s", _ge)

            # Non-multimodal model or Gemini fallback: append text hint to prompt
            enhanced_prompt += "\n\n[背景参考]: 用户已上传一张背景参考图片，请参考其色调、构图和视觉风格作为海报背景，以提示词描述的内容为主体。"

        try:
            from services.taste_art_direction import enrich_image_prompt, is_taste_art_direction_enabled

            if is_taste_art_direction_enabled():
                enhanced_prompt = enrich_image_prompt(enhanced_prompt)
        except Exception as _te:
            logger.warning("[api] /tools/image taste enrich skipped: %s", _te)

        invoke_args: dict = {"prompt": enhanced_prompt}
        if req.quality:
            invoke_args["quality"] = req.quality
        result = await asyncio.to_thread(generate_image.invoke, invoke_args)
        # 保存到历史记录
        add_generation_record(
            record_type="image",
            prompt=req.prompt,
            result=result,
            metadata={"quality": req.quality}
        )
        return {"result": result}
    except Exception as e:
        logger.error("[api] /tools/image error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/tools/image/edit")
async def api_edit_image(req: ImageEditRequest):
    """精准编辑图片：局部重绘、指令编辑、风格化、超分、去水印等。"""
    from tools.image_edit_tools import run_image_edit, validate_edit_request

    mode = (req.mode or "instruction").strip().lower()
    err = validate_edit_request(
        mode,
        req.prompt,
        req.mask_image_url or "",
        req.reference_image_urls or [],
        req.reference_target or "",
        req.watermark_mode or "auto",
        req.watermark_text or "",
    )
    if err:
        raise HTTPException(status_code=400, detail=err)

    logger.info(
        "[api] POST /tools/image/edit mode=%s source=%r prompt=%r n=%s",
        mode,
        req.source_image_url[:80],
        (req.prompt or "")[:80],
        req.n,
    )
    try:
        outcome = await asyncio.to_thread(
            run_image_edit,
            source_image_url=req.source_image_url,
            prompt=req.prompt or "",
            mode=mode,
            mask_image_url=req.mask_image_url or "",
            reference_image_urls=req.reference_image_urls or [],
            reference_intent=req.reference_intent or "replace_material",
            reference_target=req.reference_target or "",
            reference_roles=req.reference_roles or [],
            expand_top=req.expand_top,
            expand_bottom=req.expand_bottom,
            expand_left=req.expand_left,
            expand_right=req.expand_right,
            strength=req.strength,
            n=req.n,
            seed=req.seed,
            upscale_factor=req.upscale_factor,
            is_sketch=req.is_sketch,
            inpaint_ai_blend=req.inpaint_ai_blend,
            watermark_mode=req.watermark_mode or "auto",
            watermark_text=req.watermark_text or "",
            watermark_text_include_aliases=req.watermark_text_include_aliases,
        )
        if not outcome.get("success"):
            raise HTTPException(status_code=500, detail=outcome.get("error", "编辑失败"))

        add_generation_record(
            record_type="image_edit",
            prompt=req.prompt or mode,
            result=outcome.get("result", ""),
            metadata={
                "mode": mode,
                "source_image_url": req.source_image_url,
                "mask_image_url": req.mask_image_url,
                "reference_image_urls": req.reference_image_urls,
                "reference_intent": req.reference_intent,
                "reference_target": req.reference_target,
                "n": req.n,
            },
        )

        image_urls = [
            f"/api/media/{os.path.basename(path)}"
            for path in (outcome.get("local_paths") or [])
            if path
        ]
        return {
            "result": outcome.get("result", ""),
            "image_url": image_urls[0] if image_urls else "",
            "image_urls": image_urls,
            "mode": mode,
            "model": outcome.get("model"),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[api] /tools/image/edit error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/tools/image/export")
async def api_export_image(req: ImageExportRequest):
    """Export image to PNG, JPEG, or layered PSD (Edited / Original / Mask)."""
    from tools.image_export_tools import export_image_file

    fmt = (req.format or "png").strip().lower()
    logger.info(
        "[api] POST /tools/image/export format=%s image=%r",
        fmt,
        req.image_url[:80],
    )
    try:
        outcome = await asyncio.to_thread(
            export_image_file,
            req.image_url,
            fmt,
            source_image_url=req.source_image_url or "",
            mask_image_url=req.mask_image_url or "",
            jpeg_quality=req.jpeg_quality,
        )
        if not outcome.get("success"):
            raise HTTPException(status_code=400, detail=outcome.get("error", "导出失败"))
        return {
            "download_url": outcome.get("download_url", ""),
            "filename": outcome.get("filename", ""),
            "format": outcome.get("format", fmt),
            "size_bytes": outcome.get("size_bytes", 0),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[api] /tools/image/export error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/tools/image/split-psd/status")
async def api_split_image_psd_status():
    """LayerD engine readiness: packages, cached weights, pipeline loaded."""
    from tools.image_layer_split_tools import get_split_psd_status

    try:
        return await asyncio.to_thread(get_split_psd_status)
    except Exception as e:
        logger.error("[api] /tools/image/split-psd/status error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/tools/image/split-psd/warmup")
async def api_split_image_psd_warmup():
    """Preload LayerD models (BiRefNet + LaMa) before first split."""
    from tools.image_layer_split_tools import warmup_split_psd_engine

    logger.info("[api] POST /tools/image/split-psd/warmup")
    try:
        outcome = await asyncio.to_thread(warmup_split_psd_engine)
        if not outcome.get("success"):
            raise HTTPException(status_code=400, detail=outcome.get("error", "预热失败"))
        return outcome
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[api] /tools/image/split-psd/warmup error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/tools/image/split-psd")
async def api_split_image_psd(req: ImageSplitPsdRequest):
    """Split an image into multiple PSD layers (Qwen-Layered cloud primary)."""
    from tools.image_layer_split_tools import split_image_to_psd

    logger.info(
        "[api] POST /tools/image/split-psd image=%r max_layers=%s high_quality=%s",
        req.image_url[:80],
        req.max_layers,
        req.high_quality,
    )
    try:
        outcome = await asyncio.to_thread(
            split_image_to_psd,
            req.image_url,
            max_layers=req.max_layers,
            include_ocr=req.include_ocr,
            high_quality=req.high_quality,
        )
        if not outcome.get("success"):
            raise HTTPException(status_code=400, detail=outcome.get("error", "拆分失败"))
        return outcome
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[api] /tools/image/split-psd error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/tools/image/logo-motion")
async def api_logo_motion(req: LogoMotionRequest):
    """Generate an animated HTML showcase from a raster logo."""
    from tools.logo_motion_tools import run_logo_motion

    logger.info(
        "[api] POST /tools/image/logo-motion image=%r style=%s duration=%s",
        req.source_image_url[:80],
        req.style,
        req.duration_ms,
    )
    try:
        outcome = await asyncio.to_thread(
            run_logo_motion,
            source_image_url=req.source_image_url,
            motion_brief=req.motion_brief,
            style=req.style,
            duration_ms=req.duration_ms,
        )
        if not outcome.get("success"):
            raise HTTPException(status_code=400, detail=outcome.get("error", "生成失败"))
        add_generation_record(
            record_type="logo_motion",
            prompt=req.motion_brief,
            result=outcome.get("html_url", ""),
            metadata={
                "source_image_url": req.source_image_url,
                "style": req.style,
                "duration_ms": req.duration_ms,
            },
        )
        return outcome
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[api] /tools/image/logo-motion error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/tools/image/logo-motion/status")
async def api_logo_motion_status():
    """Check logo-motion runtime dependencies (Chrome, Playwright)."""
    import shutil

    status = {
        "chrome": False,
        "chrome_path": None,
        "playwright": False,
        "playwright_chromium": False,
    }
    try:
        from tools.logo_motion_tools import _find_chrome

        status["chrome_path"] = _find_chrome()
        status["chrome"] = True
    except Exception as exc:
        status["chrome_error"] = str(exc)

    try:
        import playwright  # noqa: F401

        status["playwright"] = True
    except Exception as exc:
        status["playwright_error"] = str(exc)

    if status["playwright"]:
        try:
            from playwright.sync_api import sync_playwright

            with sync_playwright() as p:
                status["playwright_chromium"] = p.chromium.executable_path is not None
        except Exception as exc:
            status["playwright_chromium_error"] = str(exc)

    return status


@app.post("/tools/image/logo-motion/trace")
async def api_logo_motion_trace(req: LogoMotionTraceRequest):
    """Trace a raster logo to SVG and return fit metrics."""
    from tools.logo_motion_tools import run_trace_logo_to_svg

    logger.info(
        "[api] POST /tools/image/logo-motion/trace image=%r",
        req.source_image_url[:80],
    )
    try:
        outcome = await asyncio.to_thread(run_trace_logo_to_svg, req.source_image_url)
        if not outcome.get("success"):
            raise HTTPException(status_code=400, detail=outcome.get("error", "描摹失败"))
        return outcome
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[api] /tools/image/logo-motion/trace error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


def _extract_video_url_from_result(result: str) -> str:
    """
    从 generate_video 返回的文本中提取本地文件名，转换为 /api/media/<filename> URL。
    优先匹配 '直接显示:' 后的绝对路径，其次匹配 storage/outputs/ 相对路径。
    """
    import re as _re2
    # 优先: **直接显示:** /abs/path/storage/outputs/<filename>
    # 注意: 文本格式为 "**直接显示:** /abs/path"，冒号后跟 ** 再跟空格，
    # 用 [^/\n]+ 跳过冒号和 ** 标记，再捕获以 / 开头的绝对路径。
    m = _re2.search(r'直接显示[^/\n]+(/[^\s]+\.(?:mp4|webm|mov))', result or "", _re2.IGNORECASE)
    if m:
        path = m.group(1).strip()
        filename = os.path.basename(path)
        if filename and filename.endswith(('.mp4', '.webm', '.mov')):
            return f"/api/media/{filename}"
    # 次选: storage/outputs/<anything>.<ext>
    m2 = _re2.search(r'storage[/\\]outputs[/\\]([^\s"\')>]+\.(?:mp4|webm|mov))', result or "", _re2.IGNORECASE)
    if m2:
        return f"/api/media/{os.path.basename(m2.group(1))}"
    return ""


@app.post("/tools/video")
async def api_generate_video(req: MediaRequest):
    logger.info("[api] POST /tools/video prompt=%r", req.prompt[:80])
    try:
        result = await asyncio.to_thread(generate_video.invoke, {"prompt": req.prompt})
        # 保存到历史记录
        add_generation_record(
            record_type="video",
            prompt=req.prompt,
            result=result,
            metadata={}
        )
        video_url = _extract_video_url_from_result(result)
        logger.info("[api] /tools/video done video_url=%s", video_url or "(none)")
        return {"result": result, "video_url": video_url}
    except Exception as e:
        logger.error("[api] /tools/video error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/tools/video/happyhorse")
async def api_generate_happyhorse_video(req: HappyHorseVideoRequest):
    """欢乐马 HappyHorse 专用文生视频（固定 happyhorse-1.0-t2v，不依赖媒体模型选择）"""
    prompt = (req.prompt or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt 不能为空")
    logger.info(
        "[api] POST /tools/video/happyhorse duration=%s ratio=%s prompt=%.80r",
        req.duration,
        req.ratio,
        prompt,
    )
    try:
        result = await asyncio.to_thread(
            generate_happyhorse_t2v_internal,
            prompt,
            duration=req.duration,
            resolution=req.resolution,
            ratio=req.ratio,
            watermark=req.watermark,
            seed=req.seed,
        )
        if not result.get("success"):
            raise HTTPException(status_code=502, detail=result.get("error", "生成失败"))
        local_path = result.get("local_path", "")
        add_generation_record(
            record_type="video",
            prompt=prompt,
            result=local_path or result.get("url", ""),
            metadata={
                "provider": "happyhorse",
                "model": result.get("model"),
                "duration": req.duration,
                "resolution": req.resolution,
                "ratio": req.ratio,
            },
        )
        video_url = ""
        if local_path:
            video_url = f"/api/media/{os.path.basename(local_path)}"
        return {
            "success": True,
            "provider": "happyhorse",
            "model": result.get("model"),
            "video_url": video_url,
            "remote_url": result.get("url"),
            "local_path": local_path,
            "message": "欢乐马视频生成成功",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[api] /tools/video/happyhorse error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/tools/video/happyhorse/from-image")
async def api_generate_happyhorse_video_from_image(req: HappyHorseImageToVideoRequest):
    """欢乐马 HappyHorse 专用图生视频（固定 happyhorse-1.0-i2v）"""
    image_url = (req.image_url or "").strip()
    if not image_url:
        raise HTTPException(status_code=400, detail="image_url 不能为空")
    logger.info(
        "[api] POST /tools/video/happyhorse/from-image duration=%s image=%.80r",
        req.duration,
        image_url,
    )
    try:
        result = await asyncio.to_thread(
            generate_happyhorse_i2v_internal,
            image_url,
            req.prompt,
            duration=req.duration,
            resolution=req.resolution,
            watermark=req.watermark,
            seed=req.seed,
        )
        if not result.get("success"):
            raise HTTPException(status_code=502, detail=result.get("error", "生成失败"))
        local_path = result.get("local_path", "")
        add_generation_record(
            record_type="video",
            prompt=req.prompt or f"HappyHorse 图生视频: {image_url[:120]}",
            result=local_path or result.get("url", ""),
            metadata={
                "provider": "happyhorse",
                "model": result.get("model"),
                "source_image": image_url,
            },
        )
        video_url = ""
        if local_path:
            video_url = f"/api/media/{os.path.basename(local_path)}"
        return {
            "success": True,
            "provider": "happyhorse",
            "model": result.get("model"),
            "video_url": video_url,
            "remote_url": result.get("url"),
            "local_path": local_path,
            "message": "欢乐马图生视频成功",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[api] /tools/video/happyhorse/from-image error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/tools/video/long")
async def api_generate_long_video(req: LongVideoRequest, background_tasks: BackgroundTasks):
    try:
        prompt = (req.prompt or "").strip()
        if not prompt:
            raise HTTPException(status_code=400, detail="prompt 不能为空")

        duration_sec = max(30, min(req.duration_sec, 120))
        task_id = create_long_video_task(prompt=prompt, duration_sec=duration_sec, style=req.style)
        logger.info(
            "[api] POST /tools/video/long task_id=%s duration_sec=%s style=%s prompt_preview=%.120r",
            task_id,
            duration_sec,
            req.style,
            prompt[:120],
        )
        background_tasks.add_task(run_long_video_task, task_id, prompt, duration_sec, req.style)
        return {
            "task_id": task_id,
            "status": "pending",
            "provider": "alibaba",
            "model": os.getenv("WAN_LONG_VIDEO_MODEL", "wan2.7-t2v"),
            "message": "长视频任务已提交，正在使用通义 Wan 分段生成",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Long video submit error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/tools/video/long/{task_id}")
async def api_get_long_video_task(task_id: str):
    task = get_long_video_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="task not found")
    return task


@app.post("/tools/video/auto")
async def api_create_auto_video(req: AutoVideoRequest, background_tasks: BackgroundTasks):
    """一键短视频：主题 → 旁白 → 素材 → 配音 → 字幕 → 成片（MoneyPrinterTurbo 风格）"""
    subject = (req.subject or "").strip()
    if not subject:
        raise HTTPException(status_code=400, detail="subject 不能为空")

    params = AutoVideoParams(
        subject=subject,
        script=req.script.strip(),
        search_terms=req.search_terms,
        voice=req.voice,
        aspect_ratio=req.aspect_ratio,
        material_source=req.material_source,
        clip_duration=req.clip_duration,
        subtitle_enabled=req.subtitle_enabled,
        subtitle_style=req.subtitle_style,
        bgm=req.bgm,
        bgm_volume=req.bgm_volume,
        language=req.language,
        paragraph_number=req.paragraph_number,
    )
    task_id = create_auto_video_task(params)
    logger.info(
        "[api] POST /tools/video/auto task_id=%s subject=%.80r source=%s aspect=%s",
        task_id,
        subject,
        req.material_source,
        req.aspect_ratio,
    )
    background_tasks.add_task(run_auto_video_task, task_id, params)
    return {
        "task_id": task_id,
        "status": "pending",
        "message": "一键短视频任务已提交，正在生成旁白与素材",
    }


@app.get("/tools/video/auto/{task_id}")
async def api_get_auto_video_task(task_id: str):
    task = get_auto_video_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="task not found")
    return task


@app.get("/tools/video/auto/config/voices")
async def api_auto_video_voices():
    has_pexels, has_pixabay = has_stock_api_keys()
    return {
        "voices": list_voice_options(),
        "bgm": get_available_bgm(),
        "stock_keys": {
            "pexels": has_pexels,
            "pixabay": has_pixabay,
            "any": has_pexels or has_pixabay,
        },
    }


# --- 文件上传 API ---
@app.post("/upload")
async def api_upload_file(file: UploadFile = File(...)):
    """上传文件（图片或视频）"""
    try:
        # 验证文件类型
        allowed_types = {
            "image/jpeg", "image/png", "image/gif", "image/webp",
            "video/mp4", "video/webm", "video/quicktime",
            "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/aac", "audio/m4a", "audio/ogg",
        }
        if file.content_type not in allowed_types:
            raise HTTPException(
                status_code=400,
                detail=f"不支持的文件类型: {file.content_type}。支持的类型: jpg, png, gif, webp, mp4, webm, mov, mp3, wav, m4a, aac, ogg"
            )

        # 限制文件大小 (50MB)
        content = await file.read()
        if len(content) > 50 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="文件大小不能超过 50MB")

        # 保存文件
        filepath = save_upload_file(content, file.filename or "upload")
        filename = os.path.basename(filepath)

        # 判断文件类型
        if file.content_type.startswith("video/"):
            asset_type = "video"
        elif file.content_type.startswith("audio/"):
            asset_type = "audio"
        else:
            asset_type = "image"

        return {
            "filename": filename,
            "filepath": filepath,
            "url": f"/uploads/{filename}",
            "type": asset_type,
            "size": len(content)
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Upload error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# --- 上传参考媒体（工具链用）：返回可被图生视频等 API 请求的 URL ---
@app.post("/tools/media/upload-reference")
async def api_upload_media_reference(request: Request, file: UploadFile = File(...)):
    """将用户参考图/短视频暂存至 /uploads，并返回可被后端消费的绝对 URL。"""
    filename_in = file.filename or "upload.bin"
    content_type = (file.content_type or "").lower()
    ext = ("." + (filename_in.split(".")[-1] or "")).lower()
    ok_type = (
        content_type.startswith("image/")
        or content_type.startswith("video/")
        or ext in (
            ".jpg",
            ".jpeg",
            ".png",
            ".webp",
            ".gif",
            ".bmp",
            ".mp4",
            ".mov",
            ".webm",
        )
    )
    if not ok_type:
        raise HTTPException(
            status_code=400,
            detail="上传文件应为图片或常见短视频格式（image/*、video/mp4 等）。",
        )
    content = await file.read()
    if len(content) > 80 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="文件过大（超过 80MB）")
    filepath = save_upload_file(content, filename_in)
    basename = os.path.basename(filepath)
    rel_path = f"/uploads/{basename}"

    public_base = (os.getenv("PUBLIC_BACKEND_URL") or "").strip().rstrip("/")
    if public_base:
        abs_url = f"{public_base}{rel_path}"
    else:
        base = str(request.base_url).rstrip("/")
        abs_url = f"{base}{rel_path}"

    return {
        "ok": True,
        "filename": basename,
        "path": rel_path,
        "public_url": abs_url,
    }


# --- 图生视频 API ---
class ImageToVideoRequest(BaseModel):
    image_url: str
    prompt: str = ""


@app.post("/tools/video/from-image")
async def api_generate_video_from_image(req: ImageToVideoRequest):
    """从图片生成视频"""
    try:
        result = await asyncio.to_thread(
            generate_video_from_image_internal,
            req.image_url,
            req.prompt,
        )
        # 保存到历史记录
        add_generation_record(
            record_type="video",
            prompt=f"图生视频: {req.prompt or req.image_url}",
            result=result,
            metadata={"source_image": req.image_url}
        )
        video_url = _extract_video_url_from_result(result)
        return {"result": result, "video_url": video_url}
    except Exception as e:
        logger.error(f"Image to video error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/tools/video/from-upload")
async def api_generate_video_from_upload(
    file: UploadFile = File(...),
    prompt: str = Form("")
):
    """上传图片并生成视频"""
    try:
        # 验证文件类型
        if not file.content_type or not file.content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail="请上传图片文件")

        # 限制文件大小 (10MB)
        content = await file.read()
        if len(content) > 10 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="图片大小不能超过 10MB")

        # 保存文件
        filepath = save_upload_file(content, file.filename or "upload.jpg")
        filename = os.path.basename(filepath)

        # 需要公网URL才能调用ZhipuAI API
        # 在实际部署时，需要配置公网访问地址
        # 这里先返回本地路径信息
        local_url = f"/uploads/{filename}"

        return {
            "message": "图片已上传，但图生视频需要公网可访问的图片URL",
            "local_url": local_url,
            "filepath": filepath,
            "hint": "请使用已上传到公网的图片URL调用 /tools/video/from-image 接口"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Upload and generate error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# --- 视频混剪 API ---
class RemixRequest(BaseModel):
    file_paths: List[str]
    transition: str = "fade"
    duration_per_clip: float = 3.0


class AIRemixRequest(BaseModel):
    file_paths: List[str]
    user_prompt: str = ""
    fusion_mode: bool = True  # 融合模式（默认开启）
    generate_ai_segments: bool = True
    segment_duration: int = 4
    # 音频选项
    add_narration: bool = False
    narration_text: str = ""
    narration_style: str = "informative"
    narration_voice: str = "zh-CN-XiaoxiaoNeural"
    add_bgm: bool = False
    bgm_id: str = ""
    bgm_path: str = ""
    bgm_volume: float = 0.3
    # 字幕选项
    add_subtitles: bool = False
    subtitle_text: str = ""
    subtitle_style: str = "default"
    subtitle_position: str = "bottom"
    # ASR字幕选项
    use_asr_subtitles: bool = False
    asr_method: str = "whisper"  # "whisper" 或 "glm-asr"
    asr_language: str = "zh"


class OpenCutToolRequest(BaseModel):
    """OpenCut 专业剪辑工具请求"""
    tool: str
    params: Dict[str, Any] = Field(default_factory=dict)


# OpenCut 工具名到函数映射
_OPENCUT_TOOL_MAP = {
    "cut": cut_video_segment,
    "split": split_video,
    "merge": merge_clips,
    "speed": change_video_speed,
    "overlay": overlay_video,
    "text": add_text_overlay,
    "filter": apply_video_filter,
    "audio_extract": extract_audio_track,
    "audio_replace": replace_audio_track,
    "project": generate_opencut_project,
    "script": execute_edit_script,
}


@app.post("/tools/video/opencut")
async def api_opencut_tool(req: OpenCutToolRequest):
    """
    OpenCut 专业剪辑工具统一入口
    根据 tool 字段分发到对应 FFmpeg 实现
    """
    tool_fn = _OPENCUT_TOOL_MAP.get(req.tool)
    if not tool_fn:
        raise HTTPException(status_code=400, detail=f"未知工具: {req.tool}")

    try:
        logger.info("[api] POST /tools/video/opencut tool=%s", req.tool)
        result = await asyncio.to_thread(tool_fn, **req.params)
        if isinstance(result, dict) and result.get("success"):
            add_generation_record(
                record_type="video",
                prompt=f"OpenCut 剪辑: {req.tool}",
                result=result.get("local_path", ""),
                metadata={"tool": req.tool, "params": req.params},
            )
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[api] /tools/video/opencut error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/tools/video/opencut/{tool}")
async def api_opencut_tool_by_path(tool: str, params: Dict[str, Any] = None):
    """兼容路径参数的 OpenCut 工具调用"""
    params = params or {}
    return await api_opencut_tool(OpenCutToolRequest(tool=tool, params=params))


@app.post("/tools/video/remix")
async def api_remix_videos(req: RemixRequest):
    """混剪多个视频/图片素材（简单拼接模式）"""
    try:
        if len(req.file_paths) < 2:
            raise HTTPException(status_code=400, detail="至少需要2个素材文件")

        result = remix_videos(
            file_paths=req.file_paths,
            transition=req.transition,
            duration_per_clip=req.duration_per_clip
        )

        # 保存到历史记录
        add_generation_record(
            record_type="video",
            prompt=f"混剪视频: {len(req.file_paths)} 个素材",
            result=result,
            metadata={"source_files": req.file_paths, "type": "remix"}
        )

        return {"result": result}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Remix error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/tools/video/ai-remix")
async def api_ai_remix_videos(req: AIRemixRequest):
    """
    AI智能混剪 - 使用大模型分析素材并生成创意视频

    融合模式（默认）：
    1. 使用GLM-4V视觉模型分析每个素材内容
    2. 使用GLM-4将所有素材元素融合成统一的视频描述
    3. 使用CogVideoX生成一个融合所有元素的完整AI视频

    分段模式：
    1. 分析素材 -> 2. 生成脚本 -> 3. 逐段生成 -> 4. 拼接

    音频选项：
    - 支持AI配音（自动生成或自定义文本）
    - 支持背景音乐（预设或自定义）
    """
    try:
        if len(req.file_paths) < 1:
            raise HTTPException(status_code=400, detail="至少需要1个素材文件")

        mode_name = "融合模式" if req.fusion_mode else "分段模式"
        audio_info = []
        if req.add_narration:
            audio_info.append("配音")
        if req.add_bgm:
            audio_info.append("BGM")
        audio_str = f" + {'+'.join(audio_info)}" if audio_info else ""
        logger.info(f"Starting AI remix ({mode_name}{audio_str}) with {len(req.file_paths)} files, prompt: {req.user_prompt}")

        result = ai_remix_videos(
            file_paths=req.file_paths,
            user_prompt=req.user_prompt,
            fusion_mode=req.fusion_mode,
            generate_ai_segments=req.generate_ai_segments,
            segment_duration=req.segment_duration,
            # 音频参数
            add_narration=req.add_narration,
            narration_text=req.narration_text,
            narration_style=req.narration_style,
            narration_voice=req.narration_voice,
            add_bgm=req.add_bgm,
            bgm_id=req.bgm_id,
            bgm_path=req.bgm_path,
            bgm_volume=req.bgm_volume,
            # 字幕参数
            add_subtitles=req.add_subtitles,
            subtitle_text=req.subtitle_text,
            subtitle_style=req.subtitle_style,
            subtitle_position=req.subtitle_position,
            # ASR字幕参数
            use_asr_subtitles=req.use_asr_subtitles,
            asr_method=req.asr_method,
            asr_language=req.asr_language
        )

        if result.get("success"):
            # 保存到历史记录
            add_generation_record(
                record_type="video",
                prompt=f"AI智能混剪: {req.user_prompt or '创意混剪'} ({len(req.file_paths)} 素材)",
                result=result.get("message", "AI混剪完成"),
                metadata={
                    "source_files": req.file_paths,
                    "type": "ai_remix",
                    "script": result.get("script"),
                    "stages": result.get("stages"),
                    "has_narration": req.add_narration,
                    "has_bgm": req.add_bgm,
                    "has_subtitles": req.add_subtitles,
                    "has_asr_subtitles": req.use_asr_subtitles
                }
            )

        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"AI Remix error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# --- 音频配置 API ---
@app.get("/tools/audio/config")
async def api_get_audio_config():
    """获取可用的音频和字幕配置选项"""
    try:
        bgm_list = get_available_bgm()
        return {
            "voices": VOICE_OPTIONS,
            "styles": NARRATION_STYLES,
            "bgm_list": bgm_list,
            "subtitle_styles": SUBTITLE_STYLES
        }
    except Exception as e:
        logger.error(f"Get audio config error: {e}")
        return {
            "voices": VOICE_OPTIONS,
            "styles": NARRATION_STYLES,
            "bgm_list": [],
            "subtitle_styles": SUBTITLE_STYLES
        }


class TTSRequest(BaseModel):
    text: str
    voice: str = "zh-CN-XiaoxiaoNeural"
    output_filename: str = ""


@app.post("/tools/audio/tts")
async def api_generate_tts(req: TTSRequest):
    """生成TTS语音"""
    try:
        import asyncio
        result = await generate_speech_edge_tts(
            text=req.text,
            voice=req.voice,
            output_filename=req.output_filename or None
        )

        if result.get("success"):
            return result
        else:
            raise HTTPException(status_code=500, detail=result.get("error", "TTS生成失败"))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"TTS error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# --- 历史记录 API ---
@app.get("/history")
async def api_get_history(record_type: Optional[str] = None, limit: int = 50):
    try:
        items = get_generation_history(record_type=record_type, limit=limit)
        return {"items": items}
    except Exception as e:
        logger.error(f"Get history error: {e}")
        return {"items": []}


class ChatHistoryRequest(BaseModel):
    prompt: str
    result: str
    type: str


@app.post("/chat/history")
async def api_save_chat_history(req: ChatHistoryRequest):
    """保存聊天生成的内容到历史记录"""
    try:
        record = add_generation_record(
            record_type=req.type,
            prompt=req.prompt,
            result=req.result,
            metadata={"source": "chat"}
        )
        return {"message": "Saved", "id": record["id"]}
    except Exception as e:
        logger.error(f"Save chat history error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/history")
async def api_clear_history():
    try:
        clear_generation_history()
        return {"message": "History cleared"}
    except Exception as e:
        logger.error(f"Clear history error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/history/{record_id}")
async def api_delete_record(record_id: str):
    try:
        success = delete_generation_record(record_id)
        if success:
            return {"message": "Record deleted"}
        else:
            raise HTTPException(status_code=404, detail="Record not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Delete record error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/history/{record_id}/download")
async def api_download_record(record_id: str):
    """下载历史记录中的媒体文件"""
    try:
        # 获取记录详情
        items = get_generation_history(limit=1000)  # 获取所有记录
        record = next((item for item in items if item["id"] == record_id), None)

        if not record:
            raise HTTPException(status_code=404, detail="Record not found")

        # 尝试将非多媒体内容作为文本文件下载
        if record["type"] not in ["image", "video"]:
            from fastapi.responses import Response
            content_text = record.get("result", "")
            if not content_text:
                raise HTTPException(status_code=400, detail="Record content is empty")

            filename = f"{record['type']}_{record_id[:8]}.txt"
            headers = {
                "Content-Disposition": f"attachment; filename=\"{filename}\"",
            }
            return Response(content=content_text, media_type="text/plain; charset=utf-8", headers=headers)

        # 从结果中提取文件路径或URL
        result_text = record.get("result", "")
        media_path = None
        media_url = None

        # 尝试从结果文本中提取文件路径
        import re
        # 匹配 ./storage/outputs/xxx.mp4 或 storage/outputs/xxx.mp4 或类似的路径
        path_match = re.search(r'[./]*storage/outputs/([^\s]+\.(?:mp4|jpg|jpeg|png|gif|webm))', result_text)
        if path_match:
            filename = path_match.group(1)
            media_path = os.path.join(OUTPUT_DIR, filename)

        # 尝试提取URL
        url_match = re.search(r'https?://[^\s]+', result_text)
        if url_match:
            media_url = url_match.group(0)

        # 如果没找到路径，尝试从metadata中查找
        if not media_path and record.get("metadata"):
            metadata = record["metadata"]
            # 检查是否有final_video字段
            if metadata.get("final_video"):
                final_video = metadata["final_video"]
                if final_video.startswith("/media/"):
                    filename = final_video.replace("/media/", "")
                    media_path = os.path.join(OUTPUT_DIR, filename)

        # 优先使用本地文件，如果不存在则重定向到URL
        if media_path and os.path.exists(media_path):
            # 返回本地文件
            from fastapi.responses import FileResponse
            return FileResponse(
                path=media_path,
                filename=os.path.basename(media_path),
                media_type="video/mp4" if media_path.endswith('.mp4') else "image/jpeg"
            )
        elif media_url:
            # 重定向到外部URL
            from fastapi.responses import RedirectResponse
            return RedirectResponse(url=media_url, status_code=302)
        else:
            raise HTTPException(status_code=404, detail="Media file not found")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Download record error: {e}")
        raise HTTPException(status_code=500, detail=str(e))




if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)


# =============================================================
# My Computer API — 本地文件夹注册 & 后台索引
# =============================================================

import services.computer_service as _cs
from fastapi import BackgroundTasks


class ComputerFolderAddRequest(BaseModel):
    name: str = ""
    path: str


class ComputerIndexPrefsRequest(BaseModel):
    storageLimitGiB: Optional[float] = None
    maxFileMiB: Optional[float] = None


class ComputerBrowseRequest(BaseModel):
    path: str = "/"


class LocalComputerActionRequest(BaseModel):
    action: str = Field(..., min_length=1, max_length=80)
    path: Optional[str] = None
    dest_path: Optional[str] = None
    content: Optional[str] = None
    command: Optional[str] = None
    working_dir: Optional[str] = None
    app_id: Optional[str] = None
    trace_id: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class SystemAssistantRunRequest(BaseModel):
    recipe_id: str = Field(..., min_length=1, max_length=120)
    params: Dict[str, Any] = Field(default_factory=dict)
    trace_id: Optional[str] = None


class ProgrammerRunRequest(BaseModel):
    recipe_id: str = Field(..., min_length=1, max_length=120)
    params: Dict[str, Any] = Field(default_factory=dict)
    trace_id: Optional[str] = None


class ProductManagerRunRequest(BaseModel):
    recipe_id: str = Field(..., min_length=1, max_length=120)
    params: Dict[str, Any] = Field(default_factory=dict)
    trace_id: Optional[str] = None


class LegalAdvisorRunRequest(BaseModel):
    recipe_id: str = Field(..., min_length=1, max_length=120)
    params: Dict[str, Any] = Field(default_factory=dict)
    trace_id: Optional[str] = None


class AdCampaignRunRequest(BaseModel):
    recipe_id: str = Field(..., min_length=1, max_length=120)
    params: Dict[str, Any] = Field(default_factory=dict)
    trace_id: Optional[str] = None


class ShortDramaRunRequest(BaseModel):
    recipe_id: str = Field(..., min_length=1, max_length=120)
    params: Dict[str, Any] = Field(default_factory=dict)
    trace_id: Optional[str] = None


class PodcastRunRequest(BaseModel):
    recipe_id: str = Field(..., min_length=1, max_length=120)
    params: Dict[str, Any] = Field(default_factory=dict)
    trace_id: Optional[str] = None


class MusicRunRequest(BaseModel):
    recipe_id: str = Field(..., min_length=1, max_length=120)
    params: Dict[str, Any] = Field(default_factory=dict)
    trace_id: Optional[str] = None


class ProcurementAssistantRunRequest(BaseModel):
    recipe_id: str = Field(..., min_length=1, max_length=120)
    params: Dict[str, Any] = Field(default_factory=dict)
    trace_id: Optional[str] = None


class BusinessPartnershipRunRequest(BaseModel):
    recipe_id: str = Field(..., min_length=1, max_length=120)
    params: Dict[str, Any] = Field(default_factory=dict)
    trace_id: Optional[str] = None


class GameArtRunRequest(BaseModel):
    recipe_id: str = Field(..., min_length=1, max_length=120)
    params: Dict[str, Any] = Field(default_factory=dict)
    trace_id: Optional[str] = None


class GameDesignRunRequest(BaseModel):
    recipe_id: str = Field(..., min_length=1, max_length=120)
    params: Dict[str, Any] = Field(default_factory=dict)
    trace_id: Optional[str] = None


class SystemAssistantCatalogRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    packages: Dict[str, str] = Field(default_factory=dict)
    category: str = Field(default="custom", max_length=64)


class DesktopAutomationPlanRequest(BaseModel):
    action_id: str = Field(..., min_length=1, max_length=64)
    params: Optional[Dict[str, Any]] = None


class PlatformActionRequest(BaseModel):
    platform_id: str = Field(..., min_length=1, max_length=80)
    action_id: str = Field(..., min_length=1, max_length=120)
    params: Dict[str, Any] = Field(default_factory=dict)
    trace_id: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


@app.get("/computer/browse")
async def api_computer_browse(path: str = "/"):
    """浏览服务器目录结构，返回子目录列表"""
    result = _cs.browse_directory(path)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.get("/computer/status")
async def api_computer_status():
    """返回真实磁盘使用量 + RAG 索引目录大小"""
    return await asyncio.to_thread(_cs.get_status)


@app.get("/computer/folders")
async def api_computer_list_folders():
    """获取所有已注册的本地文件夹"""
    return {"folders": await asyncio.to_thread(_cs.get_folders)}


@app.post("/computer/folders")
async def api_computer_add_folder(req: ComputerFolderAddRequest):
    """
    添加本地文件夹并触发后台索引。
    立即返回 pending 状态的文件夹条目；
    前端可轮询 GET /computer/folders 观察进度。
    """
    result = _cs.add_folder(req.name, req.path)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    folder_id = result["folder"]["id"]
    _cs.start_index_folder(folder_id)
    return result


@app.delete("/computer/folders/{folder_id}")
async def api_computer_remove_folder(folder_id: str):
    """删除文件夹注册并从 RAG 索引中清除对应文档"""
    result = _cs.remove_folder(folder_id)
    if not result["success"]:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


@app.post("/computer/folders/{folder_id}/reindex")
async def api_computer_reindex_folder(folder_id: str):
    """清除旧索引并重新索引指定文件夹"""
    result = _cs.reindex_folder(folder_id)
    if not result["success"]:
        raise HTTPException(status_code=404, detail=result["error"])
    _cs.start_index_folder(folder_id)
    return result


@app.post("/computer/folders/{folder_id}/pause")
async def api_computer_pause_index(folder_id: str):
    """暂停文件夹索引"""
    result = _cs.pause_index_folder(folder_id)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.post("/computer/folders/{folder_id}/resume")
async def api_computer_resume_index(folder_id: str):
    """继续文件夹索引"""
    result = _cs.resume_index_folder(folder_id)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.post("/computer/folders/{folder_id}/cancel")
async def api_computer_cancel_index(folder_id: str):
    """取消文件夹索引（保留已入库内容）"""
    result = _cs.cancel_index_folder(folder_id)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.get("/computer/index-prefs")
async def api_computer_get_prefs():
    """获取索引偏好设置"""
    return _cs.get_index_prefs()


@app.put("/computer/index-prefs")
async def api_computer_save_prefs(req: ComputerIndexPrefsRequest):
    """保存索引偏好设置"""
    updates: Dict[str, Any] = {}
    if req.storageLimitGiB is not None:
        updates["storageLimitGiB"] = req.storageLimitGiB
    if req.maxFileMiB is not None:
        updates["maxFileMiB"] = req.maxFileMiB
    return _cs.save_index_prefs(updates)


@app.get("/computer/roots")
async def api_computer_allowed_roots():
    """返回本地电脑动作允许访问的根目录。"""
    return {"roots": local_computer_service.list_allowed_roots()}


@app.get("/computer/desktop-profiles")
async def api_computer_desktop_profiles():
    """OS 桌面级原子动作注册表（与现有 capability 映射；不含本机驱动实现）。"""
    from core.desktop_actions import list_desktop_action_profiles

    return {"profiles": list_desktop_action_profiles()}


@app.get("/computer/desktop-profiles/{action_id}")
async def api_computer_desktop_profile(action_id: str):
    from core.desktop_actions import get_desktop_action_profile

    prof = get_desktop_action_profile(action_id)
    if not prof:
        raise HTTPException(status_code=404, detail="Unknown desktop action")
    return prof


@app.post("/computer/desktop-plan")
async def api_computer_desktop_plan(req: DesktopAutomationPlanRequest):
    """生成桌面动作规划（ capability + 审批提示 + 实现路径）；不执行。"""
    from core.desktop_actions import plan_desktop_action

    try:
        plan = plan_desktop_action(req.action_id, req.params)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"success": True, "plan": plan}


@app.get("/computer/actions/audit")
async def api_computer_action_audit(
    limit: int = 100,
    action: Optional[str] = None,
    status: Optional[str] = None,
    task_id: Optional[str] = None,
):
    """查询本地电脑动作审计日志。"""
    return {
        "events": local_computer_service.list_audit_events(
            limit=limit,
            action=action,
            status=status,
            task_id=task_id,
        )
    }


@app.post("/computer/actions")
async def api_computer_action(req: LocalComputerActionRequest):
    """执行或申请审批一个本地电脑动作。写入/删除/Shell/应用启动默认只进入审批。"""
    try:
        return local_computer_service.run_action(
            action=req.action,
            path=req.path,
            dest_path=req.dest_path,
            content=req.content,
            command=req.command,
            working_dir=req.working_dir,
            app_id=req.app_id,
            trace_id=req.trace_id,
            metadata=req.metadata,
        )
    except LocalComputerError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/computer/actions/{task_id}/resume")
async def api_computer_action_resume(task_id: str):
    """审批通过后执行已批准的本地文件动作。"""
    try:
        result = local_computer_service.resume_approved_action(task_id)
        if result is None:
            raise HTTPException(status_code=404, detail="Task not found")
        return result
    except LocalComputerError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@app.post("/computer/actions/{task_id}/rollback")
async def api_computer_action_rollback(task_id: str):
    """用执行前快照回滚已完成的本地文件动作。"""
    try:
        result = local_computer_service.rollback_action(task_id)
        if result is None:
            raise HTTPException(status_code=404, detail="Task not found")
        return result
    except LocalComputerError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


# ── System Assistant API ───────────────────────────────────────────────────
from core.app_catalog import add_custom_app, get_app, list_apps, search_apps
from core.system_recipes import list_recipes
from services import system_assistant_service


@app.get("/system-assistant/recipes")
async def api_system_assistant_recipes(category: Optional[str] = None):
    return {"recipes": list_recipes(category=category)}


@app.get("/system-assistant/environment")
async def api_system_assistant_environment(client_platform: Optional[str] = None):
    return system_assistant_service.get_environment(client_platform)


@app.get("/system-assistant/suggestions")
async def api_system_assistant_suggestions(client_platform: Optional[str] = None):
    return system_assistant_service.get_suggestions(client_platform=client_platform)


@app.get("/system-assistant/catalog")
async def api_system_assistant_catalog(query: Optional[str] = None, category: Optional[str] = None):
    return {"apps": list_apps(query=query, category=category)}


@app.post("/system-assistant/catalog")
async def api_system_assistant_catalog_add(req: SystemAssistantCatalogRequest):
    entry = add_custom_app(name=req.name, packages=req.packages, category=req.category)
    return {"success": True, "app": entry}


@app.get("/system-assistant/diagnostics/quick")
async def api_system_assistant_quick_diagnostics():
    return system_assistant_service.quick_diagnostics()


@app.post("/system-assistant/run")
async def api_system_assistant_run(req: SystemAssistantRunRequest):
    try:
        return system_assistant_service.start_recipe(
            req.recipe_id,
            req.params,
            trace_id=req.trace_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/system-assistant/tasks/{task_id}")
async def api_system_assistant_task(task_id: str):
    task = system_assistant_service.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@app.post("/system-assistant/tasks/{task_id}/resume")
async def api_system_assistant_task_resume(task_id: str):
    try:
        return system_assistant_service.resume_task(task_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@app.post("/system-assistant/tasks/{task_id}/cancel")
async def api_system_assistant_task_cancel(task_id: str):
    from utils.task_manager import task_manager

    task = task_manager.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    task_manager.update_task(task_id, status="cancelled", message="已取消")
    return {"success": True, "task_id": task_id}


# ── Programmer Agent API ───────────────────────────────────────────────────
from core.programmer_recipes import list_recipes as list_programmer_recipes
from services import programmer_service


@app.get("/programmer/recipes")
async def api_programmer_recipes(category: Optional[str] = None):
    return {"recipes": list_programmer_recipes(category=category)}


@app.get("/programmer/environment")
async def api_programmer_environment():
    return programmer_service.get_environment()


@app.get("/programmer/suggestions")
async def api_programmer_suggestions():
    return programmer_service.get_suggestions()


@app.get("/programmer/components")
async def api_programmer_components():
    from core.infra_components import list_components

    return {"components": list_components()}


@app.post("/programmer/run")
async def api_programmer_run(req: ProgrammerRunRequest):
    try:
        return programmer_service.start_recipe(
            req.recipe_id,
            req.params,
            trace_id=req.trace_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/programmer/tasks/{task_id}")
async def api_programmer_task(task_id: str):
    task = programmer_service.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@app.post("/programmer/tasks/{task_id}/resume")
async def api_programmer_task_resume(task_id: str):
    try:
        return programmer_service.resume_task(task_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


# ── Product Manager Agent API ──────────────────────────────────────────────
from core.product_manager_recipes import list_recipes as list_product_manager_recipes
from services import product_manager_service


@app.get("/product-manager/recipes")
async def api_product_manager_recipes(category: Optional[str] = None):
    return {"recipes": list_product_manager_recipes(category=category)}


@app.get("/product-manager/environment")
async def api_product_manager_environment():
    return product_manager_service.get_environment()


@app.get("/product-manager/suggestions")
async def api_product_manager_suggestions():
    return product_manager_service.get_suggestions()


@app.post("/product-manager/run")
async def api_product_manager_run(req: ProductManagerRunRequest):
    try:
        return product_manager_service.start_recipe(
            req.recipe_id,
            req.params,
            trace_id=req.trace_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/product-manager/tasks/{task_id}")
async def api_product_manager_task(task_id: str):
    task = product_manager_service.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


# ── Legal Advisor Agent API ────────────────────────────────────────────────
from core.legal_recipes import list_recipes as list_legal_recipes
from services import legal_service


@app.get("/legal-advisor/recipes")
async def api_legal_advisor_recipes(category: Optional[str] = None):
    return {"recipes": list_legal_recipes(category=category)}


@app.get("/legal-advisor/environment")
async def api_legal_advisor_environment():
    return legal_service.get_environment()


@app.get("/legal-advisor/suggestions")
async def api_legal_advisor_suggestions():
    return legal_service.get_suggestions()


@app.post("/legal-advisor/run")
async def api_legal_advisor_run(req: LegalAdvisorRunRequest):
    try:
        return legal_service.start_recipe(
            req.recipe_id,
            req.params,
            trace_id=req.trace_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/legal-advisor/tasks/{task_id}")
async def api_legal_advisor_task(task_id: str):
    task = legal_service.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


# ── Ad Campaign Assistant API ──────────────────────────────────────────────
from core.ad_campaign_recipes import list_recipes as list_ad_campaign_recipes
from services import ad_campaign_service


@app.get("/ad-campaign/recipes")
async def api_ad_campaign_recipes(category: Optional[str] = None):
    return {"recipes": list_ad_campaign_recipes(category=category)}


@app.get("/ad-campaign/environment")
async def api_ad_campaign_environment():
    return ad_campaign_service.get_environment()


@app.get("/ad-campaign/suggestions")
async def api_ad_campaign_suggestions():
    return ad_campaign_service.get_suggestions()


@app.post("/ad-campaign/run")
async def api_ad_campaign_run(req: AdCampaignRunRequest):
    try:
        return ad_campaign_service.start_recipe(
            req.recipe_id,
            req.params,
            trace_id=req.trace_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/ad-campaign/tasks/{task_id}")
async def api_ad_campaign_task(task_id: str):
    task = ad_campaign_service.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


# ── AI Short Drama API ─────────────────────────────────────────────────────
from core.short_drama_recipes import list_recipes as list_short_drama_recipes
from services import short_drama_service


@app.get("/short-drama/recipes")
async def api_short_drama_recipes(category: Optional[str] = None):
    return {"recipes": list_short_drama_recipes(category=category)}


@app.get("/short-drama/environment")
async def api_short_drama_environment():
    return short_drama_service.get_environment()


@app.get("/short-drama/suggestions")
async def api_short_drama_suggestions():
    return short_drama_service.get_suggestions()


@app.post("/short-drama/run")
async def api_short_drama_run(req: ShortDramaRunRequest):
    try:
        return short_drama_service.start_recipe(
            req.recipe_id,
            req.params,
            trace_id=req.trace_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/short-drama/tasks/{task_id}")
async def api_short_drama_task(task_id: str):
    task = short_drama_service.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


# ── AI Podcast API ─────────────────────────────────────────────────────────
from core.podcast_recipes import list_recipes as list_podcast_recipes
from services import podcast_service


@app.get("/podcast/recipes")
async def api_podcast_recipes(category: Optional[str] = None):
    return {"recipes": list_podcast_recipes(category=category)}


@app.get("/podcast/environment")
async def api_podcast_environment():
    return podcast_service.get_environment()


@app.get("/podcast/suggestions")
async def api_podcast_suggestions():
    return podcast_service.get_suggestions()


@app.post("/podcast/run")
async def api_podcast_run(req: PodcastRunRequest):
    try:
        return podcast_service.start_recipe(
            req.recipe_id,
            req.params,
            trace_id=req.trace_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/podcast/tasks/{task_id}")
async def api_podcast_task(task_id: str):
    task = podcast_service.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


# ── AI Music API ───────────────────────────────────────────────────────────
from core.music_recipes import list_recipes as list_music_recipes
from services import music_service


@app.get("/music/recipes")
async def api_music_recipes(category: Optional[str] = None):
    return {"recipes": list_music_recipes(category=category)}


@app.get("/music/environment")
async def api_music_environment():
    return music_service.get_environment()


@app.get("/music/suggestions")
async def api_music_suggestions():
    return music_service.get_suggestions()


@app.post("/music/run")
async def api_music_run(req: MusicRunRequest):
    try:
        return music_service.start_recipe(
            req.recipe_id,
            req.params,
            trace_id=req.trace_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/music/tasks/{task_id}")
async def api_music_task(task_id: str):
    task = music_service.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


# ── Business Partnership Assistant API ─────────────────────────────────────
from core.business_partnership_recipes import list_recipes as list_business_partnership_recipes
from services import business_partnership_service


@app.get("/business-partnership/recipes")
async def api_business_partnership_recipes(category: Optional[str] = None):
    return {"recipes": list_business_partnership_recipes(category=category)}


@app.get("/business-partnership/environment")
async def api_business_partnership_environment():
    return business_partnership_service.get_environment()


@app.get("/business-partnership/suggestions")
async def api_business_partnership_suggestions():
    return business_partnership_service.get_suggestions()


@app.post("/business-partnership/run")
async def api_business_partnership_run(req: BusinessPartnershipRunRequest):
    try:
        return business_partnership_service.start_recipe(
            req.recipe_id,
            req.params,
            trace_id=req.trace_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/business-partnership/tasks/{task_id}")
async def api_business_partnership_task(task_id: str):
    task = business_partnership_service.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


# ── Procurement Assistant API ───────────────────────────────────────────────
from core.procurement_recipes import list_recipes as list_procurement_recipes
from services import procurement_service


@app.get("/procurement-assistant/recipes")
async def api_procurement_assistant_recipes(category: Optional[str] = None):
    return {"recipes": list_procurement_recipes(category=category)}


@app.get("/procurement-assistant/environment")
async def api_procurement_assistant_environment():
    return procurement_service.get_environment()


@app.get("/procurement-assistant/suggestions")
async def api_procurement_assistant_suggestions():
    return procurement_service.get_suggestions()


@app.post("/procurement-assistant/run")
async def api_procurement_assistant_run(req: ProcurementAssistantRunRequest):
    try:
        return procurement_service.start_recipe(
            req.recipe_id,
            req.params,
            trace_id=req.trace_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/procurement-assistant/tasks/{task_id}")
async def api_procurement_assistant_task(task_id: str):
    task = procurement_service.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


# ── Game Art Agent API ─────────────────────────────────────────────────────
from core.game_art_recipes import list_recipes as list_game_art_recipes
from services import game_art_service


@app.get("/game-art/recipes")
async def api_game_art_recipes(category: Optional[str] = None):
    return {"recipes": list_game_art_recipes(category=category)}


@app.get("/game-art/environment")
async def api_game_art_environment():
    return game_art_service.get_environment()


@app.get("/game-art/suggestions")
async def api_game_art_suggestions():
    return game_art_service.get_suggestions()


@app.post("/game-art/run")
async def api_game_art_run(req: GameArtRunRequest):
    try:
        return game_art_service.start_recipe(
            req.recipe_id,
            req.params,
            trace_id=req.trace_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/game-art/tasks/{task_id}")
async def api_game_art_task(task_id: str):
    task = game_art_service.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


# ── Game Design Agent API ──────────────────────────────────────────────────
from core.game_design_recipes import list_recipes as list_game_design_recipes
from services import game_design_service


@app.get("/game-design/recipes")
async def api_game_design_recipes(category: Optional[str] = None):
    return {"recipes": list_game_design_recipes(category=category)}


@app.get("/game-design/environment")
async def api_game_design_environment():
    return game_design_service.get_environment()


@app.get("/game-design/suggestions")
async def api_game_design_suggestions():
    return game_design_service.get_suggestions()


@app.post("/game-design/run")
async def api_game_design_run(req: GameDesignRunRequest):
    try:
        return game_design_service.start_recipe(
            req.recipe_id,
            req.params,
            trace_id=req.trace_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/game-design/tasks/{task_id}")
async def api_game_design_task(task_id: str):
    task = game_design_service.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


# ── Skills API ─────────────────────────────────────────────────────────────
SKILLS_DIR = Path(PROJECT_ROOT) / ".agent" / "skills"
SKILLS_ENABLED_PATH = Path(PROJECT_ROOT) / "storage" / "skills_enabled.json"


def _load_skills_enabled() -> dict:
    if SKILLS_ENABLED_PATH.exists():
        try:
            return json.loads(SKILLS_ENABLED_PATH.read_text())
        except Exception:
            pass
    return {}


def _save_skills_enabled(state: dict):
    SKILLS_ENABLED_PATH.parent.mkdir(parents=True, exist_ok=True)
    SKILLS_ENABLED_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2))


def _parse_skill_frontmatter(content: str) -> dict:
    """Parse YAML frontmatter from SKILL.md"""
    meta: dict = {}
    if content.startswith("---"):
        end = content.find("---", 3)
        if end != -1:
            fm = content[3:end].strip()
            for line in fm.splitlines():
                if ":" in line:
                    k, _, v = line.partition(":")
                    meta[k.strip()] = v.strip()
    return meta


@app.get("/api/skills")
async def api_list_skills():
    """List available agent skills from .agent/skills/"""
    enabled = _load_skills_enabled()
    skills = []
    if SKILLS_DIR.exists():
        for skill_dir in sorted(SKILLS_DIR.iterdir()):
            if not skill_dir.is_dir() or skill_dir.name.startswith("."):
                continue
            skill_file = skill_dir / "SKILL.md"
            meta: dict = {}
            description = ""
            if skill_file.exists():
                try:
                    content = skill_file.read_text(encoding="utf-8", errors="ignore")
                    meta = _parse_skill_frontmatter(content)
                    # First non-blank non-heading line after frontmatter as fallback desc
                    if not meta.get("description"):
                        in_fm = content.startswith("---")
                        body = content[content.find("---", 3) + 3:].strip() if in_fm else content
                        for line in body.splitlines():
                            line = line.strip()
                            if line and not line.startswith("#"):
                                description = line[:200]
                                break
                    else:
                        description = meta["description"]
                except Exception:
                    pass
            skill_id = skill_dir.name
            skills.append({
                "id": skill_id,
                "name": meta.get("name") or meta.get("display_name") or skill_id,
                "display_name": meta.get("display_name") or meta.get("name") or skill_id,
                "description": description or meta.get("description", ""),
                "category": meta.get("category") or meta.get("metadata.category", "General"),
                "version": meta.get("version", ""),
                "has_skill_md": skill_file.exists(),
                "enabled": enabled.get(skill_id, True),
            })
    return {"skills": skills}


class SkillToggleRequest(BaseModel):
    skill_id: str
    enabled: bool


@app.post("/api/skills/toggle")
async def api_toggle_skill(req: SkillToggleRequest):
    """Enable or disable a skill"""
    enabled = _load_skills_enabled()
    enabled[req.skill_id] = req.enabled
    _save_skills_enabled(enabled)
    return {"success": True, "skill_id": req.skill_id, "enabled": req.enabled}


class SkillImportRequest(BaseModel):
    skill_id: str
    display_name: str
    description: str = ""
    category: str = "General"
    version: str = "1.0.0"
    allowed_tools: str = ""


@app.post("/api/skills/import")
async def api_import_skill(req: SkillImportRequest):
    """Create a new skill directory with SKILL.md from form data"""
    import re
    skill_id = re.sub(r"[^a-z0-9\-_]", "-", req.skill_id.strip().lower()).strip("-")
    if not skill_id:
        raise HTTPException(status_code=400, detail="Invalid skill_id")
    skill_dir = SKILLS_DIR / skill_id
    skill_dir.mkdir(parents=True, exist_ok=True)
    skill_file = skill_dir / "SKILL.md"
    lines = ["---"]
    lines.append(f"name: {skill_id}")
    lines.append(f"display_name: {req.display_name}")
    lines.append(f"description: {req.description}")
    lines.append(f"category: {req.category}")
    lines.append(f"version: {req.version}")
    if req.allowed_tools:
        lines.append(f"allowed-tools: {req.allowed_tools}")
    lines.append("---")
    lines.append("")
    lines.append(f"# {req.display_name}")
    lines.append("")
    lines.append(req.description or "")
    skill_file.write_text("\n".join(lines), encoding="utf-8")
    # auto-enable
    enabled = _load_skills_enabled()
    enabled[skill_id] = True
    _save_skills_enabled(enabled)
    return {"success": True, "skill_id": skill_id}


@app.post("/api/skills/import-file")
async def api_import_skill_file(file: UploadFile = File(...), skill_id: str = Form(...)):
    """Upload a SKILL.md file to create or overwrite a skill"""
    import re
    sid = re.sub(r"[^a-z0-9\-_]", "-", skill_id.strip().lower()).strip("-")
    if not sid:
        raise HTTPException(status_code=400, detail="Invalid skill_id")
    content = await file.read()
    skill_dir = SKILLS_DIR / sid
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_bytes(content)
    enabled = _load_skills_enabled()
    enabled[sid] = True
    _save_skills_enabled(enabled)
    return {"success": True, "skill_id": sid}


# ── MCP Servers API ─────────────────────────────────────────────────────────
MCP_CONFIG_PATH = Path(PROJECT_ROOT) / "storage" / "mcp_servers.json"
_mcp_servers_lock = threading.Lock()


def _load_mcp_servers() -> list:
    with _mcp_servers_lock:
        if MCP_CONFIG_PATH.exists():
            try:
                return json.loads(MCP_CONFIG_PATH.read_text(encoding="utf-8")).get("servers", [])
            except Exception:
                pass
        return []


def _save_mcp_servers(servers: list):
    with _mcp_servers_lock:
        MCP_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        MCP_CONFIG_PATH.write_text(
            json.dumps({"servers": servers}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


def _upsert_mcp_server_entry(entry: dict) -> list:
    """Merge one server row; safe when multiple presets install in parallel."""
    with _mcp_servers_lock:
        servers: list = []
        if MCP_CONFIG_PATH.exists():
            try:
                servers = json.loads(MCP_CONFIG_PATH.read_text(encoding="utf-8")).get("servers", [])
            except Exception:
                servers = []
        sid = entry.get("id")
        merged = False
        for i, s in enumerate(servers):
            if s.get("id") == sid:
                servers[i].update(entry)
                merged = True
                break
        if not merged:
            servers.append(entry)
        MCP_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        MCP_CONFIG_PATH.write_text(
            json.dumps({"servers": servers}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return servers


def _remove_mcp_server_entries(*, server_id: str = "", preset_id: str = "") -> list:
    with _mcp_servers_lock:
        servers: list = []
        if MCP_CONFIG_PATH.exists():
            try:
                servers = json.loads(MCP_CONFIG_PATH.read_text(encoding="utf-8")).get("servers", [])
            except Exception:
                servers = []
        servers = [
            s
            for s in servers
            if s.get("id") != server_id and s.get("preset_id") != preset_id
        ]
        MCP_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        MCP_CONFIG_PATH.write_text(
            json.dumps({"servers": servers}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return servers


async def _restore_managed_mcp_presets_on_startup() -> None:
    """Enabled catalog MCP presets: respawn managed subprocess after backend restart."""
    import asyncio

    from services.mcp_managed_launcher import managed_process_snapshot, start_managed_preset
    from services.mcp_presets import MCP_PRESET_SPECS

    try:
        servers = _load_mcp_servers()
    except Exception as exc:
        logger.warning("[mcp-managed] startup restore: load servers failed: %s", exc)
        return

    seen: set[str] = set()
    for entry in servers:
        if entry.get("enabled") is False:
            continue
        sid = str(entry.get("id") or "")
        preset_id = str(entry.get("preset_id") or "").strip()
        if not preset_id and sid.startswith("mcp-preset-"):
            cand = sid[len("mcp-preset-") :]
            if cand in MCP_PRESET_SPECS:
                preset_id = cand
        if not preset_id or preset_id not in MCP_PRESET_SPECS:
            continue
        if preset_id in seen:
            continue
        seen.add(preset_id)

        try:
            snap = managed_process_snapshot().get(preset_id) or {}
            if snap.get("alive"):
                logger.info("[mcp-managed] startup: preset=%s already running", preset_id)
                continue
        except Exception as exc:
            logger.warning("[mcp-managed] startup: snapshot preset=%s err=%s", preset_id, exc)

        logger.info("[mcp-managed] startup: restoring preset=%s", preset_id)
        try:
            spawn = await asyncio.to_thread(start_managed_preset, preset_id)
        except Exception as exc:
            logger.warning("[mcp-managed] startup: start_managed_preset preset=%s exception=%s", preset_id, exc)
            continue

        if not spawn.get("success"):
            logger.warning(
                "[mcp-managed] startup: restore failed preset=%s err=%s",
                preset_id,
                spawn.get("error"),
            )
            continue

        new_u = str(spawn.get("url") or "").strip()
        if not new_u:
            continue

        changed = False
        for row in servers:
            pid_row = str(row.get("preset_id") or "").strip()
            rid = str(row.get("id") or "")
            if pid_row != preset_id and rid != f"mcp-preset-{preset_id}":
                continue
            if row.get("url") != new_u:
                row["url"] = new_u
                changed = True
            if not str(row.get("preset_id") or "").strip():
                row["preset_id"] = preset_id
                changed = True
        if changed:
            try:
                _save_mcp_servers(servers)
            except Exception as exc:
                logger.warning("[mcp-managed] startup: save servers after url bump failed: %s", exc)

    try:
        from agents.mcp_tools import refresh_agents_after_mcp_change

        refresh_agents_after_mcp_change()
        logger.info("[mcp-managed] startup: agent registry and graph cache refreshed")
    except Exception as exc:
        logger.warning("[mcp-managed] startup: agent refresh failed: %s", exc)


@app.get("/api/mcp/servers")
async def api_get_mcp_servers():
    """Get configured MCP servers"""
    return {"servers": _load_mcp_servers()}


class MCPServerRequest(BaseModel):
    id: str = ""
    name: str
    url: str
    description: str = ""
    enabled: bool = True


class MCPInvokeRequest(BaseModel):
    tool_name: str
    arguments: Dict[str, Any] = Field(default_factory=dict)


def _sanitize_mcp_invoke_arguments_generic(arguments: Dict[str, Any]) -> Dict[str, Any]:
    """JSON-like args only; size limits to reduce abuse."""

    def _walk(v: Any, depth: int) -> Any:
        if depth > 6:
            raise HTTPException(status_code=400, detail="arguments too nested")
        if v is None or isinstance(v, bool):
            return v
        if isinstance(v, int):
            return v
        if isinstance(v, float):
            return v
        if isinstance(v, str):
            return v if len(v) <= 32_000 else v[:32_000]
        if isinstance(v, list):
            if len(v) > 48:
                raise HTTPException(status_code=400, detail="arguments array too large")
            return [_walk(item, depth + 1) for item in v]
        if isinstance(v, dict):
            if len(v) > 40:
                raise HTTPException(status_code=400, detail="arguments object has too many keys")
            out: Dict[str, Any] = {}
            for k_raw, val in v.items():
                k = str(k_raw)[:120]
                out[k] = _walk(val, depth + 1)
            return out
        raise HTTPException(status_code=400, detail="unsupported JSON type in arguments")

    return _walk(arguments, 0)


def _mcp_invoke_args_for_tool(tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
    if tool_name == "search":
        q = arguments.get("query")
        if not isinstance(q, str) or not q.strip():
            raise HTTPException(status_code=400, detail="search requires non-empty query string")
        out: Dict[str, Any] = {"query": q.strip()[:800]}
        mr = arguments.get("max_results")
        if mr is not None:
            try:
                n = int(mr)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="max_results must be integer")
            out["max_results"] = max(1, min(25, n))
        reg = arguments.get("region")
        if isinstance(reg, str) and reg.strip():
            out["region"] = reg.strip()[:64]
        return out

    if tool_name == "fetch_content":
        u = arguments.get("url")
        if not isinstance(u, str) or not u.strip().startswith(("http://", "https://")):
            raise HTTPException(
                status_code=400,
                detail="fetch_content requires url starting with http:// or https://",
            )
        out = {"url": u.strip()[:16_384]}
        si = arguments.get("start_index")
        if si is not None:
            try:
                out["start_index"] = max(0, int(si))
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="start_index must be integer")
        ml = arguments.get("max_length")
        if ml is not None:
            try:
                out["max_length"] = max(256, min(96_000, int(ml)))
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="max_length must be integer")
        be = arguments.get("backend")
        if isinstance(be, str) and be.strip() in ("httpx", "curl", "auto"):
            out["backend"] = be.strip()
        return out

    return _sanitize_mcp_invoke_arguments_generic(dict(arguments))


@app.post("/api/mcp/servers")
async def api_add_mcp_server(req: MCPServerRequest):
    """Add or update an MCP server"""
    servers = _load_mcp_servers()
    server_id = req.id or req.name.lower().replace(" ", "-")
    # Update existing or append
    existing = next((s for s in servers if s["id"] == server_id), None)
    entry = {
        "id": server_id,
        "name": req.name,
        "url": req.url,
        "description": req.description,
        "enabled": req.enabled,
    }
    if existing:
        servers = [entry if s["id"] == server_id else s for s in servers]
    else:
        servers.append(entry)
    _save_mcp_servers(servers)
    return {"success": True, "server": entry}


@app.patch("/api/mcp/servers/{server_id}")
async def api_toggle_mcp_server(server_id: str, body: dict):
    """Toggle MCP server enabled state"""
    servers = _load_mcp_servers()
    for s in servers:
        if s["id"] == server_id:
            s.update(body)
            break
    _save_mcp_servers(servers)
    return {"success": True}


@app.delete("/api/mcp/servers/{server_id}")
async def api_delete_mcp_server(server_id: str):
    """Delete an MCP server"""
    servers = [s for s in _load_mcp_servers() if s["id"] != server_id]
    _save_mcp_servers(servers)
    return {"success": True}


@app.post("/api/mcp/servers/{server_id}/ping")
async def api_ping_mcp_server(server_id: str):
    """Test connectivity to an MCP server and persist the status."""
    from services.mcp_managed_launcher import start_managed_preset, stop_managed_preset
    from services.mcp_client import ping_server_sync
    from services.mcp_presets import MCP_PRESET_SPECS

    servers = _load_mcp_servers()
    server = next((s for s in servers if s["id"] == server_id), None)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    preset_id = str(server.get("preset_id") or "").strip()
    if not preset_id and server_id.startswith("mcp-preset-"):
        cand = server_id[len("mcp-preset-") :]
        if cand in MCP_PRESET_SPECS:
            preset_id = cand

    url = str(server.get("url") or "").strip()
    result = await asyncio.to_thread(ping_server_sync, url)

    err_lo = (result.get("error") or "").lower()
    need_managed_heal = (
        preset_id
        and not result.get("success")
        and (
            "connection refused" in err_lo
            or "timed out" in err_lo
            or "timeout" in err_lo
            or "403" in err_lo
            or err_lo.startswith("http 403")
        )
    )

    if need_managed_heal:
        await asyncio.to_thread(stop_managed_preset, preset_id)
        spawn = await asyncio.to_thread(start_managed_preset, preset_id)
        if spawn.get("success"):
            new_u = str(spawn.get("url") or "").strip()
            if new_u:
                if new_u != url:
                    for s in servers:
                        if s["id"] == server_id:
                            s["url"] = new_u
                            if preset_id and not str(s.get("preset_id") or "").strip():
                                s["preset_id"] = preset_id
                            break
                    _save_mcp_servers(servers)
                    url = new_u
            result = await asyncio.to_thread(ping_server_sync, url)
    # persist status
    for s in servers:
        if s["id"] == server_id:
            s["status"] = "connected" if result.get("success") else "error"
            s["status_msg"] = "" if result.get("success") else result.get("error", "")
            s["server_name"] = result.get("server_name", "")
            s["server_version"] = result.get("server_version", "")
            if preset_id and not str(s.get("preset_id") or "").strip():
                s["preset_id"] = preset_id
            break
    _save_mcp_servers(servers)
    return result


@app.get("/api/mcp/servers/{server_id}/tools")
async def api_list_mcp_server_tools(server_id: str):
    """List tools advertised by an MCP server."""
    from services.mcp_client import list_tools_sync
    servers = _load_mcp_servers()
    server = next((s for s in servers if s["id"] == server_id), None)
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    result = await asyncio.to_thread(list_tools_sync, server["url"])
    return result


@app.post("/api/mcp/servers/{server_id}/invoke")
async def api_invoke_mcp_tool(server_id: str, req: MCPInvokeRequest):
    """
    Call a single tool exposed by a configured MCP server (HTTP Streamable MCP).
    Verifies tool_name via tools/list; does not accept arbitrary URLs.
    """
    import time as _time

    from services.mcp_client import invoke_mcp_tool_sync, list_tools_sync

    t_start = _time.perf_counter()
    servers = _load_mcp_servers()
    server = next((s for s in servers if s.get("id") == server_id), None)
    if not server:
        logger.warning("[api] MCP invoke reject server_id=%s reason=not_found", server_id)
        raise HTTPException(status_code=404, detail="Server not found")
    if not server.get("enabled", True):
        logger.warning("[api] MCP invoke reject server_id=%s reason=disabled", server_id)
        raise HTTPException(status_code=403, detail="Server is disabled")
    url = (server.get("url") or "").strip()
    if not url:
        logger.warning("[api] MCP invoke reject server_id=%s reason=no_url", server_id)
        raise HTTPException(status_code=400, detail="Server has no url")

    tname = (req.tool_name or "").strip()
    if not tname:
        raise HTTPException(status_code=400, detail="tool_name required")

    listed = await asyncio.to_thread(list_tools_sync, url)
    if not listed.get("success"):
        err_msg = str(listed.get("error") or "tools/list failed")
        logger.warning(
            "[api] MCP invoke fail server_id=%s tool=%s phase=tools_list err=%s",
            server_id,
            tname,
            err_msg[:400],
        )
        raise HTTPException(
            status_code=502,
            detail=err_msg,
        )

    allowed = {
        tool.get("name")
        for tool in (listed.get("tools") or [])
        if isinstance(tool, dict) and isinstance(tool.get("name"), str)
    }
    logger.info(
        "[api] MCP invoke gate_ok server_id=%s tool=%s url=%r advertised_count=%s",
        server_id,
        tname,
        url[:120] + ("…" if len(url) > 120 else ""),
        len(allowed),
    )
    if tname not in allowed:
        sample = ",".join(sorted(allowed))[:260]
        logger.warning(
            "[api] MCP invoke reject server_id=%s tool=%s not_in_catalog sample=%s",
            server_id,
            tname,
            sample,
        )
        raise HTTPException(
            status_code=400,
            detail=f"tool '{tname}' is not advertised by this server",
        )

    sanitized = _mcp_invoke_args_for_tool(tname, req.arguments or {})
    key_summary = ",".join(sorted(sanitized.keys()))
    payload = await asyncio.to_thread(invoke_mcp_tool_sync, url, tname, sanitized)
    elapsed_ms = (_time.perf_counter() - t_start) * 1000
    if isinstance(payload, dict):
        succ = payload.get("success")
        logger.info(
            "[api] MCP invoke done server_id=%s tool=%s success=%s result_len=%s arg_keys=[%s] elapsed_ms=%.0f",
            server_id,
            tname,
            succ,
            len(str(payload.get("result", ""))),
            key_summary[:120],
            elapsed_ms,
        )
        if succ is False:
            logger.warning(
                "[api] MCP invoke upstream_error server_id=%s tool=%s err=%s",
                server_id,
                tname,
                str(payload.get("error", ""))[:480],
            )
    else:
        logger.warning(
            "[api] MCP invoke weird_payload server_id=%s tool=%s type=%s",
            server_id,
            tname,
            type(payload).__name__,
        )
    return payload


@app.get("/api/mcp/presets")
async def api_list_mcp_presets():
    """Catalog of built‑in MCP presets (one‑click localhost HTTP)."""
    from services.mcp_presets import MCP_PRESET_SPECS, server_entry_id
    from services.mcp_managed_launcher import managed_process_snapshot

    snapshot = managed_process_snapshot()
    servers = _load_mcp_servers()
    presets_out: List[Dict[str, Any]] = []

    for pid, meta in MCP_PRESET_SPECS.items():
        sid = server_entry_id(pid)
        row = next((s for s in servers if s.get("id") == sid), None)
        installed = row is not None or any(s.get("preset_id") == pid for s in servers)
        proc = snapshot.get(pid) or {}

        presets_out.append(
            {
                "id": pid,
                "server_row_id": sid,
                "github": meta.get("github", ""),
                "default_port": meta.get("default_port"),
                "http_path": meta.get("http_path", "/mcp"),
                "description_zh": meta.get("description_zh", ""),
                "description_en": meta.get("description_en", ""),
                "installed": installed,
                "running": bool(proc.get("alive")),
                "url": row.get("url") if row else None,
                "hint_cmd": "",
            }
        )
    return {"presets": presets_out}


@app.post("/api/mcp/presets/{preset_id}/install")
async def api_install_mcp_preset(preset_id: str):
    """Start managed subprocess (if applicable) and register server in mcp_servers.json."""
    from services import mcp_presets as presets_mod
    from services.mcp_managed_launcher import start_managed_preset

    if preset_id not in presets_mod.MCP_PRESET_SPECS:
        raise HTTPException(status_code=404, detail="Unknown preset")

    spawn = await asyncio.to_thread(start_managed_preset, preset_id)
    if not spawn.get("success"):
        raise HTTPException(status_code=400, detail=str(spawn.get("error") or "install failed"))

    sid = presets_mod.server_entry_id(preset_id)
    meta = presets_mod.MCP_PRESET_SPECS[preset_id]
    url = spawn.get("url") or presets_mod.preset_public_url(
        meta,
        int(spawn.get("port", meta["default_port"])),
        "127.0.0.1",
    )

    entry = {
        "id": sid,
        "name": meta.get("name_zh") or meta.get("name_en") or sid,
        "url": url,
        "description": meta.get("description_zh", ""),
        "enabled": True,
        "preset_id": preset_id,
    }

    _upsert_mcp_server_entry(entry)
    try:
        from agents.mcp_tools import refresh_agents_after_mcp_change
        from agents.orchestrator import build_multi_agent_graph

        refresh_agents_after_mcp_change()
        build_multi_agent_graph()
    except Exception as exc:
        logger.warning("[mcp] install preset: agent refresh failed: %s", exc)
    return {"success": True, "preset_id": preset_id, "server": entry, **spawn}


@app.delete("/api/mcp/presets/{preset_id}/uninstall")
async def api_uninstall_mcp_preset(preset_id: str):
    """Terminate managed subprocess and remove catalog server row."""
    from services import mcp_presets as presets_mod
    from services.mcp_managed_launcher import stop_managed_preset

    if preset_id not in presets_mod.MCP_PRESET_SPECS:
        raise HTTPException(status_code=404, detail="Unknown preset")

    await asyncio.to_thread(stop_managed_preset, preset_id)
    sid = presets_mod.server_entry_id(preset_id)
    _remove_mcp_server_entries(server_id=sid, preset_id=preset_id)
    try:
        from agents.mcp_tools import refresh_agents_after_mcp_change
        from agents.orchestrator import build_multi_agent_graph

        refresh_agents_after_mcp_change()
        build_multi_agent_graph()
    except Exception as exc:
        logger.warning("[mcp] uninstall preset: agent refresh failed: %s", exc)
    return {"success": True}


class PublishRequest(BaseModel):
    platform: str
    content: str
    title: str = ""
    media_urls: List[str] = []
    content_type: str = "mixed"  # image, video, text, mixed
    options: Dict = {}

class PublishAllRequest(BaseModel):
    content: str
    title: str = ""
    media_urls: List[str] = []
    content_type: str = "mixed"
    options: Dict = {}

class ConnectPlatformRequest(BaseModel):
    platform: str
    credentials: Dict[str, str]

@app.post("/tools/publish")
async def api_publish_content(
    req: PublishRequest,
    _: Optional[dict] = Depends(require_auth_when_enabled),
):
    """发布内容到指定平台（使用真实 Connector）"""
    try:
        normalized_media_urls = normalize_publish_media(
            media_urls=req.media_urls,
            content=req.content,
            content_type=req.content_type,
            outputs_dir=OUTPUT_DIR,
            logger=logger,
        )
        logger.info(
            f"Publish request normalized media_urls: incoming={req.media_urls}, "
            f"normalized={normalized_media_urls}, content_type={req.content_type}"
        )

        # 使用连接器管理器发布
        result = await connector_manager.publish_to_platform(
            platform_id=req.platform,
            content_type=req.content_type,
            title=req.title,
            content=req.content,
            media_urls=normalized_media_urls,
            options=req.options
        )

        result_dict = result.to_dict()

        if result.success:
            # 保存到历史记录
            add_generation_record(
                record_type="publish",
                prompt=f"发布到 {req.platform}: {req.title or req.content[:20]}",
                result=json.dumps(result_dict, ensure_ascii=False),
                metadata={"platform": req.platform, "media_urls": normalized_media_urls}
            )
            return {"success": True, "data": result_dict}
        else:
            return {"success": False, "error": result.error}

    except Exception as e:
        logger.error(f"Publish error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/tools/publish/all")
async def api_publish_to_all(
    req: PublishAllRequest,
    _: Optional[dict] = Depends(require_auth_when_enabled),
):
    """一键发布到所有已连接的平台"""
    try:
        normalized_media_urls = normalize_publish_media(
            media_urls=req.media_urls,
            content=req.content,
            content_type=req.content_type,
            outputs_dir=OUTPUT_DIR,
            logger=logger,
        )
        logger.info(
            f"Publish-all request normalized media_urls: incoming={req.media_urls}, "
            f"normalized={normalized_media_urls}, content_type={req.content_type}"
        )
        results = await connector_manager.publish_to_all_platforms(
            content_type=req.content_type,
            title=req.title,
            content=req.content,
            media_urls=normalized_media_urls,
            options=req.options
        )

        # 过滤并处理结果
        final_results = []
        for r in results:
            if isinstance(r, Exception):
                logger.error(f"Task failed with exception: {r}")
                final_results.append({
                    "platform": "unknown",
                    "success": False,
                    "error": str(r)
                })
            else:
                final_results.append(r.to_dict())

        success_count = sum(1 for r in final_results if r.get("success"))

        # 记录日志
        add_generation_record(
            record_type="publish_all",
            prompt=f"一键发布: {req.title}",
            result=json.dumps({"success_count": success_count, "results": final_results}, ensure_ascii=False),
            metadata={"media_urls": normalized_media_urls}
        )

        return {
            "success": True,
            "total": len(results),
            "success_count": success_count,
            "details": final_results
        }
    except Exception as e:
        logger.error(f"Publish all error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/context/memory")
async def api_context_memory_list():
    """列出所有 Agent 记忆条目"""
    import asyncio as _aio

    def _list():
        from utils.vector_store import get_vector_store

        store = get_vector_store()
        if not store:
            return {"success": True, "memories": []}
        memories = store.get_all_memories()
        return {"success": True, "memories": memories}

    try:
        return await _aio.to_thread(_list)
    except Exception as e:
        logger.error(f"Memory list error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/context/memory/summary")
async def api_context_memory_summary(offset: int = 0, limit: int = 50):
    """轻量记忆摘要列表（分页，不含完整 content）。"""
    import asyncio as _aio

    def _summary():
        from utils.vector_store import get_vector_store

        store = get_vector_store()
        if not store:
            return {"success": True, "memories": [], "total": 0, "offset": offset, "limit": limit}
        summaries, total = store.get_memories_summary(offset=offset, limit=limit)
        return {
            "success": True,
            "memories": summaries,
            "total": total,
            "offset": max(0, offset),
            "limit": max(1, min(limit, 200)),
        }

    try:
        return await _aio.to_thread(_summary)
    except Exception as e:
        logger.error(f"Memory summary error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/context/memory/dashboard")
async def api_context_memory_dashboard(hits_limit: int = 200, signals_limit: int = 1000):
    """MemoryPanel 首屏聚合数据。"""
    import asyncio as _aio
    from services.memory_dashboard import build_memory_dashboard

    try:
        return await _aio.to_thread(
            build_memory_dashboard,
            hits_limit=min(hits_limit, 500),
            signals_limit=min(signals_limit, 2000),
        )
    except Exception as e:
        logger.error(f"Memory dashboard error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/context/memory")
async def api_context_memory_create(req: MemoryCreateRequest):
    """保存一条 Agent 记忆条目。"""
    try:
        from services.learning_data_pipeline import append_event
        from services.memory_quality import prepare_memory_write
        from utils.vector_store import get_vector_store

        store = get_vector_store()
        if not store:
            raise HTTPException(status_code=503, detail="Memory store not available")
        metadata = dict(req.metadata or {})
        metadata.update(
            {
                "type": req.memory_type or "fact",
                "source": req.source or "user",
                "confidence": req.confidence,
                "inferred": req.inferred,
            }
        )
        prepared = prepare_memory_write(req.content.strip(), metadata=metadata, store=store)
        if prepared["action"] == "rejected":
            raise HTTPException(
                status_code=400,
                detail={
                    "error": prepared.get("error"),
                    "risk_flags": prepared.get("risk_flags", []),
                    "candidate_id": prepared.get("candidate_id"),
                },
            )
        if prepared["action"] == "duplicate":
            return {
                "success": True,
                "id": prepared.get("duplicate_id", ""),
                "duplicate": True,
                "content": prepared["content"],
                "metadata": prepared["metadata"],
            }
        if prepared["action"] == "candidate":
            append_event(
                "memory_candidate",
                source="api.context.memory",
                action="create",
                status="candidate",
                summary=prepared["content"],
                metadata={"candidate_id": prepared.get("candidate_id", ""), "risk_flags": prepared.get("risk_flags", [])},
            )
            return {"success": True, "status": "candidate", **prepared}

        memory_id = store.add_memory(prepared["content"], prepared["metadata"])
        append_event(
            "memory_write",
            source="api.context.memory",
            action="create",
            status="approved",
            summary=prepared["content"],
            metadata={"memory_id": memory_id, "risk_flags": prepared.get("risk_flags", [])},
        )
        return {"success": True, "id": memory_id, "content": prepared["content"], "metadata": prepared["metadata"]}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Memory create error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/context/memory/{memory_id}")
async def api_context_memory_delete(memory_id: str):
    """删除指定记忆条目"""
    try:
        from utils.vector_store import get_vector_store
        store = get_vector_store()
        if not store:
            raise HTTPException(status_code=503, detail="Memory store not available")
        ok = store.delete_memory(memory_id)
        return {"success": ok}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Memory delete error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/context/memory/search")
async def api_context_memory_search(body: dict):
    """语义搜索记忆条目"""
    import asyncio as _aio

    def _search():
        from utils.vector_store import get_vector_store

        query = body.get("query", "").strip()
        k = min(int(body.get("k", 10)), 50)
        if not query:
            return {"success": False, "error": "query is required", "results": []}
        store = get_vector_store()
        if not store:
            return {"success": True, "results": []}
        results = store.search_memory(query, k=k)
        return {"success": True, "results": results}

    try:
        return await _aio.to_thread(_search)
    except Exception as e:
        logger.error(f"Memory search error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# Dream Engine API
# ============================================================

class DreamActRequest(BaseModel):
    action: str = Field(..., description="act | dismiss")


@app.post("/evolution/dream/run")
async def api_dream_run(force: bool = False):
    """手动触发 dream daily（含 LLM digest 生成）。"""
    try:
        from services.dream_engine import run_daily
        import asyncio as _aio
        result = await _aio.to_thread(run_daily, force=force)
        return result
    except Exception as e:
        logger.error("dream run error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/evolution/dream/status")
async def api_dream_status():
    """获取最近 dream 运行状态（读 meta.json）。"""
    try:
        from services.dream_store import get_dream_store
        store = get_dream_store()
        meta = store.load_meta("latest")
        runs = store.list_runs(limit=5)
        return {"latest": meta, "recent_runs": runs}
    except Exception as e:
        logger.error("dream status error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/evolution/dream/digest")
async def api_dream_digest():
    """获取最新 dream digest.json 内容。"""
    try:
        from services.dream_store import get_dream_store
        digest = get_dream_store().load_digest("latest")
        if digest is None:
            raise HTTPException(status_code=404, detail="No dream digest available yet")
        return digest
    except HTTPException:
        raise
    except Exception as e:
        logger.error("dream digest error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/evolution/dreams")
async def api_dream_cards(
    limit: int = 20,
    since_iso: Optional[str] = None,
    status: Optional[str] = None,
):
    """获取 dream 卡片流水（dreams.jsonl 分页）。"""
    try:
        from services.dream_store import get_dream_store
        cards = get_dream_store().load_dream_cards(limit=limit, since_iso=since_iso, status=status)
        return {"cards": cards, "count": len(cards)}
    except Exception as e:
        logger.error("dream cards error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/evolution/dreams/{card_id}/act")
async def api_dream_card_act(card_id: str, req: DreamActRequest):
    """处理 dream 卡片动作（act/dismiss）并更新 XP 和伴侣状态。"""
    if req.action not in {"act", "dismiss"}:
        raise HTTPException(status_code=400, detail="action must be 'act' or 'dismiss'")
    try:
        from services.dream_store import get_dream_store
        from core.companion_state import patch_companion_state

        ok = get_dream_store().update_dream_card_status(card_id, req.action)
        if not ok:
            raise HTTPException(status_code=404, detail=f"Dream card {card_id} not found")

        # act → XP+3；dismiss → XP+1
        xp_delta = 3 if req.action == "act" else 1
        patch_companion_state({"growth_add_xp": xp_delta})

        return {"success": True, "card_id": card_id, "action": req.action, "xp_delta": xp_delta}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("dream card act error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/evolution/signals")
async def api_evolution_signal_create(req: EvolutionSignalRequest):
    """记录用户/Agent 对记忆、对话、trace 等对象的反馈信号。"""
    try:
        from services.evolution_signals import append_signal

        signal = append_signal(
            target_type=req.target_type,
            target_id=req.target_id,
            signal=req.signal,
            comment=req.comment,
            source=req.source,
            trace_id=req.trace_id,
            metadata=req.metadata,
        )
        return {"success": True, "signal": signal}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as e:
        logger.error(f"Evolution signal create error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/evolution/signals")
async def api_evolution_signal_list(
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    limit: int = 200,
):
    """读取反馈信号，可按 target_type / target_id 过滤。"""
    try:
        from services.evolution_signals import list_signals

        return {"success": True, "signals": list_signals(target_type=target_type, target_id=target_id, limit=limit)}
    except Exception as e:
        logger.error(f"Evolution signal list error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/evolution/events")
async def api_learning_event_create(req: LearningEventRequest):
    """记录统一学习事件，作为后续自学习/复盘/检索的事件底座。"""
    try:
        from services.learning_data_pipeline import append_event

        event = append_event(
            req.kind,
            session_id=req.session_id,
            trace_id=req.trace_id,
            source=req.source,
            channel=req.channel,
            action=req.action,
            status=req.status,
            summary=req.summary,
            artifact_ref=req.artifact_ref,
            token_usage=req.token_usage,
            cost=req.cost,
            metadata=req.metadata,
        )
        return {"success": True, "event": event}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as e:
        logger.error(f"Learning event create error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/evolution/events")
async def api_learning_event_list(
    kind: Optional[str] = None,
    session_id: Optional[str] = None,
    trace_id: Optional[str] = None,
    limit: int = 200,
):
    """读取统一学习事件，可按 kind / session_id / trace_id 过滤。"""
    try:
        from services.learning_data_pipeline import list_events

        return {"success": True, "events": list_events(kind=kind, session_id=session_id, trace_id=trace_id, limit=limit)}
    except Exception as e:
        logger.error(f"Learning event list error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/evolution/session-recall/search")
async def api_session_recall_search(req: SessionRecallSearchRequest):
    """检索历史 session/trace 事件，返回 reference-only 的短摘要与来源元数据。"""
    try:
        from services.session_recall import session_search

        return session_search(
            req.query,
            role_filter=req.role_filter,
            limit=req.limit,
            current_session_id=req.current_session_id,
            current_trace_id=req.current_trace_id,
            session_id=req.session_id,
            around_message_id=req.around_message_id,
            window=req.window,
        )
    except Exception as e:
        logger.error(f"Session recall search error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/evolution/memory-usage/outcome")
async def api_memory_usage_outcome(req: MemoryUsageOutcomeRequest):
    """记录某条记忆的使用结果，用于升降置信、stale 与 curator 建议。"""
    try:
        from services.memory_evaluation import record_outcome

        row = record_outcome(
            memory_id=req.memory_id,
            outcome=req.outcome,
            trace_id=req.trace_id or "",
            source=req.source,
            comment=req.comment,
            metadata=req.metadata,
        )
        return {"success": True, "usage": row}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as e:
        logger.error(f"Memory usage outcome error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/evolution/memory-usage")
async def api_memory_usage_list(
    memory_id: Optional[str] = None,
    trace_id: Optional[str] = None,
    kind: Optional[str] = None,
    limit: int = 200,
):
    """读取记忆召回与使用结果记录。"""
    try:
        from services.memory_evaluation import list_memory_hit_records, list_memory_usage, summarize_memory_usage

        rows = list_memory_usage(memory_id=memory_id, trace_id=trace_id, kind=kind, limit=limit)
        ids = [memory_id] if memory_id else list({row.get("memory_id", "") for row in rows if row.get("memory_id")})
        hits = [] if kind and kind != "recall" else list_memory_hit_records(memory_id=memory_id, trace_id=trace_id, limit=limit)
        return {"success": True, "usage": rows, "hits": hits, "summary": summarize_memory_usage(ids or None)}
    except Exception as e:
        logger.error(f"Memory usage list error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/evolution/memory-usage/hits")
async def api_memory_usage_hit_records(
    memory_id: Optional[str] = None,
    trace_id: Optional[str] = None,
    limit: int = 100,
):
    """读取可视化用的记忆命中记录，包含 recall 行与对应记忆内容。"""
    try:
        from services.memory_evaluation import list_memory_hit_records

        return {
            "success": True,
            "hits": list_memory_hit_records(memory_id=memory_id, trace_id=trace_id, limit=limit),
        }
    except Exception as e:
        logger.error(f"Memory hit records error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/evolution/knowledge-layers")
async def api_knowledge_layers():
    """返回知识/记忆分层 taxonomy，用于 UI、Agent 与 curator 共用。"""
    try:
        from services.knowledge_layers import taxonomy

        return {"success": True, **taxonomy()}
    except Exception as e:
        logger.error(f"Knowledge layers taxonomy error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/evolution/knowledge-layers/classify")
async def api_knowledge_layer_classify(req: KnowledgeLayerClassifyRequest):
    """对候选记忆/知识做分层分类，不写入任何长期资产。"""
    try:
        from services.knowledge_layers import classify_knowledge_layer, ensure_knowledge_metadata

        classification = classify_knowledge_layer(req.content, req.metadata)
        return {
            "success": True,
            "classification": classification,
            "metadata": ensure_knowledge_metadata(req.content, req.metadata),
        }
    except Exception as e:
        logger.error(f"Knowledge layer classify error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/evolution/reflections/{trace_id}")
async def api_reflect_trace(trace_id: str, force: bool = False):
    """手动触发某条 trace 的轻量复盘。"""
    try:
        from services.reflection_loop import reflect_trace

        result = reflect_trace(trace_id, force=force)
        if not result.get("success") and result.get("error") == "trace not found":
            raise HTTPException(status_code=404, detail="Trace not found")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Reflection create error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/evolution/reflections")
async def api_reflection_list(trace_id: Optional[str] = None, status: Optional[str] = None, limit: int = 100):
    """读取任务复盘记录。"""
    try:
        from services.reflection_loop import list_reflections

        return {"success": True, "reflections": list_reflections(trace_id=trace_id, status=status, limit=limit)}
    except Exception as e:
        logger.error(f"Reflection list error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/evolution/curator/run")
async def api_learning_curator_run(req: LearningCuratorRunRequest):
    """运行学习整理 worker；默认 dry-run，只生成审阅报告，不改长期资产。"""
    try:
        from services.learning_curator import run_learning_curator

        return run_learning_curator(dry_run=req.dry_run, limit=req.limit)
    except Exception as e:
        logger.error(f"Learning curator run error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/evolution/curator/runs")
async def api_learning_curator_runs(limit: int = 50):
    """列出学习整理 worker 的历史运行。"""
    try:
        from services.learning_curator import list_curator_runs

        return {"success": True, "runs": list_curator_runs(limit=limit)}
    except Exception as e:
        logger.error(f"Learning curator list error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/evolution/curator/runs/{run_id}")
async def api_learning_curator_run_detail(run_id: str):
    """读取某次学习整理报告。"""
    try:
        from services.learning_curator import get_curator_run

        result = get_curator_run(run_id)
        if not result:
            raise HTTPException(status_code=404, detail="Curator run not found")
        return {"success": True, **result}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Learning curator detail error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/connections/summary")
async def api_connections_summary():
    """只读连接摘要 facade，不返回任何 token/cookie。"""
    try:
        from services.connections_summary import build_connections_summary

        return build_connections_summary(connector_manager)
    except Exception as e:
        logger.error(f"Connections summary error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/settings/connections/summary")
async def api_settings_connections_summary():
    """设置页使用的连接摘要别名。"""
    return await api_connections_summary()


@app.get("/context/memory-graph")
async def api_context_memory_graph(mode: str = "memories"):
    """记忆网图 — 四种 mode：memories / topics / usage / dreams。"""
    import asyncio as _aio
    from services.memory_graph_export import export_memory_graph

    try:
        result = await _aio.to_thread(export_memory_graph, mode)
        return result
    except Exception as e:
        logger.error("memory-graph error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/context/memory/chunks")
async def api_context_memory_chunks(
    search: str = "",
    layer: str = "",
    source: str = "",
    entity_id: str = "",
    limit: int = 200,
):
    """OpenHuman-style memory chunk list for three-pane browser."""
    import asyncio as _aio
    from services.memory_chunks import list_memory_chunks

    try:
        return await _aio.to_thread(
            list_memory_chunks,
            search=search,
            layer=layer,
            source=source,
            entity_id=entity_id,
            limit=limit,
        )
    except Exception as e:
        logger.error("memory chunks error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/context/memory/{memory_id}/code-entities")
async def api_context_memory_code_entities(memory_id: str):
    """Code entities linked to a memory (regex + optional CodeGraph)."""
    import asyncio as _aio
    from services.memory_chunks import get_chunk_detail

    try:
        chunk = await _aio.to_thread(get_chunk_detail, memory_id)
        if not chunk:
            raise HTTPException(status_code=404, detail="memory not found")
        return {
            "memory_id": memory_id,
            "code_entities": chunk.get("code_entities") or [],
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("memory code-entities error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/context/memory-status")
async def api_context_memory_status():
    """记忆系统状态面板 — OpenHuman MemoryTreeStatusPanel 风格聚合。"""
    import asyncio as _aio

    from services.codegraph_service import get_codegraph_status
    from services.skill_runtime import get_skill_usage_stats, list_skill_index
    from utils.vector_store import get_vector_store

    def _build():
        store = get_vector_store()
        if hasattr(store, "get_all_memories"):
            memories = store.get_all_memories()
        elif hasattr(store, "list_memories"):
            memories = store.list_memories()
        else:
            memories = []
        layers: dict[str, int] = {}
        for m in memories:
            meta = m.get("metadata") or {}
            layer = str(meta.get("knowledge_layer") or "unknown")
            layers[layer] = layers.get(layer, 0) + 1

        skills = list_skill_index()
        enabled_skills = [s for s in skills if s.enabled]
        usage = get_skill_usage_stats()

        from services.session_state_db import session_stats

        return {
            "memory_count": len(memories),
            "layers": layers,
            "skills_enabled": len(enabled_skills),
            "skills_total": len(list_skill_index(include_disabled=True)),
            "skill_usage": usage,
            "sessions": session_stats(),
            "codegraph": get_codegraph_status(),
        }

    try:
        return await _aio.to_thread(_build)
    except Exception as e:
        logger.error("memory-status error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/context/sessions/stats")
async def api_context_sessions_stats():
    """SQLite session store statistics."""
    import asyncio as _aio
    from services.session_state_db import session_stats

    try:
        return await _aio.to_thread(session_stats)
    except Exception as e:
        logger.error("sessions stats error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/context/codegraph-status")
async def api_context_codegraph_status():
    """CodeGraph 本地索引与 MCP 就绪状态。"""
    import asyncio as _aio
    from services.codegraph_service import get_codegraph_status

    try:
        return await _aio.to_thread(get_codegraph_status)
    except Exception as e:
        logger.error("codegraph-status error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/context/codegraph/init")
async def api_context_codegraph_init(with_index: bool = True):
    """Initialize CodeGraph index under project root (.codegraph/)."""
    import asyncio as _aio
    from services.codegraph_service import run_codegraph_init

    try:
        result = await _aio.to_thread(run_codegraph_init, with_index=with_index)
        if not result.get("success"):
            raise HTTPException(
                status_code=400,
                detail=str(result.get("error") or "codegraph init failed"),
            )
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error("codegraph-init error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/context/codegraph/search")
async def api_context_codegraph_search(q: str = "", limit: int = 16):
    """Search CodeGraph symbols for the context UI."""
    import asyncio as _aio
    from services.codegraph_service import search_codegraph_symbols

    try:
        return await _aio.to_thread(search_codegraph_symbols, q, limit=min(limit, 32))
    except Exception as e:
        logger.error("codegraph-search error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/context/codegraph/graph")
async def api_context_codegraph_graph(
    symbol: str = "",
    scope: str = "",
    hops: int = 1,
    max_nodes: int = 64,
    edge_kinds: str = "calls",
):
    """Bounded call/import subgraph for CodeGraph visualization."""
    import asyncio as _aio
    from services.codegraph_service import build_codegraph_graph

    kinds = [k.strip() for k in edge_kinds.split(",") if k.strip()]
    try:
        return await _aio.to_thread(
            build_codegraph_graph,
            symbol=symbol or None,
            scope=scope or None,
            edge_kinds=kinds or ["calls"],
            hops=hops,
            max_nodes=max_nodes,
        )
    except Exception as e:
        logger.error("codegraph-graph error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/context/knowledge-graph")
async def api_context_knowledge_graph():
    """My Context：知识图谱节点与边（运行时拼装）"""
    import asyncio

    from services.context_knowledge_graph import build_context_knowledge_graph

    try:
        data = await asyncio.to_thread(build_context_knowledge_graph)
        return {"success": True, **data}
    except Exception as e:
        logger.error(f"Knowledge graph build error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/connectors/platforms")
async def api_get_platforms():
    """获取所有平台的连接状态"""
    try:
        platforms = connector_manager.get_all_platforms()
        return {"platforms": platforms}
    except Exception as e:
        logger.error(f"Get platforms error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/connectors/capability-matrix")
async def api_get_connector_capability_matrix():
    """获取超级 Agent 平台连接能力矩阵。"""
    try:
        platforms = connector_manager.get_all_platforms()
        return {"platforms": list_platform_profiles(platforms)}
    except Exception as e:
        logger.error(f"Get connector capability matrix error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/connectors/platforms/{platform_id}")
async def api_get_platform_status(platform_id: str):
    """获取单个平台状态"""
    try:
        status = connector_manager.get_platform_status(platform_id)
        if status is None:
            raise HTTPException(status_code=404, detail="Platform not found")
        return status
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get platform status error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/connectors/capability-matrix/{platform_id}")
async def api_get_connector_capability_profile(platform_id: str):
    """获取单个平台的超级 Agent 能力定义。"""
    try:
        connector_status = connector_manager.get_platform_status(platform_id)
        profile = get_platform_profile(platform_id, connector_status)
        if profile is None:
            raise HTTPException(status_code=404, detail="Platform profile not found")
        return profile
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get connector capability profile error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/connectors/platform-actions")
async def api_request_platform_action(req: PlatformActionRequest):
    """创建一个平台动作请求；发送/写入类动作先进入审批。飞书 read_docs 可传 include_blocks 与 blocks_page_token 续拉块列表；write_docs 可传 batch_updates / requests 做 docx 块批量更新。"""
    try:
        return await request_platform_action(
            platform_id=req.platform_id,
            action_id=req.action_id,
            params=req.params,
            trace_id=req.trace_id,
            metadata=req.metadata,
        )
    except PlatformActionError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/connectors/platform-actions/{task_id}/resume")
async def api_resume_platform_action(task_id: str):
    """审批通过后恢复平台动作；真实 connector 未接入前只返回安全占位结果。"""
    try:
        result = await resume_approved_platform_action(task_id)
        if result is None:
            raise HTTPException(status_code=404, detail="Task not found")
        return result
    except PlatformActionError as exc:
        raise HTTPException(status_code=409, detail=str(exc))

@app.post("/connectors/connect")
async def api_connect_platform(req: ConnectPlatformRequest):
    """连接平台（保存凭证并验证）"""
    try:
        success = await connector_manager.connect_platform(
            platform_id=req.platform,
            credentials=req.credentials
        )

        if success:
            status = connector_manager.get_platform_status(req.platform)
            return {"success": True, "status": status}
        else:
            return {"success": False, "error": "认证失败，请检查凭证是否正确"}

    except Exception as e:
        logger.error(f"Connect platform error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/connectors/disconnect/{platform_id}")
async def api_disconnect_platform(platform_id: str):
    """断开平台连接"""
    try:
        success = await connector_manager.disconnect_platform(platform_id)
        return {"success": success}
    except Exception as e:
        logger.error(f"Disconnect platform error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# 兼容旧的 API
@app.get("/tools/publish/accounts")
async def api_get_publish_accounts():
    """获取已连接的发布账号（兼容旧API）"""
    try:
        platforms = connector_manager.get_all_platforms()
        # 只返回已连接的
        connected = [p for p in platforms if p['connected']]
        return {"accounts": connected}
    except Exception as e:
        logger.error(f"Get accounts error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# --- OAuth 认证 API ---
from utils.oauth_manager import oauth_manager

@app.get("/connectors/oauth/authorize/{platform}")
async def api_oauth_authorize(platform: str):
    """
    生成OAuth授权URL
    用户点击"授权"按钮时调用此接口
    """
    try:
        result = oauth_manager.generate_authorization_url(platform)
        logger.info(f"Generated OAuth URL for platform: {platform}")
        return result
    except ValueError as e:
        logger.error(f"OAuth authorize error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"OAuth authorize error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


from tools.connectors.interactive_login import interactive_login_manager

class BrowserLoginRequest(BaseModel):
    platform: str

class BrowserStatusRequest(BaseModel):
    session_id: str

@app.post("/connectors/browser/start")
async def api_browser_start(req: BrowserLoginRequest):
    """启动交互式浏览器登录 - 打开可见浏览器窗口"""
    logger.info(f"[Interactive Login] 启动 {req.platform} 交互式登录...")
    try:
        result = await interactive_login_manager.start_interactive_login(req.platform)
        if result.get("success"):
            logger.info(f"[Interactive Login] 浏览器已打开，等待用户登录...")
            return result
        else:
            raise HTTPException(status_code=500, detail=result.get("error"))
    except Exception as e:
        logger.error(f"[Interactive Login] 启动失败: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/connectors/browser/status")
async def api_browser_status(req: BrowserStatusRequest):
    """检查交互式登录状态"""
    logger.debug(f"[Interactive Login] 检查状态: {req.session_id}")
    try:
        result = await interactive_login_manager.check_login_status(req.session_id)

        # 如果登录成功，保存凭证
        if result.get("status") == "success":
            logger.info(f"[Interactive Login] 登录成功！保存凭证...")
            try:
                platform = result.get("platform")
                cookie_string = result.get("cookies", "")

                # 解析 cookie 字符串为字典
                credentials = {}
                for item in cookie_string.split("; "):
                    if "=" in item:
                        key, value = item.split("=", 1)
                        credentials[key] = value

                # 打印解析结果
                logger.info(f"[Interactive Login] 解析到 {len(credentials)} 个 cookies: {list(credentials.keys())}")

                # 保存凭证
                success = await connector_manager.connect_platform(platform, credentials)
                if success:
                    logger.info(f"[Interactive Login] 凭证已成功验证并保存")
                else:
                    logger.warning(f"[Interactive Login] 凭证保存失败 - 连接验证未通过")
                    # 如果保存失败，我们需要让前端知道
                    return {
                        "status": "error",
                        "error": f"连接验证失败，请确保已点击登录按钮并进入后台。捕获到的 Cookies 数量: {len(credentials)}",
                        "platform": platform
                    }
            except Exception as save_err:
                logger.warning(f"保存凭证过程中出错: {save_err}")
                import traceback
                logger.warning(traceback.format_exc())
                return {"status": "error", "error": f"保存凭证失败: {str(save_err)}"}

        return result
    except Exception as e:
        logger.error(f"[Interactive Login] 检查状态失败: {e}")
        return {"status": "error", "error": str(e)}

@app.post("/connectors/browser/cancel")
async def api_browser_cancel(req: BrowserStatusRequest):
    """取消交互式登录"""
    try:
        result = await interactive_login_manager.cancel_login(req.session_id)
        return result
    except Exception as e:
        return {"success": False, "error": str(e)}

class OAuthCallbackRequest(BaseModel):
    platform: str
    code: str
    state: str



@app.post("/connectors/oauth/callback")
async def api_oauth_callback(req: OAuthCallbackRequest):
    """
    处理OAuth回调
    用户授权后，平台会重定向回来并携带授权码
    """
    try:
        # 用授权码换取访问令牌
        result = oauth_manager.handle_callback(
            platform=req.platform,
            code=req.code,
            state=req.state
        )

        # 保存到connector manager
        if result.get("success"):
            credentials = {
                "access_token": result["access_token"],
                "refresh_token": result.get("refresh_token"),
                "expires_in": result.get("expires_in"),
                "token_type": "Bearer"
            }

            await connector_manager.connect_platform(
                platform_id=req.platform,
                credentials=credentials
            )

            logger.info(f"OAuth callback successful for platform: {req.platform}, user: {result.get('account', {}).get('username')}")

            return {
                "success": True,
                "account": result.get("account")
            }
        else:
            raise HTTPException(status_code=400, detail="Failed to exchange token")

    except ValueError as e:
        logger.error(f"OAuth callback error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"OAuth callback error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════
# 多模态输入 API
# POST /multimodal/analyze  — 单文件分析
# POST /multimodal/chat     — 带文件的对话（预处理后注入上下文）
# ═══════════════════════════════════════════════════════════

# 支持的文件类型白名单
_MULTIMODAL_IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp"}
_MULTIMODAL_DOC_TYPES   = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "text/plain", "text/markdown", "text/csv",
    "application/json",
}
_MULTIMODAL_VIDEO_TYPES = {"video/mp4", "video/webm", "video/quicktime", "video/x-matroska"}

_MULTIMODAL_ALL_TYPES   = _MULTIMODAL_IMAGE_TYPES | _MULTIMODAL_DOC_TYPES | _MULTIMODAL_VIDEO_TYPES

_SIZE_LIMITS = {
    "image":    20 * 1024 * 1024,   # 20 MB
    "document": 50 * 1024 * 1024,   # 50 MB
    "video":   100 * 1024 * 1024,  # 100 MB
}

# 通义 DashScope OpenAI 兼容接口常见报错：Range of input length should be [1, 30720]
_MULTIMODAL_LLM_INPUT_CAP = 30720


def _clamp_multimodal_human_message(system_prompt: str, full_message: str) -> tuple[str, bool]:
    """
    将 HumanMessage 正文限制在模型单次输入上限内（按字符计），避免 InternalError.Algo.InvalidParameter。
    返回 (正文, 是否发生过截断)。
    """
    text = full_message if isinstance(full_message, str) else str(full_message)
    if not text.strip():
        text = "（无用户正文，请仅依据附件说明作答。）"
    overhead = len(system_prompt) + 900
    max_human = max(2048, _MULTIMODAL_LLM_INPUT_CAP - overhead)
    if len(text) <= max_human:
        return text, False
    trailer = (
        "\n\n---\n[系统说明：附件提取正文过长，已超过当前对话模型单次输入上限（约 "
        f"{_MULTIMODAL_LLM_INPUT_CAP} 字符），上文已截断；全文分析请拆分文档或分批提问。]\n"
    )
    take = max_human - len(trailer)
    if take < 1500:
        take = max_human - 120
        trailer = "\n\n[正文过长已截断]\n"
    return text[:take] + trailer, True


def _multimodal_file_category(content_type: str, filename: str = "") -> str:
    if content_type in _MULTIMODAL_IMAGE_TYPES:
        return "image"
    if content_type in _MULTIMODAL_DOC_TYPES:
        return "document"
    if content_type in _MULTIMODAL_VIDEO_TYPES:
        return "video"
    # When content_type is generic (lost through proxy), detect from extension
    if content_type in ("", "application/octet-stream") and filename:
        import mimetypes
        guessed, _ = mimetypes.guess_type(filename)
        if guessed:
            return _multimodal_file_category(guessed)
    return "unknown"


@app.post("/multimodal/analyze")
async def api_multimodal_analyze(
    file: UploadFile = File(...),
    task_type: str = Form("auto"),
    options: str = Form("{}"),
):
    """
    单文件多模态分析。
    task_type: auto | ocr | parse | video | directory
    options:   JSON 字符串，传入工具选项（如 languages、extract_tables 等）
    """
    logger.info("[api] POST /multimodal/analyze file=%s content_type=%s task_type=%s",
                file.filename, file.content_type, task_type)
    try:
        content_type = file.content_type or "application/octet-stream"
        category = _multimodal_file_category(content_type, file.filename or "")
        if category == "unknown":
            raise HTTPException(
                status_code=400,
                detail=f"不支持的文件类型: {content_type}  文件: {file.filename}"
            )

        content = await file.read()
        size_limit = _SIZE_LIMITS.get(category, 50 * 1024 * 1024)
        if len(content) > size_limit:
            raise HTTPException(
                status_code=400,
                detail=f"文件过大: {len(content)//1024//1024}MB，限制 {size_limit//1024//1024}MB"
            )

        # 保存到临时目录
        tmp_path = STORAGE_DIR / "temp" / (file.filename or "upload")
        tmp_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path.write_bytes(content)

        opts = {}
        try:
            opts = json.loads(options)
        except Exception:
            pass

        # 根据类型分发
        effective_task = task_type
        if effective_task == "auto":
            effective_task = {"image": "ocr", "document": "parse", "video": "video"}[category]

        from tools.multimodal_tools import (
            parse_document, ocr_image, analyze_video
        )

        if effective_task == "ocr":
            langs = opts.get("languages", ["ch_sim", "en"])
            result = await asyncio.to_thread(
                ocr_image.invoke, {"image_path": str(tmp_path), "languages": langs}
            )
        elif effective_task == "parse":
            extract_tables = opts.get("extract_tables", True)
            result = await asyncio.to_thread(
                parse_document.invoke, {"file_path": str(tmp_path), "extract_tables": extract_tables}
            )
        elif effective_task == "video":
            max_frames = opts.get("max_frames", 10)
            result = await asyncio.to_thread(
                analyze_video.invoke, {"video_path": str(tmp_path), "max_frames": max_frames}
            )
        else:
            result = f"[不支持的 task_type: {effective_task}]"

        result_payload = {
            "task_type": effective_task,
            "file_name": file.filename,
            "category": category,
            "result": result,
        }
        logger.info("[api] /multimodal/analyze done file=%s task=%s result_len=%d",
                    file.filename, effective_task, len(str(result)))
        return result_payload

    except HTTPException:
        raise
    except Exception as e:
        logger.error("[api] /multimodal/analyze error file=%s: %s", file.filename, e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# 公司定制 · 每日餐费票据
# ============================================================
@app.get("/meal/feishu/status")
async def api_meal_feishu_status():
    """飞书接入状态（长连接 + 配置）。"""
    from routers import meal_receipt_router as meal
    return {"ok": True, **meal.feishu_integration_status()}


@app.get("/meal/feishu/config")
async def api_meal_feishu_config_get():
    from services.meal_feishu_config import load_config
    c = load_config()
    return {
        "ok": True,
        "app_id": c.get("app_id", ""),
        "use_lark_cli": bool(c.get("use_lark_cli")),
        "app_secret_set": bool(c.get("app_secret")),
        "verification_token_set": bool(c.get("verification_token")),
    }


@app.post("/meal/feishu/config")
async def api_meal_feishu_config_set(body: dict):
    from services.meal_feishu_config import save_config
    from services.meal_feishu_api import reset_client_cache
    c = save_config(body)
    reset_client_cache()
    return {
        "ok": True,
        "app_id": c.get("app_id", ""),
        "use_lark_cli": bool(c.get("use_lark_cli")),
        "app_secret_set": bool(c.get("app_secret")),
    }


@app.get("/meal/feishu/lark-cli")
async def api_meal_feishu_lark_cli_probe():
    from services import meal_feishu_lark_cli as lc
    return {"ok": True, **lc.integration_probe()}


@app.post("/meal/feishu/sync-lark-cli")
async def api_meal_feishu_sync_lark_cli():
    from services import meal_feishu_lark_cli as lc
    from services.meal_feishu_api import reset_client_cache
    ok, message, extra = await asyncio.to_thread(lc.sync_from_lark_cli)
    reset_client_cache()
    return {"ok": ok, "message": message, **extra}


@app.post("/meal/feishu/connect")
async def api_meal_feishu_connect():
    from services import meal_feishu_ws as fws
    await asyncio.to_thread(fws.stop)
    ok, msg = await asyncio.to_thread(fws.start)
    return {"ok": ok, "message": msg, "connected": fws.is_connected()}


@app.post("/meal/feishu/disconnect")
async def api_meal_feishu_disconnect():
    from services import meal_feishu_ws as fws
    fws.stop()
    return {"ok": True, "connected": False}


@app.get("/feishu/ops/status")
async def api_feishu_ops_status():
    """运维快照：端口、飞书连接、餐费库、定时提醒、磁盘。"""
    from services.feishu_ops import collect_ops_status, format_ops_status_markdown

    status = collect_ops_status()
    return {
        "ok": True,
        "status": status,
        "markdown": format_ops_status_markdown(status),
    }


@app.get("/feishu/ops/actions")
async def api_feishu_ops_actions():
    """可执行的运维动作白名单（供 Web 展示）。"""
    from services.feishu_ops_deploy import list_action_catalog

    return {"ok": True, "actions": list_action_catalog()}


@app.post("/feishu/ops/plan-from-chat")
async def api_feishu_ops_plan_from_chat(body: dict):
    """拉取飞书群对话 + LLM 解析为运维计划（待确认）。"""
    from services.feishu_ops_deploy import plan_from_context

    try:
        hours = float(body.get("hours_back") or 2)
    except (TypeError, ValueError):
        hours = 2.0
    return plan_from_context(
        chat_id=(body.get("chat_id") or "").strip(),
        hours_back=hours,
        instruction=(body.get("instruction") or "").strip(),
        focus_keyword=(body.get("focus_keyword") or "").strip(),
        as_who=(body.get("as_who") or "bot").strip() or "bot",
    )


@app.post("/feishu/ops/execute")
async def api_feishu_ops_execute(body: dict):
    """执行已确认的运维计划。"""
    from services.feishu_ops_deploy import execute_plan

    pid = (body.get("plan_id") or "").strip()
    if not pid:
        raise HTTPException(status_code=400, detail="plan_id 必填")
    return execute_plan(pid, sender_open_id=(body.get("sender_open_id") or "").strip())


@app.post("/feishu/ops/broadcast")
async def api_feishu_ops_broadcast(body: dict):
    """向指定飞书群推送运维摘要（chat_id=oc_xxx）。"""
    from services import meal_feishu_lark_cli as lc
    from services.feishu_ops import collect_ops_status, format_ops_status_markdown

    chat_id = (body.get("chat_id") or "").strip()
    if not chat_id.startswith("oc_"):
        raise HTTPException(status_code=400, detail="chat_id 须为 oc_ 开头的群 ID")
    summary = format_ops_status_markdown(collect_ops_status()).replace("**", "")
    ok, detail = await asyncio.to_thread(lc.send_chat_text, chat_id, summary[:4000])
    return {"ok": ok, "detail": detail}


@app.get("/feishu/ops/jenkins/health")
async def api_feishu_ops_jenkins_health():
    from services.jenkins_service import health_check

    return await asyncio.to_thread(health_check)


@app.get("/feishu/ops/jenkins/jobs")
async def api_feishu_ops_jenkins_jobs():
    from services.jenkins_service import list_whitelist_jobs

    return await asyncio.to_thread(list_whitelist_jobs)


@app.get("/feishu/ops/jenkins/builds")
async def api_feishu_ops_jenkins_builds(job_name: str = "", limit: int = 10):
    from services.jenkins_service import list_builds

    name = (job_name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="job_name 必填")
    return await asyncio.to_thread(list_builds, name, limit)


@app.get("/feishu/ops/jenkins/console")
async def api_feishu_ops_jenkins_console(job_name: str = "", build_number: int = 0):
    from services.jenkins_service import get_console_text

    name = (job_name or "").strip()
    if not name or build_number < 1:
        raise HTTPException(status_code=400, detail="job_name 与 build_number 必填")
    return await asyncio.to_thread(get_console_text, name, int(build_number))


@app.post("/feishu/ops/jenkins/trigger")
async def api_feishu_ops_jenkins_trigger(body: dict):
    from services.jenkins_service import trigger_build

    job_name = (body.get("job_name") or "").strip()
    if not job_name:
        raise HTTPException(status_code=400, detail="job_name 必填")
    bp = body.get("build_params") if isinstance(body.get("build_params"), dict) else {}
    wait = body.get("wait_for_start", True)
    if isinstance(wait, str):
        wait = wait.lower() not in ("0", "false", "no")
    return await asyncio.to_thread(trigger_build, job_name, bp, wait_for_start=bool(wait))


@app.get("/feishu/ops/jenkins/config")
async def api_feishu_ops_jenkins_config_get():
    """Jenkins 白名单流水线与飞书自动构建配置（供 Web 配置页）。"""
    from services.jenkins_config_store import get_jenkins_settings_for_ui

    return await asyncio.to_thread(get_jenkins_settings_for_ui)


@app.put("/feishu/ops/jenkins/config")
async def api_feishu_ops_jenkins_config_put(body: dict):
    """保存 Jenkins 白名单流水线等配置到 feishu_config.json。"""
    from services.jenkins_config_store import update_jenkins_settings

    try:
        return await asyncio.to_thread(update_jenkins_settings, body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/meal/feishu/webhook")
async def api_meal_feishu_webhook(request: Request):
    """飞书事件订阅回调（可选；本地开发推荐用「连接飞书」长连接）。"""
    from services.feishu_vote_handler import dispatch_platform_event
    from services.meal_feishu_handler import handle_im_message_event
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="invalid json")
    if body.get("type") == "url_verification":
        return {"challenge": body.get("challenge")}
    header = body.get("header") or {}
    event_type = header.get("event_type") or ""
    if event_type == "im.message.receive_v1":
        event = body.get("event") or {}
        await asyncio.to_thread(handle_im_message_event, event)
        return {}
    if event_type == "card.action.trigger":
        result = await asyncio.to_thread(dispatch_platform_event, body)
        if result:
            return result
        return {"toast": {"type": "info", "content": "已收到回调", "i18n": {"zh_cn": "已收到回调"}}}
    return {}


@app.get("/meal/feishu/chats")
async def api_meal_feishu_chats():
    """机器人已加入的飞书群列表（供定时提醒选择）。"""
    from services import meal_feishu_lark_cli as lc
    from services.meal_feishu_config import is_configured

    if not is_configured():
        raise HTTPException(status_code=400, detail="请先完成飞书 lark-cli 连接")
    chats, err = await asyncio.to_thread(lc.list_bot_group_chats)
    if err and not chats:
        return {"ok": False, "chats": [], "error": err}
    return {
        "ok": True,
        "chats": chats,
        "count": len(chats),
        "error": err or None,
    }


@app.get("/meal/feishu/chat-members")
async def api_meal_feishu_chat_members(chat_id: str = ""):
    """提醒群成员列表（姓名模糊选择）；默认使用已配置的 reminder_chat_id。"""
    import asyncio

    from services import meal_feishu_lark_cli as lc
    from services.meal_feishu_config import (
        is_configured,
        load_config,
        resolve_member_list_chat_id,
    )

    if not is_configured():
        raise HTTPException(status_code=400, detail="请先完成飞书 lark-cli 连接")

    cid, resolve_err, chat_source = resolve_member_list_chat_id(chat_id)
    if not cid:
        return {
            "ok": False,
            "members": [],
            "error": resolve_err or "请先在「群聊定时提醒」中选择提醒群",
            "chat_id": "",
        }
    members, err = await asyncio.to_thread(lc.list_chat_members, cid)
    if err and not members:
        return {"ok": False, "members": [], "error": err, "chat_id": cid}
    cfg = load_config()
    chat_name = str(cfg.get("reminder_chat_name") or "").strip()
    if chat_source == "auto_first_group" and not chat_name:
        chats, _ = await asyncio.to_thread(lc.list_bot_group_chats)
        for row in chats or []:
            if str(row.get("chat_id") or "") == cid:
                chat_name = str(row.get("name") or "")
                break
    return {
        "ok": True,
        "members": members,
        "chat_id": cid,
        "chat_name": chat_name,
        "chat_source": chat_source,
        "error": err or None,
    }


@app.get("/meal/feishu/attendance-ids")
async def api_meal_feishu_attendance_ids(chat_id: str = ""):
    """诊断：提醒群成员的 open_id 是否已能解析为考勤 user_id。"""
    import asyncio

    from services.meal_feishu_attendance_ids import batch_resolve_attendance_identities
    from services.meal_feishu_config import is_configured, load_config
    from services import meal_feishu_lark_cli as lc

    if not is_configured():
        raise HTTPException(status_code=400, detail="请先完成飞书 lark-cli 连接")
    cfg = load_config()
    cid = (chat_id or cfg.get("reminder_chat_id") or "").strip()
    if not cid:
        raise HTTPException(status_code=400, detail="请先配置提醒群")
    members, err = await asyncio.to_thread(lc.list_chat_members, cid)
    oids = [m["open_id"] for m in members if m.get("open_id")]
    resolved = await asyncio.to_thread(batch_resolve_attendance_identities, oids)
    rows = []
    for m in members:
        oid = m.get("open_id") or ""
        att_id, id_type, note = resolved.get(oid, ("", "employee_id", ""))
        rows.append(
            {
                "name": m.get("name") or "",
                "open_id": oid,
                "attendance_id": att_id,
                "id_type": id_type,
                "ok": bool(att_id),
                "note": note[:200] if note else "",
            }
        )
    return {
        "ok": True,
        "chat_id": cid,
        "members": rows,
        "error": err or None,
        "hint": (
            "若 ok 均为 false，请在飞书开放平台为应用开通 "
            "contact:user.employee_id:readonly 并重新发布；"
            "或在 feishu_config.json 配置 attendance_user_id_map"
        ),
    }


@app.get("/meal/reminder")
async def api_meal_reminder_get():
    from services.meal_feishu_reminder import reminder_status

    return {"ok": True, **reminder_status()}


@app.post("/meal/reminder")
async def api_meal_reminder_set(body: dict = None):
    from services.meal_feishu_config import save_config
    from services.meal_feishu_reminder import refresh_reminder_schedule, reminder_status

    body = body or {}
    allowed = {
        "reminder_enabled",
        "reminder_chat_id",
        "reminder_chat_name",
        "reminder_hour",
        "reminder_minute",
        "reminder_days",
        "reminder_extra_text",
    }
    patch = {k: body[k] for k in allowed if k in body}
    save_config(patch)
    sched = await asyncio.to_thread(refresh_reminder_schedule)
    return {"ok": True, "schedule": sched, **reminder_status()}


@app.post("/meal/reminder/send-now")
async def api_meal_reminder_send_now(body: dict = None):
    from services.meal_feishu_reminder import send_group_reminder

    body = body or {}
    result = await asyncio.to_thread(
        send_group_reminder,
        chat_id=(body.get("chat_id") or "").strip(),
        extra=(body.get("extra") or "").strip(),
    )
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "发送失败"))
    return result


@app.post("/meal/feishu/token")
async def api_meal_feishu_token(body: dict):
    """为飞书员工生成 H5 上传令牌。"""
    from routers import meal_receipt_router as meal
    oid = (body.get("open_id") or body.get("oid") or "").strip()
    if not oid:
        raise HTTPException(status_code=400, detail="open_id 必填")
    name = (body.get("name") or "").strip()
    return {"ok": True, "token": meal.make_upload_token(oid, name)}


@app.get("/tapd/status")
async def api_tapd_status():
    """TAPD 集成配置状态（不含密钥）。"""
    from services import tapd_service as tapd

    return {"ok": True, **tapd.tapd_status()}


@app.post("/tapd/bugs/create")
async def api_tapd_bug_create(request: Request):
    """创建 TAPD 缺陷并在飞书群 @ 成员；支持 JSON 或 multipart（含附件）。"""
    import json as _json

    from services import tapd_service as tapd
    from services.meal_feishu_config import is_configured

    try:
        upload_files: list[UploadFile] = []
        ct = (request.headers.get("content-type") or "").lower()
        if "multipart/form-data" in ct:
            form = await request.form()
            title = str(form.get("title") or "").strip()
            description = str(form.get("description") or "").strip()
            chat_id = str(form.get("chat_id") or "").strip()
            priority = str(
                form.get("priority_label") or form.get("priority") or ""
            ).strip()
            reporter_name = str(form.get("reporter_name") or "").strip()
            raw_mentions = form.get("mentions") or "[]"
            raw_chat_ids = form.get("chat_ids") or form.get("chat_id") or "[]"
            if isinstance(raw_mentions, str):
                try:
                    raw_mentions = _json.loads(raw_mentions)
                except _json.JSONDecodeError:
                    raw_mentions = []
            upload_files = [
                f
                for f in form.getlist("attachments")
                if hasattr(f, "read") and getattr(f, "filename", None)
            ]
        else:
            body = await request.json()
            title = (body.get("title") or "").strip()
            description = (body.get("description") or "").strip()
            chat_id = (body.get("chat_id") or "").strip()
            priority = (body.get("priority_label") or body.get("priority") or "").strip()
            reporter_name = (body.get("reporter_name") or "").strip()
            raw_mentions = body.get("mentions") or []
            raw_chat_ids = body.get("chat_ids")

        mentions: list[dict[str, str]] = []
        if isinstance(raw_mentions, list):
            for row in raw_mentions:
                if not isinstance(row, dict):
                    continue
                oid = str(row.get("open_id") or "").strip()
                name = str(row.get("name") or "").strip()
                if oid:
                    mentions.append({"open_id": oid, "name": name or oid})

        chat_ids: list[str] = []
        if isinstance(raw_chat_ids, list):
            chat_ids = [
                str(c).strip()
                for c in raw_chat_ids
                if str(c).strip().startswith("oc_")
            ]
        elif isinstance(raw_chat_ids, str) and raw_chat_ids.strip():
            try:
                parsed = _json.loads(raw_chat_ids)
                if isinstance(parsed, list):
                    chat_ids = [
                        str(c).strip()
                        for c in parsed
                        if str(c).strip().startswith("oc_")
                    ]
            except _json.JSONDecodeError:
                chat_ids = [
                    p.strip()
                    for p in raw_chat_ids.replace("\n", ",").split(",")
                    if p.strip().startswith("oc_")
                ]
        if not chat_ids and chat_id.startswith("oc_"):
            chat_ids = [chat_id]

        if not title:
            raise HTTPException(status_code=400, detail="缺陷标题不能为空")
        if not chat_ids:
            raise HTTPException(
                status_code=400,
                detail="请至少选择一个有效的飞书群（oc_ 开头）",
            )
        if not is_configured():
            raise HTTPException(status_code=400, detail="请先完成飞书 lark-cli 连接")

        bug = await asyncio.to_thread(
            tapd.create_bug,
            title=title,
            description=description,
            priority_label=priority,
        )
        if not bug.get("ok"):
            raise HTTPException(status_code=400, detail=bug.get("error") or "TAPD 创建失败")

        bug_id = str(bug.get("bug_id") or "")
        attachment_rows: list[dict] = []
        attachment_errors: list[str] = []
        if upload_files and bug_id:
            file_payloads: list[tuple[bytes, str, str]] = []
            for uf in upload_files:
                if not uf or not uf.filename:
                    continue
                content = await uf.read()
                if not content:
                    continue
                ctype = (uf.content_type or "application/octet-stream").strip()
                file_payloads.append((content, uf.filename, ctype))
            if file_payloads:
                attachment_rows, attachment_errors = await asyncio.to_thread(
                    tapd.upload_bug_attachments,
                    bug_id,
                    file_payloads,
                )

        feishu_ok, feishu_err, feishu_results = await asyncio.to_thread(
            tapd.notify_feishu_bug_chats,
            chat_ids=chat_ids,
            bug_title=str(bug.get("title") or title),
            bug_url=str(bug.get("url") or ""),
            description=description,
            mentions=mentions,
            reporter_name=reporter_name,
            attachment_count=len(attachment_rows),
        )

        return {
            "ok": True,
            "bug": {
                "id": bug.get("bug_id"),
                "url": bug.get("url"),
                "title": bug.get("title"),
            },
            "feishu": {
                "ok": feishu_ok,
                "error": feishu_err or None,
                "results": feishu_results,
                "sent": sum(1 for r in feishu_results if r.get("ok")),
                "total": len(feishu_results),
            },
            "attachments": {
                "uploaded": len(attachment_rows),
                "errors": attachment_errors or None,
                "items": attachment_rows or None,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("[tapd] bug create failed")
        raise HTTPException(status_code=500, detail=str(e)[:300]) from e


@app.post("/tapd/bugs/analyze-media")
async def api_tapd_bug_analyze_media(request: Request):
    """从截图/录屏/GIF 分析缺陷，返回建议的标题、描述与优先级（不创建缺陷）。"""
    from services.tapd_bug_analyze import analyze_bug_media

    try:
        ct = (request.headers.get("content-type") or "").lower()
        if "multipart/form-data" not in ct:
            raise HTTPException(status_code=400, detail="请使用 multipart/form-data 上传附件")

        form = await request.form()
        upload_files = [
            f
            for f in form.getlist("attachments")
            if hasattr(f, "read") and getattr(f, "filename", None)
        ]
        if not upload_files:
            raise HTTPException(status_code=400, detail="请至少上传一个附件（截图/录屏/HAR）")

        file_payloads: list[tuple[bytes, str, str]] = []
        for uf in upload_files:
            content = await uf.read()
            if not content:
                continue
            ctype = (uf.content_type or "application/octet-stream").strip()
            file_payloads.append((content, uf.filename or "upload.bin", ctype))

        if not file_payloads:
            raise HTTPException(status_code=400, detail="附件内容为空")

        result = await asyncio.to_thread(analyze_bug_media, file_payloads)
        if not result.get("ok"):
            raise HTTPException(
                status_code=400,
                detail=result.get("error") or "媒体分析失败",
            )
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("[tapd] bug analyze-media failed")
        raise HTTPException(status_code=500, detail=str(e)[:300]) from e


@app.get("/tapd/bugs/stats")
async def api_tapd_bug_stats(
    range_days: int = Query(30, ge=0, le=3650),
    created_start: str = Query(""),
    created_end: str = Query(""),
):
    """TAPD 缺陷统计汇总（按时间范围聚合）。"""
    from services import tapd_service as tapd

    result = await asyncio.to_thread(
        tapd.bug_stats_summary,
        range_days=range_days,
        created_start=created_start.strip(),
        created_end=created_end.strip(),
    )
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error") or "统计失败")
    return result


@app.get("/tapd/bugs")
async def api_tapd_bug_list(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    range_days: int = Query(0, ge=0, le=3650),
    created_start: str = Query(""),
    created_end: str = Query(""),
    status: str = Query(""),
    priority: str = Query(""),
    keyword: str = Query(""),
    current_owner: str = Query(""),
    reporter: str = Query(""),
    open_only: bool = Query(False),
    closed_only: bool = Query(False),
):
    """TAPD 缺陷分页列表（支持模糊搜索与筛选）。"""
    from services import tapd_service as tapd

    result = await asyncio.to_thread(
        tapd.search_bugs,
        page=page,
        limit=limit,
        range_days=range_days,
        created_start=created_start.strip(),
        created_end=created_end.strip(),
        status=status.strip(),
        priority=priority.strip(),
        keyword=keyword.strip(),
        current_owner=current_owner.strip(),
        reporter=reporter.strip(),
        open_only=open_only,
        closed_only=closed_only,
    )
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error") or "查询失败")
    return result


@app.post("/tapd/bugs/stats/export")
async def api_tapd_stats_export(body: dict):
    """导出 TAPD 缺陷统计报告（MD / Excel / PDF / PPT），可选 AI 总结。"""
    from fastapi.responses import Response

    from services import tapd_service as tapd
    from services import tapd_stats_export as export_svc

    fmt = (body.get("format") or "md").strip().lower()
    if fmt == "pptx":
        fmt = "ppt"
    if fmt not in export_svc.EXPORT_FORMATS:
        raise HTTPException(
            status_code=400,
            detail=f"format 须为 md / excel / pdf / ppt，当前: {fmt}",
        )

    range_days = int(body.get("range_days") or 30)
    with_ai_raw = body.get("with_ai")
    # 叙述类导出默认开启 AI 整理，避免输出纯原始数据
    if with_ai_raw is None:
        with_ai = fmt in {"md", "pdf", "ppt"}
    else:
        with_ai = bool(with_ai_raw)
    mode = (body.get("mode") or "summary").strip()
    user_note = (body.get("user_note") or "").strip()

    stats = await asyncio.to_thread(
        tapd.bug_stats_summary,
        range_days=max(0, min(range_days, 3650)),
    )
    if not stats.get("ok"):
        raise HTTPException(status_code=400, detail=stats.get("error") or "获取统计失败")

    ai_analysis: str | None = None
    if with_ai:
        ai = await asyncio.to_thread(
            export_svc.analyze_stats,
            stats,
            mode=mode,
            user_note=user_note,
        )
        if not ai.get("ok"):
            raise HTTPException(status_code=400, detail=ai.get("error") or "AI 分析失败")
        ai_analysis = str(ai.get("analysis") or "")

    try:
        content, mime, filename = await asyncio.to_thread(
            export_svc.export_stats_report,
            stats,
            fmt=fmt,
            ai_analysis=ai_analysis,
        )
    except ImportError as e:
        raise HTTPException(
            status_code=400,
            detail=f"导出格式 {fmt} 所需依赖未安装：{e}",
        ) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    return Response(
        content=content,
        media_type=mime,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Export-Filename": filename,
        },
    )


@app.get("/feishu/votes/setup")
async def api_feishu_vote_setup():
    """飞书投票接入状态与卡片回调配置引导。"""
    from services import feishu_vote_service as vote

    return {"ok": True, **vote.vote_setup_status()}


@app.get("/feishu/votes/templates")
async def api_feishu_vote_templates():
    """飞书投票模版列表。"""
    from services import feishu_vote_service as vote

    return {"ok": True, "templates": vote.list_templates()}


@app.get("/feishu/votes")
async def api_feishu_vote_list(limit: int = Query(50, ge=1, le=200)):
    """飞书投票历史列表。"""
    from services import feishu_vote_service as vote

    return {"ok": True, "polls": vote.list_polls(limit=limit)}


@app.post("/feishu/votes")
async def api_feishu_vote_create(body: dict):
    """创建投票（草稿）。"""
    from services import feishu_vote_service as vote

    result = await asyncio.to_thread(vote.create_poll, body)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error") or "创建失败")
    return result


@app.get("/feishu/votes/{poll_id}")
async def api_feishu_vote_get(poll_id: str, include_votes: bool = Query(False)):
    """获取单个投票详情。"""
    from services import feishu_vote_service as vote

    result = await asyncio.to_thread(vote.get_poll, poll_id, include_votes=include_votes)
    if not result.get("ok"):
        raise HTTPException(status_code=404, detail=result.get("error") or "不存在")
    return result


@app.get("/feishu/votes/{poll_id}/stats")
async def api_feishu_vote_stats(poll_id: str):
    """投票实时统计与分析。"""
    from services import feishu_vote_service as vote

    result = await asyncio.to_thread(vote.get_stats, poll_id)
    if not result.get("ok"):
        raise HTTPException(status_code=404, detail=result.get("error") or "不存在")
    return result


@app.post("/feishu/votes/{poll_id}/send")
async def api_feishu_vote_send(poll_id: str):
    """向目标群发送投票交互卡片。"""
    from services import feishu_vote_service as vote

    result = await asyncio.to_thread(vote.send_poll, poll_id)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error") or "发送失败")
    return result


@app.post("/feishu/votes/{poll_id}/close")
async def api_feishu_vote_close(poll_id: str):
    """结束投票。"""
    from services import feishu_vote_service as vote

    result = await asyncio.to_thread(vote.close_poll, poll_id)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error") or "操作失败")
    return result


@app.post("/meal/upload")
async def api_meal_upload(
    file: UploadFile = File(None),
    files: list[UploadFile] | None = File(None),
    employee_id: str = Form(""),
    employee_name: str = Form(""),
    meal_date: str = Form(""),
    token: str = Form(""),
    overwrite: bool = Form(False),
    manual_amount: str = Form(""),
):
    """上传餐费截图（最多 3 张）→ 分别识别金额并合计 → 入库（每人每天一条）。"""
    from routers import meal_receipt_router as meal

    uploads: list[UploadFile] = []
    multi = files or []
    if multi:
        uploads.extend(multi[: meal.MAX_UPLOAD_IMAGES])
    elif file:
        uploads.append(file)
    if not uploads:
        raise HTTPException(status_code=400, detail="请至少上传一张截图")
    if len(multi) > meal.MAX_UPLOAD_IMAGES:
        raise HTTPException(
            status_code=400,
            detail=f"单次最多上传 {meal.MAX_UPLOAD_IMAGES} 张截图",
        )

    file_data: list[tuple[bytes, str]] = []
    for uf in uploads:
        content = await uf.read()
        if len(content) > 20 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="单张图片不能超过 20MB")
        file_data.append((content, uf.filename or "receipt.jpg"))

    manual_amt = meal._norm_amount(manual_amount.strip()) if manual_amount.strip() else None

    if token.strip():
        result = await asyncio.to_thread(
            meal.process_upload_feishu,
            token=token.strip(),
            content=file_data[0][0],
            filename=file_data[0][1],
            files=file_data,
            overwrite=overwrite,
            manual_amount=manual_amt,
        )
    else:
        eid = employee_id.strip()
        ename = employee_name.strip()
        if not eid and ename:
            eid = meal.employee_id_from_name(ename)
        if not eid:
            raise HTTPException(
                status_code=400,
                detail="请填写姓名，或使用飞书个人上传链接（带 token）",
            )
        result = await asyncio.to_thread(
            meal.process_upload,
            employee_id=eid,
            employee_name=ename,
            files=file_data,
            meal_date=meal_date.strip(),
            overwrite=overwrite,
            manual_amount=manual_amt,
        )
    return result


@app.get("/meal/receipts")
async def api_meal_receipts(
    employee_id: str,
    month: str = "",
    employee_name: str = "",
):
    """某员工的餐费记录 + 汇总。"""
    from routers import meal_receipt_router as meal
    if month.strip().lower() in ("all", "全部"):
        month = ""
    records = meal.list_by_emp(
        employee_id, month=month, employee_name=employee_name
    )
    return {
        "ok": True,
        "month": month,
        "records": meal.enrich_records(records, month=month),
        "summary": meal.summarize(records),
    }


@app.get("/meal/receipts/mine")
async def api_meal_receipts_mine(token: str = "", name: str = "", month: str = ""):
    """上传页 / 飞书链接：凭 token 或姓名查看本人餐费历史。"""
    from routers import meal_receipt_router as meal
    from utils.meal_public_url import meal_upload_history_url, meal_upload_page_url

    eid, display_name, err = meal.resolve_upload_identity(token, name)
    if not eid:
        return {"ok": False, "error": err, "records": [], "summary": meal.summarize([])}
    if month.strip().lower() in ("all", "全部"):
        month = ""
    records = meal.list_by_emp(eid, month=month)
    emp_name = display_name or (records[0].get("employee_name") if records else "")
    tok = (token or "").strip()
    upload_url = meal_upload_page_url()
    if tok:
        upload_url = f"{upload_url}?token={tok}"
    return {
        "ok": True,
        "employee_id": eid,
        "employee_name": emp_name,
        "month": month,
        "records": meal.enrich_records(
            [meal._norm_record(r) for r in records], month=month
        ),
        "summary": meal.summarize(records),
        "history_url": meal_upload_history_url(token=tok, employee_name=name or display_name),
        "upload_url": upload_url,
    }


@app.get("/meal/receipts/all")
async def api_meal_receipts_all(month: str = ""):
    """全员餐费总览（管理统计）。"""
    from routers import meal_receipt_router as meal
    if month.strip().lower() in ("all", "全部"):
        month = ""
    elif not month:
        month = meal.current_month()
    records = meal.list_all(month=month)
    return {
        "ok": True,
        "month": month,
        "summary": meal.summarize(records),
        "by_user": meal.summarize_by_user(records),
        "by_date": meal.summarize_by_date(records),
        "records": meal.enrich_records(records, month=month),
        "vision": meal.get_vision_info(),
    }


@app.post("/meal/receipts")
async def api_meal_upsert(body: dict):
    """手动补录/更正（覆盖当天）。"""
    from routers import meal_receipt_router as meal
    employee_id = (body.get("employee_id") or "").strip()
    employee_name = (body.get("employee_name") or "").strip()
    meal_date = (body.get("meal_date") or "").strip()
    if not employee_id or not meal_date:
        raise HTTPException(status_code=400, detail="employee_id 和 meal_date 必填")
    try:
        amount = round(float(body.get("amount")), 2)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="amount 无效")
    if amount <= 0:
        raise HTTPException(status_code=400, detail="amount 必须大于 0")
    ok, status, record = meal.upsert_receipt(
        employee_id=employee_id, employee_name=employee_name, meal_date=meal_date,
        amount=amount, currency=(body.get("currency") or "CNY"),
        merchant=(body.get("merchant") or ""), source="manual", overwrite=True,
    )
    return {"ok": ok, "status": status, "record": record}


@app.delete("/meal/receipts")
async def api_meal_delete(employee_id: str, meal_date: str):
    from routers import meal_receipt_router as meal
    ok = meal.delete_receipt(employee_id, meal_date)
    return {"ok": ok}


@app.get("/meal/vision")
async def api_meal_vision():
    from routers import meal_receipt_router as meal
    return {"ok": True, **meal.get_vision_info()}


@app.get("/meal/export")
async def api_meal_export(
    scope: str = "company",
    employee_id: str = "",
    month: str = "",
    employee_name: str = "",
):
    """导出 Excel：scope=company 全员 / user 指定员工。"""
    import urllib.parse
    from fastapi.responses import Response
    from routers import meal_receipt_router as meal
    if month.strip().lower() in ("all", "全部"):
        month = ""
    tag = month or "全部"
    if scope == "user" and employee_id:
        records = meal.list_by_emp(
            employee_id, month=month, employee_name=employee_name
        )
        name = records[0].get("employee_name") if records else employee_id
        data = meal.build_personal_excel(records, name or employee_id, month)
        fname = f"餐费_{name or employee_id}_{tag}.xlsx"
    else:
        records = meal.list_all(month=month)
        data = meal.build_company_excel(records, month)
        fname = f"全员餐费统计_{tag}.xlsx"
    quoted = urllib.parse.quote(fname)
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quoted}"},
    )


def _streaming_text_from_chunk(chunk) -> str:
    """LangChain AIMessageChunk.content may be str or list (OpenAI-style blocks)."""
    text = getattr(chunk, "content", None)
    if text is None:
        return ""
    if isinstance(text, str):
        return text
    if isinstance(text, list):
        parts: List[str] = []
        for block in text:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                parts.append(str(block.get("text") or block.get("content") or ""))
        return "".join(parts)
    return str(text)


@app.post("/multimodal/chat")
async def api_multimodal_chat(
    message: str = Form(""),
    session_id: str = Form(""),
    files: Annotated[List[UploadFile], File()] = (),
):
    """
    多模态对话接口（流式）。
    接受文本消息 + 多个文件，预处理文件后将提取内容注入上下文，
    然后转发给 multi-agent/stream 处理。
    """
    logger.info("[api] POST /multimodal/chat message_len=%d files=%d session=%s",
                len(message), len(files), session_id or "(none)")

    async def generate():
        try:
            # ── 1. 处理上传文件 ────────────────────────────
            file_contexts = []
            from tools.multimodal_tools import parse_document, ocr_image, analyze_video

            for f in files:
                content_type = f.content_type or "application/octet-stream"
                category = _multimodal_file_category(content_type, f.filename or "")
                if category == "unknown":
                    file_contexts.append(f"[跳过不支持的文件: {f.filename} (type={content_type})]")
                    continue

                content = await f.read()
                size_limit = _SIZE_LIMITS.get(category, 50 * 1024 * 1024)
                if len(content) > size_limit:
                    file_contexts.append(f"[文件 {f.filename} 超过大小限制，已跳过]")
                    continue

                tmp_path = STORAGE_DIR / "temp" / (f.filename or "upload")
                tmp_path.parent.mkdir(parents=True, exist_ok=True)
                tmp_path.write_bytes(content)

                try:
                    if category == "image":
                        extracted = await asyncio.to_thread(
                            ocr_image.invoke, {"image_path": str(tmp_path), "languages": ["ch_sim", "en"]}
                        )
                    elif category == "document":
                        extracted = await asyncio.to_thread(
                            parse_document.invoke, {"file_path": str(tmp_path), "extract_tables": True}
                        )
                    elif category == "video":
                        extracted = await asyncio.to_thread(
                            analyze_video.invoke, {"video_path": str(tmp_path), "max_frames": 10}
                        )
                    else:
                        extracted = ""
                    file_contexts.append(extracted)
                except Exception as e:
                    file_contexts.append(f"[文件 {f.filename} 处理失败: {e}]")

            # ── 2. 组合消息 ─────────────────────────────────
            if file_contexts:
                context_block = "\n\n".join(file_contexts)
                full_message = (
                    f"[用户上传了 {len(files)} 个文件，内容如下]\n\n"
                    f"{context_block}\n\n"
                    f"[用户问题]\n{message}"
                ) if message else (
                    f"[用户上传了 {len(files)} 个文件，内容如下]\n\n"
                    f"{context_block}\n\n"
                    f"请分析以上文件内容并给出详细说明。"
                )
            else:
                full_message = message

            system_prompt = (
                "你是 AI Media Agent 的多模态分析助手。用户上传了文件，"
                "文件内容已提取并附在下方。请基于文件内容回答用户问题，"
                "如果内容不足请如实说明。"
            )
            full_message, mm_truncated = _clamp_multimodal_human_message(
                system_prompt, full_message
            )
            if mm_truncated:
                logger.warning(
                    "[api] /multimodal/chat human message truncated to fit LLM input cap=%s",
                    _MULTIMODAL_LLM_INPUT_CAP,
                )

            # ── 3. 直接用 LLM 流式回复（绕过 Planning Graph）
            # Planning Graph 会把含"图片/视频"关键词的请求误规划为生成任务，
            # 而多模态场景需要的是基于已提取内容直接分析回答。
            from core.llm_provider import get_chat_llm, get_api_key

            llm = get_chat_llm(
                temperature=0.5,
                streaming=True,
                api_key=get_api_key() or api_key,
            )

            from langchain_core.messages import SystemMessage, HumanMessage
            messages = [
                SystemMessage(content=system_prompt),
                HumanMessage(content=full_message),
            ]

            async for token in llm.astream(messages):
                text = _streaming_text_from_chunk(token)
                if text:
                    yield f"data: {json.dumps({'content': text}, ensure_ascii=False)}\n\n"

            yield "data: [DONE]\n\n"

        except Exception as e:
            logger.error(f"Multimodal chat error: {e}")
            yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ══════════════════════════════════════════════════════════════════
# 工作流 API  /workflows
# ══════════════════════════════════════════════════════════════════

@app.get("/workflows")
async def workflow_list():
    """列出所有工作流"""
    from services.workflow_service import get_workflow_service
    svc = get_workflow_service()
    workflows = await svc.list_workflows()
    return {"success": True, "workflows": workflows}


@app.post("/workflows", status_code=201)
async def workflow_create(body: dict):
    """创建新工作流"""
    from services.workflow_service import get_workflow_service
    svc = get_workflow_service()
    wf = await svc.create_workflow(body)
    return {"success": True, "workflow": wf}


@app.get("/workflows/{workflow_id}")
async def workflow_get(workflow_id: str):
    """获取工作流详情"""
    from services.workflow_service import get_workflow_service
    svc = get_workflow_service()
    wf = await svc.get_workflow(workflow_id)
    if wf is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return {"success": True, "workflow": wf}


@app.put("/workflows/{workflow_id}")
async def workflow_update(workflow_id: str, body: dict):
    """更新工作流"""
    from services.workflow_service import get_workflow_service
    svc = get_workflow_service()
    wf = await svc.update_workflow(workflow_id, body)
    if wf is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return {"success": True, "workflow": wf}


@app.delete("/workflows/{workflow_id}")
async def workflow_delete(workflow_id: str):
    """删除工作流"""
    from services.workflow_service import get_workflow_service
    svc = get_workflow_service()
    ok = await svc.delete_workflow(workflow_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return {"success": True}


@app.post("/workflows/{workflow_id}/runs")
async def workflow_run(workflow_id: str, body: dict):
    """启动工作流运行（SSE 流式响应）"""
    import uuid as _uuid
    from core.workflow_engine import run_workflow
    from services.workflow_service import get_workflow_service

    svc = get_workflow_service()
    wf = await svc.get_workflow(workflow_id)
    if wf is None:
        raise HTTPException(status_code=404, detail="Workflow not found")

    run_id = str(_uuid.uuid4())
    initial_variables = body.get("initial_variables", {})

    async def generate():
        async for chunk in run_workflow(wf, run_id, initial_variables):
            yield chunk

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/workflows/{workflow_id}/runs/{run_id}/cancel")
async def workflow_cancel_run(workflow_id: str, run_id: str):
    """取消正在运行的工作流"""
    from services.grpc_client import get_workflow_scheduler_stub
    stub = get_workflow_scheduler_stub()
    if stub is None:
        return {"success": False, "message": "Scheduler not available"}
    try:
        from generated.mediaagent import workflow_pb2  # type: ignore
        resp = stub.CancelWorkflow(workflow_pb2.CancelWorkflowRequest(run_id=run_id))
        return {"success": resp.cancelled}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/workflows/{workflow_id}/runs")
async def workflow_list_runs(workflow_id: str, limit: int = 20):
    """获取工作流运行历史"""
    from services.workflow_service import get_workflow_service
    svc = get_workflow_service()
    runs = await svc.list_runs(workflow_id, limit=limit)
    return {"success": True, "runs": runs}


@app.get("/workflows/{workflow_id}/runs/{run_id}")
async def workflow_get_run(workflow_id: str, run_id: str):
    """获取单次运行详情"""
    from services.workflow_service import get_workflow_service
    svc = get_workflow_service()
    run = await svc.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return {"success": True, "run": run}


@app.get("/workflows/{workflow_id}/runs/{run_id}/status")
async def workflow_run_status(workflow_id: str, run_id: str):
    """从 Go 调度器获取实时运行状态"""
    from services.grpc_client import get_workflow_scheduler_stub
    stub = get_workflow_scheduler_stub()
    if stub is None:
        return {"success": False, "message": "Scheduler not available"}
    try:
        from generated.mediaagent import workflow_pb2  # type: ignore
        resp = stub.GetRunStatus(workflow_pb2.RunStatusRequest(run_id=run_id))
        node_statuses = [
            {
                "node_id": ns.node_id,
                "status": ns.status,
                "error": ns.error,
                "started_at_ms": ns.started_at_ms,
                "finished_at_ms": ns.finished_at_ms,
            }
            for ns in resp.node_statuses
        ]
        return {
            "success": True,
            "run_id": resp.run_id,
            "workflow_id": resp.workflow_id,
            "status": resp.status,
            "node_statuses": node_statuses,
            "started_at_ms": resp.started_at_ms,
            "finished_at_ms": resp.finished_at_ms,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
