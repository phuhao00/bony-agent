#!/usr/bin/env bash
# =============================================================================
# Arena Agent 沙箱 · bony-agent 一键环境搭建脚本
#
# 在精简容器/AI Agent 沙箱中完成后端可用环境搭建：
#   1. 创建 Python venv 并安装 backend/requirements.txt
#   2. 输出环境体检报告（哪些能力可用/哪些被沙箱限制）
#   3. 冒烟导入 backend/main.py —— main.py 会自举安装
#      ffmpeg(imageio-ffmpeg) 与 ffprobe(兼容垫片) 到 storage/bin
#
# 用法:  bash scripts/arena/setup_arena.sh
# 可选环境变量:  VENV_DIR (默认 <repo>/arena-venv)
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VENV_DIR="${VENV_DIR:-$ROOT/arena-venv}"
C_G="\033[32m"; C_Y="\033[33m"; C_R="\033[31m"; C_C="\033[36m"; C_0="\033[0m"
ok()   { printf "${C_G}✓${C_0} %s\n" "$*"; }
warn() { printf "${C_Y}⚠${C_0} %s\n" "$*"; }
bad()  { printf "${C_R}✗${C_0} %s\n" "$*"; }
info() { printf "${C_C}➜${C_0} %s\n" "$*"; }

echo "──────────────────────────────────────────────"
info "bony-agent · Arena 沙箱环境搭建"
echo "仓库根目录: $ROOT"
echo "Python venv: $VENV_DIR"
echo "──────────────────────────────────────────────"

# ── 1. Python 版本检查 ───────────────────────────────────────────────────────
PYBIN="$(command -v python3 || true)"
[ -z "$PYBIN" ] && { bad "未找到 python3"; exit 1; }
PYVER="$($PYBIN -c 'import sys;print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
PYMAJOR="${PYVER%%.*}"; PYMINOR="${PYVER##*.}"
if [ "$PYMAJOR" -lt 3 ] || { [ "$PYMAJOR" -eq 3 ] && [ "$PYMINOR" -lt 10 ]; }; then
  bad "需要 Python >= 3.10，当前 $PYVER"; exit 1
fi
ok "Python $PYVER"

# ── 2. venv + 依赖 ───────────────────────────────────────────────────────────
if [ ! -x "$VENV_DIR/bin/python" ]; then
  info "创建 venv..."
  "$PYBIN" -m venv "$VENV_DIR"
fi
info "安装后端依赖（全量约 1-2 分钟）..."
"$VENV_DIR/bin/pip" install -q --disable-pip-version-check -r "$ROOT/backend/requirements.txt"
ok "依赖安装完成"

# ── 3. 环境体检 ──────────────────────────────────────────────────────────────
echo "──────────────────────────────────────────────"
info "环境体检"
probe() { # name cmd 必需性
  if command -v "$2" >/dev/null 2>&1; then ok "$1: $($2 --version 2>&1 | head -1)"
  elif [ "${3:-可选}" = "必需" ]; then bad "$1: 缺失"; else warn "$1: 缺失（$3）"; fi
}
probe "Node.js   " node "可选（前端 web/ 需要）"
probe "Go        " go   "可选（高并发引擎 backend_massive_concurrent，沙箱跳过）"
probe "Rust/Cargo" cargo "可选（安全引擎 backend_safety，沙箱跳过）"
probe "Docker    " docker "可选（沙箱内一般不可用）"
probe "ffmpeg    " ffmpeg "由 imageio-ffmpeg 自举（见下）"
MEM="$(free -h 2>/dev/null | awk '/^Mem:/{print $2}' || echo '?')"
warn "可用内存: $MEM（建议 ≥4GB 用于前端构建；后端+流水线在 ≤2GB 已验证）"

# ── 4. 冒烟导入（触发自举垫片安装）──────────────────────────────────────────
echo "──────────────────────────────────────────────"
info "冒烟导入 backend/main.py（将自举安装 ffmpeg/ffprobe 垫片）..."
(cd "$ROOT/backend" && "$VENV_DIR/bin/python" -c "
import main, shutil
print('  FastAPI app:', main.app.title)
print('  ffmpeg ->', shutil.which('ffmpeg'))
print('  ffprobe ->', shutil.which('ffprobe'))
")
FFBIN="$ROOT/storage/bin"
[ -x "$FFBIN/ffmpeg" ]  && ok "ffmpeg 自举垫片已就绪: $FFBIN/ffmpeg"
[ -x "$FFBIN/ffprobe" ] && ok "ffprobe 兼容垫片已就绪: $FFBIN/ffprobe"

echo "──────────────────────────────────────────────"
ok "搭建完成"
cat <<EOF

下一步：
  • 无 Key 全链路干跑:   bash scripts/arena/e2e_test.sh
  • 启动后端开发模式:     cd backend && ../arena-venv/bin/uvicorn main:app --reload
  • 接入真实 Key:         参考 backend/.env.arena.example
  • 完整文档:             docs/ARENA_AI_AGENT.md
EOF
