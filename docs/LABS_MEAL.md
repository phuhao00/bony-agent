# 内部餐费/考勤工具 (Meal)

> 前端页面：`web/app/meal/`  
> 对应 Agent：`（无独立 Agent，内部工具）`  
> 对应 Skill：`.agent/skills/（内部工具）/SKILL.md`

## 功能概述

餐费/考勤相关内部工具，对接飞书多维表格与审批。

## 前端结构

- **页面入口**：`web/app/meal/page.tsx`
- **主要组件**：page.tsx、upload/page.tsx、upload/history/page.tsx
- **样式/工具**：遵循项目主题令牌与 `AssistantRecipeResultPanel` Markdown 渲染规范。

## 后端调用链

```
前端页面
  → API Router (backend/main.py)
  → meal_feishu_*.py
  → （直接由 Service 处理）
  → （无独立 Agent，内部工具）
  → LLM / 工具 / 外部 API
```

## 使用流程

1. 用户上传考勤/餐费相关文件。
2. 后端调用飞书 API 写入多维表格或发起审批。
3. 在 `/meal/upload/history` 查看历史记录。

## 典型输出

上传记录、飞书表格更新状态。

## 相关文档

- `AGENTS.md` — Agent 协作指南
- `docs/ARCHITECTURE_OVERVIEW.md` — 系统架构总览
- `docs/AGENT_ROUTING_DIAGRAMS.md` — 路由与协作流程图
