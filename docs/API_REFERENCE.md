# AI Media Agent — API 参考手册

> 面向前后端开发者与集成者的完整接口文档。后端基于 FastAPI，所有端点自带 OpenAPI 文档（`http://localhost:8000/docs`），本文档提供人工维护的离线参考与使用说明。

---

## 一、接口概览

| 类别 | 端点数 | 说明 |
|------|--------|------|
| Agent 编排 | 6 | 多 Agent 调用、流式对话、Trace 查询 |
| 内容创作 | 8 | 文案、脚本、标题、 moderation |
| 媒体生成 | 10 | 图片、视频、长视频、配音、混剪 |
| 平台发布 | 5 | 单平台/全平台发布、账号查询 |
| 定时调度 | 6 | Cron / Interval 任务管理 |
| 知识库 RAG | 5 | 文档上传、查询、状态、清除 |
| 连接器 | 10 | 平台连接、OAuth、浏览器登录、能力矩阵 |
| 本地电脑 | 14 | My Computer 索引、本地动作、审批、审计 |
| Computer Use | 1 | 浏览器 GUI 自动化 |
| 审批与任务 | 10 | 能力审批、任务持久化、恢复、回滚 |
| 记忆与上下文 | 6 | 记忆写入、检索、知识图谱 |
| 进化学习 | 10 | 反馈信号、事件、复盘、curator、session 召回 |
| MCP | 8 | MCP 服务器管理、工具加载、调用 |
| 技能 | 4 | 技能列表、开关、导入 |
| 配置 | 4 | LLM 供应商、媒体模型切换 |
| 热点 | 4 | 游戏热点、AI 资讯 |
| Wiki | 5 | 编译、查询、图谱、重建 |
| Lobster | 8 | 分布式节点、群聊、趋势 |
| 多媒体输入 | 2 | 图片/音频/视频分析与对话 |
| 陪伴 | 2 | AI 伙伴状态读写 |
| 媒体流水线 | 4 | 八步流水线、研究、闸口 |
| 联网研究 | 3 | Web 搜索、保存知识、内容计划 |
| 健康检查 | 1 | `/health` |

**总计：约 167 个端点**

---

## 二、通用约定

### 2.1 基础 URL

```
开发环境：http://localhost:8000
生产环境：由部署配置决定（通常经 Nginx 反向代理）
```

### 2.2 请求与响应格式

- 所有请求/响应均为 **JSON**（`Content-Type: application/json`）
- 流式接口返回 **SSE**（`text/event-stream`）
- 文件上传使用 `multipart/form-data`

### 2.3 认证

当前版本采用**基于会话的轻量认证**：
- 管理后台与部分设置接口使用 `auth_router.py` 的 cookie/session 机制
- 平台连接器 OAuth 流程见 [PLATFORM_CONNECTION_IMPLEMENTATION.md](./PLATFORM_CONNECTION_IMPLEMENTATION.md)

### 2.4 错误格式

```json
{
  "detail": "错误描述"
}
```

HTTP 状态码遵循 REST 惯例：
- `200` 成功
- `400` 请求参数错误
- `404` 资源不存在
- `422` 校验失败（FastAPI 自动校验）
- `500` 服务端内部错误

---

## 三、Agent 编排接口

### 3.1 获取可用 Agent 列表

```
GET /multi-agent/agents
```

返回当前注册的所有 Agent 元数据（ID、描述、能力标签）。

### 3.2 同步调用 Agent

```
POST /multi-agent/invoke
```

**Body：**
```json
{
  "agent_id": "media_agent",
  "input": "生成一张猫咪图片",
  "session_id": "可选，用于追踪"
}
```

**Response：**
```json
{
  "result": "...",
  "trace_id": "uuid"
}
```

### 3.3 流式调用 Agent（核心对话入口）

```
POST /multi-agent/stream
```

**Body：** 同 `/multi-agent/invoke`

**返回：** SSE 流，事件类型包括：

| 事件 | 说明 |
|------|------|
| `decision` | Supervisor 路由决策 |
| `agent_result` | Agent 执行结果（可能携带 `media_url`） |
| `final` | 最终结果 |
| `done` | 流结束标记 |

**media_url 自动推断：** 后端自动从 content/response 中提取 Markdown 图片、本地路径、外链，前端可直接渲染。

### 3.4 Trace 查询

```
GET /multi-agent/traces
GET /multi-agent/traces/{trace_id}
```

用于调试与审计 Agent 执行全过程。

---

## 四、内容创作接口

### 4.1 生成脚本

```
POST /tools/script
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `topic` | string | 主题 |
| `platform` | string | 目标平台（bilibili/xiaohongshu/douyin…） |
| `duration` | int | 预估时长（秒） |
| `style` | string | 风格 |

### 4.2 生成文案/软文

```
POST /tools/copywriting
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `topic` | string | 主题 |
| `platform` | string | 平台风格适配 |
| `tone` | string | 语气 |

### 4.3 生成标题变体

```
POST /tools/titles
```

### 4.4 内容审核

```
POST /tools/moderation/check
POST /tools/moderation/fix
GET /tools/moderation/rules
```

---

## 五、媒体生成接口

### 5.1 文生图

```
POST /tools/image
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `prompt` | string | 描述 |
| `model` | string | 可选：cogview/jimeng/gemini/openrouter |
| `size` | string | 分辨率 |

### 5.2 文生视频

```
POST /tools/video
```

### 5.3 长视频任务

```
POST /tools/video/long
GET /tools/video/long/{task_id}
```

长视频默认 `duration_sec = 30`，范围 30–120，风格 `cinematic`。

### 5.4 图生视频

```
POST /tools/video/from-image
POST /tools/video/from-upload
```

### 5.5 混剪

```
POST /tools/video/remix
POST /tools/video/ai-remix
```

### 5.6 配音 TTS

```
POST /tools/audio/tts
GET /tools/audio/config
```

### 5.7 文件上传

```
POST /upload
POST /tools/media/upload-reference
```

---

## 六、平台发布接口

### 6.1 发布到指定平台

```
POST /tools/publish
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `platform` | string | 平台 ID |
| `content_type` | string | text/image/video |
| `title` / `content` | string | 标题与正文 |
| `media_urls` | string[] | 媒体路径 |

### 6.2 全平台发布

```
POST /tools/publish/all
```

### 6.3 查询已配置账号

```
GET /tools/publish/accounts
```

---

## 七、定时调度接口

```
GET    /scheduler/jobs
POST   /scheduler/jobs
PUT    /scheduler/jobs/{job_id}
DELETE /scheduler/jobs/{job_id}
POST   /scheduler/jobs/{job_id}/run
GET    /scheduler/logs
DELETE /scheduler/logs/{log_id}
POST   /scheduler/logs/batch-delete
```

**创建任务 Body 示例：**
```json
{
  "name": "每日早9点发图",
  "trigger_type": "cron",
  "trigger_args": {"hour": 9, "minute": 0},
  "content_type": "image",
  "platforms": ["xiaohongshu", "douyin"]
}
```

---

## 八、知识库 RAG 接口

```
POST   /knowledge/upload       # 上传文档（PDF/DOCX/MD/TXT/CSV）
GET    /knowledge/documents    # 列表
DELETE /knowledge/documents/{doc_id}
POST   /knowledge/query        # 语义查询
GET    /knowledge/status       # 索引状态
DELETE /knowledge/clear        # 清空
```

---

## 九、连接器接口

### 9.1 平台状态

```
GET /connectors/platforms
GET /connectors/capability-matrix
GET /connectors/platforms/{platform_id}
GET /connectors/capability-matrix/{platform_id}
```

### 9.2 连接与断开

```
POST /connectors/connect              # 配置凭证/扫码/OAuth
POST /connectors/disconnect/{platform_id}
POST /connectors/oauth/authorize/{platform}
POST /connectors/oauth/callback
```

### 9.3 浏览器辅助登录

```
POST /connectors/browser/start
POST /connectors/browser/status
POST /connectors/browser/cancel
```

### 9.4 平台动作（带审批）

```
POST /connectors/platform-actions
POST /connectors/platform-actions/{task_id}/resume
```

写类动作（发消息、写文档、发布）默认进入审批流；读类动作直接返回。

### 9.5 连接摘要

```
GET /connections/summary
GET /settings/connections/summary
```

聚合平台、生产力工具、本地运行时、MCP 的连接状态与健康信息。

---

## 十、本地电脑与审批接口

### 10.1 My Computer 索引

```
GET    /computer/roots                    # 允许访问的根目录
GET    /computer/browse?path=...          # 浏览目录
GET    /computer/status                   # 索引状态
GET    /computer/folders                  # 已登记文件夹
POST   /computer/folders                  # 登记新文件夹
DELETE /computer/folders/{folder_id}
POST   /computer/folders/{folder_id}/reindex
GET    /computer/index-prefs
PUT    /computer/index-prefs
```

### 10.2 桌面动作画像

```
GET /computer/desktop-profiles
GET /computer/desktop-profiles/{action_id}
POST /computer/desktop-plan
```

### 10.3 本地动作（带审批与审计）

```
POST /computer/actions                   # 执行本地动作
POST /computer/actions/{task_id}/resume  # 审批后恢复
POST /computer/actions/{task_id}/rollback # 回滚写入/删除
GET  /computer/actions/audit             # 审计日志查询
```

**支持的动作：** `list_dir` / `read_text_file` / `write_text_file` / `delete_path` / `launch_app` / `shell_command`

**风险与审批策略：**
- `file_read`：低风险，免审
- `file_write`：高风险，需审批，可回滚
- `file_delete`：严重，需审批，可回滚
- `shell_command`：严重，需审批，命令白名单 + 超时 5s + 输出截断 16KB

### 10.4 审批服务

```
POST   /approvals                        # 创建审批
GET    /approvals                        # 列表
GET    /approvals/{approval_id}          # 详情
POST   /approvals/{approval_id}/approve  # 批准（可带 auto_resume_*）
POST   /approvals/{approval_id}/deny     # 拒绝
```

### 10.5 任务管理

```
POST   /tasks                            # 创建任务
GET    /tasks                            # 列表
GET    /tasks/{task_id}                  # 详情
POST   /tasks/{task_id}/cancel           # 取消
POST   /tasks/{task_id}/resume           # 恢复
```

---

## 十一、Computer Use 接口

```
POST /computer-use/run
```

**Body：**
```json
{
  "goal": "在B站搜索猫咪视频",
  "starting_url": "https://www.bilibili.com",
  "require_approval": true
}
```

高风险步骤（输入密码、点击发布等）可进入审批流；审批通过后支持自动后台恢复。

---

## 十二、记忆与上下文接口

```
GET    /context/memory                   # 记忆列表
POST   /context/memory                   # 写入记忆
DELETE /context/memory/{memory_id}       # 删除
POST   /context/memory/search            # 语义搜索
GET    /context/knowledge-graph          # 知识图谱
```

记忆注入规范：使用固定 fence `<memory-context>`，prefetch 只注入短摘要与来源，流式输出不泄漏 fence 原文。

---

## 十三、进化学习接口

```
POST /evolution/signals                  # 提交反馈信号（点赞/点踩/评论）
GET  /evolution/signals
POST /evolution/events                   # 写入学习事件
GET  /evolution/events
POST /evolution/session-recall/search    # 会话检索召回
POST /evolution/memory-usage/outcome     # 记忆使用结果上报
GET  /evolution/memory-usage
GET  /evolution/memory-usage/hits        # 记忆命中可视化
GET  /evolution/knowledge-layers
POST /evolution/knowledge-layers/classify # 知识分层分类
POST /evolution/reflections/{trace_id}   # 触发任务复盘
GET  /evolution/reflections
POST /evolution/curator/run              # 触发 curator 整理
GET  /evolution/curator/runs
GET  /evolution/curator/runs/{run_id}
```

---

## 十四、媒体流水线接口

```
POST /media-pipeline/start               # 启动流水线
POST /media-pipeline/{task_id}/step      # 推进步骤
POST /media-pipeline/{task_id}/research  # 联网调研
POST /media-pipeline/{task_id}/gate      # 人工闸口审批
```

八步状态机：`script → storyboard → images → video → audio → subtitles → remix → publish`

---

## 十五、联网研究接口

```
POST /research/web-search                # DuckDuckGo 结构化搜索
POST /research/save-to-knowledge         # 保存到知识库
POST /research/content-plan              # 生成内容计划
```

---

## 十六、MCP 接口

```
GET    /api/mcp/servers
POST   /api/mcp/servers
PATCH  /api/mcp/servers/{server_id}
DELETE /api/mcp/servers/{server_id}
POST   /api/mcp/servers/{server_id}/ping
GET    /api/mcp/servers/{server_id}/tools
POST   /api/mcp/servers/{server_id}/invoke
GET    /api/mcp/presets
POST   /api/mcp/presets/{preset_id}/install
DELETE /api/mcp/presets/{preset_id}/uninstall
```

详见 [MCP_CLIENT.md](./MCP_CLIENT.md)。

---

## 十七、技能接口

```
GET  /api/skills
POST /api/skills/toggle
POST /api/skills/import
POST /api/skills/import-file
```

---

## 十八、配置接口

```
GET  /config/provider
POST /config/provider
GET  /config/media-models
POST /config/media-models
```

用于运行时切换 LLM 供应商与媒体生成模型。

---

## 十九、热点接口

```
GET  /trending/gaming
POST /trending/gaming/refresh
GET  /trending/ai
POST /trending/ai/refresh
```

---

## 二十、Wiki 接口

```
POST /wiki/compile
GET  /wiki/pages
GET  /wiki/pages/{page_id}
POST /wiki/index/rebuild
GET  /wiki/graph
GET  /wiki/health
```

---

## 二十一、Lobster 分布式接口

```
GET  /api/lobster/config
POST /api/lobster/config
GET  /api/lobster/detect
POST /api/lobster/run
GET  /api/lobster/status
GET  /api/lobster/trending
POST /api/lobster/trending/refresh
POST /api/lobster/chat
GET  /api/lobster/nodes
POST /api/lobster/group-chat
```

---

## 二十二、多媒体输入接口

```
POST /multimodal/analyze    # 分析图片/音频/视频
POST /multimodal/chat       # 带多媒体的对话
```

---

## 二十三、陪伴接口

```
GET  /companion/state
PATCH /companion/state
```

支持更新 persona、preferences、mood、growth_add_xp、append_feedback 等字段。

---

## 二十四、健康检查

```
GET /health
```

---

## 二十五、前端 API 代理

Next.js 前端通过 `web/app/api/**/route.ts` 代理调用后端，关键代理路径：

| 前端代理路径 | 对应后端 |
|-------------|---------|
| `app/api/chat/route.ts` | `/chat/history`, `/multi-agent/stream` |
| `app/api/multi-agent/stream/route.ts` | `/multi-agent/stream`（SSE，原生 http.request） |
| `app/api/context/**` | `/context/memory`, `/context/knowledge-graph` |
| `app/api/capabilities/**` | `/capabilities`, `/tasks`, `/approvals` |
| `app/api/media-pipeline/**` | `/media-pipeline/*` |
| `app/api/research/**` | `/research/*` |

---

_文档版本：2026-05-10 · 与后端 main.py 同步_
