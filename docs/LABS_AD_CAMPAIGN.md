# 广告投放助手 (Ad Campaign)

> 前端页面：`web/app/ad-campaign/`  
> 对应 Agent：`ad_campaign_agent`  
> 对应 Skill：`.agent/skills/ad-campaign-agent/SKILL.md`

## 功能概述

投放策略、创意文案、受众定向、预算分配与效果复盘。

## 前端结构

- **页面入口**：`web/app/ad-campaign/page.tsx`
- **主要组件**：AdCampaignActionPanel、AdCampaignComposer、AdCampaignKpiBar、AdCampaignResultPanel
- **样式/工具**：遵循项目主题令牌与 `AssistantRecipeResultPanel` Markdown 渲染规范。

## 后端调用链

```
前端页面
  → API Router (backend/main.py)
  → ad_campaign_service.py
  → ad_campaign_analysis.py、ad_campaign_recipes.py
  → ad_campaign_agent
  → LLM / 工具 / 外部 API
```

## 使用流程

1. 用户输入产品/服务、目标平台、预算与 KPI。
2. Agent 分析需求并调用热点/趋势工具获取灵感。
3. 调用 `core/ad_campaign_recipes.py` 生成投放策略与创意文案。
4. 前端展示 KPI 概览、创意变体与预算分配。
5. 用户可导出报告或继续迭代创意。

## 典型输出

投放策略文档、创意文案变体、受众定向建议、预算分配表与复盘模板。

## 相关文档

- `AGENTS.md` — Agent 协作指南
- `docs/ARCHITECTURE_OVERVIEW.md` — 系统架构总览
- `docs/AGENT_ROUTING_DIAGRAMS.md` — 路由与协作流程图
