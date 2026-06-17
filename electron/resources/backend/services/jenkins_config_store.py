"""Jenkins 白名单流水线配置（读写 feishu_config.json，供 Web 配置页）"""
from __future__ import annotations

import re
from typing import Any, Optional

from services.jenkins_service import get_jenkins_config, health_check
from services.meal_feishu_config import _DEFAULT, load_config, save_config

_JOB_NAME_RE = re.compile(r"^[\w][\w./-]*$")
_PARAM_NAME_RE = re.compile(r"^[\w][\w-]*$")


def _normalize_param(row: Any) -> Optional[dict[str, Any]]:
    if not isinstance(row, dict):
        return None
    name = str(row.get("name") or "").strip()
    if not name or not _PARAM_NAME_RE.match(name):
        return None
    out: dict[str, Any] = {"name": name}
    if row.get("default") is not None and str(row.get("default")).strip():
        out["default"] = str(row.get("default")).strip()
    choices = row.get("choices")
    if isinstance(choices, str):
        choices = [c.strip() for c in choices.split(",") if c.strip()]
    if isinstance(choices, list):
        clean = [str(c).strip() for c in choices if str(c).strip()]
        if clean:
            out["choices"] = clean
    return out


def normalize_allowed_jobs(raw: Any) -> tuple[list[dict[str, Any]], Optional[str]]:
    if not isinstance(raw, list):
        return [], "allowed_jobs 须为数组"
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for i, row in enumerate(raw):
        if isinstance(row, str):
            name = row.strip()
            if not name:
                continue
            if name in seen:
                return [], f"重复的 Job 名: {name}"
            if not _JOB_NAME_RE.match(name):
                return [], f"Job 名不合法: {name}"
            seen.add(name)
            out.append({"name": name, "label": name, "risk": "high", "parameters": []})
            continue
        if not isinstance(row, dict):
            return [], f"第 {i + 1} 项格式无效"
        name = str(row.get("name") or "").strip()
        if not name:
            return [], f"第 {i + 1} 项缺少 name"
        if name in seen:
            return [], f"重复的 Job 名: {name}"
        if not _JOB_NAME_RE.match(name):
            return [], f"Job 名不合法: {name}（仅字母数字、_、-、/、.）"
        seen.add(name)
        label = str(row.get("label") or name).strip() or name
        risk = str(row.get("risk") or "high").strip().lower()
        if risk not in ("low", "medium", "high"):
            risk = "high"
        params_in = row.get("parameters") if isinstance(row.get("parameters"), list) else []
        params: list[dict[str, Any]] = []
        pseen: set[str] = set()
        for p in params_in:
            norm = _normalize_param(p)
            if not norm:
                continue
            if norm["name"] in pseen:
                return [], f"Job `{name}` 参数名重复: {norm['name']}"
            pseen.add(norm["name"])
            params.append(norm)
        out.append(
            {
                "name": name,
                "label": label,
                "risk": risk,
                "parameters": params,
            }
        )
    return out, None


def get_jenkins_settings_for_ui() -> dict[str, Any]:
    cfg = load_config()
    j = get_jenkins_config()
    eff = health_check() if j.get("enabled") else {"ok": False}
    jcfg = cfg.get("jenkins") if isinstance(cfg.get("jenkins"), dict) else {}
    admins = cfg.get("ops_admin_open_ids") or []
    if isinstance(admins, str):
        admins = [a.strip() for a in admins.split(",") if a.strip()]
    return {
        "ok": True,
        "config_path": "storage/meal/feishu_config.json",
        "env_hints": {
            "jenkins_url": "JENKINS_URL",
            "jenkins_user": "JENKINS_USER",
            "jenkins_token": "JENKINS_API_TOKEN",
        },
        "jenkins": {
            "enabled": bool(jcfg.get("enabled")),
            "url": str(jcfg.get("url") or "").strip(),
            "url_effective": str(j.get("url") or ""),
            "username": str(jcfg.get("username") or "").strip(),
            "username_effective": str(j.get("username") or ""),
            "token_configured": bool(j.get("api_token")),
            "allowed_jobs": jcfg.get("allowed_jobs") if isinstance(jcfg.get("allowed_jobs"), list) else [],
            "poll_timeout_sec": int(jcfg.get("poll_timeout_sec") or 120),
            "console_max_chars": int(jcfg.get("console_max_chars") or 8000),
            "health_ok": bool(eff.get("ok")),
            "health_error": (eff.get("error") or "")[:200] if not eff.get("ok") else "",
        },
        "ops_auto_jenkins_build": bool(cfg.get("ops_auto_jenkins_build", True)),
        "ops_auto_jenkins_require_admin": bool(
            cfg.get("ops_auto_jenkins_require_admin", True)
        ),
        "ops_auto_jenkins_min_confidence": float(
            cfg.get("ops_auto_jenkins_min_confidence") or 0.65
        ),
        "ops_auto_jenkins_context_hours": float(
            cfg.get("ops_auto_jenkins_context_hours") or 1.0
        ),
        "ops_auto_jenkins_cooldown_sec": int(
            cfg.get("ops_auto_jenkins_cooldown_sec") or 90
        ),
        "ops_admin_open_ids": list(admins),
    }


def update_jenkins_settings(body: dict[str, Any]) -> dict[str, Any]:
    patch: dict[str, Any] = {}
    j_in = body.get("jenkins") if isinstance(body.get("jenkins"), dict) else {}

    if j_in:
        jobs, err = normalize_allowed_jobs(j_in.get("allowed_jobs"))
        if err:
            return {"ok": False, "error": err}
        j_patch: dict[str, Any] = {}
        if "enabled" in j_in:
            j_patch["enabled"] = bool(j_in["enabled"])
        for k in ("url", "username"):
            if k in j_in and j_in[k] is not None:
                j_patch[k] = str(j_in[k]).strip()
        if "allowed_jobs" in j_in:
            j_patch["allowed_jobs"] = jobs
        for k in ("poll_timeout_sec", "console_max_chars"):
            if k in j_in and j_in[k] is not None:
                try:
                    j_patch[k] = int(j_in[k])
                except (TypeError, ValueError):
                    return {"ok": False, "error": f"{k} 须为整数"}
        if j_patch:
            cur = load_config()
            cur_j = cur.get("jenkins") if isinstance(cur.get("jenkins"), dict) else {}
            patch["jenkins"] = {**_DEFAULT.get("jenkins", {}), **cur_j, **j_patch}

    for k in (
        "ops_auto_jenkins_build",
        "ops_auto_jenkins_require_admin",
    ):
        if k in body and body[k] is not None:
            patch[k] = bool(body[k])
    for k in ("ops_auto_jenkins_min_confidence", "ops_auto_jenkins_context_hours"):
        if k in body and body[k] is not None:
            try:
                patch[k] = float(body[k])
            except (TypeError, ValueError):
                return {"ok": False, "error": f"{k} 须为数字"}
    if "ops_auto_jenkins_cooldown_sec" in body and body["ops_auto_jenkins_cooldown_sec"] is not None:
        try:
            patch["ops_auto_jenkins_cooldown_sec"] = int(body["ops_auto_jenkins_cooldown_sec"])
        except (TypeError, ValueError):
            return {"ok": False, "error": "ops_auto_jenkins_cooldown_sec 须为整数"}
    if "ops_admin_open_ids" in body:
        raw = body["ops_admin_open_ids"]
        if isinstance(raw, list):
            patch["ops_admin_open_ids"] = [str(x).strip() for x in raw if str(x).strip()]
        elif isinstance(raw, str):
            patch["ops_admin_open_ids"] = [
                x.strip() for x in raw.replace("\n", ",").split(",") if x.strip()
            ]

    if not patch:
        return {"ok": False, "error": "无有效配置项"}

    save_config(patch)
    out = get_jenkins_settings_for_ui()
    out["ok"] = True
    out["message"] = "配置已保存，发布流水线将使用最新白名单"
    return out
