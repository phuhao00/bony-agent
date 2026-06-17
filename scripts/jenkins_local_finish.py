#!/usr/bin/env python3
"""完成本地 Jenkins 联调：Token/Job/.env/feishu_config（在 brew 已安装且 Jenkins 已启动后执行）"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
JENKINS_URL = os.getenv("JENKINS_URL", "http://127.0.0.1:8080").rstrip("/")
JENKINS_USER = os.getenv("JENKINS_USER", "admin")
JOB_NAME = os.getenv("JENKINS_TEST_JOB", "deploy-agent-backend")
ENV_FILE = ROOT / "backend" / ".env"
FEISHU_CFG = ROOT / "storage" / "meal" / "feishu_config.json"
CREDS_FILE = ROOT / "storage" / "jenkins" / "local_credentials.json"

JOB_XML = """<?xml version='1.1' encoding='UTF-8'?>
<project>
  <description>AI Media Agent 本地联调</description>
  <properties>
    <hudson.model.ParametersDefinitionProperty>
      <parameterDefinitions>
        <hudson.model.StringParameterDefinition>
          <name>BRANCH</name>
          <defaultValue>main</defaultValue>
        </hudson.model.StringParameterDefinition>
      </parameterDefinitions>
    </hudson.model.ParametersDefinitionProperty>
  </properties>
  <builders>
    <hudson.tasks.Shell>
      <command>echo "BRANCH=$BRANCH" &amp;&amp; date &amp;&amp; sleep 2 &amp;&amp; echo BUILD_OK</command>
    </hudson.tasks.Shell>
  </builders>
</project>"""


def _local_proxies() -> dict[str, None]:
    return {"http": None, "https": None}


def _password() -> str:
    init = Path.home() / ".jenkins" / "secrets" / "initialAdminPassword"
    if init.is_file():
        return init.read_text(encoding="utf-8").strip()
    return os.getenv("JENKINS_PASS", "admin")


def _session(password: str) -> requests.Session:
    s = requests.Session()
    s.trust_env = False
    s.auth = (JENKINS_USER, password)
    s.proxies = _local_proxies()
    return s


def _crumb_headers(session: requests.Session) -> dict[str, str]:
    r = session.get(f"{JENKINS_URL}/crumbIssuer/api/json", timeout=15)
    if r.status_code != 200:
        return {}
    d = r.json()
    field = d.get("crumbRequestField") or "Jenkins-Crumb"
    val = d.get("crumb") or ""
    return {field: val} if val else {}


def generate_token(session: requests.Session) -> str:
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    headers.update(_crumb_headers(session))
    r = session.post(
        f"{JENKINS_URL}/user/{JENKINS_USER}/descriptorByName/jenkins.security.ApiTokenProperty/generateNewToken",
        headers=headers,
        data={"json": json.dumps({"tokenName": "ai-media-agent-ops"})},
        timeout=30,
    )
    if r.status_code == 200:
        token = (r.json().get("data") or {}).get("tokenValue")
        if token:
            return token
    # 本地开发可暂用初始密码作为 API 凭证（Jenkins Basic Auth 支持）
    return session.auth[1]  # type: ignore[index]


def ensure_job(session: requests.Session) -> None:
    r = session.get(f"{JENKINS_URL}/job/{JOB_NAME}/api/json", timeout=15)
    if r.status_code == 200:
        print(f"Job 已存在: {JOB_NAME}")
        return
    headers = {"Content-Type": "application/xml", **_crumb_headers(session)}
    r = session.post(
        f"{JENKINS_URL}/createItem?name={JOB_NAME}",
        headers=headers,
        data=JOB_XML.encode("utf-8"),
        timeout=30,
    )
    if r.status_code not in (200, 201):
        print(f"创建 Job 警告: HTTP {r.status_code} {r.text[:200]}", file=sys.stderr)
    else:
        print(f"已创建 Job: {JOB_NAME}")


def patch_env(token: str) -> None:
    lines: list[str] = []
    if ENV_FILE.is_file():
        lines = ENV_FILE.read_text(encoding="utf-8").splitlines()
    keys = {"JENKINS_URL", "JENKINS_USER", "JENKINS_API_TOKEN"}
    lines = [ln for ln in lines if not any(ln.startswith(f"{k}=") for k in keys)]
    lines.extend(
        [
            "",
            "# Jenkins 本地联调（scripts/jenkins_local_finish.py）",
            f"JENKINS_URL={JENKINS_URL}",
            f"JENKINS_USER={JENKINS_USER}",
            f"JENKINS_API_TOKEN={token}",
        ]
    )
    ENV_FILE.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    print(f"已更新 {ENV_FILE}")


def patch_feishu_config() -> None:
    data: dict = {}
    if FEISHU_CFG.is_file():
        try:
            data = json.loads(FEISHU_CFG.read_text(encoding="utf-8"))
        except Exception:
            pass
    data.setdefault("jenkins", {})
    data["jenkins"].update(
        {
            "enabled": True,
            "url": JENKINS_URL,
            "username": JENKINS_USER,
            "allowed_jobs": [
                {
                    "name": JOB_NAME,
                    "label": "本地联调 · Agent 后端",
                    "risk": "high",
                    "parameters": [
                        {
                            "name": "BRANCH",
                            "default": "main",
                            "choices": ["main", "hh/super-agent"],
                        }
                    ],
                }
            ],
            "poll_timeout_sec": 120,
            "console_max_chars": 8000,
        }
    )
    FEISHU_CFG.parent.mkdir(parents=True, exist_ok=True)
    FEISHU_CFG.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已更新 {FEISHU_CFG}")


def verify_with_backend(token: str) -> None:
    os.environ["JENKINS_URL"] = JENKINS_URL
    os.environ["JENKINS_USER"] = JENKINS_USER
    os.environ["JENKINS_API_TOKEN"] = token
    sys.path.insert(0, str(ROOT / "backend"))
    from services.jenkins_service import health_check, is_job_allowed, trigger_build

    h = health_check()
    print("health_check:", h)
    if not h.get("ok"):
        sys.exit(1)
    assert is_job_allowed(JOB_NAME)
    r = trigger_build(JOB_NAME, {"BRANCH": "main"}, wait_for_start=True)
    print("trigger_build:", {k: r.get(k) for k in ("ok", "build_number", "result", "url", "error")})
    if not r.get("ok"):
        sys.exit(1)


def main() -> None:
    pwd = _password()
    session = _session(pwd)
    r = session.get(f"{JENKINS_URL}/api/json", timeout=15)
    if r.status_code != 200:
        print(f"Jenkins 不可达或认证失败: HTTP {r.status_code}", file=sys.stderr)
        print("请确认: brew services start jenkins-lts", file=sys.stderr)
        sys.exit(1)
    print("Jenkins API 正常")

    token = generate_token(session)
    CREDS_FILE.parent.mkdir(parents=True, exist_ok=True)
    CREDS_FILE.write_text(
        json.dumps(
            {
                "url": JENKINS_URL,
                "user": JENKINS_USER,
                "api_token": token,
                "note": "本地 Jenkins；若使用初始密码，建议在 UI 中改为固定密码并重新生成 Token",
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"凭证已写入 {CREDS_FILE}")

    ensure_job(session)
    patch_env(token)
    patch_feishu_config()
    verify_with_backend(token)
    print("\n完成。请重启后端，打开 飞书工作台 → 运维 → 发布流水线")
    print(f"  Jenkins UI: {JENKINS_URL}  用户 {JENKINS_USER}")
    init = Path.home() / ".jenkins" / "secrets" / "initialAdminPassword"
    if init.is_file():
        print(f"  当前密码见: {init} （首次安装）")


if __name__ == "__main__":
    main()
