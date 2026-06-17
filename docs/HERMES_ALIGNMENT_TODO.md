# Hermes 范式对齐 — 实施待办清单

本文档从 Cursor 计划「Hermes 模式对齐」拆解而来，目标是把 Hermes-Agent 中可借鉴的 **会话记忆、连接摘要、Channel 管理、插件钩子、工具遥测、Skill 管理、能力/工具集分类、Gateway/Sidecar 边界** 转化为本项目可落地的增量任务。**详细设计与约束以计划正文为准**；本文负责给开发拆单、验收口径和代码锚点。

| 资源                                   | 路径                                                                                                                                                              |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 完整规划（含 §1–§9、mermaid）          | **Cursor**：侧边栏 **Plans** →「Hermes 模式对齐计划」。计划文件多在本地 Cursor 目录（如 `~/.cursor/plans/`），**通常不在 Git 仓库内**，请勿依赖仓库相对路径链接。 |
| 超级 Agent 主线进度（已完成/已知限制） | [SUPER_AGENT_TODO.md](SUPER_AGENT_TODO.md)                                                                                                                        |
| 运行时架构文档                         | [ARCHITECTURE_OVERVIEW.md](ARCHITECTURE_OVERVIEW.md)                                                                                                              |
| Hermes 对照仓库（本地）                | `/Users/tutu/Downloads/hermes-agent`（路径随你机器而异）                                                                                                          |

**同步日期**：2026-05-05（第八次校对：补充 Hermes 信息处理、会话检索、上下文压缩与自学习闭环借鉴点）

---

## 原则（执行前扫一眼）

- **不合并** Hermes-Agent 仓库；只借鉴接口形态与分层。
- **连接与凭证**：现有 OAuth / Cookie / [ConnectorManager](../backend/tools/connectors/manager.py)、Lark CLI 等为唯一真实来源；新功能 **additive**，不在「摘要 API」里收密钥。
- **电脑 / 网络**：保留 Playwright Computer Use、本地沙箱、`/research/web-search`；CDP、远程终端等多为 **可选 Phase**。
- **前端体验**：默认增强现有工作台 / 设置页，不做新的 Hermes 营销页；[web/app/hermes-agent/page.tsx](../web/app/hermes-agent/page.tsx) 只保留为文档入口。
- **记忆与 Skill 都要控上下文成本**：借鉴 Hermes 的 provider / progressive disclosure / usage sidecar，但不要把所有记忆、所有 Skill 全量塞入系统提示。
- **P3**：会话 FTS、credential pool、子 Agent 委派等与主线弱相关，**按需**从计划 §9 附录立项。

---

## 当前基线（开工前核对）

| 领域           | 已有能力                                                                                                                                                                                                                                                                        | 明确缺口                                                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 记忆           | [memory_tools.py](../backend/tools/memory_tools.py) 有 `search_memory`；[vector_store.py](../backend/utils/vector_store.py) 支持 add/search/list/delete；[main.py](../backend/main.py) 已有 `GET /context/memory`、`DELETE /context/memory/{id}`、`POST /context/memory/search` | 缺 `save_memory` Tool 与 `POST /context/memory` 写入 API；[MemoryPanel.tsx](../web/app/settings/context/MemoryPanel.tsx) 的 confidence/views/upvote/downvote 仍为本地 seed 推导 |
| 连接           | [ConnectorManager](../backend/tools/connectors/manager.py) 与 `GET /connectors/platforms` 已是平台状态来源；`GET /connectors/capability-matrix` 已提供能力矩阵                                                                                                                  | 缺统一只读 facade：连接摘要、Channel / Home Channel、Lark/MCP/本地能力分段、深链、脱敏健康状态                                                                                  |
| 多 Agent       | `POST /multi-agent/invoke`、`POST /multi-agent/stream` 已创建 trace；Next [api/chat](../web/app/api/chat/route.ts) 是独立 Vercel AI SDK 聊天链路                                                                                                                                | memory prefetch / after_turn 尚未统一挂接；chat 与 multi-agent trace/feedback 语义尚未打通                                                                                      |
| 技能           | [main.py](../backend/main.py) 中 `SKILLS_ENABLED_PATH` + skills API 已存在                                                                                                                                                                                                      | 缺插件运行时 manifest、工具注册生命周期、`pre_tool` / `post_tool` 钩子                                                                                                          |
| 审批与本地执行 | [approval_service.py](../backend/services/approval_service.py)、[local_computer.py](../backend/core/local_computer.py)、Computer Use 审批链路已存在                                                                                                                             | 缺拒绝/失败经验沉淀、工具遥测、统一 agent mode / budget 旋钮                                                                                                                    |

---

## 进一步可借鉴的 Hermes 细节

这些不是“照搬 Hermes”，而是把它的稳定接口形态转成本项目的增量设计约束。

| 方向             | Hermes 参考点                                                                                                                                                                        | 本项目可借鉴方式                                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 记忆生命周期     | `MemoryProvider` / `MemoryManager` 明确 `initialize`、`prefetch`、`queue_prefetch`、`sync_turn`、`on_session_end`、`on_pre_compress`、`on_memory_write`、`shutdown` 等生命周期。     | 在 `memory-coordinator` 中先定义同名或近似生命周期；第一期只接 Chroma/JSON，后续再抽 `MemoryBackend`，避免工具层到处直接依赖 [vector_store.py](../backend/utils/vector_store.py)。           |
| 记忆上下文安全   | Hermes 用 `<memory-context>` 包裹 recall，并有 streaming scrubber / `sanitize_context`，同时强调“记忆上下文不是用户新输入”。                                                         | `prefetch` 注入要加固定 fence 和 system note；前端流式输出需避免泄漏 memory block；记忆写入前增加注入/密钥外泄扫描，尤其是自动 reflection 生成的内容。                                       |
| 缓存友好记忆     | Hermes 的 `MEMORY.md` / `USER.md` 是 session 启动时冻结快照，mid-session 写盘但不改系统提示，避免破坏 prompt cache。                                                                 | 本项目可采用“会话内写入立即持久化，下一轮只通过 short prefetch 注入；系统提示快照下个会话刷新”的策略，不在同一会话动态重建大 prompt。                                                        |
| 记忆质量闸门     | Hermes `memory_tool` 对将进入系统提示的内容做 prompt injection、密钥读取、外传命令、隐形 Unicode 扫描，并用字符预算和重复检测保持记忆精简。                                          | `save_memory` / reflection / curator 写入前增加统一 quality gate：安全扫描、去重、来源/置信度、字符预算、审批策略；自动推断记忆先进入 candidate 状态。                                       |
| 信息数据管道     | Hermes 将会话、消息、工具调用、token/cost、session source 存入 SQLite state，并用 WAL、schema version、FTS 触发器支撑跨平台并发读写和检索。                                          | 在 JSON trace 之外增加 `learning-data-pipeline`：统一采集 chat/trace/tool/signal/history 事件，先 JSONL/SQLite 均可，但 schema 要能支撑检索、统计、回放、训练样本导出。                      |
| 会话检索召回     | `session_search` 先用 FTS5 检索历史消息，按 session 去重、排除当前 lineage，再用 auxiliary 模型生成聚焦摘要；空 query 可列最近会话。                                                 | `session-search-recall` 不直接把历史全文注入上下文，而是返回“按主题聚焦的过往会话摘要 + 来源元数据”；用于“上次怎么做的”与相似任务经验召回。                                                  |
| 上下文压缩       | Hermes `ContextEngine` 抽象压缩生命周期；`ContextCompressor` 保护头尾、压缩中段、裁剪旧工具结果，并把摘要标为 reference only，避免旧请求变成新指令。                                 | `context-engine-compression` 应独立于 memory：负责 token 预算、tool result compaction、reference-only handoff；压缩前可通知 `memory-coordinator.on_pre_compress` 抽取事实。                  |
| 工具结果压缩     | Hermes 对 terminal/read_file/search/browser 等工具输出生成一行结构化摘要，保留命令、路径、退出码、行数等关键事实，而不是只写“已清理”。                                               | `tool-result-compaction` 可先服务 trace 和 long-running agent：大输出落原始 artifact，主上下文只保留摘要、artifact id、错误要点、可复现命令。                                                |
| Channel 连接管理 | Hermes 在 `GatewayConfig` 中区分 `PlatformConfig`、`HomeChannel`、`SessionSource`、`DeliveryTarget`；`channel_directory` 定期枚举 Discord/Slack 或从 session fallback 发现可达会话。 | 在平台连接之上增加 channel/contact 目录、默认投递目标、origin 回送、thread/topic 信息；先做只读目录和手动 home channel，后续再让定时发布/消息 Sidecar 复用同一套 target resolver。           |
| 连接运行时健康   | Hermes 有 `gateway_state.json`、platform `connected/disconnected/fatal`、`error_code/error_message`，并用 scoped lock 防止多个进程同时占用同一个 bot token / external identity。     | 为 `connections-summary` 增加 runtime health 与 last error；对 Telegram/Discord/Slack/Feishu 等长连接或 bot token 增加本机 scoped lock，避免双开导致平台断线或消息重复。                     |
| 自我学习闭环     | Hermes 把 Skill 作为 procedural memory，`skill_usage` 侧车记录 use/view/patch、agent-created、pinned、active/stale/archived。                                                        | 在 `evolution-*` 之外增加 Skill 使用统计与 curator 任务：只管理 Agent 创建的 Skill，不碰内置/人工/Hub 技能；可按低使用、失败率、用户否定反馈进入 stale/archived。                            |
| 后台学习 Curator | Hermes curator 是 idle / interval 触发的后台辅助 Agent：有 `.curator_state`、dry-run、报告、pin 保护、只归档不删除、只碰 agent-created 内容。                                        | `learning-curator-worker` 只处理候选记忆、Agent 创建 Skill、经验 playbook；默认 dry-run + 报告，必须可暂停，禁止自动修改内置/人工资产，禁止无审计删除。                                      |
| Skill 渐进披露   | `skills_list` 只给 metadata，`skill_view` 再加载完整说明与 supporting files；Skill 可带 `references/templates/scripts/assets`。                                                      | 当前 `.agent/skills` 可升级为索引 + 按需加载：列表页/Agent prompt 只放 `name/description/category/readiness`，执行时再加载全文和支持文件，降低 token 与误触发。                              |
| Skill 来源与安全 | Hermes 有 Skills Hub lock、quarantine、trust_level、`skills_guard` 扫描、pinned guard、platform disabled。                                                                           | 为本项目技能加 `source: builtin/local/user/agent/external`、`trust_level`、`platforms`、`requires_env`、`disabled_by_platform`；外部 Skill 安装先隔离扫描，危险内容不直接进入 Agent prompt。 |
| 插件生命周期     | Hermes 插件分 `standalone/backend/exclusive/platform`，支持 tools、slash commands、platform adapter、context engine、image provider、hooks。                                         | `skills-plugin-runtime` 可拆为 `PluginSurface` 与 `ProviderSurface`：先做 manifest + hooks，后续再允许 media provider / context engine / platform adapter 插件化。                           |
| 能力/工具分类    | Hermes 用 `toolsets.py` 与 `toolset_distributions.py` 按 web/browser/terminal/file/memory/skills/research/development/safe 等场景组合工具。                                          | 在 [capabilities.py](../backend/core/capabilities.py) 之上增加“场景 profile”：content、media、publish、research、computer-use、safe、dev；用于 UI 分组、Agent mode、任务预算和审批策略。     |
| 命令注册表       | Hermes 的 slash command 集中在 `COMMAND_REGISTRY`，CLI/gateway/help/autocomplete 统一消费。                                                                                          | 本项目的工作台入口、Capabilities、后端工具与未来 Sidecar 命令可建立统一 action registry，避免页面、API、Agent 工具各自维护名称和说明。                                                       |

---

## 建议实施顺序（依赖提示）

以下为 **推荐** 顺序，避免返工；并行项已标注。

1. **P0 三线可并行**：`memory-save-tool` · `connections-summary` · `evolution-preference-signals`。其中 `memory-save-tool` 是后续 `memory-coordinator` 和 `reflection-loop` 的前置项。
2. **先于进化闭环**：完成 `memory-save-tool` 后，再做 `memory-coordinator`（prefetch 写入语义一致）、`reflection-loop`（摘要落记忆）。
3. **连接先 facade 后 UI**：先补后端 `connections-summary`，再替换 [CapabilitiesConnectionsTab.tsx](../web/app/settings/capabilities/CapabilitiesConnectionsTab.tsx) 的直接平台列表展示。
   - 若要做 Channel 管理，先扩 `connections-summary` 的 schema，再做 `channel-directory`；避免 UI 直接读 connector 私有状态。

4. **文档与实现可并行**：`gateway-decision-adr`、`arch-doc-runtime` 可与 P1 代码穿插完成，但 ADR 必须先明确默认不启 Sidecar。
5. **网络治理**：`network-tier-ssrf` 建议在扩展任意「fetch URL」类工具 **之前**合入（纯函数 + 测试可先落地）。
6. **插件与遥测**：实现 `evolution-tool-telemetry` 前，先在 `skills-plugin-runtime` 中稳定 **`pre_tool` / `post_tool`** 钩子形状（P1 先于 P2，与优先级一致）。
7. **Skill 治理后置**：`skill-progressive-disclosure` 可先做只读索引；`skill-curator-usage` 必须等 `evolution-preference-signals` 和基础 Skill 来源标记稳定后再开启自动归档。
8. **自我学习先数据后智能**：先做 `learning-data-pipeline` 与 `memory-quality-gate`，再做 `session-search-recall`、`tool-result-compaction`、`learning-curator-worker`；不要让后台 Agent 直接改 prompt 或无审计写长期记忆。

---

## P0

> P0 的完成标准：用户能保存/检索记忆，设置页能看到统一连接摘要，记忆/对话反馈能真实落库；所有新增 API 不接收密钥。

- [x] **`memory-save-tool`**：补齐 Agent 记忆写入闭环。
  - 交付：在 [memory_tools.py](../backend/tools/memory_tools.py) 增加 `@tool save_memory(content, memory_type="fact", source="user", metadata=None)`；复用 [vector_store.py](../backend/utils/vector_store.py) 的 `add_memory`，metadata 至少包含 `type/source/timestamp/confidence`。
  - API：在 [main.py](../backend/main.py) 增加 `POST /context/memory`，供 [MemoryPanel.tsx](../web/app/settings/context/MemoryPanel.tsx) 与后续 coordinator/reflection 复用。
  - 能力：对齐 [capabilities.py](../backend/core/capabilities.py) 中 `memory_write`；如果写入来自 Agent 自动推断，默认需要审批或标记 `inferred=true`。
  - 验收：可通过 `POST /context/memory` 写入，再由 `GET /context/memory` 与 `POST /context/memory/search` 找回；Chroma 不可用时 JSON fallback 仍可用。

- [x] **`connections-summary`**：建立只读连接 facade。
  - 交付：新增 `GET /settings/connections/summary`（或 `GET /connections/summary`，最终名称需固定），聚合 `connectors/platforms`、`connectors/capability-matrix`、MCP/Lark CLI/本地 Computer 配置状态。
  - 返回：按 `platforms`、`productivity`、`local_runtime`、`mcp` 分段；每项包含 `id/name/status/capabilities/deep_link/credential_state/runtime_state/channel_count/home_channel`，credential 只返回 `missing|configured|verified|error`。
  - UI：[CapabilitiesConnectionsTab.tsx](../web/app/settings/capabilities/CapabilitiesConnectionsTab.tsx) 改为消费摘要接口，保留 `/platforms`、`/lark-cli`、`/settings/my-computer` 深链。
  - 验收：断开后端或无凭证时 UI 有空态/错误态；不改变 OAuth、Cookie、connect/disconnect 既有接口。

- [x] **`evolution-preference-signals`**：把反馈从 UI 状态升级为持久信号。
  - 交付：新增 `storage/evolution/preference_signals.jsonl`（或同等服务封装），字段建议 `id/target_type/target_id/signal/comment/source/created_at/trace_id`。
  - API：新增 `POST /evolution/signals` 与 `GET /evolution/signals?target_type=&target_id=`；支持 memory up/downvote、chat thumbs、短评。
  - UI：[MemoryPanel.tsx](../web/app/settings/context/MemoryPanel.tsx) 的 upvote/downvote 调真实 API；confidence/views/upvotes/downvotes 不再由 id seed 伪造。
  - 验收：刷新页面后票数保留；未绑定 trace 的反馈仍可保存，绑定 trace 时能回查到 trace。

---

## P1

> P1 的完成标准：记忆能在对话前后被协调使用，Agent 行为模式可配置，插件钩子与网络安全边界有最小可运行版本。

- [x] **`memory-coordinator`**：新建 `backend/services/memory_coordinator.py`。
  - 交付：提供 `initialize(session_id, scope)`、`prefetch(query, k, scope)`、`queue_prefetch(query, scope)`、`after_turn(input, output, trace_id, tool_events)`、`save_reflection(summary, metadata)`、`on_pre_compress(messages)`、`shutdown()` 等薄接口；第一期实现可只调用现有 Chroma/JSON。
  - 挂接：后端 [/multi-agent/stream](../backend/main.py) / [/multi-agent/invoke](../backend/main.py) 先接入；Next [api/chat](../web/app/api/chat/route.ts) 可先通过后端 API 调用，避免在 TS 里复制记忆逻辑。
  - 约束：prefetch 只注入短摘要和来源，不把整段记忆塞进系统提示；使用固定 fence 标记 recall，明确“不是用户新输入”；预留敏感信息 scrub 与注入扫描。
  - 验收：关闭 `chatMemoryEnabled` 时不 prefetch；启用时 trace metadata 可看到 memory hit 数量；流式输出不会把 memory fence 原文泄漏给用户。

- [ ] **`agent-mode-setting`**：统一 Agent 行为模式。
  - 交付：`storage/agent_mode.json`，字段建议 `mode: ask|semi_auto|auto`、`max_steps`、`approval_bias`、`network_tier`。
  - API/UI：新增读取/更新接口，并在 Capabilities 或 Settings 中提供控制；默认 `semi_auto`。
  - 消费：[router.py](../backend/agents/router.py)、[orchestrator.py](../backend/agents/orchestrator.py)、[computer_use_service.py](../backend/services/computer_use_service.py) 读取，但高风险动作仍以审批服务为准。
  - 验收：auto 模式不会绕过 `requires_approval=True` 的 capability。

- [x] **`reflection-loop`**：任务完成后的轻量复盘。
  - 交付：在 [trace_store.py](../backend/utils/trace_store.py) finalize 后或上层调用点触发 reflection worker，生成短摘要、失败原因、可复用偏好。
  - 输出：摘要写入 `save_memory`；关键反馈追加到 [companion_state.py](../backend/core/companion_state.py) 的 `recent_feedback`。
  - 约束：不要在 trace 写锁内跑 LLM；失败不影响主任务完成。
  - 验收：成功/失败 trace 都能产生可选 reflection 记录；可通过开关禁用。

- [x] **`learning-data-pipeline`**：建立自我学习所需的统一事件底座。
  - 交付：新增 `backend/services/learning_data_pipeline.py`，统一接收 `chat_turn`、`agent_trace`、`tool_call`、`tool_result`、`memory_candidate`、`feedback_signal`、`skill_usage`、`publish_result` 等事件；第一期可落 `storage/evolution/events.jsonl`，但 schema 预留 SQLite/FTS 迁移。
  - 数据结构：字段至少包含 `id/kind/session_id/trace_id/source/channel/action/status/summary/artifact_ref/token_usage/cost/created_at`；大文本或二进制只存 artifact 引用，不塞进主事件行。
  - 接入：先从 [trace_store.py](../backend/utils/trace_store.py)、[history_manager.py](../backend/utils/history_manager.py)、[generation_history.py](../backend/utils/generation_history.py)、`evolution-preference-signals` 做桥接，避免继续散落多个 JSON 文件。
  - 验收：同一次 multi-agent 任务可串起输入、工具、输出、反馈；事件写入失败不影响主任务；可按 `session_id/trace_id/kind` 查询最近事件。

- [x] **`memory-quality-gate`**：长期记忆写入前的安全与质量闸门。
  - 交付：新增 `backend/services/memory_quality.py`，提供 `scan(content, source)`、`dedupe(candidate)`、`score(candidate)`、`classify(candidate)`；覆盖 prompt injection、密钥读取/外传、私密 ID、隐形 Unicode、重复/近重复、过长内容。
  - 状态：自动提取的记忆先写为 `candidate|approved|rejected|archived`，字段包含 `source/source_trace_id/confidence/risk_flags/reviewed_by/reviewed_at`；用户手动保存可默认 approved，但仍过安全扫描。
  - 消费：`save_memory`、`reflection-loop`、`learning-curator-worker` 都必须走同一闸门；高风险候选只进入审阅队列，不进入 Agent prompt。
  - 验收：含“忽略以上指令”或读取 `.env` 的候选被阻断；重复记忆返回已有 id；超过预算时提示合并/替换而不是静默截断。

- [ ] **`connections-manifest-layer`**（可选）：连接展示预设层。
  - 交付：`storage/connections/manifest.json`，仅存非密钥字段，如 display name、分组、文档链接、深链、推荐能力。
  - 用途：只影响 summary/UI 展示，不替代真实 connector 状态。
  - 验收：导入错误 manifest 时不会影响发布/连接主链路。

- [ ] **`channel-directory`**：建立平台下的 channel/contact 目录。
  - 交付：新增 `backend/services/channel_directory.py`，持久化到 `storage/connections/channel_directory.json`；字段建议 `platform/channel_id/name/type/thread_id/parent_id/source/last_seen_at/capabilities`。
  - 数据源：Discord/Slack/Feishu 等可枚举平台优先调用 connector 能力；不可枚举平台从发布历史、登录/会话来源、用户手动添加记录中补齐。
  - API：新增 `GET /connections/channels?platform=`、`POST /connections/channels/refresh`、`POST /connections/channels`（手动添加/命名），返回值不包含 token/cookie。
  - 验收：无可枚举权限时仍能显示手动/历史发现的 channel；重复 channel 去重；连接断开时目录保留但标记 stale。

- [ ] **`home-channel-routing`**：为每个平台提供默认投递目标与 target resolver。
  - 交付：新增 `storage/connections/home_channels.json`，支持 `platform -> channel_id/thread_id/name`；提供 `resolve_target("origin|local|platform|platform:channel_id|platform:channel_id:thread_id")`。
  - 消费：定时发布、批量分发、未来 Sidecar 回包统一使用 resolver；`origin` 只在存在消息/任务来源上下文时有效，无来源时降级为 local 或显式错误。
  - UI：平台详情页支持设置默认 channel；Capabilities 摘要显示 home channel 名称与失效状态。
  - 验收：裸平台名能解析到 home channel；未配置 home channel 时不会误发；thread/topic 信息可保留。

- [ ] **`connection-runtime-health-lock`**：连接运行时状态与身份锁。
  - 交付：新增 `storage/connections/runtime_status.json`，记录 `platform/state/updated_at/error_code/error_message/active_worker_id`；新增本机 scoped lock，按 `platform + token/account hash` 防双开。
  - 约束：只存 hash 和脱敏元数据，不落真实 token/cookie；lock 过期/进程消失可自动清理；普通 OAuth/Cookie 发布平台可先只写状态，不启强锁。
  - 验收：同一 bot token 第二个 worker 启动时得到明确错误；fatal 状态可在 summary/UI 看见；disconnect 会释放 lock。

- [ ] **`skills-plugin-runtime`**：建立 Hermes 式插件表面，但不改现有 skills 语义。
  - 交付：新增 `backend/plugins/` 或 `storage/plugins/` manifest loader；支持声明工具、capability、`pre_tool`、`post_tool`，并预留 `on_session_start`、`on_session_end`、`transform_tool_result`、`provider_kind`。
  - 共存：继续保留 [main.py](../backend/main.py) 中 `SKILLS_ENABLED_PATH` / skills API；插件只做运行时扩展，不重写 `.agent/skills`。
  - 最小版本：先支持只读 discovery + no-op hook，再接入一个内部示例插件；插件类型先限定为 `standalone`，后续再扩 `media_provider`、`context_engine`、`platform_adapter`。
  - 验收：禁用插件后工具注册和 hooks 完全消失；插件异常被隔离并记录日志。

- [ ] **`skill-progressive-disclosure`**：把 Skill 从“全量说明”升级为索引 + 按需加载。
  - 交付：为 `.agent/skills` 建立 lightweight index，字段包含 `name/description/category/tags/platforms/requires_env/readiness/source/trust_level`；Agent 默认只看索引，需要执行时再加载 `SKILL.md` 与 references/templates/scripts/assets。
  - 约束：不改变现有 `SKILL.md` 格式；缺 frontmatter 的旧 Skill 走兼容解析；外部或用户导入 Skill 不自动进入高权限工具集。
  - 验收：列出技能时不读取大文件；禁用某个 skill 后不会出现在 Agent 可见索引；缺 env 的 skill 显示 `setup_needed` 而不是执行时报错。

- [ ] **`capability-toolset-profiles`**：为架构分类增加场景化能力组合。
  - 交付：在 [capabilities.py](../backend/core/capabilities.py) 或独立 `capability_profiles.py` 中定义 `safe/content/media/publish/research/computer_use/dev` 等 profile，映射 capabilities、tools、默认预算、默认审批策略。
  - UI：Capabilities / Workbench 按 profile 展示，而不是只按技术模块平铺；`agent-mode-setting` 可选择 profile 或继承任务路由结果。
  - 验收：safe profile 不包含本地写文件/发布/高风险浏览器动作；publish profile 明确依赖平台连接状态；profile 变更不影响底层 capability 的 `requires_approval`。

- [ ] **`gateway-decision-adr`**：明确 Gateway/Sidecar 的边界。
  - 交付：在 [ARCHITECTURE_OVERVIEW.md](ARCHITECTURE_OVERVIEW.md) 或独立 ADR 写明：默认不启动 Hermes Gateway；若做 Sidecar，仅转发到现有 [/multi-agent/stream](../backend/main.py)、[/multi-agent/invoke](../backend/main.py) 或 Next [/api/chat](../web/app/api/chat/route.ts)。
  - 必写：认证、审计、消息来源标签、限流、断线恢复、失败降级。
  - 禁止：假设存在 FastAPI `POST /chat`；禁止在 Sidecar 中接收平台密钥。

- [ ] **`arch-doc-runtime`**：更新运行时架构。
  - 交付：在 [ARCHITECTURE_OVERVIEW.md](ARCHITECTURE_OVERVIEW.md) 增加 Runtime 四层：`AgentRuntime`、`ToolRuntime`、`LearningSignals`、`ConnectionsFacade`。
  - 覆盖：PluginSurface、GatewayOptional、ComputerNetworkSurface、MemoryCoordinator、AgentMode。
  - 验收：图与文字都指向真实文件和真实接口。

- [ ] **`network-tier-ssrf`**：为联网工具补安全分层。
  - 交付：新增 URL 校验/分级纯函数，覆盖 public web search、受控 fetch、开放 URL 读取。
  - 规则：禁止私网/localhost/file URL；限制重定向层数、响应体大小、content-type；记录来源 URL。
  - 对齐：[research_artifact.py](../backend/core/research_artifact.py)、`/research/web-search`、Next chat 的 `fetchWebContent`。
  - 验收：单测覆盖 SSRF、重定向到私网、超大响应、非 http(s)。

---

## P2

- [ ] **`evolution-tool-telemetry`**：按 trace / tool / agent 聚合成功率、耗时、失败原因；先落 `storage/evolution/tool_telemetry.jsonl`，后续再做仪表盘或 [router.py](../backend/agents/router.py) 软加权。
- [ ] **`evolution-lessons-playbooks`**：审批拒绝 / CU 失败 / semi-auto 中断 → 结构化 `lessons.jsonl`；字段建议 `trigger/context/lesson/recommended_action/confidence/source_trace_id`。
- [x] **`session-search-recall`**：把“过去会话经验”升级为可检索 episodic memory。
  - 交付：在 `learning-data-pipeline` 的事件层之上增加 `session_search(query, role_filter=None, limit=3)` 服务；第一期可用 SQLite FTS5 或现有 JSONL 索引，后续与 `session-sqlite-fts` 合并。
  - 行为：按消息命中检索，归并到 session/trace，排除当前 session lineage；对长会话只截取命中附近窗口，再用辅助模型生成聚焦摘要；空 query 返回最近会话 metadata。
  - 用途：Agent 在用户提到“上次”“之前那个方案”“我们当时怎么修的”时主动调用；返回摘要、来源、日期、trace/session id，不直接注入历史全文。
  - 验收：能搜到历史 chat/generation/trace 中的关键词；当前会话不会重复召回自己；辅助模型不可用时返回短 preview fallback。
- [ ] **`tool-result-compaction`**：为长工具输出建立结构化压缩层。
  - 交付：新增 `backend/services/tool_result_compactor.py`，对 terminal、browser、read/search、RAG、publisher、media generation 等结果生成短摘要，字段建议 `tool_name/action/inputs_preview/status/key_outputs/error/artifact_ref/raw_size`。
  - 策略：原始大输出写入 `storage/traces/artifacts/` 或对应 artifact store；trace 和 LLM 上下文只保留摘要与引用；失败结果保留可复现命令、错误码、关键文件路径。
  - 验收：超长工具输出不会进入下一轮 prompt；trace 页面仍可打开原始结果；摘要能区分 success/error/partial。
- [ ] **`context-engine-compression`**：抽象 Hermes 式 ContextEngine，负责上下文预算而不是长期记忆。
  - 交付：新增 `backend/services/context_engine.py`，定义 `update_from_response`、`should_compress`、`compress`、`on_session_start`、`on_session_end`、`get_status`；默认实现可只做 token/字符估算与 no-op 状态。
  - 压缩规则：保护 system/head 与最近 tail；中段摘要必须标记 `REFERENCE ONLY`，明确旧请求不是新指令；压缩前调用 `memory_coordinator.on_pre_compress(messages)` 抽取可沉淀事实。
  - 验收：达到阈值时生成 reference-only handoff；摘要不会包含“请执行旧任务”的活动指令；可通过配置关闭。
- [ ] **`skill-curator-usage`**：借鉴 Hermes `skill_usage`，为 Agent 创建的 Skill 建立使用侧车；字段建议 `created_by/use_count/view_count/patch_count/last_used_at/last_viewed_at/state/pinned/archived_at`。
  - 约束：只自动管理 `created_by=agent` 的 Skill；内置、人工、外部 Hub Skill 默认不可归档/覆盖；pinned skill 禁止 Agent 自动修改。
  - 验收：执行/查看/修改 Skill 后计数更新；低使用 Skill 只进入 stale，不自动删除；用户可 pin/unpin。
- [x] **`learning-curator-worker`**：后台自学习与知识整理 worker。
  - 交付：新增 `backend/services/learning_curator.py`，定期或 idle 触发，读取 `learning-data-pipeline`、memory candidates、skill usage、lessons；输出报告与候选操作，不默认直接改长期资产。
  - 约束：默认 dry-run；可暂停；只处理 `created_by=agent` 或 `source=reflection/agent` 的候选；禁止删除，只能建议 archive/merge；内置/人工/外部 Skill 与 approved user memory 需要显式审批。
  - 输出：`storage/evolution/curator_runs/{run_id}/report.md` + `run.json`，记录建议新增/合并/归档的 memory、playbook、Skill，以及证据 trace。
  - 验收：无活动或首次启动不会立刻大规模修改；报告可复查；同一建议重复出现会合并计数而非无限新增。
- [x] **`knowledge-memory-separation`**：明确不同知识层的边界，避免“什么都塞进 memory”。
  - 交付：定义 taxonomy：`user_profile`、`agent_memory`、`episodic_session`、`procedural_skill`、`domain_knowledge_rag`、`feedback_signal`、`tool_telemetry`；更新 memory metadata 与 Settings UI 文案。
  - 规则：用户偏好进 profile；项目事实/环境经验进 agent memory；文档资料进 RAG；可复用流程进 Skill/playbook；单次任务日志进 session/trace；投票和否定进 signals。
  - 验收：同一条候选能被分类到唯一主类型；RAG 文档不会进入系统提示记忆；删除某类数据不误删其他类。
- [x] **`memory-evaluation-loop`**：让记忆使用可被衡量和修正。
  - 交付：记录 memory recall 的 `hit_id/query/session_id/used_in_response/user_feedback/outcome`；在 Memory UI 展示真实 views/useful/rejected/stale，而非本地 seed。
  - 行为：低置信、反复被否定、长期未使用的记忆进入 review/stale；被多次采纳的记忆提升 confidence；错误记忆可生成替换建议。
  - 验收：Agent 使用某条记忆后有 usage 记录；用户 downvote 会影响该记忆状态；curator 能根据 usage/outcome 生成整理建议。
- [ ] **`skill-security-provenance`**：为外部或 Agent 生成 Skill 增加来源、信任与安全扫描。
  - 交付：引入 `source/trust_level/content_hash/installed_at/audit_log`，外部 Skill 先进入 quarantine，扫描通过后安装；扫描规则覆盖 prompt injection、密钥读取、持久化、破坏性命令、网络外传。
  - 验收：危险 Skill 被阻断且保留报告；trusted source 与 community source 策略不同；扫描失败不会破坏已有 Skill。
- [ ] **`action-command-registry`**：统一 UI action、Agent tool、Sidecar slash command 的元数据。
  - 交付：建立轻量 action registry，字段建议 `id/title/category/profile/deep_link/api_route/capability_id/risk_level/enabled_when`。
  - 用途：Workbench、Capabilities、未来 Sidecar help/autocomplete、Agent tool 描述共享同一份名称和分组。
  - 验收：新增一个 action 只需注册一次即可在 UI/帮助/能力摘要中出现；禁用 capability 后 action 自动显示不可用原因。
- [ ] **`channel-session-context`**：沉淀跨 channel 的来源上下文。
  - 交付：为未来 Sidecar / 消息入口定义 `SessionSource` 等价结构，字段建议 `platform/chat_id/chat_name/chat_type/user_id/user_name/thread_id/topic/message_id`，并支持 PII hash 展示。
  - 用途：让 Agent 知道“当前来自哪个 channel、可回哪里、有哪些已连接投递目标”，但不把原始敏感 ID 暴露给普通 UI 摘要。
  - 验收：group/thread 可选择按用户隔离或共享 session；channel topic 可作为短上下文注入；无 Sidecar 时不影响现有 Web chat。
- [ ] **`browser-layer-cdp`**（验证痛点后）：借鉴 Hermes `browser_supervisor` / CDP；与 Playwright **并行**，默认不改 [computer_use_service.py](../backend/services/computer_use_service.py) 主路径。
- [ ] **`terminal-env-abstraction`**：文档 + `TerminalBackend` 薄接口预留；第一期仍为目录沙箱 + Shell allowlist + 审批，不引入远程终端。
- [ ] **`memory-backend-abstract`**（扩展）：`MemoryBackend` 协议 + Chroma 实现 + NoOp；为外部记忆服务预留，避免继续把所有语义写死在 [vector_store.py](../backend/utils/vector_store.py)。
- [ ] **`memory-context-cache-policy`**（扩展）：会话启动时生成 memory snapshot；会话中写入立即持久化但不重建大系统提示；下一轮仅通过 bounded prefetch 注入短上下文。
  - 验收：同一会话内保存记忆不会导致系统提示重建；新会话可刷新 snapshot；压缩前可调用 `on_pre_compress` 抽取事实。
- [ ] **`sidecar-prototype`**（扩展）：只有在需要 Telegram/Discord/Feishu 常驻 inbound 时再立项；转发至现有 **`/multi-agent/stream`**（或 invoke）及 Next **`/api/chat`** 代理链，而非虚构的 `POST /chat`。

---

## P3（二期候选 · 按需）

> 对应计划 **§9 附录**。仅当痛点明确（检索、成本、多 key、超长上下文、IDE 集成）再拆迭代。

- [ ] **`session-sqlite-fts`**：SQLite + FTS5 会话与消息检索；来源标签（web/cli/bot）；与 [POST /chat/history](../backend/main.py)、trace 并存或可渐进迁移。若 P2 已完成 `session-search-recall`，本项升级为“把 JSONL/轻量索引迁到 SQLite + FTS5 + trigram”。
- [ ] **`llm-credential-pool`**：多 API Key 轮换 / 策略；与 [llm_provider.py](../backend/core/llm_provider.py) 叠加。
- [ ] **`delegate-subagent-tool`**：工具形态子 Agent（隔离 budget、并发上限、费用归因）；**不**替换现有 [orchestrator.py](../backend/agents/orchestrator.py) Supervisor。
- [ ] **`context-compression-auto`**：在 `context-engine-compression` 的接口上启用真实自动摘要 + 保护最近 N 轮；可选 auxiliary 模型；与 `memory-coordinator` 分工。
- [ ] **`conversation-checkpoints`**：对话/工具状态快照与回溯（区别于 CU 审批恢复）。
- [ ] **`approval-smart-assist`**：LLM **仅预标注**审批队列；**不**自动执行高风险步骤；审计对齐 [approval_service.py](../backend/services/approval_service.py)。
- [ ] **`agent-budget-unified`**：对外单一「回合/步数/token 预算」旋钮；映射 orchestrator / Computer Use（与 `agent-mode-setting` 合并设计）。
- [ ] **`acp-or-batch`**（极按需）：ACP IDE 适配或批处理评测流水线。

---

## 任务模板（新增条目按此写）

```md
- [ ] **`task-id`**：一句话目标。
  - 交付：改哪些文件 / 新增哪些 API / 数据结构。
  - 约束：安全、兼容、凭证、审批、降级策略。
  - 验收：至少 2 条可执行检查；包含失败/空态。
```

---

## 验证与质量门禁（摘录）

| 类型              | 建议                                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 后端单测 / 行为测 | [tests/test_super_agent_foundation.py](../tests/test_super_agent_foundation.py)：连接摘要、manifest 解析、网络 SSRF/重定向、`approval_service` 兼容等增量用例 |
| Computer Use API  | [tests/test_computer_use_api.py](../tests/test_computer_use_api.py)（若改动 CU / 审批门控）                                                                   |
| 前端              | `npx eslint` 覆盖改动的 Capabilities / Memory / Chat 相关 TSX                                                                                                 |
| 密钥安全          | 自动化测试中 **勿** 引入真实 token；manifest 仅非密钥字段                                                                                                     |

建议命令：

```bash
# 后端：按改动范围跑局部测试
cd backend
python -m pytest ../tests/test_super_agent_foundation.py

# 前端：覆盖设置页 / chat 改动
cd web
npm run lint
```

> 若只改文档，可不跑测试；若新增 API，至少补一条行为测试或用 TestClient 覆盖 happy path + 空态/失败态。

---

## 与计划 YAML 的 id 对照

计划 frontmatter 中共 **15** 条核心 `id`，与本清单对应关系如下（便于 PR 标题引用）：

`memory-save-tool` · `connections-summary` · `connections-manifest-layer` · `memory-coordinator` · `agent-mode-setting` · `reflection-loop` · `evolution-preference-signals` · `evolution-tool-telemetry` · `evolution-lessons-playbooks` · `skills-plugin-runtime` · `gateway-decision-adr` · `arch-doc-runtime` · `network-tier-ssrf` · `browser-layer-cdp` · `terminal-env-abstraction`

本清单 **P2/P3 扩展项**（`memory-backend-abstract`、`sidecar-prototype`、`session-sqlite-fts` 等）来自计划正文 §9 或优先级表，**未全部写入** Cursor YAML，仍以本文档为准勾选。

第六次 / 第七次校对新增的扩展候选（`skill-progressive-disclosure`、`capability-toolset-profiles`、`channel-directory`、`home-channel-routing`、`connection-runtime-health-lock`、`skill-curator-usage`、`skill-security-provenance`、`action-command-registry`、`channel-session-context`、`memory-context-cache-policy`）暂不计入 Cursor YAML 的 15 条核心 id；若后续开工，可单独补入计划 frontmatter。

第八次校对新增的扩展候选（`learning-data-pipeline`、`memory-quality-gate`、`session-search-recall`、`tool-result-compaction`、`context-engine-compression`、`learning-curator-worker`、`knowledge-memory-separation`、`memory-evaluation-loop`）同样暂不计入 Cursor YAML 的 15 条核心 id；它们是“真正具备自我学习能力”的数据与治理底座，建议优先从 P1/P2 拆小 PR。

---

## 勾选说明

完成任务后将 `- [ ]` 改为 `- [x]`，或在 PR / Commit 描述中引用 **`id`**（例如 `memory-save-tool`）。

推荐提交粒度：一个 PR 只完成一个 P0/P1 id；如果同时改后端和前端，PR 描述需列出 API contract、UI 入口、验证命令。

---

## 修订记录

| 日期       | 说明                                                                                                                                                                                                           |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-05 | 初版                                                                                                                                                                                                           |
| 2026-05-05 | 二次核对：新增 P3 §9 附录项                                                                                                                                                                                    |
| 2026-05-05 | 三次更新：落地索引、依赖顺序、验证表、YAML id 对照、P2 拆分 `memory-backend-abstract` / `sidecar-prototype`                                                                                                    |
| 2026-05-05 | 第四次校对：计划链接改为 Cursor Plans（仓库内通常无 `.cursor/plans`）；Sidecar / memory-coordinator 对齐真实路由（`/multi-agent/stream`、`/api/chat`）；`skills-plugin-runtime` 表述改为 `SKILLS_ENABLED_PATH` |
| 2026-05-05 | 第五次校对：补充当前基线、P0/P1 交付与验收、任务模板、真实 API / 文件锚点                                                                                                                                      |
| 2026-05-05 | 第六次校对：补充 Hermes 记忆 provider lifecycle、memory context fence、Skill 渐进披露、Skill curator、安全来源治理、toolset/profile 分类与统一 action registry 借鉴点                                          |
| 2026-05-05 | 第七次校对：补充 Hermes PlatformConfig、HomeChannel、DeliveryTarget、channel directory、runtime status、scoped lock 与 channel session context 的连接管理借鉴点                                                |
| 2026-05-05 | 第八次校对：补充 Hermes memory quality gate、SQLite/FTS session recall、ContextEngine compression、tool result compaction、learning data pipeline 与后台 curator 自学习闭环                                    |
