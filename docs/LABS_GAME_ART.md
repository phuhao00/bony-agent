# 游戏美术助手 (Game Art)

> 前端页面：`web/app/game-art/`  
> 对应 Agent：`game_art_agent`  
> 对应 Skill：`.agent/skills/game-art-agent/SKILL.md`

## 功能概述

视觉风格指南、角色/场景 Brief、UI 美术规范与竞品视觉分析。

## 前端结构

- **页面入口**：`web/app/game-art/page.tsx`
- **主要组件**：GameArtActionPanel、GameArtComposer、GameArtMoodboard、GameArtResultPanel
- **样式/工具**：遵循项目主题令牌与 `AssistantRecipeResultPanel` Markdown 渲染规范。

## 后端调用链

```
前端页面
  → API Router (backend/main.py)
  → game_art_service.py
  → game_art_analysis.py、game_art_recipes.py
  → game_art_agent
  → LLM / 工具 / 外部 API
```

## 使用流程

1. 用户输入游戏类型、平台、受众与参考作品。
2. Agent 搜索游戏趋势并生成美术方向。
3. 输出视觉风格指南、角色/场景 Brief 或情绪板。
4. 美术需求可进一步交给 `media_agent` / `image_edit_agent` 生成素材。

## 典型输出

Markdown 美术文档与图片占位/生成建议。

## 相关文档

- `AGENTS.md` — Agent 协作指南
- `docs/ARCHITECTURE_OVERVIEW.md` — 系统架构总览
- `docs/AGENT_ROUTING_DIAGRAMS.md` — 路由与协作流程图
