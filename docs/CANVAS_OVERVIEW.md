# Cursor Canvas 工作区速览文档

> 面向开发者与 AI 编程助手：说明本仓库 **Cursor Canvas** 的用途、文件位置、内容结构及维护方式。  
> 与产品内 Web 架构页（`/architecture`）互补：Canvas 供 IDE 侧边离线查阅；Web 页供终端用户浏览器访问。

---

## 一、什么是 Cursor Canvas

**Cursor Canvas** 是 Cursor IDE 中的 live React  artifact：单个 `.canvas.tsx` 文件，可在聊天旁打开，用于展示架构图、统计图表、路由/API 速查等 **独立可视化文档**。

本仓库当前维护一张总览 Canvas：

| 文件 | 用途 |
|------|------|
| `canvases/ai-media-agent-overview.canvas.tsx` | 全项目速览：彩色图表、架构 SVG、前端路由、API 分组、Electron/iOS 打包 |

Canvas 使用 `cursor/canvas` SDK（`PieChart`、`BarChart`、`UsageBar`、`computeDAGLayout` 等），颜色来自 `colorPalette` / `usageColorSequence`，**禁止**硬编码 hex 或渐变。

---

## 二、文件位置（双路径，必读）

Canvas 存在 **两个路径**，职责不同：

| 路径 | 是否入 Git | IDE 是否渲染 |
|------|------------|--------------|
| `<repo>/canvases/*.canvas.tsx` | ✅ 是 | ❌ 否（仅源码归档） |
| `~/.cursor/projects/<workspace>/canvases/*.canvas.tsx` | ❌ 否 | ✅ **是** |

`<workspace>` 对应当前工作区，例如本机为：

```text
/Users/tutu/.cursor/projects/Users-tutu-Documents-agent/canvases/ai-media-agent-overview.canvas.tsx
```

**常见现象：** 只改了仓库内 `canvases/`，IDE 里打开的仍是旧版灰色图。  
**处理方式：** 修改仓库文件后，同步到 Cursor 托管目录：

```bash
cp canvases/ai-media-agent-overview.canvas.tsx \
  ~/.cursor/projects/Users-tutu-Documents-agent/canvases/ai-media-agent-overview.canvas.tsx
```

然后在 Cursor 中 **关闭并重新打开** 该 Canvas。  
编译状态可看同目录下的 `*.canvas.status.json`（`status: "rendered"` 表示成功）。

---

## 三、如何打开

1. 在 Cursor 聊天中点击 Canvas 文件链接，或从文件树打开 `canvases/ai-media-agent-overview.canvas.tsx`（需已同步到 `.cursor/projects/.../canvases/`）。
2. 使用 **Open in Canvas** / 在聊天旁并排查看。
3. 页面顶部有绿色 Callout **「彩色图从这里开始」**；其下依次为 Stat 卡片 → **彩色总览图** → 交付形态图 → Agent/平台矩阵 → 正文表格与架构 SVG。

---

## 四、内容地图（ai-media-agent-overview）

### 4.1 彩色总览图（页面中上部）

| 区块 | 类型 | 数据来源（摘要） |
|------|------|------------------|
| 桌面运行时组件 | 环形 `PieChart` | Electron 五服务 + Playwright + RAG（等权） |
| 前端路由分组 | `BarChart` | `web/app/**/page.tsx` 计数（约 35 页） |
| 注册 Agent | 横向 `BarChart` | `backend/agents/` 职责权重示意 |
| 媒体流水线 | `LineChart`（面积） | `core/media_pipeline.py` · `PIPELINE_STEP_IDS` |
| storage/ 子目录 | `UsageBar` | 持久化面相对权重示意 |
| 四种交付形态 | 彩色 SVG | Web Dev / Electron / Win ZIP / iOS Shell |
| Agent 星座图 | 彩色 SVG | `orchestrator` 与专业 Agent 关系 |
| 社媒连接器矩阵 | 彩色 SVG 网格 | `tools/connectors/` 12 个发布平台 |

### 4.2 架构 SVG（七色 `colorPalette`）

- 总体分层、后端调用 DAG、路由策略、Supervisor 循环  
- 媒体流水线八步、gRPC 三引擎、工作流引擎、连接器类图  
- Electron 启动链路、五服务、首次启动、打包准备流水线  
- iOS Capacitor 远程壳（`mobile/`）

### 4.3 文本速查（折叠区块）

- 前端主要入口与完整 `web/app` 路由表  
- 后端目录、常用 API（含 `/agent/chat/stream`）、Agent 角色、`storage/` 约定  
- 环境变量、venv/临时目录规范  
- 桌面打包（`build_mac.sh`、`bundle_revision`、Developer ID / 公证）  
- iOS 客户端对比表与快速开始

---

## 五、与 Web `/architecture` 的区别

| | Cursor Canvas | Web `web/app/architecture` |
|--|---------------|----------------------------|
| 运行环境 | Cursor IDE 内编译 | Next.js 浏览器页 |
| 内容 | 开发者速查 + 统计图 + 打包/iOS | 产品向交互分层说明（i18n） |
| 更新方式 | 改 `.canvas.tsx` 并同步到 `.cursor/projects` | 改 `web/app/architecture/copy` 等 |
| 受众 | 开发者 / AI Agent | 终端用户 |

两者应 **语义一致、各自维护**；大架构变更时建议同时更新 Canvas 与 `docs/ARCHITECTURE_OVERVIEW.md`。

---

## 六、维护指南

### 6.1 何时更新 Canvas

- 新增/删除 `web/app` 路由或重要 API 端点  
- Electron 启动流程、打包脚本、`bundle_revision` 策略变更  
- 新增交付形态（如 iOS、新 gRPC 服务）  
- Agent 注册表或连接器平台数量变化  

### 6.2 编辑规范

1. **只改一个文件**：每个 Canvas 仅一个 `.canvas.tsx`，禁止拆 helper 模块。  
2. **仅 import `cursor/canvas`**，数据内联，禁止 `fetch`。  
3. **图表须自描述**：标题、轴/图例、数据来源 caption。  
4. **无空状态**：无数据则省略该区块，不写 placeholder。  
5. 参考 Cursor 技能：`.cursor/skills-cursor/canvas/SKILL.md`（若本地已安装）。

### 6.3 提交流程建议

```bash
# 1. 编辑仓库内文件
vim canvases/ai-media-agent-overview.canvas.tsx

# 2. 同步到 IDE 托管目录并本地预览
cp canvases/ai-media-agent-overview.canvas.tsx \
  ~/.cursor/projects/Users-tutu-Documents-agent/canvases/

# 3. 仅提交 canvases/（IDE 目录不入 Git）
git add canvases/ai-media-agent-overview.canvas.tsx
git commit -m "docs(canvas): update overview charts for …"
```

### 6.4 验证清单

- [ ] `.cursor/projects/.../canvases/` 与仓库 `canvases/` 内容一致  
- [ ] IDE 中可见「彩色总览图」与彩色 SVG（非全灰）  
- [ ] `*.canvas.status.json` 为 `rendered`（可选）  
- [ ] 端口、版本号（如 Electron 1.0.37）与 `electron/package.json` 一致  

---

## 七、相关文档

| 文档 | 说明 |
|------|------|
| `docs/ARCHITECTURE_OVERVIEW.md` | 系统架构总览（Mermaid / 章节详述） |
| `docs/DEVELOPMENT_GUIDE.md` | 开发者上手指南（含 Canvas 小节） |
| `docs/INSTALLATION.md` | 桌面包安装（DMG / ZIP） |
| `docs/WINDOWS_DEPLOYMENT.md` | Windows 部署补充 |
| `mobile/README.md` | iOS Capacitor 客户端 |
| `.agent/skills/electron-mac-packaging/SKILL.md` | Electron 打包与 `bundle_revision` |
| `AGENTS.md` | Agent 协作与目录规范 |
| `web/app/architecture/` | 产品内架构交互页 |

---

_文档版本：2026-05-31 · 对应 Canvas 彩色总览与 Electron 1.0.37 / iOS Capacitor 章节_
