#!/usr/bin/env bash
# 本地 Jenkins（Homebrew jenkins-lts）安装 + 初始化 + 与 AI Media Agent 联调配置
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JENKINS_USER="${JENKINS_USER:-admin}"
JENKINS_PASS="${JENKINS_PASS:-admin}"
JENKINS_URL="${JENKINS_URL:-http://127.0.0.1:8080}"
JOB_NAME="${JENKINS_TEST_JOB:-deploy-agent-backend}"
ENV_FILE="$ROOT/backend/.env"
FEISHU_CFG="$ROOT/storage/meal/feishu_config.json"
CREDS_FILE="$ROOT/storage/jenkins/local_credentials.json"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "此脚本当前仅适配 macOS + Homebrew。Linux 请自行安装 Jenkins 后参考 docs/JENKINS_OPS.md 配置。"
  exit 1
fi

if ! command -v brew >/dev/null 2>&1; then
  echo "请先安装 Homebrew: https://brew.sh"
  exit 1
fi

# Homebrew 默认使用 ~/.jenkins（launchd 未设置 JENKINS_HOME 时）
if [[ -f "$HOME/.jenkins/config.xml" ]]; then
  JENKINS_HOME="$HOME/.jenkins"
elif [[ -d /opt/homebrew/var/jenkins/home ]]; then
  JENKINS_HOME="/opt/homebrew/var/jenkins/home"
else
  JENKINS_HOME="$HOME/.jenkins"
fi
echo "    JENKINS_HOME=$JENKINS_HOME"

echo "==> 安装 jenkins-lts（若已安装则跳过）"
brew list jenkins-lts >/dev/null 2>&1 || brew install jenkins-lts

mkdir -p "$JENKINS_HOME/init.groovy.d"
cat > "$JENKINS_HOME/init.groovy.d/01-skip-wizard.groovy" <<'GROOVY'
import jenkins.model.Jenkins
import jenkins.install.InstallState

if (!Jenkins.instance.installState.isSetupComplete()) {
  InstallState.INITIAL_SETUP_COMPLETED.initializeState()
}
GROOVY

cat > "$JENKINS_HOME/init.groovy.d/02-admin-user.groovy" <<GROOVY
import jenkins.model.*
import hudson.security.*

def instance = Jenkins.getInstance()
if (instance.getSecurityRealm() == null || instance.getSecurityRealm().getClass().name.contains('Legacy')) {
  def realm = new HudsonPrivateSecurityRealm(false)
  if (realm.getUser("${JENKINS_USER}") == null) {
    realm.createAccount("${JENKINS_USER}", "${JENKINS_PASS}")
  }
  instance.setSecurityRealm(realm)
  def strategy = new FullControlOnceLoggedInAuthorizationStrategy()
  strategy.setAllowAnonymousRead(false)
  instance.setAuthorizationStrategy(strategy)
  instance.save()
  println "Jenkins admin user ensured: ${JENKINS_USER}"
}
GROOVY

echo "==> 启动 Jenkins 服务"
brew services start jenkins-lts 2>/dev/null || true

echo "==> 等待 Jenkins 就绪 ($JENKINS_URL)"
for i in $(seq 1 90); do
  if curl -sf -o /dev/null -m 2 "$JENKINS_URL/login" 2>/dev/null; then
    echo "    Jenkins 已响应 (${i}s)"
    break
  fi
  if [[ "$i" -eq 90 ]]; then
    echo "超时：Jenkins 未在 8080 启动。请执行: brew services list | grep jenkins"
    exit 1
  fi
  sleep 2
done

# 额外等待 Groovy 初始化脚本执行
sleep 5

echo "==> 配置项目并联调（Token / Job / .env）"
exec "$ROOT/venv/bin/python" "$ROOT/scripts/jenkins_local_finish.py"
exit 0

# --- 以下保留作参考，由 jenkins_local_finish.py 执行 ---
echo "==> 生成 API Token"
mkdir -p "$ROOT/storage/jenkins"
export JENKINS_URL JENKINS_USER JENKINS_PASS CREDS_FILE
"$ROOT/venv/bin/python" <<'PY'
import json
import os
import sys
import requests

url = os.environ.get("JENKINS_URL", "http://127.0.0.1:8080").rstrip("/")
user = os.environ.get("JENKINS_USER", "admin")
password = os.environ.get("JENKINS_PASS", "admin")
creds_path = os.environ["CREDS_FILE"]

session = requests.Session()
session.auth = (user, password)

crumb_field, crumb_val = "", ""
try:
    r = session.get(f"{url}/crumbIssuer/api/json", timeout=10)
    if r.status_code == 200:
        d = r.json()
        crumb_field = d.get("crumbRequestField") or "Jenkins-Crumb"
        crumb_val = d.get("crumb") or ""
except Exception:
    pass

headers = {"Content-Type": "application/x-www-form-urlencoded"}
if crumb_val:
    headers[crumb_field] = crumb_val

r = session.post(
    f"{url}/user/{user}/descriptorByName/jenkins.security.ApiTokenProperty/generateNewToken",
    headers=headers,
    data={"json": json.dumps({"tokenName": "ai-media-agent-ops"})},
    timeout=30,
)
if r.status_code != 200:
    print("生成 Token 失败:", r.status_code, r.text[:300], file=sys.stderr)
    sys.exit(1)

data = r.json()
token = (data.get("data") or {}).get("tokenValue")
if not token:
    print("响应中无 tokenValue:", data, file=sys.stderr)
    sys.exit(1)

os.makedirs(os.path.dirname(creds_path), exist_ok=True)
with open(creds_path, "w", encoding="utf-8") as f:
    json.dump({
        "url": url,
        "user": user,
        "api_token": token,
        "note": "本地 Homebrew Jenkins，由 scripts/setup_local_jenkins.sh 生成",
    }, f, indent=2)
print("已写入", creds_path)
PY

TOKEN=$("$ROOT/venv/bin/python" -c "import json; print(json.load(open('$CREDS_FILE'))['api_token'])")

echo "==> 创建测试 Job: $JOB_NAME"
CRUMB_JSON=$(curl -sf -u "$JENKINS_USER:$TOKEN" "$JENKINS_URL/crumbIssuer/api/json" 2>/dev/null || echo "{}")
CRUMB=$(echo "$CRUMB_JSON" | "$ROOT/venv/bin/python" -c "import sys,json; d=json.load(sys.stdin); print(d.get('crumb',''))" 2>/dev/null || true)
CRUMB_FIELD=$(echo "$CRUMB_JSON" | "$ROOT/venv/bin/python" -c "import sys,json; d=json.load(sys.stdin); print(d.get('crumbRequestField','Jenkins-Crumb'))" 2>/dev/null || echo "Jenkins-Crumb")

JOB_XML='<?xml version="1.1" encoding="UTF-8"?>
<project>
  <description>AI Media Agent 本地联调测试 Job</description>
  <keepDependencies>false</keepDependencies>
  <properties>
    <hudson.model.ParametersDefinitionProperty>
      <parameterDefinitions>
        <hudson.model.StringParameterDefinition>
          <name>BRANCH</name>
          <description>Git branch</description>
          <defaultValue>main</defaultValue>
          <trim>false</trim>
        </hudson.model.StringParameterDefinition>
      </parameterDefinitions>
    </hudson.model.ParametersDefinitionProperty>
  </properties>
  <scm class="hudson.scm.NullSCM"/>
  <canRoam>true</canRoam>
  <disabled>false</disabled>
  <blockBuildWhenDownstreamBuilding>false</blockBuildWhenDownstreamBuilding>
  <blockBuildWhenUpstreamBuilding>false</blockBuildWhenUpstreamBuilding>
  <triggers/>
  <concurrentBuild>false</concurrentBuild>
  <builders>
    <hudson.tasks.Shell>
      <command>echo "AI Media Agent Jenkins test" &amp;&amp; echo "BRANCH=${BRANCH}" &amp;&amp; date &amp;&amp; sleep 3 &amp;&amp; echo "BUILD OK"</command>
    </hudson.tasks.Shell>
  </builders>
  <publishers/>
  <buildWrappers/>
</project>'

ENCODED=$(printf '%s' "$JOB_XML" | python3 -c "import sys,urllib.parse; print(urllib.parse.quote(sys.stdin.read()))")
CREATE_URL="$JENKINS_URL/createItem?name=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$JOB_NAME'))")"
if [[ -n "$CRUMB" ]]; then
  curl -sf -u "$JENKINS_USER:$TOKEN" -H "$CRUMB_FIELD: $CRUMB" -X POST "$CREATE_URL" --data-urlencode "mode=hudson.model.FreeStyleProject" --data-urlencode "name=$JOB_NAME" --data-urlencode "from=$JOB_XML" >/dev/null 2>&1 \
    || curl -sf -u "$JENKINS_USER:$TOKEN" -H "$CRUMB_FIELD: $CRUMB" -X POST "$CREATE_URL" -H "Content-Type: application/xml" -d "$JOB_XML" >/dev/null 2>&1 \
    || echo "    （Job 可能已存在，跳过创建）"
else
  curl -sf -u "$JENKINS_USER:$TOKEN" -X POST "$CREATE_URL" -H "Content-Type: application/xml" -d "$JOB_XML" >/dev/null 2>&1 \
    || echo "    （Job 可能已存在，跳过创建）"
fi

echo "==> 写入 backend/.env"
touch "$ENV_FILE"
for key in JENKINS_URL JENKINS_USER JENKINS_API_TOKEN; do
  sed -i '' "/^${key}=/d" "$ENV_FILE" 2>/dev/null || sed -i "/^${key}=/d" "$ENV_FILE"
done
{
  echo ""
  echo "# Jenkins 本地联调（scripts/setup_local_jenkins.sh）"
  echo "JENKINS_URL=$JENKINS_URL"
  echo "JENKINS_USER=$JENKINS_USER"
  echo "JENKINS_API_TOKEN=$TOKEN"
} >> "$ENV_FILE"

echo "==> 更新 storage/meal/feishu_config.json"
mkdir -p "$(dirname "$FEISHU_CFG")"
"$ROOT/venv/bin/python" <<PY
import json
from pathlib import Path

path = Path("$FEISHU_CFG")
data = {}
if path.is_file():
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        pass

data.setdefault("jenkins", {})
data["jenkins"].update({
    "enabled": True,
    "url": "$JENKINS_URL",
    "username": "$JENKINS_USER",
    "allowed_jobs": [
        {
            "name": "$JOB_NAME",
            "label": "本地联调 · Agent 后端",
            "risk": "high",
            "parameters": [
                {"name": "BRANCH", "default": "main", "choices": ["main", "hh/super-agent"]}
            ],
        }
    ],
    "poll_timeout_sec": 120,
    "console_max_chars": 8000,
})
path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
print("已更新", path)
PY

echo "==> 联调：触发一次测试构建"
"$ROOT/venv/bin/python" <<PY
import os, sys
sys.path.insert(0, "$ROOT/backend")
from services.jenkins_service import health_check, trigger_build, is_job_allowed

os.environ.setdefault("JENKINS_URL", "$JENKINS_URL")
os.environ.setdefault("JENKINS_USER", "$JENKINS_USER")
os.environ.setdefault("JENKINS_API_TOKEN", "$TOKEN")

h = health_check()
print("health:", h)
assert h.get("ok"), h
assert is_job_allowed("$JOB_NAME")
r = trigger_build("$JOB_NAME", {"BRANCH": "main"}, wait_for_start=True)
print("trigger:", {k: r.get(k) for k in ("ok", "job_name", "build_number", "result", "url", "error")})
assert r.get("ok"), r
PY

echo ""
echo "完成。"
echo "  Jenkins UI:  $JENKINS_URL  用户 $JENKINS_USER / 密码 $JENKINS_PASS"
echo "  Token 文件:  $CREDS_FILE"
echo "  请重启后端后打开: 飞书工作台 → 运维 → 发布流水线"
echo "  手动验证: cd backend && ../venv/bin/python -c \"from services.jenkins_service import health_check; print(health_check())\""
