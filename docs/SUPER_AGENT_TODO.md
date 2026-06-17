# 超级 Agent 实施 TODO

更新时间：2026-05-05

本文档记录「超级强大的 Agent」实施进度：本地电脑/浏览器操作、平台连接、多媒体创作、联网检索、陪伴能力，以及执行安全与审批体系。

## 当前目标

构建一个可对话驱动的全链路数字员工，具备以下能力：

- 操作本地电脑与浏览器，逐步扩展到应用级自动化。
- 连接飞书、Discord、微信、QQ、钉钉等协作平台。
- 调用 Blender、Unity、Unreal、Photoshop 等创作工具。
- 完成文案、脚本、图片、视频、混剪、发布等多媒体生产流程。
- 联网收集、搜索、整理信息，并沉淀到知识库和上下文记忆。
- 提供陪伴功能与长期记忆，支持可成长的 AI 伙伴/宠物体验。
- 对高风险动作提供任务追踪、审批、审计与恢复机制。

## 已完成

- [x] 检查后端现有架构和实现模式。
- [x] 新增能力注册表，统一描述浏览器、鼠标、键盘、文件、平台、媒体、Shell 等能力及风险等级。
- [x] 新增审批服务，支持创建、查询、批准、拒绝、过期和敏感参数脱敏。
- [x] 将任务管理从纯内存升级为 `storage/tasks/` JSON 持久化，并保持现有长视频任务兼容。
- [x] 新增后端能力、任务、审批 API。
- [x] 扩展 trace metadata 更新能力，便于把任务和审批串联到执行追踪。
- [x] 新增聚焦测试，覆盖能力注册、审批生命周期、任务持久化、Computer Use 审批门控。
- [x] 将 Computer Use 执行路径接入可选审批门控。
- [x] 将审批门控抽到轻量 `core/execution_approval.py`，避免测试依赖 LangChain/Playwright。
- [x] 新增前端 capabilities/tasks/approvals 代理 API。
- [x] 新增「能力配置 / 审批与任务」页面，用于查看待审批项、任务列表和能力矩阵。
- [x] 在 Computer Use 页面新增高风险步骤审批模式开关，并在等待审批时跳转到审批面板。
- [x] 补充中英文 tab 文案。
- [x] 验证后端 focused unittest 通过。
- [x] 验证本次新增/改动前端文件 ESLint 通过。
- [x] 新增轻量 API 行为层与测试，覆盖 capabilities、tasks、approvals 的主要状态流转。
- [x] 新增审批恢复第一版：审批通过后可从任务面板继续 Computer Use 任务。
- [x] 新增本地电脑动作地基：允许目录沙箱、只读文件动作、危险动作审批、审计日志和 API 代理。
- [x] 支持审批通过后执行已批准的文件写入/单文件删除，并在执行前保存回滚快照。
- [x] 增加回滚 API 和任务面板 Rollback 操作，可用快照恢复文件写入/删除。
- [x] 增加本地动作审计查询 API 和前端 Recent Local Actions 面板。
- [x] 为 Shell 请求增加命令 allowlist、工作目录沙箱和审批前校验；仍不直接执行 Shell。
- [x] 支持审批通过后执行 allowlist 内 Shell 命令，带 5 秒超时、16KB 输出截断和结果审计。
- [x] 为 Shell 执行增加环境变量清理、参数数量/长度限制和路径参数沙箱校验。
- [x] 为 Shell 执行增加命令级参数 allowlist，限制各命令仅使用只读安全参数子集。
- [x] 为 Shell 执行结果增加输出风险标注：非零退出、超时、截断、疑似 secret/token。
- [x] 新增平台连接能力矩阵：飞书、Discord、微信、QQ、钉钉的接入方式、认证模式、动作风险和审批策略。
- [x] 新增平台动作请求地基：飞书发送/写入类动作进入审批，读类返回 connector 待接入占位。
- [x] 在 Capabilities 审批页展示平台矩阵，并支持平台动作任务审批后恢复。
- [x] 接入飞书消息 connector 第一版：支持 webhook 发送、官方 API 消息发送/读取、connector manager 注册和审批后执行。

## 待实现

### P0：审批恢复执行

- [x] 设计审批通过后的恢复模型。
- [x] 保存被拦截的 Computer Use 步骤、目标、起始 URL 和审批 ID。
- [x] 支持审批通过后重新规划执行，并对已批准的阻塞步骤跳过一次审批。
- [x] 审批拒绝后将关联任务标记为取消。
- [x] 增加恢复执行后端 API：`POST /tasks/{task_id}/resume`。
- [x] 在前端任务面板增加「Resume」操作。
- [x] 保存更完整的页面上下文摘要，用于更精细的原位恢复（阻塞时保存 DOM 文本/控件摘要、`resume_navigation_url`；恢复时直达该 URL 并向 planner 注入快照）。
- [x] 支持审批通过后自动后台继续执行（`POST /approvals/{id}/approve` 请求体 `auto_resume_computer_use`，能力配置页可选勾选）。

### P0：API 行为测试

- [x] 为 capabilities API 添加行为测试。
- [x] 为 tasks API 添加创建、查询、取消测试。
- [x] 为 approvals API 添加创建、批准、拒绝和过期测试。
- [x] 为 Computer Use 审批恢复 payload 添加轻量测试，避免真实浏览器依赖。
- [x] 为 `/computer-use/run` 增加 FastAPI 集成烟测（`tests/test_computer_use_api.py`：`TestClient` + `AsyncMock` 替换 `run_computer_use_session`；覆盖空 goal 400、正常返回、`require_approval` 时创建任务）；需使用含 FastAPI 的 venv（如项目 `venv/`）。

### P1：本地电脑操作能力

- [x] 设计第一版本地动作模型：文件读取/写入/删除、应用启动、Shell 命令。
- [x] 所有写入/删除/Shell/应用启动动作默认走能力审批，暂不直接执行。
- [x] 增加本地文件访问沙箱，默认使用 My Computer 已登记目录作为允许根目录。
- [x] 将 My Computer 索引目录与本地文件操作能力打通：`GET /computer/roots`、`POST /computer/actions`。
- [x] 增加本地动作审计日志：`storage/computer/local_actions.jsonl`。
- [x] 增加本地动作审计查询：`GET /computer/actions/audit`。
- [x] 支持审批通过后执行已批准的文件写入/单文件删除动作，并保留可回滚快照。
- [x] 增加真正 OS 桌面动作模型：屏幕读取、鼠标、键盘、窗口焦点、应用状态（`core/desktop_actions.py`：`DESKTOP_ACTION_PROFILES` + `GET /computer/desktop-profiles`、`GET /computer/desktop-profiles/{action_id}`、`POST /computer/desktop-plan`；与现有 `screen_read` / `mouse_control` / `keyboard_input` / `app_launch` 映射；`native_bridge_planned` 项为待本机桥接，执行仍以 Computer Use + `local_computer` 为准）。
- [x] 为 Shell 命令增加命令级 allowlist 和工作目录限制。
- [x] 为审批通过后的 Shell 执行增加进程沙箱、超时、输出截断和输出审计。
- [x] 为 Shell 执行增加环境变量清理和更细粒度参数策略。
- [x] 为 Shell 执行增加命令级参数 allowlist。
- [x] 为 Shell 执行增加按命令输出风险标注。
- [x] 为 Shell 执行增加更完整的只读命令证明（`SHELL_READONLY_PROOF` 静态理由 + `shell_policy` / 执行结果 / 任务 metadata 中的 `read_only_proof`）。
- [x] 增加回滚 API，用快照恢复被写入或删除的文件。

### P1：平台连接矩阵

- [x] 梳理飞书、Discord、微信、QQ、钉钉的连接方式：官方 API、Webhook、MCP、浏览器 RPA、桌面自动化。
- [x] 为每个平台定义 connector capability、动作风险、审批策略和认证状态映射。
- [x] 飞书优先接入消息、文档、日历、多维表格常用流程（读多免审、写多审；具体权限依赖飞书应用授权）。
  - [x] 定义飞书消息、文档、日历、多维表格动作模型和审批策略。
  - [x] 增加飞书动作请求 API，占位连接真实 connector 前的安全审批流。
  - [x] 在前端审批任务面板展示飞书平台能力和动作审批状态。
  - [x] 接入飞书真实消息发送/读取 connector。
  - [x] 接入飞书文档读取/写入 connector（GET raw_content；新建 docx；向现有文档追加段落；webhook-only 不可）。
  - [x] 接入飞书日历读取 connector（`GET .../calendar/v4/calendars/{calendar_id}/events`）。
  - [x] 接入飞书多维表格读取 connector（`GET .../bitable/v1/apps/{app_token}/tables/{table_id}/records`）。
  - [x] 飞书写入类扩展：日历创建/更新、Base 批量新建与更新（`calendar_write`、`base_write`，仍走审批）；docx 块批量更新（`write_docs` 的 `batch_updates` / `requests` → `PATCH .../blocks/batch_update`，≤200/次、同批 block_id 不可重复）。
- [x] Discord：Bot REST 含频道创建/更新/删除（`manage_channels`，需审批与机器人权限）。
- [x] 微信/QQ/钉钉：`SemiAutoIMConnector`（`tools/connectors/semi_auto_im.py`）+ `ConnectorManager` 注册；凭证字段 `semi_auto_enabled` 显式开启后 `execute_action` 返回 `semi_auto_playbook`（操作步骤 + Computer Use 模板），不执行真实远程自动化；矩阵增加 `semi_auto_playbook` 接入方式说明。

### P1：创作软件自动化

- [x] 为 Blender 设计 Python 脚本执行工具和场景生成工具（首版：`core/creative_software.py` 注册表 + `POST /creative-apps/plan` 生成 `blender -b … -P …` argv 与 `shell_suggestion`；真实执行须本地 `shell_command`/审批 + allowlist 策略扩展）。
- [x] 为 Unity/Unreal 设计项目命令、资源导入、构建和编辑器自动化入口（同模块：`unity_batch_method`、`unreal_editor_headless` CLI 模板与风险说明）。
- [x] 为 Photoshop 设计可插拔动作入口，优先考虑脚本/插件/本地自动化桥（同模块：`photoshop_extendscript` / `-r` jsx 模板与版本差异提示）。
- [x] 将创作软件动作纳入能力注册表和审批体系（已有 `creative_app_script`；补充 `GET /creative-apps/profiles`、`GET /creative-apps/profiles/{app_id}` 与能力描述中的 API 指引）。
- [x] 为每个创意软件（Figma、Blender、Photoshop、Unity、Unreal）创建独立的 AI 自动化对话页：`/creative-apps/[appId]/agent`，复用 `desktop_operator_agent`，首条消息注入应用上下文，采用 Apple 风格对话 UI（顶部工具栏 + 中央对话区 + 右侧快捷边栏 + 底部浮动 composer）。
- [x] 完善 Figma Code Connect CLI 全流程支持：`/creative-apps/plan` 新增 publish / unpublish / parse / preview / migrate / create 模式，生成带 token/config/dir/label/node 等参数的 argv 模板；前端 Figma Agent 上下文与快捷示例覆盖全部 CLI 操作。

### P1：多媒体生产流水线

- [x] 把脚本、分镜、图片、视频、配音、字幕、混剪串成可恢复任务（首版：`media_pipeline` 任务类型 + 八步状态机 + `POST /media-pipeline/start` 与 `POST /media-pipeline/{id}/step`；各步实际生成仍由现有 tools 调用；Next.js `app/api/media-pipeline/start` 与 `app/api/media-pipeline/[task_id]/step` 代理）。
- [x] 流水线可选联网调研：`POST /media-pipeline/{id}/research`（默认用 goal 检索）、`research_history` / `last_research_artifact` 写入任务 metadata；带 `trace_id` 时追加 `media_pipeline_research` 事件（含 `items_preview`）；Next.js `app/api/media-pipeline/[task_id]/research`。
- [x] 每个步骤写入任务进度、trace、产物路径和失败原因（`advance_media_pipeline_step` 在存在 metadata.trace_id 且 trace 文件存在时追加 `media_pipeline_step`：step 状态、任务 progress、artifact_hint 常用键、error 摘要）。
- [x] 支持人工在关键节点审批分镜、画面、视频片段、发布文案（`POST /media-pipeline/{id}/gate`：步骤置 `waiting_approval` + 创建 `media_pipeline_gate` 审批；`metadata.source=media_pipeline`；批准则步骤 `completed` 并保留原 artifact，拒绝则步骤 `failed`；Next.js `app/api/media-pipeline/[task_id]/gate`）。
- [x] 将生成结果自动保存到历史、知识库或素材库（`POST /media-pipeline/{id}/step` 与 `POST /media-pipeline/{id}/gate` 可选 `persist_to_history` / `persist_to_knowledge`：`/step` 在步骤 `completed` 时落库；`/gate` 在人工批准后完成步骤时落库；任务 `metadata.last_step_persist` 记录摘要）。

### P2：联网研究与知识沉淀

- [x] 统一 Web Search、Computer Use、RAG 查询和上下文记忆的结果格式（首版：`core/research_artifact.py` 的 `make_research_artifact` / `make_research_item` / `merge_research_summaries`；调用侧可按需接入）。
- [x] DuckDuckGo HTML 搜索结构化（`ddg_html_search_structured`）与 `research_artifact` 封装（`ddg_html_search_research_artifact`）；`POST /research/web-search`；可选 `trace_id` 追加 `research_web_search` 事件；Next.js `app/api/research/web-search` 代理。
- [x] 增加研究任务 trace 条目级与摘要预览（`research_trace_previews`：`summary_preview` + `items_preview` 含 title/url/snippet/可选 quote/confidence；`research_web_search` 与 `media_pipeline_research` 事件已写入）。
- [x] 增加研究任务 trace：引用预览补全与去重、置信度 reported/启发式（`normalize_research_url_key` / `dedupe_research_items`、`research_trace_previews` 的 `quote_source`+`confidence_basis`、`merge_research_summaries` 合并前去重；非机器学习校准）。
- [x] 支持一键保存研究结论到知识库（`research_artifact` → Markdown → `save_knowledge_file` + RAG ingest；`POST /research/save-to-knowledge`；可选 `trace_id` 写 `research_saved_to_knowledge`；Next.js `/api/research/save-to-knowledge`）。
- [x] 支持从研究结果直接生成内容选题、脚本或发布计划（`POST /research/content-plan`：`artifact` 或 `artifacts` 合并 → LLM 输出 `topic_ideas` / `script_direction` / `publish_plan`；可选 `trace_id` 写 `research_content_plan`；Next.js `/api/research/content-plan`）。

### P2：陪伴与养成能力

- [x] 设计 AI 伙伴长期状态：人格、偏好、情绪、成长、宠物占位、复盘列表（`core/companion_state.py` + `storage/companion/state.json`；`GET/PATCH /companion/state`；Next `app/api/companion/state`）。
- [x] 可解释的状态更新：`PATCH` 支持 persona / preferences / mood / pet / `memory_tag_ids` / `growth_add_xp` / `growth_set_title` / `append_feedback`（与 `/context/memory` 解耦，标签可挂接记忆 ID）。
- [x] 支持日程提醒、主动问候与任务复盘自动化（调度器 `content_type: companion_nudge`：`services/scheduler.py` 定时触发 → `companion_state_store.patch_state` 写入 `recent_feedback`（`scheduler_nudge`）+ `growth_add_xp: 1`；不走平台发布；建任务仍用 `POST /scheduler/jobs`）。
- [x] 陪伴 UI：`/companion` 右上角「档案」面板（等级、头衔、XP、宠物、心情备忘、最近复盘）。

## 验证命令

后端 focused tests：

```bash
/Users/tutu/Documents/agent/venv/bin/python /Users/tutu/Documents/agent/tests/test_super_agent_foundation.py
/Users/tutu/Documents/agent/venv/bin/python /Users/tutu/Documents/agent/tests/test_computer_use_api.py
```

本次前端改动文件 ESLint：

```bash
cd /Users/tutu/Documents/agent/web
npx eslint app/computer-use/page.tsx app/settings/capabilities/CapabilitiesApprovalsTab.tsx app/settings/capabilities/page.tsx app/api/capabilities/route.ts app/api/tasks/route.ts 'app/api/tasks/[id]/cancel/route.ts' app/api/approvals/route.ts 'app/api/approvals/[id]/route.ts' 'app/api/approvals/[id]/approve/route.ts' 'app/api/approvals/[id]/deny/route.ts'
```

新增恢复任务前端文件 ESLint：

```bash
cd /Users/tutu/Documents/agent/web
npx eslint app/settings/capabilities/CapabilitiesApprovalsTab.tsx 'app/api/tasks/[id]/resume/route.ts'
```

## 已知限制

- 审批通过后默认仍需在任务面板点击 Resume；若在能力配置页勾选「批准后后台自动继续」，Approve 时按审批 `metadata.source` 投递 `auto_resume_computer_use` / `auto_resume_platform_action` / `auto_resume_local_computer` 之一；也可在 Approve 请求体中手动传上述字段。
- 恢复时会导航到阻塞时保存的 URL，并向 planner 提供该时刻的页面文本/控件摘要；仍会重新启动浏览器进程，非同一 Chromium 实例的「挂起恢复」。
- 当前 Computer Use 是浏览器自动化，不是完整 OS 桌面自动化。
- 全量 `npm run lint` 仍有历史 lint 债务，不能作为当前改动的唯一判断标准。
- `pytest` 当前未安装，后端测试使用 `unittest` 直接运行。
