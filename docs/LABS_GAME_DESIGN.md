# 游戏设计助手 (Game Design)

> 前端页面：`web/app/game-design/`  
> 对应 Agent：`game_design_agent`  
> 对应 Skill：`.agent/skills/game-design-agent/SKILL.md`

## 功能概述

概念案、核心循环、系统设计、关卡规划、剧情世界观与数值框架。

## 前端结构

- **页面入口**：`web/app/game-design/page.tsx`
- **主要组件**：GameDesignActionPanel、GameDesignComposer、GameDesignResultPanel
- **样式/工具**：遵循项目主题令牌与 `AssistantRecipeResultPanel` Markdown 渲染规范。

## 后端调用链

```
前端页面
  → API Router (backend/main.py)
  → game_design_service.py
  → game_design_analysis.py、game_design_recipes.py
  → game_design_agent
  → LLM / 工具 / 外部 API
```

## 使用流程

1. 用户输入游戏创意、类型与目标平台。
2. Agent 搜索趋势并生成策划文档。
3. 输出概念案、核心循环、系统设计、关卡规划、数值框架。
4. 美术需求同步给 `game_art_agent`，实现需求可转 `media_agent`。

## 典型输出

Markdown 策划文档，标注 P0/P1/P2 与可验证指标。

## 相关文档

- `AGENTS.md` — Agent 协作指南
- `docs/ARCHITECTURE_OVERVIEW.md` — 系统架构总览
- `docs/AGENT_ROUTING_DIAGRAMS.md` — 路由与协作流程图
