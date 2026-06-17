# 编程助手 (Programmer)

> 前端页面：`web/app/programmer/`  
> 对应 Agent：`programmer_agent`  
> 对应 Skill：`.agent/skills/programmer-agent/SKILL.md`

## 功能概述

Git/SSH 环境、中间件运维、代码分析与开发工作流。

## 前端结构

- **页面入口**：`web/app/programmer/page.tsx`
- **主要组件**：ProgrammerActionPanel、ProgrammerApprovalCard、ProgrammerComposer、ProgrammerResultPanel
- **样式/工具**：遵循项目主题令牌与 `AssistantRecipeResultPanel` Markdown 渲染规范。

## 后端调用链

```
前端页面
  → API Router (backend/main.py)
  → programmer_service.py
  → programmer_recipes.py、programmer_command_policy.py
  → programmer_agent
  → LLM / 工具 / 外部 API
```

## 使用流程

1. 用户输入开发任务或运维问题。
2. Agent 扫描环境、诊断问题或执行 Recipe。
3. 高风险操作（启动/停止/Shell）需审批卡确认。
4. 输出诊断结果、命令日志与修复建议。

## 典型输出

Markdown 技术报告、命令输出、修复步骤与风险标注。

## 相关文档

- `AGENTS.md` — Agent 协作指南
- `docs/ARCHITECTURE_OVERVIEW.md` — 系统架构总览
- `docs/AGENT_ROUTING_DIAGRAMS.md` — 路由与协作流程图
