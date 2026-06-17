# 法务顾问助手 (Legal Advisor)

> 前端页面：`web/app/legal-advisor/`  
> 对应 Agent：`legal_agent`  
> 对应 Skill：`.agent/skills/legal-agent/SKILL.md`

## 功能概述

合同审查、法规解读、公司合规体检、案例检索与经济金融法律要点分析。

## 前端结构

- **页面入口**：`web/app/legal-advisor/page.tsx`
- **主要组件**：LegalAdvisorActionPanel、LegalAdvisorComposer、LegalAdvisorResultPanel
- **样式/工具**：遵循项目主题令牌与 `AssistantRecipeResultPanel` Markdown 渲染规范。

## 后端调用链

```
前端页面
  → API Router (backend/main.py)
  → legal_service.py
  → legal_analysis.py、legal_recipes.py
  → legal_agent
  → LLM / 工具 / 外部 API
```

## 使用流程

1. 用户输入合同文本、法律问题或上传文档。
2. 选择 Recipe（合同审查、合规体检、法规解读、案例检索）。
3. 前端调用 `legal_agent` 后端服务。
4. Agent 调用 `core/legal_*` Recipe 与联网检索，生成法律分析报告。
5. 结果面板渲染 Markdown 报告，标注法律依据与风险等级。
6. 重要合同建议人工复核或咨询执业律师。

## 典型输出

Markdown 法律分析报告，包含风险点、法律依据、修改建议与免责声明。

## 相关文档

- `AGENTS.md` — Agent 协作指南
- `docs/ARCHITECTURE_OVERVIEW.md` — 系统架构总览
- `docs/AGENT_ROUTING_DIAGRAMS.md` — 路由与协作流程图
