# 🚀 Agent 项目优化建议

> AI Media Agent 项目的详细优化分析与改进方案

**分析日期**: 2026-04-29  
**项目规模**: 105 个 Python 文件 | 75 个 TypeScript 文件 | 25 个 Skills

---

## 🎯 优化优先级总览

| 优先级    | 类别            | 重要性 | 工作量 |
| --------- | --------------- | ------ | ------ |
| 🔴 **高** | Skills 功能重复 | 高     | 中     |
| 🔴 **高** | 代码结构整理    | 高     | 中     |
| 🟡 **中** | 文档补充        | 中     | 低     |
| 🟡 **中** | 性能优化        | 中     | 中     |
| 🟢 **低** | 配置优化        | 低     | 低     |

---

## 🔴 高优先级优化

### 1. **Skills 功能重复问题**

#### 识别的重复 Skills：

```
⚠️ 组1: 文案相关
  copywriter          - 文案撰写专家
  copywriting         - 文案生成 (含脚本)
  ➜ 建议: 合并或明确职责划分

⚠️ 组2: 内容审核
  content-moderator   - 内容审核员 (skill定义)
  moderation          - 审核工具 (含脚本)
  ➜ 建议: 统一名称，合并定义

⚠️ 组3: 视频/媒体
  video-editor        - 视频编辑 (含脚本、资源)
  media               - 媒体处理 (含脚本)
  media-expert        - 媒体专家 (skill定义)
  ➜ 建议: 建立清晰的层级关系
```

**解决方案:**

```
重构方案 A (推荐):
├── copywriting/           # 合并后的文案 skill
│   ├── SKILL.md
│   └── scripts/
├── content-moderation/    # 统一的审核 skill
│   ├── SKILL.md
│   └── scripts/
└── media-production/      # 统一的媒体 skill
    ├── SKILL.md
    ├── scripts/
    └── assets/
```

**迁移步骤:**

1. 合并 `copywriter` 和 `copywriting` 的 SKILL.md 定义
2. 在 `copywriting/SKILL.md` 中保留两个角色的职责说明
3. 保留 `copywriter` 文件夹作为兼容别名，避免旧 Agent 配置失效
4. 类似处理 `moderation` 和其他重复 Skills

---

### 2. **Backend 工具层级优化**

#### 现状分析：

```
backend/tools/
├── 媒体工具 (6个文件 - 可能有重复)
│   ├── image_tools.py
│   ├── video_tools.py
│   ├── audio_tools.py
│   ├── media_tools.py          ⚠️ 可能是通用接口?
│   ├── media_common.py         ⚠️ 重复代码?
│   └── long_video_tools.py     ⚠️ video_tools 的子集?
├── 平台工具 (1个文件)
│   └── publisher_tools.py       ⚠️ 可能需要拆分?
├── 内容工具 (3个文件)
│   ├── copywriting_tools.py
│   ├── script_tools.py
│   └── moderation_tools.py
└── 其他工具 (11个文件)
    ├── connectors/             ⚠️ 应该独立?
    ├── rag_tools.py
    ├── gaming_trending.py
    └── ...
```

**优化方案:**

```python
# 新建议的结构:
backend/
├── tools/
│   ├── __init__.py
│   ├── base.py                # 工具基类
│   │
│   ├── media/                 # 📁 媒体处理
│   │   ├── __init__.py
│   │   ├── common.py          # 通用媒体工具
│   │   ├── image.py           # 图片生成
│   │   ├── video.py           # 视频生成
│   │   └── audio.py           # 音频/TTS
│   │
│   ├── content/               # 📁 内容创作
│   │   ├── __init__.py
│   │   ├── copywriting.py
│   │   ├── scripting.py
│   │   └── moderation.py
│   │
│   ├── social/                # 📁 社交媒体
│   │   ├── __init__.py
│   │   ├── publisher.py       # 统一发布接口
│   │   ├── platforms/
│   │   │   ├── douyin.py
│   │   │   ├── bilibili.py
│   │   │   ├── xiaohongshu.py
│   │   │   └── youtube.py
│   │   └── trending.py
│   │
│   ├── knowledge/             # 📁 知识库
│   │   ├── __init__.py
│   │   ├── rag.py
│   │   └── memory.py
│   │
│   └── connectors/            # 📁 连接器
│       ├── __init__.py
│       ├── base.py
│       └── ...
```

**代码示例:**

```python
# tools/media/__init__.py
from .common import MediaCommon
from .image import ImageGenerator
from .video import VideoGenerator
from .audio import AudioProcessor

__all__ = ['MediaCommon', 'ImageGenerator', 'VideoGenerator', 'AudioProcessor']

# 使用方式统一化
from backend.tools.media import ImageGenerator, VideoGenerator
```

---

### 3. **env-manager Skill 补全**

#### 问题：

- `env-manager` 缺少 `SKILL.md` 定义文件
- 仅包含脚本，没有正式的 Skill 定义

#### 解决方案：

创建 `.agent/skills/env-manager/SKILL.md`：

```markdown
---
name: "env-manager"
display_name: "环境管理器"
description: "AI 开发环境配置和依赖管理"
version: "1.0.0"
category: "utility"
---

## 职能

管理 Python 和 Node 依赖、环境变量、虚拟环境配置。

## 主要职责

- 检查和更新依赖版本
- 生成环境变量模板
- 验证环境配置完整性
- 处理跨平台兼容性问题

## 关键技能

- Python: pip, venv, requirements.txt
- Node: npm, package.json, package-lock.json
- 脚本: 自动化配置检查

## 输入示例
```

pip 包更新检查

```

## 输出示例

```

✓ numpy 1.24.1 → 1.25.0 (可更新)
✓ pandas 2.0.0 (最新)

```

```

---

## 🟡 中优先级优化

### 4. **代码规范和文档**

#### 问题清单：

```
❌ tools/ 目录没有 __init__.py 统一导出
❌ 不同工具文件的错误处理方式不一致
❌ API 文档不完整（缺少类型提示）
❌ 没有统一的日志记录规范
❌ 缺少单元测试用例 (tests/ 目录为空或很小)
```

#### 改进方案：

**A. 统一导入接口**

```python
# backend/tools/__init__.py
from .media import ImageGenerator, VideoGenerator, AudioProcessor
from .content import Copywriter, ScriptGenerator, ContentModerator
from .social import PublishManager, TrendAnalyzer
from .knowledge import RAGManager, MemoryManager

__all__ = [
    'ImageGenerator',
    'VideoGenerator',
    'AudioProcessor',
    'Copywriter',
    'ScriptGenerator',
    'ContentModerator',
    'PublishManager',
    'TrendAnalyzer',
    'RAGManager',
    'MemoryManager',
]
```

**B. 统一错误处理**

```python
# backend/tools/exceptions.py
class ToolError(Exception):
    """工具基础异常"""
    pass

class MediaGenerationError(ToolError):
    """媒体生成错误"""
    pass

class PublishError(ToolError):
    """发布错误"""
    pass

# 使用示例
try:
    image = ImageGenerator.generate(prompt)
except MediaGenerationError as e:
    logger.error(f"Failed to generate image: {e}")
    return {"error": str(e), "code": "MEDIA_ERROR"}
```

**C. 统一日志规范**

```python
# backend/utils/logger.py
import logging
from pythonjsonlogger import jsonlogger

def setup_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(name)
    handler = logging.StreamHandler()
    formatter = jsonlogger.JsonFormatter()
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    return logger

# 使用
logger = setup_logger(__name__)
logger.info("Action", extra={"tool": "image_gen", "status": "success"})
```

---

### 5. **Skills 文档标准化**

#### 问题：

- 24 个 SKILL.md 文件可能没有统一的格式
- Frontmatter 字段不统一

#### 解决方案 - SKILL.md 标准模板：

```markdown
---
name: "{skill-name}"
display_name: "{显示名称}"
description: "{简短描述}"
version: "1.0.0"
category: "{category}" # content, media, platform, data, tech, design, utility
tags: ["标签1", "标签2"]
author: "{作者}"
created_at: "2026-04-29"
updated_at: "2026-04-29"
---

## 🎯 职能描述

简明扼要的职能说明（2-3句）

## 🔧 核心能力

- 能力1
- 能力2
- 能力3

## 📥 输入示例
```

输入示例

```

## 📤 输出示例

```

输出示例

```

## 🚀 使用流程

1. 第一步
2. 第二步
3. 第三步

## ⚙️ 配置参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| param1 | string | ✓ | 说明 |
| param2 | int | | 说明 |

## 📚 相关 Skills

- [其他 Skill](./path)
- [相关 Skill](./path)
```

---

### 6. **性能优化建议**

#### API 性能：

```python
# ❌ 现状问题
def generate_media(prompt):
    # 每次都重新加载模型
    model = load_model()
    return model.generate(prompt)

# ✅ 改进方案 - 使用单例模式
class MediaGenerator:
    _instance = None
    _model = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    @classmethod
    def get_model(cls):
        if cls._model is None:
            cls._model = load_model()  # 仅加载一次
        return cls._model

    def generate(self, prompt):
        model = self.get_model()
        return model.generate(prompt)

# 使用
generator = MediaGenerator()
result = generator.generate(prompt)
```

#### 缓存策略：

```python
# 缓存生成的媒体元数据
from functools import lru_cache
from datetime import datetime, timedelta

class MediaCache:
    def __init__(self, ttl=3600):
        self.cache = {}
        self.ttl = ttl

    def set(self, key, value):
        self.cache[key] = {
            'value': value,
            'timestamp': datetime.now()
        }

    def get(self, key):
        if key in self.cache:
            entry = self.cache[key]
            if datetime.now() - entry['timestamp'] < timedelta(seconds=self.ttl):
                return entry['value']
            else:
                del self.cache[key]
        return None
```

---

## 🟢 低优先级优化

### 7. **启动脚本改进**

#### 现状：

- `start_local.sh` - 本地启动
- 可能没有错误检查和恢复机制

#### 改进方案：

```bash
#!/bin/bash
# start_local.sh - 改进版本

set -e  # 任何错误都退出

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}✓${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

# 检查虚拟环境
check_venv() {
    if [ ! -d "venv" ]; then
        log_error "Virtual environment not found!"
        log_info "Creating virtual environment..."
        python3 -m venv venv
    fi

    source venv/bin/activate
    log_info "Virtual environment activated"
}

# 检查依赖
check_deps() {
    log_info "Checking Python dependencies..."
    pip install -q -r backend/requirements.txt

    log_info "Checking Node dependencies..."
    cd web && npm install --prefer-offline && cd ..
}

# 启动后端
start_backend() {
    log_info "Starting backend on http://localhost:8000"
    cd backend
    python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
    BACKEND_PID=$!
    cd ..
}

# 启动前端
start_frontend() {
    log_info "Starting frontend on http://localhost:3000"
    cd web
    npm run dev &
    FRONTEND_PID=$!
    cd ..
}

# 主函数
main() {
    log_info "Starting AI Media Agent..."

    check_venv
    check_deps

    start_backend
    start_frontend

    log_info "Services started successfully!"
    log_info "Backend: http://localhost:8000/docs"
    log_info "Frontend: http://localhost:3000"

    # 等待进程
    wait
}

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; log_info 'Shutdown complete'" EXIT

main
```

---

## 📊 优化影响评估

| 优化项           | 代码量  | 测试需求 | 风险 | 收益 |
| ---------------- | ------- | -------- | ---- | ---- |
| Skills 合并      | 100 行  | 中       | 低   | 高   |
| 工具重构         | 500+ 行 | 高       | 中   | 高   |
| env-manager 补全 | 50 行   | 低       | 低   | 低   |
| 代码规范         | 200 行  | 中       | 低   | 中   |
| 文档标准化       | 300 行  | 低       | 低   | 中   |
| 性能优化         | 100 行  | 高       | 低   | 中   |

---

## 🎬 实施计划

### 第 1 阶段（第 1-2 周）

1. ✅ 合并重复的 Skills
2. ✅ 补全 env-manager SKILL.md
3. ✅ 建立统一的 Skill 文档模板

### 第 2 阶段（第 3-4 周）

1. ✅ 重构 backend/tools 目录结构
2. ✅ 实现统一的错误处理和日志
3. ✅ 添加单元测试框架

### 第 3 阶段（第 5-6 周）

1. ✅ 代码性能优化和缓存
2. ✅ 完善启动脚本
3. ✅ API 文档补充

---

## ✅ 检查清单

- [x] 合并 copywriter 和 copywriting Skills
- [x] 合并 moderation 和 content-moderator Skills
- [x] 明确 media 相关 Skills 的职责
- [x] 补全 env-manager SKILL.md
- [x] 重构 backend/tools 为子模块结构（兼容式 facade，暂不搬移旧实现文件）
- [x] 实现统一的错误处理
- [ ] 建立日志规范
- [x] 为核心重复 Skills 添加标准 Frontmatter
- [ ] 添加 API 类型提示
- [ ] 编写单元测试
- [ ] 性能基准测试
- [x] 更新 AGENTS.md 和 README.md

---

**生成日期**: 2026-04-29  
**下次审查**: 建议在实施 2-3 个优化后进行
