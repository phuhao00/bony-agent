# AI Media Agent — 变更日志

> 本文档按版本记录所有功能变更、修复与优化。最新版本在最上方。
> 格式遵循 [Keep a Changelog](https://keepachangelog.com/) 规范。

---

## [Unreleased] — 开发中

### 新功能
- 全量功能清单文档（54+ 技能 / 14+ 平台 / 42+ 模块）
- 投资路演文档 V3 数据同步
- 新增 CHANGELOG.md 自动维护

### 文档
- 更新 README.md 技能列表从 18+ 到 54+
- 更新 INVESTOR_DECK.md 所有核心数据
- 新增 FEATURE_LIST.md 全量功能清单

---

## [v1.0.36] — 2026-06-12

> **AI Media Agent 桌面版 v1.0.36** — 正式发布，包含 Labs 专业助手、Desktop Operator、System Assistant、Claude Code 工作区、AI 客服系统等重磅功能。


### 🎨 媒体生成
- 2026-06-11 [204dc485](https://github.com/phuhao00/ai-media-agent/commit/204dc485) feat(knowledge): add content view/edit, one-click optimize, and upload polish
- 2026-06-11 [229a0dbc](https://github.com/phuhao00/ai-media-agent/commit/229a0dbc) fix(knowledge): support image PDF upload without blocking list APIs
- 2026-06-10 [29d30697](https://github.com/phuhao00/ai-media-agent/commit/29d30697) feat(media): add dedicated HappyHorse video studio and DashScope integration.
- 2026-06-10 [d8f65a36](https://github.com/phuhao00/ai-media-agent/commit/d8f65a36) chore(web): remove image gradient test page from navigation.
- 2026-06-10 [335c0ae5](https://github.com/phuhao00/ai-media-agent/commit/335c0ae5) feat(media): upgrade DashScope PSD split to five-stage precision pipeline.
- 2026-06-09 [ed2c5997](https://github.com/phuhao00/ai-media-agent/commit/ed2c5997) feat(media): add LayerD image-to-PSD and AI customer service.
- 2026-06-08 [5808a5f3](https://github.com/phuhao00/ai-media-agent/commit/5808a5f3) fix(media): refine watermark text removal with local OCR inpaint.
- 2026-06-08 [fe67169e](https://github.com/phuhao00/ai-media-agent/commit/fe67169e) feat(media): add targeted watermark removal by area or text.
- 2026-06-08 [512c0fc6](https://github.com/phuhao00/ai-media-agent/commit/512c0fc6) fix(media): correct inpaint reference replace mask scaling and local paste.
- 2026-06-08 [8e52a852](https://github.com/phuhao00/ai-media-agent/commit/8e52a852) feat(media): fix mask tools, add inpaint replace, export, and shortcuts.
- 2026-06-08 [ce2428bd](https://github.com/phuhao00/ai-media-agent/commit/ce2428bd) feat(media): add reference-image edit with intent workflow UX
- 2026-06-08 [b3b399cb](https://github.com/phuhao00/ai-media-agent/commit/b3b399cb) feat(media): expand image edit with 11 modes, batch queue, and selection tools.
- 2026-06-08 [26c929ae](https://github.com/phuhao00/ai-media-agent/commit/26c929ae) feat(media): polish image edit UI with compare slider and canvas tools.
- 2026-06-08 [ed0de644](https://github.com/phuhao00/ai-media-agent/commit/ed0de644) feat(media): add precise image editing with inpaint, instruction edit, and outpaint.
- 2026-06-06 [580566f7](https://github.com/phuhao00/ai-media-agent/commit/580566f7) feat(media): wire taste-skill anti-slop art direction into image/video/copy pipelines.
- 2026-06-04 [9ac4b320](https://github.com/phuhao00/ai-media-agent/commit/9ac4b320) feat(meal): workbench tab, identity merge, and upload image dedup
- 2026-06-03 [0fa1d0db](https://github.com/phuhao00/ai-media-agent/commit/0fa1d0db) feat(meal): attendance in stats/export, group member picker, Excel images
- 2026-05-31 [1f9b2ed4](https://github.com/phuhao00/ai-media-agent/commit/1f9b2ed4) chore(env): add PEXELS_API_KEY for auto short video stock footage
- 2026-05-31 [70ac0e1c](https://github.com/phuhao00/ai-media-agent/commit/70ac0e1c) feat(media): add one-click auto short video pipeline (MoneyPrinterTurbo style)
- 2026-05-25 [495bf1e0](https://github.com/phuhao00/ai-media-agent/commit/495bf1e0) fix(multimodal): use qwen-vl-max for Alibaba image understanding
- 2026-05-24 [17415692](https://github.com/phuhao00/ai-media-agent/commit/17415692) fix(web): disable Next image optimizer in standalone for Electron logo
- 2026-05-19 [5ec2e468](https://github.com/phuhao00/ai-media-agent/commit/5ec2e468) fix: bundle ffmpeg via imageio-ffmpeg; auto-symlink in APP_DATA/bin at startup
- 2026-05-15 [48bad73f](https://github.com/phuhao00/ai-media-agent/commit/48bad73f) fix(web): long-video poll errors, chat composer menu clipping
- 2026-05-12 [ecc5461c](https://github.com/phuhao00/ai-media-agent/commit/ecc5461c) update media and video tools
- 2026-05-12 [1948e7de](https://github.com/phuhao00/ai-media-agent/commit/1948e7de) fix(workflow): video/image fills panel height when dragged larger
- 2026-05-12 [bdcf1c91](https://github.com/phuhao00/ai-media-agent/commit/bdcf1c91) feat(workflow): redesign result panel — full-bleed video, floating actions, image grid, footer
- 2026-05-12 [48f25956](https://github.com/phuhao00/ai-media-agent/commit/48f25956) fix(workflow): deduplicate video/image URLs in result renderer
- 2026-05-12 [4c990b81](https://github.com/phuhao00/ai-media-agent/commit/4c990b81) feat(workflow): rich result display with video player, image preview, and formatted text
- 2026-05-11 [f6beeb7d](https://github.com/phuhao00/ai-media-agent/commit/f6beeb7d) feat: add multi-select + poster/card/video generation to financial-news page
- 2026-05-10 [a470844e](https://github.com/phuhao00/ai-media-agent/commit/a470844e) docs(architecture): sync docs with codebase — add ai-news, long_video_agent, missing settings pages

### 🧪 Labs 专业助手
- 2026-06-12 [96aa8ca4](https://github.com/phuhao00/ai-media-agent/commit/96aa8ca4) fix(web): unify Labs assistant layouts so results scroll and composer stays at bottom.
- 2026-06-12 [7f5d4a6e](https://github.com/phuhao00/ai-media-agent/commit/7f5d4a6e) fix(web): resolve Next.js build errors in Labs layouts and knowledge optimize.
- 2026-06-12 [f26eff5a](https://github.com/phuhao00/ai-media-agent/commit/f26eff5a) feat(web): role-specific Labs agent layouts and knowledge auto-optimize
- 2026-06-12 [126d007b](https://github.com/phuhao00/ai-media-agent/commit/126d007b) feat: add procurement and specialized business assistant pages in Labs.
- 2026-06-12 [3b4706bf](https://github.com/phuhao00/ai-media-agent/commit/3b4706bf) feat: add Product Manager and Legal Advisor agents with workbench UI.
- 2026-06-12 [77fbdb27](https://github.com/phuhao00/ai-media-agent/commit/77fbdb27) feat: add Desktop Operator agent, native GUI bridge, and standalone UI
- 2026-06-12 [3ddfc00e](https://github.com/phuhao00/ai-media-agent/commit/3ddfc00e) feat: add System Assistant environment adaptation and smart UI
- 2026-06-12 [80b33a14](https://github.com/phuhao00/ai-media-agent/commit/80b33a14) feat: add System Assistant for local computer maintenance

### 🖥️ 桌面端与打包
- 2026-06-12 [bb70869b](https://github.com/phuhao00/ai-media-agent/commit/bb70869b) fix(electron): stabilize Windows packaging build for Next.js and desktop-pet.
- 2026-06-12 [5f204a03](https://github.com/phuhao00/ai-media-agent/commit/5f204a03) fix(electron): bundle Windows venv-prebuilt and repair lark-cli install.
- 2026-06-12 [49b0271a](https://github.com/phuhao00/ai-media-agent/commit/49b0271a) fix(electron): resolve Windows startup TDZ and bundled lark-cli install.
- 2026-06-12 [86c793db](https://github.com/phuhao00/ai-media-agent/commit/86c793db) feat: align Mac/Win Electron packaging with build cache and expand assistant platform.
- 2026-06-10 [7831223c](https://github.com/phuhao00/ai-media-agent/commit/7831223c) fix(packaging): auto-install bundled skills/MCP and parallelize Windows setup.
- 2026-06-10 [379ca240](https://github.com/phuhao00/ai-media-agent/commit/379ca240) feat(packaging): bundle agent skills and MCP defaults into desktop installers.
- 2026-06-10 [080076e7](https://github.com/phuhao00/ai-media-agent/commit/080076e7) fix(packaging): sync Electron Windows bundle and improve source zip build.
- 2026-06-08 [812d2986](https://github.com/phuhao00/ai-media-agent/commit/812d2986) refactor(desktop-pet): unify character switching into a single chip flow.
- 2026-06-08 [0f9f4afc](https://github.com/phuhao00/ai-media-agent/commit/0f9f4afc) chore(electron): refresh bundled install helper and directory service.
- 2026-06-07 [d674676e](https://github.com/phuhao00/ai-media-agent/commit/d674676e) fix(desktop-pet): improve context menu layout and switch feedback.
- 2026-06-06 [ef8d3ad1](https://github.com/phuhao00/ai-media-agent/commit/ef8d3ad1) feat(desktop-pet): redesign character switcher with scene-based layout.
- 2026-06-06 [5272379e](https://github.com/phuhao00/ai-media-agent/commit/5272379e) feat(desktop-pet): add GG Bond superhero pig as fifth pet character.
- 2026-06-06 [7a1560e6](https://github.com/phuhao00/ai-media-agent/commit/7a1560e6) feat(desktop-pet): add Xiong Er plush bear as fourth pet character.
- 2026-06-06 [66498b6d](https://github.com/phuhao00/ai-media-agent/commit/66498b6d) feat(desktop-pet): add star, Kitty, and 3D Peppa character switching.
- 2026-06-02 [44415b0a](https://github.com/phuhao00/ai-media-agent/commit/44415b0a) feat(desktop-pet): perch pet on chat header with coquettish idle animations
- 2026-06-02 [a7a07307](https://github.com/phuhao00/ai-media-agent/commit/a7a07307) fix(desktop-pet): macOS voice input STT and cross-platform packaging
- 2026-06-02 [75e83016](https://github.com/phuhao00/ai-media-agent/commit/75e83016) fix(desktop-pet): bundle Windows sidecar and fix launch status false positives
- 2026-06-02 [0426da63](https://github.com/phuhao00/ai-media-agent/commit/0426da63) feat(desktop-pet): add Tauri companion sidecar with pet API and cross-platform packaging
- 2026-05-31 [93655c6d](https://github.com/phuhao00/ai-media-agent/commit/93655c6d) docs(electron): expand Mac packaging skill to v1.4.0
- 2026-05-31 [6773d098](https://github.com/phuhao00/ai-media-agent/commit/6773d098) feat(electron): embedded dashboard, splash startup, and Playwright auto-install
- 2026-05-29 [7f9b491a](https://github.com/phuhao00/ai-media-agent/commit/7f9b491a) fix(electron): sync backend on launch and document Mac packaging pitfalls
- 2026-05-26 [51073401](https://github.com/phuhao00/ai-media-agent/commit/51073401) fix(electron): RAG/lark-cli/vision models for packaged Mac builds
- 2026-05-25 [e523ce5c](https://github.com/phuhao00/ai-media-agent/commit/e523ce5c) chore(electron): refresh bundled binaries for v1.0.36 desktop builds
- 2026-05-25 [a14eaf46](https://github.com/phuhao00/ai-media-agent/commit/a14eaf46) fix(electron): add Windows packaging, bundled Node, and port/service fixes
- 2026-05-25 [370ad686](https://github.com/phuhao00/ai-media-agent/commit/370ad686) docs(skill): expand electron-mac-packaging for bundled Python, Node, and logo fixes
- 2026-05-25 [08d59130](https://github.com/phuhao00/ai-media-agent/commit/08d59130) fix(electron): bundle Python, portable Node, and real app logo for macOS installs
- 2026-05-24 [809c7987](https://github.com/phuhao00/ai-media-agent/commit/809c7987) docs(skill): add electron-mac-packaging skill and logo build gates
- 2026-05-24 [69365c00](https://github.com/phuhao00/ai-media-agent/commit/69365c00) fix(electron): harden pip install on macOS and reject Homebrew venv
- 2026-05-22 [84cfe15b](https://github.com/phuhao00/ai-media-agent/commit/84cfe15b) fix(electron): rebuild venv when pip is corrupted (v1.0.31)
- 2026-05-22 [b5b9b9b0](https://github.com/phuhao00/ai-media-agent/commit/b5b9b9b0) fix(electron): auto-repair missing Python venv on launch (v1.0.30)

### 🤖 Agent 与 AI
- 2026-06-11 [e8774bb8](https://github.com/phuhao00/ai-media-agent/commit/e8774bb8) feat(claude-code): expand slash commands with grouped palette and skill discovery.
- 2026-06-11 [5dccd5d0](https://github.com/phuhao00/ai-media-agent/commit/5dccd5d0) feat(claude-code): add multi-turn chat UI with compact input bar.
- 2026-06-11 [e18fc07d](https://github.com/phuhao00/ai-media-agent/commit/e18fc07d) feat(claude-code): embed Claude Agent SDK with Qwen provider and startup bootstrap.
- 2026-06-11 [89ea1732](https://github.com/phuhao00/ai-media-agent/commit/89ea1732) feat(code-analyst): bind workspace root to chat so agents explore the repo proactively.
- 2026-06-10 [da01eccb](https://github.com/phuhao00/ai-media-agent/commit/da01eccb) feat(openclaw): redesign console to match Hermes layout without 3D scene.
- 2026-06-10 [5c543af0](https://github.com/phuhao00/ai-media-agent/commit/5c543af0) refactor(chat): make multi-agent the default and only chat mode.
- 2026-06-10 [b0660836](https://github.com/phuhao00/ai-media-agent/commit/b0660836) feat(hermes): integrate Hermes runtime, last30days research, and TurboVec memory.
- 2026-05-29 [3e8a583c](https://github.com/phuhao00/ai-media-agent/commit/3e8a583c) feat(agent): unify Direct and Multi-Agent on LangGraph Graph Router
- 2026-05-06 [041e5573](https://github.com/phuhao00/ai-media-agent/commit/041e5573) feat(multi-agent): long_video_agent + Nova composer contrast
- 2026-05-21 [4b207725](https://github.com/phuhao00/ai-media-agent/commit/4b207725) fix(companion): enable web search in multi-agent path for realtime queries
- 2026-05-05 [f5e16ee4](https://github.com/phuhao00/ai-media-agent/commit/f5e16ee4) feat: Hermes alignment groundwork — memory, connections summary, evolution
- 2026-04-29 [dc5e8db1](https://github.com/phuhao00/ai-media-agent/commit/dc5e8db1) feat: multi-agent orchestration with streaming, tracing and augmented LLM
- 2026-04-23 [9ad62e87](https://github.com/phuhao00/ai-media-agent/commit/9ad62e87) feat: enhance computer-use service, update lark-cli UI and add hermes-agent page
- 2026-03-12 [1b0ff5c2](https://github.com/phuhao00/ai-media-agent/commit/1b0ff5c2) feat: 🦞 新增专注 OpenClaw 交互的前端页签与后端直连 API
- 2026-03-12 [44b79d34](https://github.com/phuhao00/ai-media-agent/commit/44b79d34) fix: 🦞 再次修正 OpenClaw CLI 调用命令，使用默认存在的 main Agent
- 2026-03-12 [d0f92771](https://github.com/phuhao00/ai-media-agent/commit/d0f92771) fix: 🦞 OpenClaw CLI 追加 --agent 选项避免报错
- 2026-03-12 [d453eb68](https://github.com/phuhao00/ai-media-agent/commit/d453eb68) fix: 🦞 修正 OpenClaw CLI 调用命令为 openclaw agent
- 2026-03-12 [cd1e0b6b](https://github.com/phuhao00/ai-media-agent/commit/cd1e0b6b) fix: 🦞 修复 Bilibili 热点抓取 + 修正 OpenClaw API 调用方式

### 🧠 知识库与上下文
- 2026-06-11 [204dc485](https://github.com/phuhao00/ai-media-agent/commit/204dc485) feat(knowledge): add content view/edit, one-click optimize, and upload polish
- 2026-06-11 [229a0dbc](https://github.com/phuhao00/ai-media-agent/commit/229a0dbc) fix(knowledge): support image PDF upload without blocking list APIs
- 2026-06-10 [b0660836](https://github.com/phuhao00/ai-media-agent/commit/b0660836) feat(hermes): integrate Hermes runtime, last30days research, and TurboVec memory.
- 2026-06-07 [d674676e](https://github.com/phuhao00/ai-media-agent/commit/d674676e) fix(desktop-pet): improve context menu layout and switch feedback.
- 2026-06-06 [d56104f2](https://github.com/phuhao00/ai-media-agent/commit/d56104f2) feat(context): align memory, sessions, skills, and codegraph in My Context.
- 2026-05-31 [cc061f7d](https://github.com/phuhao00/ai-media-agent/commit/cc061f7d) feat(memory): add dream engine, memory graph export, and context UI tabs
- 2026-05-26 [08a34f55](https://github.com/phuhao00/ai-media-agent/commit/08a34f55) fix(knowledge): show indexed docs in search and repair FAQ category counts
- 2026-05-26 [957cc981](https://github.com/phuhao00/ai-media-agent/commit/957cc981) feat(knowledge): FAQ Excel import, flexible headers, and clearer UX
- 2026-05-03 [0a47e7dd](https://github.com/phuhao00/ai-media-agent/commit/0a47e7dd) feat(web): dark-theme tokens, My context Memory, companion fixes; docs
- 2026-04-30 [de65b0bf](https://github.com/phuhao00/ai-media-agent/commit/de65b0bf) docs: update AGENTS.md with latest project context
- 2026-06-06 [7d482ea6](https://github.com/phuhao00/ai-media-agent/commit/7d482ea6) feat(codegraph): add interactive call-graph explorer in My Context.
- 2026-06-06 [7529fc35](https://github.com/phuhao00/ai-media-agent/commit/7529fc35) fix(codegraph): run via npx and use correct CLI argument shapes.
- 2026-05-18 [49dcc161](https://github.com/phuhao00/ai-media-agent/commit/49dcc161) fix(win): patch ssl.SSLContext.wrap_socket to fix check_hostname error — covers urllib3/requests used by pip; bump to 1.0.9
- 2026-05-18 [ffb28181](https://github.com/phuhao00/ai-media-agent/commit/ffb28181) fix(win): use ssl._create_unverified_context wrapper scripts for pip+playwright — fixes check_hostname SSL error on proxied networks; bump to 1.0.8
- 2026-05-12 [1ac7b247](https://github.com/phuhao00/ai-media-agent/commit/1ac7b247) feat(workflow): expand agent config with 5-section layout — model, memory, context, tools, reliability
- 2026-05-05 [f5e16ee4](https://github.com/phuhao00/ai-media-agent/commit/f5e16ee4) feat: Hermes alignment groundwork — memory, connections summary, evolution
- 2026-05-04 [150d2376](https://github.com/phuhao00/ai-media-agent/commit/150d2376) feat(mcp): 接入 modelcontextprotocol/servers 官方参考预设
- 2026-05-03 [949e2c19](https://github.com/phuhao00/ai-media-agent/commit/949e2c19) feat: UI theme updates, chat history API, prefs context and media page fixes
- 2026-05-01 [f50e1e38](https://github.com/phuhao00/ai-media-agent/commit/f50e1e38) feat: add memory panel and update settings pages
- 2026-03-01 [21de8fda](https://github.com/phuhao00/ai-media-agent/commit/21de8fda) Revert "fix(rag): use ChromaDB as vector store instead of in-memory storage"
- 2026-02-27 [9b33e99a](https://github.com/phuhao00/ai-media-agent/commit/9b33e99a) fix(rag): use ChromaDB as vector store instead of in-memory storage
- 2026-02-27 [7086955c](https://github.com/phuhao00/ai-media-agent/commit/7086955c) fix(llm): cap openrouter output token limits to 4096 natively to prevent 402 cost-ceiling errors on large context models

### 🔧 运维与工具
- 2026-06-12 [5f204a03](https://github.com/phuhao00/ai-media-agent/commit/5f204a03) fix(electron): bundle Windows venv-prebuilt and repair lark-cli install.
- 2026-06-12 [49b0271a](https://github.com/phuhao00/ai-media-agent/commit/49b0271a) fix(electron): resolve Windows startup TDZ and bundled lark-cli install.
- 2026-06-09 [ee8020a5](https://github.com/phuhao00/ai-media-agent/commit/ee8020a5) fix(meal): move reminder chat sync out of setState updater.
- 2026-06-05 [cdef8461](https://github.com/phuhao00/ai-media-agent/commit/cdef8461) feat(tapd): add smart media and HAR analysis for bug submission.
- 2026-06-05 [afc58e03](https://github.com/phuhao00/ai-media-agent/commit/afc58e03) feat(tapd): export AI-narrative stats reports with styled PDF/PPT.
- 2026-06-05 [e544772e](https://github.com/phuhao00/ai-media-agent/commit/e544772e) feat(lark-cli): add Feishu interactive voting and TAPD stats export.
- 2026-06-05 [d7dd0659](https://github.com/phuhao00/ai-media-agent/commit/d7dd0659) feat(tapd): add bug statistics dashboard with range filters
- 2026-06-05 [c4abb170](https://github.com/phuhao00/ai-media-agent/commit/c4abb170) feat(tapd): multi-group notify, attachments, and fix false send errors
- 2026-06-05 [5edf498c](https://github.com/phuhao00/ai-media-agent/commit/5edf498c) feat(tapd): add bug submission with Feishu @ and meal manual amount
- 2026-06-05 [b52c7f81](https://github.com/phuhao00/ai-media-agent/commit/b52c7f81) fix(lark-cli): dev report preview fills viewport; meal uses APP_DATA storage
- 2026-06-05 [d7f2d053](https://github.com/phuhao00/ai-media-agent/commit/d7f2d053) feat(ops): Jenkins 运维中心与飞书群聊自动构建
- 2026-06-04 [9ac4b320](https://github.com/phuhao00/ai-media-agent/commit/9ac4b320) feat(meal): workbench tab, identity merge, and upload image dedup
- 2026-06-03 [5e0a48b9](https://github.com/phuhao00/ai-media-agent/commit/5e0a48b9) fix(meal): resolve Feishu attendance IDs for Excel clock-in/out export.
- 2026-06-03 [0fa1d0db](https://github.com/phuhao00/ai-media-agent/commit/0fa1d0db) feat(meal): attendance in stats/export, group member picker, Excel images
- 2026-06-03 [b9958719](https://github.com/phuhao00/ai-media-agent/commit/b9958719) feat(meal): mobile H5 upload/history, ¥30 cap, and Feishu session
- 2026-06-02 [7dc708a1](https://github.com/phuhao00/ai-media-agent/commit/7dc708a1) feat(meal): Feishu group reminders, public upload URL, two-step upload
- 2026-06-02 [c4599cf6](https://github.com/phuhao00/ai-media-agent/commit/c4599cf6) feat(meal): daily meal receipts with lark-cli Feishu integration
- 2026-05-26 [51073401](https://github.com/phuhao00/ai-media-agent/commit/51073401) fix(electron): RAG/lark-cli/vision models for packaged Mac builds
- 2026-05-26 [3633f4b4](https://github.com/phuhao00/ai-media-agent/commit/3633f4b4) feat(lark-cli): improve dev report multi-repo path UX
- 2026-05-26 [5ea262c7](https://github.com/phuhao00/ai-media-agent/commit/5ea262c7) fix(lark-cli): preserve markdown layout when saving Feishu docs
- 2026-05-26 [6cb424fc](https://github.com/phuhao00/ai-media-agent/commit/6cb424fc) feat(lark-cli): add dev report assistant with git commits and export
- 2026-04-19 [b45b4cba](https://github.com/phuhao00/ai-media-agent/commit/b45b4cba) feat(web/lark-cli): 飞书文档助手与 search:docs:read 补授权
- 2026-06-05 [52ac67e9](https://github.com/phuhao00/ai-media-agent/commit/52ac67e9) fix(tapd): add pymupdf for stats PDF export and surface missing deps.
- 2026-04-23 [9ad62e87](https://github.com/phuhao00/ai-media-agent/commit/9ad62e87) feat: enhance computer-use service, update lark-cli UI and add hermes-agent page
- 2026-04-19 [e33139a7](https://github.com/phuhao00/ai-media-agent/commit/e33139a7) feat(web/lark-cli): 群聊多选、自定义时间、Markdown 预览与导出
- 2026-04-19 [28d7d97e](https://github.com/phuhao00/ai-media-agent/commit/28d7d97e) feat(web): Lark workbench smart assistant UX and preview layout
- 2026-04-16 [2c6298e0](https://github.com/phuhao00/ai-media-agent/commit/2c6298e0) fix(web): Lark CLI 工作台与 API 子进程环境

### 🌐 Computer Use
- 2026-06-10 [83c0ac81](https://github.com/phuhao00/ai-media-agent/commit/83c0ac81) feat(computer-use): implement Agent-S async runner with search automation.
- 2026-06-10 [1dee5e9e](https://github.com/phuhao00/ai-media-agent/commit/1dee5e9e) feat(computer-use): widen workspace layout and improve run UX.
- 2026-04-19 [01c5b0f3](https://github.com/phuhao00/ai-media-agent/commit/01c5b0f3) feat(computer-use): AutoResearch markdown report after browser run
- 2026-04-19 [5607cfed](https://github.com/phuhao00/ai-media-agent/commit/5607cfed) feat(computer-use): Playwright-backed page with LLM-planned steps
- 2026-04-23 [9ad62e87](https://github.com/phuhao00/ai-media-agent/commit/9ad62e87) feat: enhance computer-use service, update lark-cli UI and add hermes-agent page

### 📞 客服系统
- 2026-06-11 [ed1003a4](https://github.com/phuhao00/ai-media-agent/commit/ed1003a4) fix(customer-service): match bound markdown docs for short FAQ queries
- 2026-06-10 [8d449932](https://github.com/phuhao00/ai-media-agent/commit/8d449932) feat(customer-service): add configurable workspace instances per knowledge domain.
- 2026-06-10 [1a42e6ad](https://github.com/phuhao00/ai-media-agent/commit/1a42e6ad) feat(customer-service): redesign AI support UI with full-screen two-column layout.

### 🛠️ 修复与优化
- 2026-06-12 [bb70869b](https://github.com/phuhao00/ai-media-agent/commit/bb70869b) fix(electron): stabilize Windows packaging build for Next.js and desktop-pet.
- 2026-06-12 [5f204a03](https://github.com/phuhao00/ai-media-agent/commit/5f204a03) fix(electron): bundle Windows venv-prebuilt and repair lark-cli install.
- 2026-06-12 [49b0271a](https://github.com/phuhao00/ai-media-agent/commit/49b0271a) fix(electron): resolve Windows startup TDZ and bundled lark-cli install.
- 2026-06-11 [ed1003a4](https://github.com/phuhao00/ai-media-agent/commit/ed1003a4) fix(customer-service): match bound markdown docs for short FAQ queries
- 2026-06-11 [229a0dbc](https://github.com/phuhao00/ai-media-agent/commit/229a0dbc) fix(knowledge): support image PDF upload without blocking list APIs
- 2026-06-11 [744040ca](https://github.com/phuhao00/ai-media-agent/commit/744040ca) fix(claude-code): show assistant output and stop explorer refresh on input.
- 2026-06-10 [7831223c](https://github.com/phuhao00/ai-media-agent/commit/7831223c) fix(packaging): auto-install bundled skills/MCP and parallelize Windows setup.
- 2026-06-10 [080076e7](https://github.com/phuhao00/ai-media-agent/commit/080076e7) fix(packaging): sync Electron Windows bundle and improve source zip build.
- 2026-06-10 [d8f65a36](https://github.com/phuhao00/ai-media-agent/commit/d8f65a36) chore(web): remove image gradient test page from navigation.
- 2026-06-10 [5c543af0](https://github.com/phuhao00/ai-media-agent/commit/5c543af0) refactor(chat): make multi-agent the default and only chat mode.
- 2026-06-09 [ee8020a5](https://github.com/phuhao00/ai-media-agent/commit/ee8020a5) fix(meal): move reminder chat sync out of setState updater.
- 2026-06-08 [5808a5f3](https://github.com/phuhao00/ai-media-agent/commit/5808a5f3) fix(media): refine watermark text removal with local OCR inpaint.
- 2026-06-08 [512c0fc6](https://github.com/phuhao00/ai-media-agent/commit/512c0fc6) fix(media): correct inpaint reference replace mask scaling and local paste.
- 2026-06-08 [812d2986](https://github.com/phuhao00/ai-media-agent/commit/812d2986) refactor(desktop-pet): unify character switching into a single chip flow.
- 2026-06-08 [0f9f4afc](https://github.com/phuhao00/ai-media-agent/commit/0f9f4afc) chore(electron): refresh bundled install helper and directory service.
- 2026-06-07 [d674676e](https://github.com/phuhao00/ai-media-agent/commit/d674676e) fix(desktop-pet): improve context menu layout and switch feedback.
- 2026-06-05 [aad9f39a](https://github.com/phuhao00/ai-media-agent/commit/aad9f39a) refactor(tapd): widen bug form with two-column layout and clearer UX
- 2026-06-05 [b52c7f81](https://github.com/phuhao00/ai-media-agent/commit/b52c7f81) fix(lark-cli): dev report preview fills viewport; meal uses APP_DATA storage
- 2026-06-03 [5e0a48b9](https://github.com/phuhao00/ai-media-agent/commit/5e0a48b9) fix(meal): resolve Feishu attendance IDs for Excel clock-in/out export.
- 2026-06-02 [a7a07307](https://github.com/phuhao00/ai-media-agent/commit/a7a07307) fix(desktop-pet): macOS voice input STT and cross-platform packaging
- 2026-06-02 [75e83016](https://github.com/phuhao00/ai-media-agent/commit/75e83016) fix(desktop-pet): bundle Windows sidecar and fix launch status false positives
- 2026-05-31 [1f9b2ed4](https://github.com/phuhao00/ai-media-agent/commit/1f9b2ed4) chore(env): add PEXELS_API_KEY for auto short video stock footage
- 2026-05-29 [7f9b491a](https://github.com/phuhao00/ai-media-agent/commit/7f9b491a) fix(electron): sync backend on launch and document Mac packaging pitfalls
- 2026-05-26 [51073401](https://github.com/phuhao00/ai-media-agent/commit/51073401) fix(electron): RAG/lark-cli/vision models for packaged Mac builds
- 2026-05-26 [08a34f55](https://github.com/phuhao00/ai-media-agent/commit/08a34f55) fix(knowledge): show indexed docs in search and repair FAQ category counts
- 2026-05-26 [5ea262c7](https://github.com/phuhao00/ai-media-agent/commit/5ea262c7) fix(lark-cli): preserve markdown layout when saving Feishu docs
- 2026-05-26 [6d22e9af](https://github.com/phuhao00/ai-media-agent/commit/6d22e9af) chore(electron): refresh v1.0.36 build artifacts after repackage
- 2026-05-25 [e523ce5c](https://github.com/phuhao00/ai-media-agent/commit/e523ce5c) chore(electron): refresh bundled binaries for v1.0.36 desktop builds
- 2026-05-25 [495bf1e0](https://github.com/phuhao00/ai-media-agent/commit/495bf1e0) fix(multimodal): use qwen-vl-max for Alibaba image understanding
- 2026-05-25 [a14eaf46](https://github.com/phuhao00/ai-media-agent/commit/a14eaf46) fix(electron): add Windows packaging, bundled Node, and port/service fixes

### 📚 文档与配置
- 2026-06-12 [5f204a03](https://github.com/phuhao00/ai-media-agent/commit/5f204a03) fix(electron): bundle Windows venv-prebuilt and repair lark-cli install.
- 2026-06-11 [ed1003a4](https://github.com/phuhao00/ai-media-agent/commit/ed1003a4) fix(customer-service): match bound markdown docs for short FAQ queries
- 2026-06-11 [e8774bb8](https://github.com/phuhao00/ai-media-agent/commit/e8774bb8) feat(claude-code): expand slash commands with grouped palette and skill discovery.
- 2026-06-10 [7831223c](https://github.com/phuhao00/ai-media-agent/commit/7831223c) fix(packaging): auto-install bundled skills/MCP and parallelize Windows setup.
- 2026-06-10 [379ca240](https://github.com/phuhao00/ai-media-agent/commit/379ca240) feat(packaging): bundle agent skills and MCP defaults into desktop installers.
- 2026-06-06 [580566f7](https://github.com/phuhao00/ai-media-agent/commit/580566f7) feat(media): wire taste-skill anti-slop art direction into image/video/copy pipelines.
- 2026-06-06 [d56104f2](https://github.com/phuhao00/ai-media-agent/commit/d56104f2) feat(context): align memory, sessions, skills, and codegraph in My Context.
- 2026-05-31 [1f9b2ed4](https://github.com/phuhao00/ai-media-agent/commit/1f9b2ed4) chore(env): add PEXELS_API_KEY for auto short video stock footage
- 2026-05-31 [93655c6d](https://github.com/phuhao00/ai-media-agent/commit/93655c6d) docs(electron): expand Mac packaging skill to v1.4.0
- 2026-05-26 [08a34f55](https://github.com/phuhao00/ai-media-agent/commit/08a34f55) fix(knowledge): show indexed docs in search and repair FAQ category counts
- 2026-05-26 [5ea262c7](https://github.com/phuhao00/ai-media-agent/commit/5ea262c7) fix(lark-cli): preserve markdown layout when saving Feishu docs
- 2026-05-25 [e3fcaf6b](https://github.com/phuhao00/ai-media-agent/commit/e3fcaf6b) docs: add v1.0.36 desktop package installation guide
- 2026-05-25 [370ad686](https://github.com/phuhao00/ai-media-agent/commit/370ad686) docs(skill): expand electron-mac-packaging for bundled Python, Node, and logo fixes
- 2026-05-24 [809c7987](https://github.com/phuhao00/ai-media-agent/commit/809c7987) docs(skill): add electron-mac-packaging skill and logo build gates
- 2026-05-24 [69365c00](https://github.com/phuhao00/ai-media-agent/commit/69365c00) fix(electron): harden pip install on macOS and reject Homebrew venv
- 2026-05-22 [84cfe15b](https://github.com/phuhao00/ai-media-agent/commit/84cfe15b) fix(electron): rebuild venv when pip is corrupted (v1.0.31)
- 2026-05-22 [b5b9b9b0](https://github.com/phuhao00/ai-media-agent/commit/b5b9b9b0) fix(electron): auto-repair missing Python venv on launch (v1.0.30)
- 2026-05-22 [2887c17c](https://github.com/phuhao00/ai-media-agent/commit/2887c17c) fix(electron): auto-clean venv and python-dist before install setup
- 2026-05-22 [64383598](https://github.com/phuhao00/ai-media-agent/commit/64383598) fix(electron): unset PYTHONHOME for venv to fix encodings import error
- 2026-05-20 [1b305f5c](https://github.com/phuhao00/ai-media-agent/commit/1b305f5c) docs(canvas): add macOS/Windows desktop packaging to project overview
- 2026-05-10 [2ee6f4b8](https://github.com/phuhao00/ai-media-agent/commit/2ee6f4b8) docs: update AGENTS.md and copilot instructions
- 2026-05-10 [1027644a](https://github.com/phuhao00/ai-media-agent/commit/1027644a) docs: 完善技术文档与项目架构
- 2026-05-10 [a470844e](https://github.com/phuhao00/ai-media-agent/commit/a470844e) docs(architecture): sync docs with codebase — add ai-news, long_video_agent, missing settings pages
- 2026-05-06 [83380159](https://github.com/phuhao00/ai-media-agent/commit/83380159) docs(architecture): sync service and API entries with backend evolution/wiki/mcp modules
- 2026-05-06 [af319af5](https://github.com/phuhao00/ai-media-agent/commit/af319af5) docs: sync directory structure, ports and module lists across all docs
- 2026-05-06 [cb7369b2](https://github.com/phuhao00/ai-media-agent/commit/cb7369b2) docs: clarify media_agent identity, sync architecture docs & frontend page
- 2026-05-06 [6e6489e8](https://github.com/phuhao00/ai-media-agent/commit/6e6489e8) docs: 同步 SSE 代理重构、media_url 推断与长视频默认时长变更
- 2026-05-06 [3c4dbdac](https://github.com/phuhao00/ai-media-agent/commit/3c4dbdac) docs: 同步记忆命中可视化与 reflection-loop 行为变更
- 2026-05-05 [0952695e](https://github.com/phuhao00/ai-media-agent/commit/0952695e) docs: 完善开发文档与架构图
- 2026-05-03 [0a47e7dd](https://github.com/phuhao00/ai-media-agent/commit/0a47e7dd) feat(web): dark-theme tokens, My context Memory, companion fixes; docs

### 📦 其他
- 2026-05-19 [2a8b593d](https://github.com/phuhao00/ai-media-agent/commit/2a8b593d) chore: bump version to 1.0.17
- 2026-05-19 [ecec00bc](https://github.com/phuhao00/ai-media-agent/commit/ecec00bc) chore: bump version to 1.0.16
- 2026-05-06 [5296a5f8](https://github.com/phuhao00/ai-media-agent/commit/5296a5f8) chore: purge unnecessary files and update .gitignore
- 2026-05-06 [056ba991](https://github.com/phuhao00/ai-media-agent/commit/056ba991) chore: commit current workspace updates
- 2026-05-03 [ead32c2f](https://github.com/phuhao00/ai-media-agent/commit/ead32c2f) refactor: simplify customization settings layout
- 2026-04-30 [370d7179](https://github.com/phuhao00/ai-media-agent/commit/370d7179) feat: refactor backend tools into content/knowledge/media/social modules
- 2026-04-28 [20a9d3d4](https://github.com/phuhao00/ai-media-agent/commit/20a9d3d4) chore: update trending data
- 2026-04-28 [a084c987](https://github.com/phuhao00/ai-media-agent/commit/a084c987) chore: update runtime data (scheduler, logs, trending)
- 2026-03-13 [352f1199](https://github.com/phuhao00/ai-media-agent/commit/352f1199) chore: update trending data and scheduler logs
- 2026-03-04 [39c8952d](https://github.com/phuhao00/ai-media-agent/commit/39c8952d) chore: 优化 Docker 生产环境配置并添加详细部署指南
- 2026-03-03 [fc5def36](https://github.com/phuhao00/ai-media-agent/commit/fc5def36) refactor: 移动游戏热点看板到独立页面
- 2026-03-02 [71176cd3](https://github.com/phuhao00/ai-media-agent/commit/71176cd3) chore: add storage profiles and credential files to gitignore
- 2026-02-10 [cc31c833](https://github.com/phuhao00/ai-media-agent/commit/cc31c833) chore: 更新模型列表到 2026 最新版本
- 2026-02-01 [522e82ae](https://github.com/phuhao00/ai-media-agent/commit/522e82ae) chore: update .gitignore and remove sensitive/temp files from tracking
- 2026-06-11 [cf7d798d](https://github.com/phuhao00/ai-media-agent/commit/cf7d798d) feat: 更新 ClaudeCodeRunner 钩子并添加会话上下文管理
- 2026-06-11 [a0832cad](https://github.com/phuhao00/ai-media-agent/commit/a0832cad) feat: 增强 ClaudeCode 功能，优化 Git 操作和本地命令执行
- 2026-06-11 [657a2f25](https://github.com/phuhao00/ai-media-agent/commit/657a2f25) feat: 添加 Git 提交消息建议 API 及相关服务，更新桌宠启动逻辑和文档
- 2026-05-31 [b55dfd0a](https://github.com/phuhao00/ai-media-agent/commit/b55dfd0a) Document Cursor Canvas workflow, sync paths, and cross-links.
- 2026-05-31 [b1943a85](https://github.com/phuhao00/ai-media-agent/commit/b1943a85) Expand project overview canvas with colorful charts and deployment diagrams.
- 2026-05-21 [795c1264](https://github.com/phuhao00/ai-media-agent/commit/795c1264) feat(companion): redesign chat UI with markdown, compact panel, and collapsible replies

---

## [v1.0.35] — 2026-05-31

> 记忆系统升级、Electron 嵌入仪表盘、Cursor Canvas 工作流文档化。

### 新功能
- feat(memory): 添加 dream engine、memory graph export、context UI tabs
- feat(electron): 嵌入仪表盘、启动画面、Playwright 自动安装
- feat(agent): 统一 Direct 和 Multi-Agent 到 LangGraph Graph Router
- feat(electron): 后端启动同步与 Mac 打包陷阱文档

### 文档
- docs: 扩展 Cursor Canvas 项目概览画布，彩色图表与部署图
- docs(electron): 扩展 Mac 打包技能到 v1.4.0
- docs: 记录 Cursor Canvas 工作流、同步路径与交叉链接

---

## [v1.0.34] — 2026-05-26

> Electron 打包修复、知识库 FAQ 增强、Lark CLI 开发报告助手。

### 新功能
- feat(knowledge): FAQ Excel 导入、灵活表头、更清晰的 UX
- feat(lark-cli): 添加开发报告助手（含 git commits 和导出）
- fix(electron): 打包 Mac 版本的 RAG/lark-cli/vision 模型支持
- fix(knowledge): 搜索中显示已索引文档，修复 FAQ 分类计数

---

## [v1.0.33] — 2026-05-20

> 桌面宠物 Tauri 伴侣、餐费管理、AI 混剪与自动化流水线。

### 新功能
- feat(desktop-pet): 添加 Tauri 伴侣 sidecar，支持宠物 API 和跨平台打包
- feat(meal): 日常餐费收据管理，集成 lark-cli 飞书
- feat(media): 添加一键自动短视频流水线（MoneyPrinterTurbo 风格）
- feat(media): 添加 AI 混剪指令编排与自动化视频生成

---

## [v1.0.32] — 2026-05-10

> 记忆协调器、自学习系统、安全执行面完善。

### 新功能
- feat(memory): 记忆协调器、命中评估、质量评分
- feat(learning): 进化学习数据管道、学习策展人、任务复盘闭环
- feat(security): 能力注册表、审批门控、平台能力矩阵
- feat(security): 本地沙箱、Shell 白名单、审计追踪

---

## [v1.0.31] — 2026-04-20

> MCP 客户端集成、多模态输入、RAG 知识库升级。

### 新功能
- feat(mcp): MCP 协议客户端，连接外部工具服务器
- feat(multimodal): 支持图片、音频、视频作为对话输入
- feat(rag): LlamaIndex + ChromaDB 私有文档检索增强
- feat(knowledge): 文档上传解析流程（Python/Rust 降级路径）

---

## [v1.0.30] — 2026-04-01

> V4 三语言微服务架构正式发布。

### 新功能
- feat(architecture): Go 高并发引擎 (:50053) — 目录检索、批量抓取、文件监控
- feat(architecture): Rust 安全引擎 (:50052) — 文档/视频解析、加密、私钥存储
- feat(architecture): gRPC + Protocol Buffers + mTLS 跨服务通信
- feat(architecture): OCR 服务 (:50051) — 图片文字识别

---

## 历史版本

| 版本 | 日期 | 核心变化 |
|------|------|----------|
| v1.0.29 | 2026-03 | V3 架构：多模态 + MCP |
| v1.0.28 | 2026-02 | V2 架构：Agent 协作 + LangGraph |
| v1.0.27 | 2026-01 | V1 架构：Python 单体 + FastAPI |
| v1.0.0 | 2025-12 | 项目启动，MVP 开发 |

---

_文档版本：2026-06-13 · 与代码仓库实时同步 · 数据范围：最近 200 次提交_
