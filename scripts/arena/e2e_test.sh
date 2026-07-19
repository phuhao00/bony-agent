#!/usr/bin/env bash
# =============================================================================
# Arena 沙箱 · 内容生成全链路无 Key 干跑测试
#
# 链路: 主题 → LLM(桩)旁白 → LLM(桩)检索词 → edge-tts 真实配音
#       → 本地合成素材(synthetic) → ffmpeg 拼接 → 混音 → CJK 字幕烧录 → MP4
#
# 先决条件: 已运行 scripts/arena/setup_arena.sh（或已有可用 venv）
# 用法:     bash scripts/arena/e2e_test.sh
# 可选:     SUBJECT="你的主题" PORT=8000 STUB_PORT=8765 bash scripts/arena/e2e_test.sh
# =============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VENV_DIR="${VENV_DIR:-$ROOT/arena-venv}"
PY="${PY:-$VENV_DIR/bin/python}"
PORT="${PORT:-8000}"
STUB_PORT="${STUB_PORT:-8765}"
SUBJECT="${SUBJECT:-AI 全自动短视频生成平台实测}"

export AUTH_REQUIRED=false
export LLM_PROVIDER=ollama
export OLLAMA_BASE_URL="http://127.0.0.1:${STUB_PORT}/v1"
export OLLAMA_MODEL="arena-stub"
export CLOUDFLARE_TUNNEL_ENABLED=false

STUB_PID=""; UV_PID=""
cleanup() { [ -n "$UV_PID" ] && kill "$UV_PID" 2>/dev/null; [ -n "$STUB_PID" ] && kill "$STUB_PID" 2>/dev/null; return 0; }
trap cleanup EXIT

C_G="\033[32m"; C_Y="\033[33m"; C_R="\033[31m"; C_0="\033[0m"

echo "== [1/4] 启动本地 LLM 桩 (:$STUB_PORT) =="
"$PY" "$ROOT/scripts/arena/llm_stub.py" "$STUB_PORT" & STUB_PID=$!
sleep 1

echo "== [2/4] 启动 FastAPI 后端 (:$PORT) =="
(cd "$ROOT/backend" && "$PY" -m uvicorn main:app --host 127.0.0.1 --port "$PORT" --log-level warning) &
UV_PID=$!

READY=0
for _ in $(seq 1 90); do
  curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1 && { READY=1; break; }
  sleep 1
done
[ "$READY" -eq 0 ] && { echo -e "${C_R}后端 90s 内未就绪${C_0}"; exit 1; }
echo -e "  /health -> $(curl -s http://127.0.0.1:${PORT}/health)"

echo "== [3/4] 提交一键短视频任务: 「$SUBJECT」 =="
RESP=$(curl -s -X POST "http://127.0.0.1:${PORT}/tools/video/auto" \
  -H 'Content-Type: application/json' \
  -d "{\"subject\":\"$SUBJECT\",\"bgm\":\"none\",\"material_source\":\"pexels\"}")
TASK=$(printf '%s' "$RESP" | "$PY" -c 'import sys,json;print(json.load(sys.stdin)["task_id"])')
echo "  task_id = $TASK"

LAST=""
FINAL=""
for i in $(seq 1 180); do
  S=$(curl -s "http://127.0.0.1:${PORT}/tools/video/auto/$TASK")
  LINE=$(printf '%s' "$S" | "$PY" -c 'import sys,json;d=json.load(sys.stdin);print(d.get("progress"),"|",d.get("status"),"|",d.get("message"))' 2>/dev/null)
  [ "$LINE" != "$LAST" ] && { echo "  [$((i*2))s] $LINE"; LAST="$LINE"; }
  ST=$(printf '%s' "$LINE" | awk -F'|' '{gsub(/ /,"");print $2}')
  if [ "$ST" = "completed" ] || [ "$ST" = "failed" ]; then FINAL="$S"; break; fi
  sleep 2
done

echo "== [4/4] 结果 =="
printf '%s' "$FINAL" | "$PY" -c '
import sys, json
d = json.load(sys.stdin)
r = d.get("result") or {}
print("  状态:      ", d.get("status"))
print("  说明:      ", d.get("message"))
print("  时长(秒):  ", r.get("duration_sec"))
print("  素材模式:  ", r.get("material_mode"))
print("  成片:      ", r.get("video_path"))
print("  旁白:      ", (r.get("script") or "")[:60] + "…")
print("  检索词:    ", r.get("search_terms"))
'
ST=$(printf '%s' "$FINAL" | "$PY" -c 'import sys,json;print(json.load(sys.stdin).get("status",""))')
VP=$(printf '%s' "$FINAL" | "$PY" -c 'import sys,json;print(json.load(sys.stdin).get("result",{}).get("video_path",""))')

if [ "$ST" = "completed" ] && [ -n "$VP" ] && [ -f "$VP" ]; then
  # 用 main.py 自举安装的 ffprobe 垫片验证成片
  FFP="$ROOT/storage/bin/ffprobe"; [ -x "$FFP" ] || FFP="ffprobe"
  echo "  ffprobe:   $($FFP -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$VP" 2>/dev/null)s"
  echo -e "${C_G}✓ 全链路干跑通过${C_0}"
  exit 0
fi
echo -e "${C_R}✗ 全链路干跑失败${C_0}"
exit 1
