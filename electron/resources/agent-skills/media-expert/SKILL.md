---
name: media-expert
display_name: 媒体生成专家兼容入口
description: media-production Skill 的兼容别名。新任务请优先使用 .agent/skills/media/SKILL.md。
version: 1.1.0
category: media
tags:
  - alias
  - media-production
allowed-tools:
  - generate_image
  - generate_video
  - generate_video_from_image
---

# 兼容说明

`media-expert` 已合并到 `media-production`，正式定义位于 `.agent/skills/media/SKILL.md`。当任务涉及图片生成、视频生成、图生视频、媒体供应商选择或素材保存时，请遵循该统一入口。

保留此目录是为了兼容历史引用和旧的 Agent 配置；不要在这里新增新的能力定义。
