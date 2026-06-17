#!/bin/bash

echo "🔧 检查运行环境..."

# 创建持久化的虚拟环境
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_PATH="$(dirname "$PROJECT_DIR")/venv"

# !!! WARNING !!!
# Never move (mv) or delete (rm) the venv directory manually.
# Always reuse the existing environment to maintain consistency.
# If venv doesn't exist, create it
if [ ! -d "$VENV_PATH" ]; then
    echo "📦 Creating virtual environment at $VENV_PATH..."
    python3 -m venv "$VENV_PATH"
else
    echo "✅ Found existing venv at $VENV_PATH, reusing it."
fi


if [ -f "$PROJECT_DIR/requirements.txt" ]; then
    echo "📦 检查 requirements.txt 依赖..."
    # 为解决 macOS/Python 3.14 下的权限和编译问题，临时重定向 HOME 并强制安装二进制
    HOME="$PROJECT_DIR/storage/temp" "$VENV_PATH/bin/pip" install --only-binary :all: pydantic pydantic-core
    HOME="$PROJECT_DIR/storage/temp" "$VENV_PATH/bin/pip" install -r "$PROJECT_DIR/requirements.txt"
else
    echo "❌ 警告: 未找到 requirements.txt"
fi



echo "✅ 环境设置完成！"
echo "🚀 运行 ./start_local.sh 启动应用"
