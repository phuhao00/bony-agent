#!/usr/bin/env bash
# ============================================================
# gen_proto.sh — 一键生成所有语言的 gRPC stubs
# 用法: ./scripts/gen_proto.sh
# 依赖: grpcio-tools (Python), protoc-gen-go + protoc-gen-go-grpc (Go),
#       tonic-build 在 Rust build.rs 中处理，无需在此调用
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROTO_DIR="$PROJECT_ROOT/proto"

echo "==> Project root: $PROJECT_ROOT"
echo "==> Proto dir:    $PROTO_DIR"

# ── 颜色输出 ──────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ── Python 可执行（与 start_local.sh 保持一致，优先用项目 venv）──
if [ -f "$PROJECT_ROOT/backend/.venv/bin/python3" ]; then
  PYTHON="$PROJECT_ROOT/backend/.venv/bin/python3"
elif [ -f "$PROJECT_ROOT/.venv/bin/python3" ]; then
  PYTHON="$PROJECT_ROOT/.venv/bin/python3"
elif [ -f "$PROJECT_ROOT/venv/bin/python3" ]; then
  PYTHON="$PROJECT_ROOT/venv/bin/python3"
elif command -v python3 &>/dev/null; then
  PYTHON="python3"
else
  PYTHON=""
fi

# ── 1. Python stubs ───────────────────────────────────────
PY_OUT="$PROJECT_ROOT/backend/generated"
mkdir -p "$PY_OUT/mediaagent"

if [ -n "$PYTHON" ] && "$PYTHON" -c "import grpc_tools" 2>/dev/null; then
  echo ""
  echo "── Python stubs → $PY_OUT ──"
  echo "   python = $PYTHON"
  "$PYTHON" -m grpc_tools.protoc \
    -I "$PROTO_DIR" \
    --python_out="$PY_OUT" \
    --grpc_python_out="$PY_OUT" \
    "$PROTO_DIR/mediaagent/common.proto" \
    "$PROTO_DIR/mediaagent/ocr.proto" \
    "$PROTO_DIR/mediaagent/document.proto" \
    "$PROTO_DIR/mediaagent/video.proto" \
    "$PROTO_DIR/mediaagent/directory.proto" \
    "$PROTO_DIR/mediaagent/workflow.proto" \
    "$PROTO_DIR/mediaagent/workflow_state.proto"

  # 修复生成的绝对导入 → 相对导入
  # protoc 生成: "from mediaagent import common_pb2 as ..."
  # 需要改为:    "from . import common_pb2 as ..."
  for f in "$PY_OUT/mediaagent"/*.py; do
    [ -f "$f" ] || continue
    sed -i.bak 's/^from mediaagent import/from . import/g' "$f" 2>/dev/null || true
    rm -f "${f}.bak"
  done

  # 确保 __init__.py 存在
  touch "$PY_OUT/__init__.py"
  touch "$PY_OUT/mediaagent/__init__.py"

  ok "Python stubs generated"
else
  warn "grpc_tools 不可用，跳过 Python stubs (pip install grpcio-tools)"
fi

# ── 2. Go stubs ───────────────────────────────────────────
# 注意：必须用 -M 标志将 go_package 覆盖为模块内路径，
# 否则生成代码的 import 路径与 go.mod module 名不匹配（编译报错已确认）。
GO_OUT="$PROJECT_ROOT/backend_massive_concurrent/generated"
GO_MOD="github.com/ai-media-agent/directory-service"
mkdir -p "$GO_OUT"

if command -v protoc &>/dev/null && command -v protoc-gen-go &>/dev/null && command -v protoc-gen-go-grpc &>/dev/null; then
  echo ""
  echo "── Go stubs → $GO_OUT ──"
  protoc \
    -I "$PROTO_DIR" \
    --go_out="$GO_OUT" \
    --go_opt=paths=source_relative \
    --go_opt=Mmediaagent/common.proto="${GO_MOD}/generated/mediaagent" \
    --go_opt=Mmediaagent/directory.proto="${GO_MOD}/generated/mediaagent" \
    --go_opt=Mmediaagent/workflow.proto="${GO_MOD}/generated/mediaagent" \
    --go-grpc_out="$GO_OUT" \
    --go-grpc_opt=paths=source_relative \
    --go-grpc_opt=Mmediaagent/common.proto="${GO_MOD}/generated/mediaagent" \
    --go-grpc_opt=Mmediaagent/directory.proto="${GO_MOD}/generated/mediaagent" \
    --go-grpc_opt=Mmediaagent/workflow.proto="${GO_MOD}/generated/mediaagent" \
    "$PROTO_DIR/mediaagent/common.proto" \
    "$PROTO_DIR/mediaagent/directory.proto" \
    "$PROTO_DIR/mediaagent/workflow.proto"
  ok "Go stubs generated"
else
  warn "protoc 或 protoc-gen-go/protoc-gen-go-grpc 未找到，跳过 Go stubs"
  warn "Install: go install google.golang.org/protobuf/cmd/protoc-gen-go@latest"
  warn "         go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest"
fi

# ── 3. Rust stubs（通过 build.rs 在 cargo build 时自动生成）────
echo ""
echo "── Rust stubs ──"
echo "  Rust stubs are generated automatically by tonic-build in build.rs"
echo "  Run: cd backend_safety && cargo build"
ok "Rust: no manual step needed"

# ── 4. 完成 ──────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════"
ok "Proto generation complete!"
echo "  Python → $PY_OUT"
echo "  Go     → $GO_OUT"
echo "  Rust   → backend_safety/src/generated/ (via cargo build)"
echo "════════════════════════════════════════"
