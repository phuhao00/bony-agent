# 金融资讯日报 (Financial News)

> 前端页面：`web/app/financial-news/`  
> 对应 Agent：`（媒体/趋势 Agent 组合）`  
> 对应 Skill：`.agent/skills/（可扩展 financial-news-agent）/SKILL.md`

## 功能概述

聚合金融市场、公司财报与宏观经济资讯，支持摘要与海报生成。

## 前端结构

- **页面入口**：`web/app/financial-news/page.tsx`
- **主要组件**：page.tsx
- **样式/工具**：遵循项目主题令牌与 `AssistantRecipeResultPanel` Markdown 渲染规范。

## 后端调用链

```
前端页面
  → API Router (backend/main.py)
  → （复用研究链路服务）
  → research_artifact.py
  → （媒体/趋势 Agent 组合）
  → LLM / 工具 / 外部 API
```

## 使用流程

1. 用户进入页面，系统自动抓取/刷新金融资讯。
2. 调用研究链路生成结构化摘要。
3. 用户可选择生成海报或短视频。

## 典型输出

资讯摘要、海报、短视频。

## 相关文档

- `AGENTS.md` — Agent 协作指南
- `docs/ARCHITECTURE_OVERVIEW.md` — 系统架构总览
- `docs/AGENT_ROUTING_DIAGRAMS.md` — 路由与协作流程图
