"""
定时任务调度器服务

功能:
  - 创建/修改/删除定时任务 (cron 或 interval)
  - 任务执行: 调用现有工具生成内容 → 发布到平台
  - 任务持久化到 JSON 文件
  - 执行日志记录
"""

import os
import json
import uuid
import time
import asyncio
import threading
from contextlib import contextmanager
from datetime import datetime
from typing import Dict, List, Optional, Any

try:
    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.cron import CronTrigger
    from apscheduler.triggers.interval import IntervalTrigger
    _APSCHEDULER_AVAILABLE = True
except ImportError as _aps_err:
    _APSCHEDULER_AVAILABLE = False
    BackgroundScheduler = CronTrigger = IntervalTrigger = None  # type: ignore
    import logging as _logging
    _logging.getLogger('scheduler').warning('apscheduler not installed: %s', _aps_err)

from utils.logger import setup_logger

logger = setup_logger("scheduler")

# 持久化路径
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCHEDULER_DIR = os.path.join(PROJECT_ROOT, "storage", "scheduler")
JOBS_FILE = os.path.join(SCHEDULER_DIR, "jobs.json")
LOGS_FILE = os.path.join(SCHEDULER_DIR, "logs.json")
os.makedirs(SCHEDULER_DIR, exist_ok=True)

# 与环境变量有关的 Agent 调度互斥（避免与其它请求并行改写 LLM_PROVIDER / LLM_MODEL）
_AGENT_SCHED_LOCK = threading.Lock()


@contextmanager
def _scheduler_llm_env_override(
    provider_id: Optional[str], model_id: Optional[str]
):
    """临时覆盖全局 LLM 环境（与 orchestrator 图缓存键一致）。"""
    pid = (provider_id or "").strip().lower()
    mid = (model_id or "").strip()
    prev_p = os.environ.get("LLM_PROVIDER")
    prev_m = os.environ.get("LLM_MODEL")
    try:
        if pid:
            os.environ["LLM_PROVIDER"] = pid
        if mid:
            os.environ["LLM_MODEL"] = mid
        yield
    finally:
        def _restore(k: str, prev: Optional[str]):
            if prev is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = prev

        _restore("LLM_PROVIDER", prev_p)
        _restore("LLM_MODEL", prev_m)


def _build_agent_user_instruction(job_config: dict) -> str:
    payload = job_config.get("prompt") or ""
    ac = job_config.get("agent_config") or {}
    chunks: List[str] = [
        "[定时调度任务]",
        "请按需调用工具（含已启用的 MCP）完成以下目标。",
        "",
        "【任务说明】",
        str(payload).strip(),
    ]
    if ac.get("skills_context"):
        chunks.extend(["", "【能力 / 技能倾向】", str(ac["skills_context"]).strip()])
    if ac.get("mcp_context"):
        chunks.extend(["", "【工具 / MCP 使用提示】", str(ac["mcp_context"]).strip()])
    mode = (ac.get("online_search_mode") or "").strip().lower()
    if mode == "off":
        chunks.extend(["", "【联网偏好】关闭联网查证表述；勿虚构即时网页检索结果。"])
    elif mode == "smart":
        chunks.extend(["", "【联网偏好】与对话默认一致，涉及时效信息时可查证后作答。"])
    elif mode in ("always", "on"):
        chunks.extend(["", "【联网偏好】涉及时效信息时请尽量查证后再归纳。"])
    return "\n".join(chunks)


async def _invoke_agent_scheduler_async(job_config: dict, api_key: str) -> Dict[str, Any]:
    """执行 Agent 类定时任务（多 Agent 或单一 Media Agent）。"""
    from langchain_core.messages import HumanMessage

    from agents.orchestrator import invoke_multi_agent
    from core.llm_provider import get_api_key as _gk

    key = api_key if api_key is not None else (_gk() or "")
    prompt = _build_agent_user_instruction(job_config)
    ac = job_config.get("agent_config") or {}
    use_multi = ac.get("multi_agent", True)
    if use_multi:
        return await invoke_multi_agent(prompt, key)

    from agents.bot import get_agent_executor

    ex = get_agent_executor(key)
    result = await ex.ainvoke({"messages": [HumanMessage(content=prompt)]})
    msgs = result.get("messages") or []
    tail = msgs[-1] if msgs else None
    txt = str(getattr(tail, "content", "") or "") if tail is not None else ""
    return {
        "response": txt,
        "completed_agents": ["media_agent"],
        "messages": [],
    }


def _invoke_agent_scheduler_sync(job_config: dict) -> Dict[str, Any]:
    """在同一大锁内切换 LLM 环境并运行异步编排（供 APScheduler worker 线程使用）。"""
    from core.llm_provider import get_api_key as _gk

    ac = job_config.get("agent_config") or {}
    provider = (ac.get("provider_id") or "").strip() or None
    model = (ac.get("model") or "").strip() or None

    api_key = _gk() or ""
    with _AGENT_SCHED_LOCK:
        with _scheduler_llm_env_override(provider, model):
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                return loop.run_until_complete(
                    _invoke_agent_scheduler_async(job_config, api_key)
                )
            finally:
                loop.close()


# ------------------------------------------------------------------
# 持久化工具
# ------------------------------------------------------------------

def _load_json(path: str) -> list:
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []
    return []


def _save_json(path: str, data: list):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, default=str)


# ------------------------------------------------------------------
# 任务执行器
# ------------------------------------------------------------------
def _execute_job(job_config: dict):
    """
    执行单个定时任务:
      1. 根据 content_type 生成内容 (image/video/article)
      2. 发布到指定平台
    """
    job_id = job_config.get("id", "unknown")
    content_type = job_config.get("content_type", "image")
    prompt = job_config.get("prompt", "")
    platforms = job_config.get("platforms", [])

    logger.info(f"⏰ Executing scheduled job '{job_config.get('name')}' (id={job_id}, type={content_type})")

    log_entry = {
        "id": str(uuid.uuid4()),
        "job_id": job_id,
        "job_name": job_config.get("name", ""),
        "started_at": datetime.now().isoformat(),
        "content_type": content_type,
        "status": "running",
        "result": None,
        "error": None,
        "published_to": [],
    }

    try:
        # --- Step 1: 生成内容 ---
        generated_content = None
        media_url = None

        if content_type == "image":
            from tools.image_tools import generate_image
            # generate_image 是 LangChain @tool, 返回字符串
            result_str = generate_image.invoke(prompt)
            generated_content = result_str
            # 从结果字符串中提取本地路径
            import re
            path_match = re.search(r'storage/outputs/([a-f0-9\-]+\.(?:jpg|png|jpeg|webp))', result_str, re.IGNORECASE)
            if path_match:
                media_url = os.path.join(PROJECT_ROOT, "storage", "outputs", path_match.group(1))
                if not os.path.exists(media_url):
                    media_url = None
            if "❌" in result_str:
                raise Exception(result_str)

        elif content_type == "video":
            from tools.video_tools import generate_video_internal
            # generate_video_internal 是普通函数, 返回 dict
            result = generate_video_internal(prompt=prompt)
            if result.get("success"):
                media_url = result.get("local_path") or result.get("url")
                generated_content = f"✅ 视频已生成: {media_url}"
            else:
                raise Exception(result.get("error", "视频生成失败"))

        elif content_type == "article":
            from tools.copywriting_tools import generate_copywriting
            # generate_copywriting 是 LangChain @tool, 返回字符串
            generated_content = generate_copywriting.invoke({
                "topic": prompt,
                "platform": "xiaohongshu",
                "content_type": "种草推荐",
                "target_audience": "年轻用户",
                "additional_info": ""
            })

        elif content_type == "agent":
            logger.info(f"⏰ Job '{job_id}' running Agent orchestration …")
            agent_payload = _invoke_agent_scheduler_sync(job_config)
            generated_content = agent_payload.get("response") or ""
            completed = agent_payload.get("completed_agents") or []
            logger.info(
                f"⏰ Agent job '{job_id}' finished agents=%s chars=%s",
                completed,
                len(generated_content),
            )

        elif content_type == "companion_nudge":
            # 陪伴定时问候：写入 companion 状态，不执行媒体生成；发布渠道忽略
            message = (prompt or "").strip() or "到你约定的陪伴提醒时间啦，要休息一下或聊聊吗？"
            job_title = (job_config.get("name") or "陪伴提醒").strip()
            line = f"「{job_title}」{message}"
            try:
                from core.companion_state import companion_state_store

                companion_state_store.patch_state(
                    {
                        "append_feedback": {"kind": "scheduler_nudge", "text": line},
                        "growth_add_xp": 1,
                    }
                )
            except Exception as comp_err:
                logger.warning("⏰ companion_nudge: failed to patch companion state: %s", comp_err)
                raise
            generated_content = message
            platforms = []

        else:
            generated_content = prompt  # 直接使用提示词作为内容

        log_entry["generated_content"] = (generated_content or "")[:500]
        logger.info(f"⏰ Job '{job_id}' content generated successfully, media_url={media_url}")

        # 构建干净的发布文案 (不含 AI 响应的 markdown 样式内容)
        clean_caption = prompt  # 默认用原始提示词作为文案
        if content_type == "article" and generated_content:
            clean_caption = generated_content  # 软文直接用全文
        elif content_type == "agent" and generated_content:
            clean_caption = generated_content

        publish_ct = content_type
        if content_type == "agent":
            publish_ct = (
                (job_config.get("agent_config") or {}).get("publish_content_type")
                or "article"
            )

        # --- Step 2: 发布到平台 (使用真实 connector_manager) ---
        if platforms and content_type != "companion_nudge":
            from tools.connectors.manager import get_connector_manager
            cm = get_connector_manager()

            for platform in platforms:
                try:
                    # 异步调用需要在线程中包装
                    pub_result = asyncio.run(
                        cm.publish_to_platform(
                            platform_id=platform,
                            content_type=publish_ct,
                            title=job_config.get("name", "定时发布"),
                            content=clean_caption,
                            media_urls=[media_url] if media_url else [],
                            options={}
                        )
                    )
                    success = pub_result.success if hasattr(pub_result, "success") else False
                    err_msg = ""
                    url = ""
                    if hasattr(pub_result, "to_dict"):
                        d = pub_result.to_dict()
                        url = d.get("url", "")
                        err_msg = d.get("error", "")
                    log_entry["published_to"].append({
                        "platform": platform,
                        "success": success,
                        "url": url,
                        "error": err_msg,
                    })
                    logger.info(f"⏰ Published to {platform}: success={success}, error={err_msg}")
                except Exception as pub_err:
                    log_entry["published_to"].append({
                        "platform": platform,
                        "success": False,
                        "error": str(pub_err),
                    })
                    logger.warning(f"⏰ Publish to {platform} failed: {pub_err}")

        log_entry["status"] = "success"
        pub_n = len(log_entry["published_to"])
        if content_type == "companion_nudge":
            log_entry["result"] = "陪伴定时提醒已写入伙伴档案（recent_feedback）"
        elif pub_n > 0:
            log_entry["result"] = (
                f"执行完成，已向 {pub_n} 个平台尝试发布"
                if content_type == "agent"
                else f"生成完成, 发布到 {pub_n} 个平台"
            )
        else:
            log_entry["result"] = (
                "Agent 任务执行完成（未配置发布渠道）"
                if content_type == "agent"
                else "生成完成（未配置发布渠道）"
            )

    except Exception as e:
        log_entry["status"] = "error"
        log_entry["error"] = str(e)
        logger.error(f"⏰ Job '{job_id}' failed: {e}")

    log_entry["finished_at"] = datetime.now().isoformat()

    # 更新任务的 last_run
    jobs = _load_json(JOBS_FILE)
    for j in jobs:
        if j["id"] == job_id:
            j["last_run"] = log_entry["finished_at"]
            j["run_count"] = j.get("run_count", 0) + 1
            break
    _save_json(JOBS_FILE, jobs)

    # 保存执行日志 (只保留最近100条)
    logs = _load_json(LOGS_FILE)
    logs.insert(0, log_entry)
    _save_json(LOGS_FILE, logs[:100])

    return log_entry


# ------------------------------------------------------------------
# 调度器服务
# ------------------------------------------------------------------
class SchedulerService:
    """定时任务调度器单例"""

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        if not _APSCHEDULER_AVAILABLE:
            self.scheduler = None
            return
        self.scheduler = BackgroundScheduler(timezone="Asia/Shanghai")
        self._load_and_register_jobs()
        self._init_system_jobs()

    def _init_system_jobs(self):
        """初始化内置的系统级定时任务"""
        try:
            from tools.gaming_trending import fetch_all_trending

            # 每小时 0 分钟执行一次热点抓取
            trigger = CronTrigger(minute="0", timezone="Asia/Shanghai")
            self.scheduler.add_job(
                fetch_all_trending,
                trigger=trigger,
                id="system_gaming_trending",
                replace_existing=True,
                name="[系统] 游戏热点定时抓取",
            )
            logger.info("⏰ Registered system job: gaming trending (hourly)")
        except Exception as e:
            logger.error(f"⏰ Failed to register system job gaming_trending: {e}")

        try:
            from tools.connectors.manager import get_connector_manager
            cm = get_connector_manager()

            # 定义包装函数，因为 scheduler 需要同步或可以直接运行协程的任务
            def check_connections():
                logger.info("⏰ Running periodic platform connection check...")
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    loop.run_until_complete(cm.initialize_all())
                finally:
                    loop.close()

            # 每 30 分钟检查一次连接状态
            trigger = IntervalTrigger(minutes=30, timezone="Asia/Shanghai")
            self.scheduler.add_job(
                check_connections,
                trigger=trigger,
                id="system_platform_connection_check",
                replace_existing=True,
                name="[系统] 平台连接状态定时检查",
            )
            logger.info("⏰ Registered system job: platform connection check (every 30m)")
        except Exception as e:
            logger.error(f"⏰ Failed to register system job platform_connection_check: {e}")

        # dream daily（凌晨 2 点，含 LLM 生成 digest）
        try:
            from services.dream_engine import run_daily as _dream_daily

            trigger = CronTrigger(hour=2, minute=0, timezone="Asia/Shanghai")
            self.scheduler.add_job(
                _dream_daily,
                trigger=trigger,
                id="system_dream_daily",
                replace_existing=True,
                name="[系统] Dream Engine 日常记忆整合",
            )
            logger.info("⏰ Registered system job: dream daily (02:00 CST)")
        except Exception as e:
            logger.error(f"⏰ Failed to register system job dream_daily: {e}")

        # dream light（每 6 小时，无 LLM，只 collect + stats）
        try:
            from services.dream_engine import run_light as _dream_light

            trigger = IntervalTrigger(hours=6, timezone="Asia/Shanghai")
            self.scheduler.add_job(
                _dream_light,
                trigger=trigger,
                id="system_dream_light",
                replace_existing=True,
                name="[系统] Dream Engine 轻量事件收集",
            )
            logger.info("⏰ Registered system job: dream light (every 6h)")
        except Exception as e:
            logger.error(f"⏰ Failed to register system job dream_light: {e}")

    def start(self):
        if self.scheduler is None:
            logger.warning("⏰ Scheduler unavailable (apscheduler not installed)")
            return
        if not self.scheduler.running:
            self.scheduler.start()
            logger.info("⏰ Scheduler service started")

    def stop(self):
        if self.scheduler is None:
            return
        if self.scheduler.running:
            self.scheduler.shutdown(wait=False)
            logger.info("⏰ Scheduler service stopped")

    # ------ Job CRUD ------

    def get_all_jobs(self) -> List[dict]:
        """获取所有任务"""
        jobs = _load_json(JOBS_FILE)
        # 附加下次执行时间
        for j in jobs:
            ap_job = self.scheduler.get_job(j["id"]) if self.scheduler else None
            nrt = getattr(ap_job, "next_run_time", None) if ap_job else None
            j["next_run"] = str(nrt) if nrt else None
            j["is_active"] = ap_job is not None and j.get("enabled", True)
        return jobs

    def get_job(self, job_id: str) -> Optional[dict]:
        """获取单个任务"""
        jobs = _load_json(JOBS_FILE)
        return next((j for j in jobs if j["id"] == job_id), None)

    def create_job(self, config: dict) -> dict:
        """创建新任务"""
        job_id = config.get("id") or str(uuid.uuid4())[:8]
        content_type = config.get("content_type", "image")
        agent_cfg_in = config.get("agent_config")
        if not isinstance(agent_cfg_in, dict):
            agent_cfg_in = {}

        job = {
            "id": job_id,
            "name": config.get("name", "未命名任务"),
            "content_type": content_type,
            "prompt": config.get("prompt", ""),
            "platforms": config.get("platforms", []),
            "schedule_type": config.get("schedule_type", "cron"),  # cron | interval
            "cron_expr": config.get("cron_expr", "0 9 * * *"),     # 默认每天9点
            "interval_hours": config.get("interval_hours", 6),
            "enabled": config.get("enabled", True),
            "created_at": datetime.now().isoformat(),
            "last_run": None,
            "run_count": 0,
            "agent_config": agent_cfg_in if content_type == "agent" else {},
        }

        imin = config.get("interval_minutes")
        try:
            if imin is not None and int(imin) > 0:
                job["interval_minutes"] = int(imin)
        except (TypeError, ValueError):
            pass

        # 保存到文件
        jobs = _load_json(JOBS_FILE)
        jobs.append(job)
        _save_json(JOBS_FILE, jobs)

        # 注册到调度器
        if job["enabled"]:
            self._register_ap_job(job)

        logger.info(f"⏰ Created job '{job['name']}' (id={job_id}, schedule={job['schedule_type']})")
        return job

    def update_job(self, job_id: str, updates: dict) -> Optional[dict]:
        """更新任务"""
        jobs = _load_json(JOBS_FILE)
        job = None
        for j in jobs:
            if j["id"] == job_id:
                j.update({k: v for k, v in updates.items() if k != "id"})
                job = j
                break

        if not job:
            return None

        ct = job.get("content_type", "image")
        if ct != "agent":
            job["agent_config"] = {}
        else:
            if "agent_config" in updates:
                ac = updates.get("agent_config")
                job["agent_config"] = ac if isinstance(ac, dict) else {}
            elif not isinstance(job.get("agent_config"), dict):
                job["agent_config"] = {}

        if "interval_minutes" in updates:
            iv = updates.get("interval_minutes")
            if iv is None or (isinstance(iv, (int, float)) and int(iv) <= 0):
                job.pop("interval_minutes", None)
            else:
                job["interval_minutes"] = int(iv)

        _save_json(JOBS_FILE, jobs)

        # 重新注册调度器
        self._remove_ap_job(job_id)
        if job.get("enabled", True):
            self._register_ap_job(job)

        logger.info(f"⏰ Updated job '{job['name']}' (id={job_id})")
        return job

    def delete_job(self, job_id: str) -> bool:
        """删除任务"""
        jobs = _load_json(JOBS_FILE)
        original_len = len(jobs)
        jobs = [j for j in jobs if j["id"] != job_id]

        if len(jobs) == original_len:
            return False

        _save_json(JOBS_FILE, jobs)
        self._remove_ap_job(job_id)
        logger.info(f"⏰ Deleted job {job_id}")
        return True

    def run_job_now(self, job_id: str) -> dict:
        """立即执行一次"""
        job = self.get_job(job_id)
        if not job:
            return {"success": False, "error": f"Job {job_id} not found"}

        logger.info(f"⏰ Running job '{job['name']}' immediately")
        log_entry = _execute_job(job)
        return {"success": log_entry["status"] == "success", "log": log_entry}

    def get_logs(self, job_id: str = None, limit: int = 50) -> list:
        """获取执行日志"""
        logs = _load_json(LOGS_FILE)
        if job_id:
            logs = [l for l in logs if l.get("job_id") == job_id]
        return logs[:limit]

    def delete_log(self, log_id: str) -> bool:
        """删除单个执行日志"""
        logs = _load_json(LOGS_FILE)
        original_len = len(logs)
        logs = [l for l in logs if l.get("id") != log_id]

        if len(logs) == original_len:
            return False

        _save_json(LOGS_FILE, logs)
        logger.info(f"⏰ Deleted log {log_id}")
        return True

    def batch_delete_logs(self, log_ids: List[str]) -> int:
        """批量删除多个执行日志"""
        logs = _load_json(LOGS_FILE)
        original_len = len(logs)
        logs = [l for l in logs if l.get("id") not in log_ids]

        deleted_count = original_len - len(logs)
        if deleted_count > 0:
            _save_json(LOGS_FILE, logs)
            logger.info(f"⏰ Batch deleted {deleted_count} logs")

        return deleted_count

    # ------ Internal ------

    def _register_ap_job(self, job: dict):
        """注册任务到 APScheduler"""
        try:
            if job["schedule_type"] == "cron":
                parts = job.get("cron_expr", "0 9 * * *").split()
                # cron 格式: minute hour day month day_of_week
                trigger = CronTrigger(
                    minute=parts[0] if len(parts) > 0 else "0",
                    hour=parts[1] if len(parts) > 1 else "9",
                    day=parts[2] if len(parts) > 2 else "*",
                    month=parts[3] if len(parts) > 3 else "*",
                    day_of_week=parts[4] if len(parts) > 4 else "*",
                    timezone="Asia/Shanghai",
                )
            else:
                im_raw = job.get("interval_minutes")
                try:
                    im_ok = im_raw is not None and int(im_raw) > 0
                except (TypeError, ValueError):
                    im_ok = False
                if im_ok:
                    trigger = IntervalTrigger(
                        minutes=int(im_raw),
                        timezone="Asia/Shanghai",
                    )
                else:
                    trigger = IntervalTrigger(
                        hours=job.get("interval_hours", 6),
                        timezone="Asia/Shanghai",
                    )

            self.scheduler.add_job(
                _execute_job,
                trigger=trigger,
                id=job["id"],
                args=[job],
                replace_existing=True,
                name=job.get("name", job["id"]),
            )
        except Exception as e:
            logger.error(f"Failed to register job {job['id']}: {e}")

    def _remove_ap_job(self, job_id: str):
        """从 APScheduler 移除任务"""
        try:
            self.scheduler.remove_job(job_id)
        except Exception:
            pass  # Job might not exist

    def _load_and_register_jobs(self):
        """启动时加载所有已保存的任务"""
        jobs = _load_json(JOBS_FILE)
        count = 0
        for job in jobs:
            if job.get("enabled", True):
                self._register_ap_job(job)
                count += 1
        if count:
            logger.info(f"⏰ Loaded {count} scheduled jobs from disk")


# 全局单例
scheduler_service = SchedulerService()
