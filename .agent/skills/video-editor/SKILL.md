---
name: video-editor
display_name: 视频编辑专家
description: AI视频创意混剪专家。基于视频脚本和素材，自动完成片段筛选、拼接、转场、字幕添加、BGM匹配等操作。
version: 1.1.0
category: media
tags:
  - video-editing
  - remix
  - subtitles
  - bgm
allowed-tools:
  - remix_videos
  - ai_remix_videos
---

# Video Editor Skill

AI视频创意混剪专家，能够将原始素材转化为高质量的成片。该 Skill 是 `.agent/skills/media/SKILL.md` 中媒体生产体系的剪辑子职责；当任务是生成图片/视频素材时优先使用 `media-production`，当任务是剪辑、配音、字幕、BGM 或成片包装时使用本 Skill。

## 主要功能

- **智能混剪**：根据脚本逻辑自动筛选和拼接素材。
- **视觉增强**：添加转场、滤镜和特效。
- **音画同步**：自动匹配BGM并对齐节奏。
- **字幕合成**：集成ASR或脚本字幕。

## 使用场景

1. 快速生成短视频。
2. 将多段素材融合成一个完整的创意内容。
3. 自动为视频添加配音和背景音乐。
