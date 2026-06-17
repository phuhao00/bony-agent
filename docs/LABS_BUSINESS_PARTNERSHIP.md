# 商务合作助手 (Business Partnership)

> 前端页面：`web/app/business-partnership/`  
> 对应 Agent：`business_partnership_agent`  
> 对应 Skill：`.agent/skills/business-partnership-agent/SKILL.md`

## 功能概述

合作 outreach、方案撰写、条款要点、伙伴评估与 BD Pipeline 规划。

## 前端结构

- **页面入口**：`web/app/business-partnership/page.tsx`
- **主要组件**：BusinessPartnershipActionPanel、BusinessPartnershipComposer、BusinessPartnershipResultPanel
- **样式/工具**：遵循项目主题令牌与 `AssistantRecipeResultPanel` Markdown 渲染规范。

## 后端调用链

```
前端页面
  → API Router (backend/main.py)
  → business_partnership_service.py
  → business_partnership_analysis.py、business_partnership_recipes.py
  → business_partnership_agent
  → LLM / 工具 / 外部 API
```

## 使用流程

1. 用户输入合作目标、对方背景与己方资源。
2. 选择输出类型（outreach 文案、合作方案、伙伴评估、Pipeline）。
3. Agent 调用 Recipe 与联网搜索生成内容。
4. 输出 Markdown 报告，重要条款提示法务复核。

## 典型输出

合作邀约、合作方案、条款要点、伙伴评估表或 BD Pipeline 计划。

## 相关文档

- `AGENTS.md` — Agent 协作指南
- `docs/ARCHITECTURE_OVERVIEW.md` — 系统架构总览
- `docs/AGENT_ROUTING_DIAGRAMS.md` — 路由与协作流程图
