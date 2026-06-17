# 采购助手 (Procurement Assistant)

> 前端页面：`web/app/procurement-assistant/`  
> 对应 Agent：`procurement_agent`  
> 对应 Skill：`.agent/skills/procurement-agent/SKILL.md`

## 功能概述

供应商评估、RFQ 起草、报价比对、合同审查与成本优化。

## 前端结构

- **页面入口**：`web/app/procurement-assistant/page.tsx`
- **主要组件**：ProcurementActionPanel、ProcurementComposer、ProcurementResultPanel
- **样式/工具**：遵循项目主题令牌与 `AssistantRecipeResultPanel` Markdown 渲染规范。

## 后端调用链

```
前端页面
  → API Router (backend/main.py)
  → procurement_service.py
  → procurement_analysis.py、procurement_recipes.py
  → procurement_agent
  → LLM / 工具 / 外部 API
```

## 使用流程

1. 用户输入采购需求、规格与候选供应商。
2. 选择 Recipe（RFQ、比价、评估、成本优化）。
3. Agent 生成结构化采购文档。
4. 输出 Markdown 报告，合同风险点提示法务复核。

## 典型输出

RFQ、供应商评估表、报价比对、合同审查意见或成本优化建议。

## 相关文档

- `AGENTS.md` — Agent 协作指南
- `docs/ARCHITECTURE_OVERVIEW.md` — 系统架构总览
- `docs/AGENT_ROUTING_DIAGRAMS.md` — 路由与协作流程图
