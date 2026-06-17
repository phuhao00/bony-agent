# AI 客服助手 (Customer Service)

> 前端页面：`web/app/customer-service/`  
> 对应 Agent：`（暂无独立 Agent，由 customer_service_engine.py 直接处理）`  
> 对应 Skill：`.agent/skills/（可扩展 customer-service-agent）/SKILL.md`

## 功能概述

客服工作区、RAG 检索、会话管理与工单。

## 前端结构

- **页面入口**：`web/app/customer-service/page.tsx`
- **主要组件**：customer-service.css、page.tsx
- **样式/工具**：遵循项目主题令牌与 `AssistantRecipeResultPanel` Markdown 渲染规范。

## 后端调用链

```
前端页面
  → API Router (backend/main.py)
  → customer_service_engine.py
  → （直接由 Service 处理）
  → （暂无独立 Agent，由 customer_service_engine.py 直接处理）
  → LLM / 工具 / 外部 API
```

## 使用流程

1. 用户进入客服工作区，查看会话列表。
2. AI 基于 RAG 检索知识库生成回复建议。
3. 客服可编辑、发送或转人工/建工单。
4. 会话与工单状态由 `customer_service_store.py` 持久化。

## 典型输出

回复建议、会话摘要、工单记录。

## 相关文档

- `AGENTS.md` — Agent 协作指南
- `docs/ARCHITECTURE_OVERVIEW.md` — 系统架构总览
- `docs/AGENT_ROUTING_DIAGRAMS.md` — 路由与协作流程图
