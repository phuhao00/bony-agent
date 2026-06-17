---
name: content-moderator
display_name: 内容安全审核专家兼容入口
description: moderation Skill 的兼容别名。新任务请优先使用 .agent/skills/moderation/SKILL.md。
version: 1.1.0
category: security
tags:
  - alias
  - moderation
allowed-tools:
  - check_content
  - quick_check_sensitive_words
  - fix_content
---

# 兼容说明

`content-moderator` 已合并到 `moderation`。当任务涉及敏感词检测、平台规则、审核报告、合规修复或发布前检查时，请读取并遵循 `.agent/skills/moderation/SKILL.md`。

保留此目录是为了兼容历史引用和旧的 Agent 配置；不要在这里新增新的能力定义。
