"""Jenkins REST 客户端（白名单 Job + 构建触发/状态/日志）"""
from __future__ import annotations

import logging
import os
import time
from typing import Any, Optional
from urllib.parse import quote, urlencode

import requests

from services.meal_feishu_config import load_config

logger = logging.getLogger(__name__)

_DEFAULT_JENKINS: dict[str, Any] = {
    "enabled": False,
    "url": "",
    "username": "",
    "allowed_jobs": [],
    "poll_timeout_sec": 120,
    "console_max_chars": 8000,
}

_SESSION = requests.Session()
_SESSION.trust_env = False  # 避免 HTTP_PROXY 把 127.0.0.1 指到错误网关
_CRUMB_CACHE: dict[str, str] = {}


def _proxies_for_url(url: str) -> Optional[dict[str, Optional[str]]]:
    """本地 Jenkins 勿走系统 HTTP_PROXY，否则易出现 502。"""
    from urllib.parse import urlparse

    host = (urlparse(url).hostname or "").lower()
    if host in ("127.0.0.1", "localhost", "::1"):
        return {"http": None, "https": None}
    return None


def get_jenkins_config() -> dict[str, Any]:
    cfg = load_config()
    raw = cfg.get("jenkins")
    j = {**_DEFAULT_JENKINS, **(raw if isinstance(raw, dict) else {})}
    if not j.get("url"):
        j["url"] = os.getenv("JENKINS_URL", "").strip().rstrip("/")
    if not j.get("username"):
        j["username"] = os.getenv("JENKINS_USER", "").strip()
    j["api_token"] = os.getenv("JENKINS_API_TOKEN", "").strip()
    j["enabled"] = bool(j.get("enabled")) and bool(j.get("url")) and bool(j.get("api_token"))
    return j


def _auth() -> tuple[str, str]:
    j = get_jenkins_config()
    user = str(j.get("username") or "")
    token = str(j.get("api_token") or "")
    return user, token


def _base_url() -> str:
    return str(get_jenkins_config().get("url") or "").rstrip("/")


def _job_path(job_name: str) -> str:
    parts = [p for p in job_name.strip("/").split("/") if p]
    if not parts:
        return ""
    return "/".join(f"job/{quote(p, safe='')}" for p in parts)


def get_allowed_job_defs() -> list[dict[str, Any]]:
    j = get_jenkins_config()
    jobs = j.get("allowed_jobs")
    if not isinstance(jobs, list):
        return []
    out: list[dict[str, Any]] = []
    for row in jobs:
        if isinstance(row, dict) and row.get("name"):
            out.append(row)
        elif isinstance(row, str) and row.strip():
            out.append({"name": row.strip(), "label": row.strip()})
    return out


def get_job_def(job_name: str) -> Optional[dict[str, Any]]:
    name = (job_name or "").strip()
    for row in get_allowed_job_defs():
        if str(row.get("name") or "").strip() == name:
            return row
    return None


def is_job_allowed(job_name: str) -> bool:
    return get_job_def(job_name) is not None


def _sanitize_build_params(job_name: str, params: Optional[dict[str, Any]]) -> dict[str, str]:
    jdef = get_job_def(job_name) or {}
    spec = jdef.get("parameters") if isinstance(jdef.get("parameters"), list) else []
    allowed_names = {str(p.get("name")) for p in spec if isinstance(p, dict) and p.get("name")}
    raw = params if isinstance(params, dict) else {}
    out: dict[str, str] = {}
    for key, val in raw.items():
        k = str(key).strip()
        if allowed_names and k not in allowed_names:
            continue
        out[k] = str(val).strip() if val is not None else ""
    if not raw and spec:
        for p in spec:
            if not isinstance(p, dict):
                continue
            name = str(p.get("name") or "").strip()
            if name and name not in out:
                default = p.get("default")
                if default is not None:
                    out[name] = str(default)
    return out


def _request(
    method: str,
    path: str,
    *,
    params: Optional[dict] = None,
    data: Optional[dict] = None,
    timeout: float = 30,
    use_crumb: bool = False,
) -> requests.Response:
    base = _base_url()
    if not base:
        raise RuntimeError("Jenkins URL 未配置")
    url = f"{base}{path}" if path.startswith("/") else f"{base}/{path}"
    user, token = _auth()
    if not token:
        raise RuntimeError("JENKINS_API_TOKEN 未配置")
    headers: dict[str, str] = {}
    if use_crumb:
        crumb, field = _get_crumb()
        if crumb and field:
            headers[field] = crumb
    resp = _SESSION.request(
        method,
        url,
        params=params,
        data=data,
        auth=(user, token) if user else (token, ""),
        headers=headers,
        timeout=timeout,
        proxies=_proxies_for_url(url),
    )
    return resp


def _get_crumb() -> tuple[str, str]:
    cache_key = _base_url()
    if cache_key in _CRUMB_CACHE:
        return _CRUMB_CACHE[cache_key], "Jenkins-Crumb"
    try:
        r = _request("GET", "/crumbIssuer/api/json", timeout=10)
        if r.status_code == 404:
            return "", ""
        r.raise_for_status()
        data = r.json()
        crumb = str(data.get("crumb") or "")
        field = str(data.get("crumbRequestField") or "Jenkins-Crumb")
        if crumb:
            _CRUMB_CACHE[cache_key] = crumb
        return crumb, field
    except Exception as e:
        logger.debug("[jenkins] crumb: %s", e)
        return "", ""


def _build_api_url(job_name: str, build_number: int) -> str:
    base = _base_url()
    return f"{base}/{_job_path(job_name)}/{build_number}/"


def health_check() -> dict[str, Any]:
    j = get_jenkins_config()
    if not j.get("url"):
        return {"ok": False, "error": "未配置 JENKINS_URL 或 feishu_config.jenkins.url"}
    if not j.get("api_token"):
        return {"ok": False, "error": "未配置 JENKINS_API_TOKEN"}
    try:
        r = _request("GET", "/api/json", timeout=15)
        r.raise_for_status()
        data = r.json()
        crumb, _ = _get_crumb()
        return {
            "ok": True,
            "jenkins_version": data.get("version") or data.get("nodeDescription"),
            "csrf_enabled": bool(crumb),
            "url": _base_url(),
            "allowed_job_count": len(get_allowed_job_defs()),
        }
    except Exception as e:
        logger.warning("[jenkins] health failed: %s", e)
        return {"ok": False, "error": str(e)[:300]}


def _summarize_build(b: Optional[dict]) -> Optional[dict[str, Any]]:
    if not isinstance(b, dict) or not b.get("number"):
        return None
    return {
        "number": b.get("number"),
        "url": b.get("url"),
        "result": b.get("result"),
        "building": bool(b.get("building")),
        "timestamp": b.get("timestamp"),
        "duration": b.get("duration"),
    }


def get_job_info(job_name: str) -> dict[str, Any]:
    if not is_job_allowed(job_name):
        return {"ok": False, "error": f"Job 不在白名单: {job_name}"}
    path = f"/{_job_path(job_name)}/api/json"
    tree = "name,url,color,lastBuild,lastSuccessfulBuild,lastFailedBuild,inQueue"
    try:
        r = _request("GET", path, params={"tree": tree}, timeout=20)
        r.raise_for_status()
        data = r.json()
        jdef = get_job_def(job_name) or {}
        return {
            "ok": True,
            "name": data.get("name") or job_name,
            "label": jdef.get("label") or job_name,
            "url": data.get("url"),
            "color": data.get("color"),
            "in_queue": bool(data.get("inQueue")),
            "parameters": jdef.get("parameters") or [],
            "risk": jdef.get("risk") or "high",
            "last_build": _summarize_build(data.get("lastBuild")),
            "last_success": _summarize_build(data.get("lastSuccessfulBuild")),
            "last_failed": _summarize_build(data.get("lastFailedBuild")),
        }
    except Exception as e:
        return {"ok": False, "error": str(e)[:300]}


def list_whitelist_jobs() -> dict[str, Any]:
    if not get_jenkins_config().get("enabled"):
        return {
            "ok": False,
            "error": "Jenkins 未启用（需 url + token + enabled:true）",
            "jobs": [],
        }
    jobs_out: list[dict[str, Any]] = []
    for jdef in get_allowed_job_defs():
        name = str(jdef.get("name") or "")
        info = get_job_info(name)
        if info.get("ok"):
            jobs_out.append(info)
        else:
            jobs_out.append(
                {
                    "ok": False,
                    "name": name,
                    "label": jdef.get("label") or name,
                    "error": info.get("error"),
                    "parameters": jdef.get("parameters") or [],
                }
            )
    return {"ok": True, "jobs": jobs_out}


def list_builds(job_name: str, limit: int = 10) -> dict[str, Any]:
    if not is_job_allowed(job_name):
        return {"ok": False, "error": f"Job 不在白名单: {job_name}"}
    lim = max(1, min(int(limit or 10), 30))
    path = f"/{_job_path(job_name)}/api/json"
    tree = f"builds[number,url,result,building,timestamp,duration]{{{lim}}}"
    try:
        r = _request("GET", path, params={"tree": tree}, timeout=20)
        r.raise_for_status()
        builds = r.json().get("builds") or []
        items = [_summarize_build(b) for b in builds if isinstance(b, dict)]
        items = [x for x in items if x]
        return {"ok": True, "job_name": job_name, "builds": items}
    except Exception as e:
        return {"ok": False, "error": str(e)[:300]}


def get_build_status(
    job_name: str,
    build_number: Optional[int] = None,
) -> dict[str, Any]:
    if not is_job_allowed(job_name):
        return {"ok": False, "error": f"Job 不在白名单: {job_name}"}
    num = build_number
    if not num:
        info = get_job_info(job_name)
        if not info.get("ok"):
            return info
        lb = info.get("last_build")
        if not lb or not lb.get("number"):
            return {"ok": False, "error": "该 Job 尚无构建记录"}
        num = int(lb["number"])
    path = f"/{_job_path(job_name)}/{int(num)}/api/json"
    try:
        r = _request("GET", path, timeout=20)
        r.raise_for_status()
        data = r.json()
        return {
            "ok": True,
            "job_name": job_name,
            "number": data.get("number"),
            "url": data.get("url") or _build_api_url(job_name, int(num)),
            "result": data.get("result"),
            "building": bool(data.get("building")),
            "duration": data.get("duration"),
            "timestamp": data.get("timestamp"),
        }
    except Exception as e:
        return {"ok": False, "error": str(e)[:300]}


def get_console_text(
    job_name: str,
    build_number: int,
    *,
    max_chars: Optional[int] = None,
) -> dict[str, Any]:
    if not is_job_allowed(job_name):
        return {"ok": False, "error": f"Job 不在白名单: {job_name}"}
    j = get_jenkins_config()
    cap = max_chars or int(j.get("console_max_chars") or 8000)
    path = f"/{_job_path(job_name)}/{int(build_number)}/consoleText"
    try:
        r = _request("GET", path, timeout=60)
        r.raise_for_status()
        text = r.text or ""
        truncated = len(text) > cap
        if truncated:
            text = text[-cap:]
        return {
            "ok": True,
            "job_name": job_name,
            "build_number": int(build_number),
            "text": text,
            "truncated": truncated,
            "url": _build_api_url(job_name, int(build_number)),
        }
    except Exception as e:
        return {"ok": False, "error": str(e)[:300]}


def _poll_queue_for_build(queue_url: str, timeout_sec: float) -> Optional[int]:
    """从 queue item API 解析 build number。"""
    if not queue_url:
        return None
    if not queue_url.startswith("http"):
        queue_url = f"{_base_url()}{queue_url}"
    if not queue_url.endswith("/api/json"):
        queue_url = queue_url.rstrip("/") + "/api/json"
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        try:
            user, token = _auth()
            r = _SESSION.get(
                queue_url,
                auth=(user, token) if user else (token, ""),
                timeout=15,
                proxies=_proxies_for_url(queue_url),
            )
            if r.status_code == 404:
                return None
            r.raise_for_status()
            data = r.json()
            exe = data.get("executable")
            if isinstance(exe, dict) and exe.get("number"):
                return int(exe["number"])
            if data.get("cancelled"):
                return None
        except Exception as e:
            logger.debug("[jenkins] queue poll: %s", e)
        time.sleep(2)
    return None


def trigger_build(
    job_name: str,
    build_params: Optional[dict[str, Any]] = None,
    *,
    wait_for_start: bool = True,
) -> dict[str, Any]:
    if not get_jenkins_config().get("enabled"):
        return {"ok": False, "error": "Jenkins 未启用"}
    if not is_job_allowed(job_name):
        return {"ok": False, "error": f"Job 不在白名单: {job_name}"}

    params = _sanitize_build_params(job_name, build_params)
    jpath = _job_path(job_name)
    has_params = bool(params)

    try:
        if has_params:
            path = f"/{jpath}/buildWithParameters"
            r = _request(
                "POST",
                path,
                params=params,
                timeout=30,
                use_crumb=True,
            )
        else:
            path = f"/{jpath}/build"
            r = _request("POST", path, timeout=30, use_crumb=True)

        if r.status_code not in (200, 201):
            return {
                "ok": False,
                "error": f"触发失败 HTTP {r.status_code}: {(r.text or '')[:200]}",
            }

        queue_url = r.headers.get("Location", "")
        build_number: Optional[int] = None
        jcfg = get_jenkins_config()
        poll_timeout = float(jcfg.get("poll_timeout_sec") or 120)

        if wait_for_start and queue_url:
            build_number = _poll_queue_for_build(queue_url, min(poll_timeout, 45))

        result: dict[str, Any] = {
            "ok": True,
            "job_name": job_name,
            "build_number": build_number,
            "queue_url": queue_url,
            "parameters": params,
            "job_url": f"{_base_url()}/{jpath}/",
        }

        if build_number:
            status = get_build_status(job_name, build_number)
            result["url"] = status.get("url") or _build_api_url(job_name, build_number)
            result["building"] = status.get("building")
            result["result"] = status.get("result")
            if not status.get("building") and status.get("result"):
                console = get_console_text(job_name, build_number, max_chars=2500)
                if console.get("ok"):
                    result["console_tail"] = console.get("text", "")
        elif queue_url:
            result["message"] = "已入队，构建号尚未分配（可稍后查看 Job 页面）"
            result["url"] = result["job_url"]

        return result
    except Exception as e:
        logger.exception("[jenkins] trigger_build %s", job_name)
        return {"ok": False, "error": str(e)[:300]}


def format_trigger_result_for_chat(result: dict[str, Any]) -> str:
    if not result.get("ok"):
        return f"❌ Jenkins: {result.get('error', '失败')}"
    job = result.get("job_name", "")
    num = result.get("build_number")
    url = result.get("url") or result.get("job_url") or ""
    lines = [f"✅ Jenkins 已触发 `{job}`"]
    if num:
        lines.append(f"构建 #{num}")
    if result.get("result"):
        lines.append(f"结果: {result['result']}")
    elif result.get("building"):
        lines.append("状态: 构建中")
    elif result.get("message"):
        lines.append(str(result["message"]))
    if url:
        lines.append(f"链接: {url}")
    tail = result.get("console_tail")
    if tail:
        lines.append(f"\n```\n{str(tail)[-1500:]}\n```")
    return "\n".join(lines)[:4000]


def format_jobs_for_chat() -> str:
    r = list_whitelist_jobs()
    if not r.get("ok") and not r.get("jobs"):
        return f"❌ Jenkins: {r.get('error', '不可用')}"
    lines = ["📦 **Jenkins 白名单 Job**", ""]
    for job in r.get("jobs") or []:
        name = job.get("name") or "—"
        label = job.get("label") or name
        if not job.get("ok"):
            lines.append(f"• {label} (`{name}`) — ⚠️ {job.get('error', '无法读取')[:80]}")
            continue
        lb = job.get("last_build") or {}
        num = lb.get("number", "—")
        res = lb.get("result") or ("构建中" if lb.get("building") else "—")
        lines.append(f"• {label} (`{name}`) — 最近 #{num} {res}")
    lines.append("")
    lines.append(
        "部署：@机器人 `帮我把 main 部署一下`（自动）或 `运维部署 触发 deploy-agent-backend 分支 main`"
    )
    return "\n".join(lines)
