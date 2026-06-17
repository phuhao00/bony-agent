# Claude Code 工作区

> 前端页面：`web/app/claude-code/`  
> 对应 Agent：`（code_analyst_agent / programmer_agent）`  
> 对应 Skill：`.agent/skills/code-analyst-agent / programmer-agent/SKILL.md`

## 功能概述

代码聊天、资源管理器、Slash 命令面板与 Claude Code 集成。

## 前端结构

- **页面入口**：`web/app/claude-code/page.tsx`
- **主要组件**：CodingChatPanel、CodingExplorer、CodingOutputPanel、ClaudeCodeTimeline、SlashCommandPalette
- **样式/工具**：遵循项目主题令牌与 `AssistantRecipeResultPanel` Markdown 渲染规范。

## 后端调用链

```
前端页面
  → API Router (backend/main.py)
  → claude_code_service.py
  → coding_provider.py
  → （code_analyst_agent / programmer_agent）
  → LLM / 工具 / 外部 API
```

## 使用流程

1. 用户在聊天面板输入代码问题或 Slash 命令。
2. Claude Code 服务解析意图并调用代码分析/程序员 Agent。
3. 结果在输出面板与资源管理器中展示。
4. 支持时间轴查看多轮操作历史。

## 典型输出

代码建议、文件修改、命令输出、操作时间轴。

## 相关文档

- `AGENTS.md` — Agent 协作指南
- `docs/ARCHITECTURE_OVERVIEW.md` — 系统架构总览
- `docs/AGENT_ROUTING_DIAGRAMS.md` — 路由与协作流程图
