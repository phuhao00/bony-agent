---
name: logo-motion
display_name: Logo 动画 / 标志动效
description: 将栅格 Logo 转换为语义化 SVG，并生成带 CSS 动画的独立 HTML、帧序列胶片条和拟合 QA 报告。适合品牌 Logo、图标、标识的动效设计。
version: 1.0.0
category: media
tags:
  - logo-animation
  - motion-design
  - svg
  - css-animation
allowed-tools:
  - generate_logo_motion
  - trace_logo_to_svg
---

# Logo 动画 / 标志动效

本 Skill 基于 [nolangz/pixel2motion](https://github.com/nolangz/pixel2motion)（MIT License）的工作流，将静态 Logo 图转换成可交互的动画 HTML。

## 适用场景

- 品牌 Logo 动效（网站首屏、加载动画、视频片头）
- 应用图标启动动画
- 社交媒体封面/头像微动效
- 吉祥物或图形标识的 reveal 动画

## 输入

- `source_image_url`: Logo 栅格图（PNG/JPG/WebP），建议背景干净、主体清晰。
- `motion_brief`: 自然语言动画需求，例如「科技感线条依次描绘」「柔和淡入并轻微上浮」「活泼弹跳」。
- `style`: 预设风格
  - `subtle` — 柔和克制，适合高端品牌
  - `energetic` — 活泼弹性，适合年轻品牌
  - `cinematic` — 电影感、层次 reveal
  - `loop` — 无缝循环
  - `reveal` — 线条描绘、stroke-dashoffset
- `duration_ms`: 动画总时长，默认 1500ms。

## 输出

| 产物 | 说明 |
|------|------|
| `html_url` | `logo_motion.html` 独立动画页，可预览、慢放、重播 |
| `svg_url` | 转换后的 SVG |
| `css_url` | 驱动动画的 `motion.css` |
| `render_url` | SVG 静态渲染图 |
| `strip_url` | 关键帧胶片条 |
| `metrics` | IoU 等拟合指标 |

## 工作流程

1. `trace_logo_to_svg` 将栅格图描摹为 SVG，并做 headless-Chrome 拟合 QA。
2. LLM 根据 SVG 结构和动画需求生成 `motion.css`。
3. `animate_svg_showcase.py` 打包成独立 HTML。
4. Playwright 抓取关键帧并生成胶片条（可选，未安装时跳过）。

## 质量标准

- 拟合 IoU 越高越好；若 IoU 偏低，提醒用户 SVG 描摹可能丢失细节。
- 动画需尊重 `prefers-reduced-motion`。
- 产物路径统一落入 `storage/outputs/`，可通过 `/api/media/<filename>` 访问。

## 前置依赖

- Python 3.10+
- Pillow、numpy
- Chrome 或 Chromium（`CHROME_BIN` 环境变量可覆盖自动检测）
- Playwright（可选，用于抓取帧序列）

## 许可

本 Skill 引用的脚本来自 nolangz/pixel2motion，保留其 MIT License，详见 `LICENSE` 文件。
