#!/usr/bin/env bash
# 验证本机 Jenkins 与 AI Media Agent 后端联调
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:8000}"
WEB_PROXY="${WEB_PROXY:-http://127.0.0.1:3000/api/feishu/ops/jenkins/health}"
JOB="${JENKINS_TEST_JOB:-deploy-agent-backend}"

pass() { printf "  \033[32m✓\033[0m %s\n" "$1"; }
fail() { printf "  \033[31m✗\033[0m %s\n" "$1"; FAILED=1; }

FAILED=0
echo "==> 1. Jenkins 进程 (8080)"
if curl -sf -m 3 -o /dev/null http://127.0.0.1:8080/login; then
  pass "Jenkins HTTP 可访问"
else
  fail "Jenkins 未响应，执行: brew services start jenkins-lts"
fi

echo "==> 2. backend/.env 与 feishu_config"
for k in JENKINS_URL JENKINS_USER JENKINS_API_TOKEN; do
  if grep -q "^${k}=" "$ROOT/backend/.env" 2>/dev/null; then
    pass ".env 含 $k"
  else
    fail ".env 缺少 $k，运行: ./venv/bin/python scripts/jenkins_local_finish.py"
  fi
done
if grep -q '"enabled": true' "$ROOT/storage/meal/feishu_config.json" 2>/dev/null \
  && grep -q "deploy-agent-backend" "$ROOT/storage/meal/feishu_config.json" 2>/dev/null; then
  pass "feishu_config jenkins 白名单已配置"
else
  fail "storage/meal/feishu_config.json 未配置 jenkins"
fi

echo "==> 3. Python jenkins_service（直连）"
"$ROOT/venv/bin/python" <<PY || FAILED=1
import os, sys
from pathlib import Path
sys.path.insert(0, str(Path("$ROOT") / "backend"))
env = Path("$ROOT/backend/.env").read_text(encoding="utf-8")
for line in env.splitlines():
    if line.startswith("JENKINS_") and "=" in line and not line.strip().startswith("#"):
        k, v = line.split("=", 1)
        os.environ[k.strip()] = v.strip()
from services.jenkins_service import health_check, list_whitelist_jobs, is_job_allowed
h = health_check()
assert h.get("ok"), h
jobs = list_whitelist_jobs()
assert jobs.get("ok") and jobs.get("jobs"), jobs
assert is_job_allowed("$JOB")
print("health ok, jobs:", len(jobs["jobs"]))
PY
if [[ $? -eq 0 ]]; then pass "jenkins_service 直连 OK"; else fail "jenkins_service 直连失败"; fi

echo "==> 4. FastAPI $BACKEND_URL/feishu/ops/jenkins/*"
HEALTH=$(curl -sf -m 5 "$BACKEND_URL/feishu/ops/jenkins/health" 2>/dev/null || echo '{"ok":false}')
if echo "$HEALTH" | "$ROOT/venv/bin/python" -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if d.get('ok') else 1)" 2>/dev/null; then
  pass "GET /feishu/ops/jenkins/health"
else
  fail "后端 Jenkins health 失败（若刚改 .env，请重启后端: ./start_local.sh）"
  echo "       响应: $HEALTH"
fi

JOBS=$(curl -sf -m 5 "$BACKEND_URL/feishu/ops/jenkins/jobs" 2>/dev/null || echo '{"ok":false}')
if echo "$JOBS" | "$ROOT/venv/bin/python" -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if d.get('ok') and d.get('jobs') else 1)" 2>/dev/null; then
  pass "GET /feishu/ops/jenkins/jobs"
else
  fail "GET /feishu/ops/jenkins/jobs"
fi

echo "==> 5. Next.js 代理 $WEB_PROXY"
PROXY=$(curl -sf -m 5 "$WEB_PROXY" 2>/dev/null || echo '{"ok":false}')
if echo "$PROXY" | "$ROOT/venv/bin/python" -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if d.get('ok') else 1)" 2>/dev/null; then
  pass "前端 API 代理 health"
else
  fail "前端代理失败（确认 Next :3000 与后端 :8000 均已启动）"
fi

echo ""
if [[ "$FAILED" -eq 0 ]]; then
  echo "全部通过。打开 http://localhost:3000 → 飞书工作台 → 运维 → 发布流水线"
  exit 0
fi
echo "存在失败项，请按提示处理。"
exit 1
