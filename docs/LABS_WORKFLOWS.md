# 可视化工作流 (Workflows)

> 前端页面：`web/app/workflows/`  
> 对应 Agent：`（多 Agent 编排，由 workflow_engine.py 驱动）`  
> 对应 Skill：`.agent/skills/（可扩展 workflow-designer）/SKILL.md`

## 功能概述

创建、编辑、执行多 Agent 协作流程，支持条件分支、循环、子图调用与审批闸口。

## 前端结构

- **页面入口**：`web/app/workflows/page.tsx`
- **主要组件**：page.tsx、new/page.tsx、[id]/page.tsx
- **样式/工具**：遵循项目主题令牌与 `AssistantRecipeResultPanel` Markdown 渲染规范。

## 后端调用链

```
前端页面
  → API Router (backend/main.py)
  → workflow_service.py
  → workflow_engine.py、workflow_schema.py
  → （多 Agent 编排，由 workflow_engine.py 驱动）
  → LLM / 工具 / 外部 API
```

## 使用流程

1. 用户在 `/workflows/new` 创建工作流。
2. 拖拽/配置节点：Agent 调用、条件分支、审批闸口、循环。
3. 保存时 `workflow_schema.py` 校验结构。
4. 执行时 `workflow_engine.py` 调度各 Agent 节点。
5. 在 `/workflows/[id]` 查看执行状态与日志。

## 典型输出

工作流定义 JSON、执行日志、节点结果。

## 相关文档

- `AGENTS.md` — Agent 协作指南
- `docs/ARCHITECTURE_OVERVIEW.md` — 系统架构总览
- `docs/AGENT_ROUTING_DIAGRAMS.md` — 路由与协作流程图
