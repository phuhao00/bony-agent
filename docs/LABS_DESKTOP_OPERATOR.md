# 桌面操作助手 (Desktop Operator)

> 前端页面：`web/app/desktop-operator/`  
> 对应 Agent：`desktop_operator_agent`  
> 对应 Skill：`.agent/skills/desktop-operator-agent/SKILL.md`

## 功能概述

本机任意软件 CLI/GUI 自动化，支持 Blender/Photoshop/Office/微信等。

## 前端结构

- **页面入口**：`web/app/desktop-operator/page.tsx`
- **主要组件**：DesktopAppPicker、DesktopOperatorActionPanel、DesktopOperatorComposer、DesktopOperatorResultPanel
- **样式/工具**：遵循项目主题令牌与 `AssistantRecipeResultPanel` Markdown 渲染规范。

## 后端调用链

```
前端页面
  → API Router (backend/main.py)
  → desktop_operator_service.py
  → native_desktop_bridge.py、desktop_app_registry.py、app_automation_strategy.py、app_command_policy.py
  → desktop_operator_agent
  → LLM / 工具 / 外部 API
```

## 使用流程

1. 用户选择目标应用或描述自动化需求。
2. Agent 探测桌面环境与应用列表。
3. 生成自动化计划，高风险操作需审批。
4. 执行 CLI 或 GUI 自动化并返回日志。

## 典型输出

自动化脚本、执行日志、输出路径与审计记录。

## 相关文档

- `AGENTS.md` — Agent 协作指南
- `docs/ARCHITECTURE_OVERVIEW.md` — 系统架构总览
- `docs/AGENT_ROUTING_DIAGRAMS.md` — 路由与协作流程图
