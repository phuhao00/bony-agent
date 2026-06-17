# 系统维护助手 (System Assistant)

> 前端页面：`web/app/system-assistant/`  
> 对应 Agent：`system_assistant`  
> 对应 Skill：`.agent/skills/system-assistant-agent/SKILL.md`

## 功能概述

软件安装/卸载、网络修复、环境配置、文件与图片批量整理。

## 前端结构

- **页面入口**：`web/app/system-assistant/page.tsx`
- **主要组件**：SystemAssistantActionPanel、SystemAssistantComposer、SystemAssistantRecommendedPanel
- **样式/工具**：遵循项目主题令牌与 `AssistantRecipeResultPanel` Markdown 渲染规范。

## 后端调用链

```
前端页面
  → API Router (backend/main.py)
  → system_assistant_service.py
  → system_command_policy.py、system_environment.py、system_recipes.py、file_media_ops.py
  → system_assistant
  → LLM / 工具 / 外部 API
```

## 使用流程

1. 用户输入系统问题或维护需求。
2. Agent 运行诊断并推荐 Recipe。
3. 变更类操作先预览，用户确认后执行。
4. 输出执行结果、变更摘要与回滚方法。

## 典型输出

Markdown 维护报告、命令输出与风险提示。

## 相关文档

- `AGENTS.md` — Agent 协作指南
- `docs/ARCHITECTURE_OVERVIEW.md` — 系统架构总览
- `docs/AGENT_ROUTING_DIAGRAMS.md` — 路由与协作流程图
