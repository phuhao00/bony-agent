---
name: project-architect
description: 项目架构与规范专家。负责维护项目目录结构、命名规范以及技术栈统一。
license: MIT
metadata:
  category: Architecture
  version: 1.0.0
allowed-tools:
  - list_dir
  - run_command
  - write_to_file
  - replace_file_content
---

# Project Architect Skill

负责确保项目文件存放规范、目录清晰、模块解耦。

## 项目标准结构规范

- **`/web`**: 前端代码 (Next.js)。
- **`/backend`**: 后端核心逻辑。
  - **`/agents`**: 智能体定义层。
  - **`/tools`**: 原子级工具函数。
  - **`/core`**: 配置、日志等核心共享模块。
  - **`/utils`**: 通用工具类。
- **`.agent/skills`**: 遵循 agentskills.io 规范的技能包。
- **`/storage`**: 持久化数据。
  - **`/outputs`**: 生成的媒体文件。
  - **`/uploads`**: 用户上传的原始素材。
  - **`/temp`**: 项目内的临时文件目录（替代系统 `/tmp`）。
- **`/docs`**: 项目文档。

## 文件系统与路径规范 (File System Standards)

- **严禁使用系统 `/tmp` 目录**: 禁止在代码、脚本或工具中使用 `/tmp` 或 `tmp` 作为临时文件存放路径。
- **统一使用项目内临时目录**: 所有临时文件必须存放在项目根目录下的 `/storage/temp` 或相应模块下的 `temp` 目录中。
- **持久化原则**: 除非是真正的临时交换文件，否则优先考虑存放在 `/storage` 下的对应子目录。
- **清理机制**: 使用完临时文件后应及时删除，或确保其在项目生命周期内可控。

## 文档管理规范 (Documentation Standards)

- **中心化原则**: 避免创建琐碎的文档文件。优先在现有文档中追加内容（如 `README.md` 或相关的 `SKILL.md`）。
- **存放位置**: 
  - 核心项目说明、快速开始、架构总览：根目录 `README.md`。
  - 特定模块/技能的详细实现、API 定义、使用指南：`.agent/skills/<skill-name>/SKILL.md`。
  - 深度技术论文、长篇部署指南：`docs/` 目录下，并确保在 `README.md` 中有索引。
- **文档一致性**: 修改代码结构后，必须同步更新 `README.md` 中的目录树。

## 命名规范
- **文件夹**: kebab-case (如 `video-editor`)。
- **Python 文件**: snake_case (如 `media_tools.py`)。
- **Skill 目录**: 必须包含 `SKILL.md`。

## 依赖管理标准 (Dependency Management)

- **唯一虚拟环境**: 必须使用项目根目录下的 `venv`。禁止移动、重命名或删除该目录。
- **!!! 严禁!!!**: 禁止执行 `mv venv ...` 或 `rm -rf venv` 以及之后重新创建环境的行为。
- **增量安装**: 禁止使用 `pip install -r requirements.txt` 进行全量覆盖式重装，除非是首次构建。在日常开发中，应针对缺失的包单独使用 `pip install <package>`。
- **禁止编译**: 优先使用二进制轮子文件 (wheels)，例如使用 `--only-binary :all:`。
- **禁止临时环境**: 严禁在执行任务过程中创建临时的 `.venv` 或 `tmp_env`。

## 前端助手页 Markdown 渲染规范

所有 **Recipe 助手页**（产品经理、法务、采购、广告投放、商务合作、游戏设计、游戏美术等）及 **Programmer / System Assistant / Desktop Operator** 的结果面板，Agent 输出为 Markdown 时必须在 UI 层渲染为预览，禁止直接展示源码。

### 必须遵守

- **渲染组件**：使用 `AssistantMarkdownPreview`（封装 `MarkdownSummaryPreview` + 流式光标），或直接使用 `MarkdownSummaryPreview`。
- **禁止写法**：`{streamText}`、`{report}`、仅加 Tailwind `prose` class 而不经过 `react-markdown`。
- **共享入口**：Recipe 类助手统一走 `web/app/components/AssistantRecipeResultPanel.tsx`；新增助手页复用该组件或 `AssistantMarkdownPreview`。
- **Electron 同步**：修改 `web/` 后同步 `electron/resources/web-standalone/` 对应文件。

### 参考文件

- `web/components/MarkdownSummaryPreview.tsx` — 主对话与各 Markdown 预览
- `web/app/components/AssistantMarkdownPreview.tsx` — 助手页专用封装
- `web/app/components/AssistantRecipeResultPanel.tsx` — Recipe 助手结果面板
- `docs/FRONTEND_ARCHITECTURE.md` §6.1 — MarkdownSummaryPreview 说明

### Agent 输出约定（后端）

结构化助手 Agent（product_manager、legal、procurement 等）的系统提示词要求 **Markdown 章节、表格、P0/P1/P2**，前端负责渲染；Agent 无需输出 HTML，也无需用代码块包裹整段报告。

## 职责
- 检查项目结构是否符合上述规范。
- 迁移不规范的文件到正确位置。
- 更新相关引用确保项目可运行。
- **维护依赖健康**: 确保 `venv` 保持最新且不包含冲突的冗余环境。
