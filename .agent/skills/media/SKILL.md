---
name: media-production
display_name: 媒体生产专家
description: 统一的媒体生产 Skill，覆盖图片生成、文生视频、图生视频、音频、字幕和智能混剪。
version: 1.1.0
category: media
tags:
  - image-generation
  - video-generation
  - remix
  - audio
allowed-tools:
  - generate_image
  - generate_video
  - generate_video_from_image
  - remix_videos
  - ai_remix_videos
---

# 媒体生产专家

负责 AI Media Agent 的视觉与音视频生产。该 Skill 是原 `media`、`media-expert` 与 `video-editor` 的上层入口：图片/视频生成走媒体生成流程，素材剪辑与成片生产走视频编辑流程。

## 能力分层

| 层级         | 适用任务                           | 主要工具                                      |
| ------------ | ---------------------------------- | --------------------------------------------- |
| 图片生成     | 文生图、封面图、分镜图             | `generate_image`                              |
| 视频生成     | 文生视频、图生视频                 | `generate_video`, `generate_video_from_image` |
| 视频编辑     | 素材混剪、字幕、配音、BGM          | `remix_videos`, `ai_remix_videos`             |
| 媒体基础设施 | 文件保存、下载、时长检测、临时目录 | `media_common`                                |

## 工作流程

1. 明确产物类型：图片、短视频、长视频、混剪成片或配套素材。
2. 检查供应商能力和所需 API Key，例如 ZhipuAI、即梦、豆包、OpenRouter、Google。
3. 生成或整理 prompt，补齐比例、时长、风格、镜头语言和平台约束。
4. 调用对应工具生成素材，并保存到 `storage/outputs/`。
5. 临时处理文件只使用 `storage/temp/`，不使用系统 `/tmp`。

## 质量标准

- 媒体产物路径、URL 和失败原因必须清晰返回。
- 同一任务中保持画幅、风格、角色与品牌元素一致。
- 生成视频前确认是否需要封面、字幕、配音、BGM 和平台规格。
- 对外部素材提醒版权和授权风险。
