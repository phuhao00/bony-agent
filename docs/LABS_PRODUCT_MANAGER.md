# 产品经理助手 (Product Manager)

> 前端页面：`web/app/product-manager/`  
> 对应 Agent：`product_manager_agent`  
> 对应 Skill：`.agent/skills/product-manager-agent/SKILL.md`

## 功能概述

市场洞察、产品创意、Discovery、路线图、用户故事与 PRD 生成。

## 前端结构

- **页面入口**：`web/app/product-manager/page.tsx`
- **主要组件**：ProductManagerActionPanel、ProductManagerComposer、ProductManagerResultPanel、ProductManagerShareMenu
- **样式/工具**：遵循项目主题令牌与 `AssistantRecipeResultPanel` Markdown 渲染规范。

## 后端调用链

```
前端页面
  → API Router (backend/main.py)
  → product_manager_service.py
  → product_manager_recipes.py、product_analysis.py
  → product_manager_agent
  → LLM / 工具 / 外部 API
```

## 使用流程

1. 用户在输入框描述产品问题、目标或需求。
2. 选择或输入 Recipe（如 Discovery、JTBD、路线图、用户故事）。
3. 前端调用后端 `/product-manager/` 相关 API，由 `product_manager_agent` 执行。
4. Agent 调用 `core/product_manager_recipes.py` 中的 Recipe 生成结构化报告。
5. 结果面板使用 `AssistantRecipeResultPanel` 渲染 Markdown 报告。
6. 用户可复制、分享或继续追问迭代。

## 典型输出

Markdown 报告，包含市场洞察、用户画像、JTBD、路线图、用户故事、验收标准等。

## 相关文档

- `AGENTS.md` — Agent 协作指南
- `docs/ARCHITECTURE_OVERVIEW.md` — 系统架构总览
- `docs/AGENT_ROUTING_DIAGRAMS.md` — 路由与协作流程图
