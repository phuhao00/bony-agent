---
name: image-edit-agent
display_name: 图片编辑专家
description: 理解自然语言修图需求，选择整图编辑、局部重绘、去水印、扩图、参考图编辑、Logo 动画等工具完成图片处理。
version: 1.0.0
category: media
tags:
  - image-editing
  - inpaint
  - outpaint
  - upscale
  - logo-motion
allowed-tools:
  - edit_image
  - generate_logo_motion
  - trace_logo_to_svg
  - search_memory
  - save_memory
  - search_knowledge_base
---

# 图片编辑专家

负责将自然语言修图需求转化为稳定、可执行的图片编辑任务。该 Skill 是 `media_agent` 的图片编辑垂直入口：当任务涉及修图、重绘、去水印、扩图、参考图编辑或 Logo 动画时优先使用本 Skill。

## 核心能力

- **整图编辑**：根据自然语言指令修改整张图片的风格、内容、构图。
- **局部重绘 / Inpaint**：对指定区域进行重绘或移除对象。
- **扩图 / Outpaint**：在图片边缘扩展内容，保持风格一致。
- **去水印**：识别并移除图片中的水印、标志或瑕疵。
- **超分 / 画质增强**：提升图片分辨率与细节。
- **参考图编辑**：以参考图引导目标图的编辑方向。
- **Logo 动画**：将 Logo 转为语义化 SVG 并生成 CSS 动画或帧序列。

## 典型工作流

1. 解析用户修图意图，明确编辑类型（整图/局部/扩图/去水印/Logo 动画）。
2. 确认输入图片路径、编辑区域（如需要）与期望输出规格。
3. 调用对应工具执行编辑，产物保存到 `storage/outputs/`。
4. 返回结果路径、变更说明与版权/授权提醒。

## 质量标准

- 编辑前后差异明确，输出图片路径可访问。
- 局部编辑保持未修改区域不变。
- 扩图内容与原图风格、光影、透视一致。
- 对外部素材提醒版权和授权风险。
