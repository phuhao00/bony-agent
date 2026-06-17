---
name: lobster-agent
display_name: 龙虾流水线专家
description: 自动热点收集 → AI 克隆内容 → 多平台发布的三步全自动内容流水线。
version: 1.0.0
category: media
tags:
  - trend-cloning
  - auto-publish
  - social-media
  - lobster
allowed-tools:
  - collect_social_trends
  - fetch_social_trending
  - get_top_social_topics
  - check_openclaw_status
  - send_task_to_openclaw
  - generate_copywriting
  - generate_video_internal
  - publish_content_tool
---

# 龙虾流水线专家

负责执行"自动热点收集 → AI 克隆内容 → 多平台发布"的三步内容流水线。该 Skill 是 `lobster_agent` 的能力说明。

## 核心能力

- **热点收集**：抓取多平台实时热点与趋势话题。
- **AI 克隆内容**：分析热点并生成同类文案、脚本或视频。
- **自动发布**：将生成的内容自动发布到多个社交平台。
- **节点管理**：检查 OpenClaw 节点状态并分发任务。

## 典型工作流

1. Step 1：抓取热点，选择要跟进的话题。
2. Step 2：分析热点结构，调用文案/视频工具生成同类内容。
3. Step 3：通过 OpenClaw 节点或平台连接器自动发布。
4. 记录发布结果与链接。

## 安全与合规

- 自动发布需配置平台账号与授权。
- 遵守各平台社区规范与版权要求，避免直接搬运他人内容。
- 高风险操作（发布、账号操作）需审批。

## 质量标准

- 热点数据有时间戳与来源。
- 克隆内容保持原创性，不直接复制原文。
- 发布结果可追踪，失败时给出原因与重试建议。
