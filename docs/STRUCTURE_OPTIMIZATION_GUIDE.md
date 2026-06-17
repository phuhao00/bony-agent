# AI Media Agent — 项目结构优化实施指南

> 本文档基于 `project_structure_analysis.md` 的根目录重构方案，将其转化为可执行的迁移指南。目标：清理根目录、重构 backend 分层、统一微服务目录、安全加固。

---

## 📋 目标与收益

| 指标 | 当前 | 优化后 | 收益 |
|------|------|--------|------|
| 根目录文件数 | 38 | 8 | **减少 79%** |
| Backend 单目录文件数 | 149 | 最大 30/域 | **可维护性 ↑** |
| main.py 行数 | 6,630 | < 200 | **减少 97%** |
| 敏感文件暴露 | 4 个 | 0 | **安全风险消除** |
| 新功能定位时间 | 5-10 分钟 | < 1 分钟 | **效率 ↑** |
| 代码审查文件大小 | 平均 300+ 行 | 平均 < 150 行 | **质量 ↑** |

---

## 🗂️ 目标架构

```
ai-media-agent/
├── README.md
├── LICENSE
├── .gitignore
├── Makefile                    # 统一命令入口
├── docker-compose.yml          # 保留
├── docker-compose.chroma.yml   # 保留
│
├── bin/                        # 【新建】所有启动/构建脚本
│   ├── start-local.sh          # 原 start_local.sh
│   ├── start-ecs.sh            # 原 start_ecs.sh
│   ├── start-with-tunnel.sh    # 原 start_with_tunnel.sh
│   ├── start-chroma.sh         # 原 start_chroma.sh
│   ├── stop-ecs.sh             # 原 stop_ecs.sh
│   ├── stop-chroma.sh          # 原 stop_chroma.sh
│   ├── build-native.sh         # 原 build_native.sh
│   ├── build-package.sh        # 原 build_package.sh
│   ├── build-windows.sh        # 原 build_windows.sh
│   ├── deploy.sh               # 原 deploy.sh
│   └── windows/
│       ├── start.bat
│       └── start-windows.bat
│
├── scripts/                    # 【保留】开发/CI脚本
│   ├── setup/
│   ├── build/
│   ├── jenkins/
│   └── utils/
│
├── docs/                       # 【保留】结构化文档
│   ├── README.md               # 文档索引
│   ├── architecture/
│   ├── deployment/
│   ├── development/
│   └── api/
│
├── docker/                     # 【新建】统一Docker管理
│   ├── backend.Dockerfile      # 从 backend/ 移入
│   ├── web.Dockerfile          # 从 web/ 移入
│   ├── ocr.Dockerfile          # 从 services/ocr/ 移入
│   ├── directory.Dockerfile      # 从 backend_massive_concurrent/ 移入
│   ├── parser.Dockerfile       # 从 backend_safety/ 移入
│   └── nginx/
│
├── data/                       # 【新建】统一数据目录
│   ├── storage/                # 原 storage/
│   ├── logs/                   # 原 logs/
│   ├── tmp/                    # 原 tmp/
│   └── backups/
│
├── secrets/                    # 【新建】敏感文件（gitignored）
│   ├── .gitignore              # 忽略所有内容
│   ├── README.md               # 说明如何放置证书
│   └── example.env             # 环境变量模板
│
└── packages/                   # 【新建】统一代码包目录
    ├── backend/                # 原 backend/
    ├── web/                    # 原 web/
    ├── electron/               # 原 electron/
    ├── mobile/                 # 原 mobile/
    ├── desktop-pet/            # 原 desktop-pet/
    ├── browser-extension/      # 原 browser-extension/
    └── services/               # 微服务集合
        ├── ocr/                # 原 services/ocr/
        ├── directory/          # 原 backend_massive_concurrent/
        └── parser/             # 原 backend_safety/
```

---

## 🚀 六阶段迁移路线图

### Phase 1：安全清理（1天）

**目标**：消除敏感文件暴露风险，清理临时文件。

- [ ] 移动证书/密钥到 `secrets/` 并加入 `.gitignore`
  ```bash
  mkdir -p secrets
  mv developerID_application.cer secrets/ 2>/dev/null || true
  mv developer_id_private.key secrets/ 2>/dev/null || true
  ```
- [ ] 移动 Cookie/凭证到 `data/` 或 `secrets/`
  ```bash
  mv douyin_cookies.json data/ 2>/dev/null || true
  mv douyin_login_qr.png data/ 2>/dev/null || true
  ```
- [ ] 删除 `.pytest_cache/` 并确保被 `.gitignore` 忽略
- [ ] 清理根目录临时文件：`simple_test.py`, `test_*.py`, `*.txt`, `agent.log`, `test_output.json`
- [ ] 删除空目录 `backend_block_chain/`

### Phase 2：根目录整理（2天）

**目标**：建立 `bin/`, `docker/`, `data/` 目录，移动脚本和数据。

- [ ] 创建 `bin/` 目录，移动所有 `.sh` / `.bat` 脚本
- [ ] 创建 `docker/` 目录，移动所有 `Dockerfile`
- [ ] 创建 `data/` 目录，统一 `storage/`, `logs/`, `tmp/`
- [ ] 更新 `docker-compose.yml` 路径引用
- [ ] 更新 `.gitignore`

### Phase 3：Backend 分层重构（1-2 周）

**目标**：从平铺 149 个文件到按业务域分层的 ~200 个文件。

**按域迁移顺序**（建议）：
1. `integration/`（飞书、TAPD、Jenkins、MCP）
2. `content/`（文案、脚本、趋势）
3. `media/`（图片、视频、故事板）
4. `publish/`（平台发布、连接器）
5. `knowledge/`（RAG、知识图谱）
6. `agent/`（核心编排、路由、注册）

**关键步骤**：
- [ ] 创建 `src/api/`, `src/domains/`, `src/infrastructure/` 目录结构
- [ ] 拆分 `main.py`：提取路由注册到 `api/`，提取启动逻辑到 `lifespan.py`
- [ ] 引入 `pyproject.toml` 替代 `requirements.txt`
- [ ] 配置 `ruff` + `mypy` 代码检查

### Phase 4：Web 前端整理（3-5 天）

**目标**：统一组件目录，引入测试框架。

- [ ] 统一组件到 `components/` 目录，按 `ui/`, `layout/`, `features/`, `common/` 组织
- [ ] 引入前端测试框架（Vitest + React Testing Library）
- [ ] 配置 Playwright E2E 测试

### Phase 5：微服务归队（2-3 天）

**目标**：统一微服务目录结构。

- [ ] 创建 `packages/services/` 目录
- [ ] 移动 `backend_massive_concurrent/` → `services/directory/`
- [ ] 移动 `backend_safety/` → `services/parser/`
- [ ] 移动 `services/ocr/` → `services/ocr/`
- [ ] 更新 `docker-compose.yml` 构建路径

### Phase 6：文档与规范（持续）

**目标**：建立长期维护规范。

- [ ] 创建 `docs/README.md` 索引
- [ ] 编写 `docs/development/CODE_STRUCTURE.md`
- [ ] 编写 `docs/development/CONTRIBUTING.md`
- [ ] 添加 Makefile 统一命令（`make dev`, `make test`, `make build`）

---

## ⚠️ 风险与回滚

| 风险 | 缓解措施 |
|------|----------|
| 重构引入 Bug | 每阶段完成后运行完整测试套件；优先迁移非核心模块 |
| 路径变更破坏 Docker | 同步更新 `docker-compose.yml` 和 `Dockerfile`；先测试后合并 |
| 团队协作冲突 | 在独立分支（如 `refactor/structure`）重构，分阶段合并到 main |
| 历史记录丢失 | 使用 `git mv` 保留文件历史；避免 `rm` + `git add` |
| 功能回归 | 每阶段维护一份「功能清单」对照表，逐条验证 |

---

## 📝 维护规范

1. **新增脚本**：放入 `bin/`，不要在根目录添加 `.sh`/`.bat`
2. **新增 Dockerfile**：放入 `docker/`，在各模块中用软链接引用
3. **新增敏感文件**：放入 `secrets/`，并更新 `.gitignore`
4. **新增数据**：放入 `data/`，避免与代码混合
5. **新增后端功能**：按业务域放入 `packages/backend/src/domains/<domain>/`

---

_文档版本：2026-06-13 · 项目结构优化实施指南 V1 · 基于 project_structure_analysis.md 转化_
