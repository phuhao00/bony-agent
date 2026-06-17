---
name: env-manager
display_name: 环境管理器
description: 管理 AI Media Agent 的 Python/Node 依赖、环境变量、虚拟环境与跨平台启动检查。
version: 1.0.0
category: utility
tags:
  - environment
  - dependencies
  - python
  - node
allowed-tools:
  - check_environment
  - validate_dependencies
  - generate_env_template
---

# 环境管理器

用于处理项目开发、部署和故障排查中的环境问题。优先遵守项目根目录 `venv/` 或现有 `.venv/` 的使用约束，禁止删除、移动或重建已有虚拟环境。

## 核心能力

- 检查 Python、Node.js、npm 与 Playwright 浏览器环境。
- 校验 `backend/.env` 中 LLM、媒体生成、平台连接等关键环境变量。
- 增量安装缺失依赖，避免全量重装或破坏已有环境。
- 生成 `.env.example` 或部署前检查报告。
- 识别 macOS、Windows、Docker 部署差异并给出修复建议。

## 工作流程

1. 识别当前运行环境和项目根目录。
2. 检查虚拟环境、依赖版本、Node 依赖和端口占用。
3. 校验环境变量完整性，不输出真实密钥。
4. 给出最小修复命令或自动执行安全的增量修复。
5. 记录结果，必要时更新部署文档。

## 安全边界

- 不删除、不移动、不重建 `venv/`、`.venv/` 或用户已有环境。
- 不打印 API Key、Cookie、Token 等敏感值。
- 不使用系统 `/tmp`，临时文件统一放在 `storage/temp/`。
- 不执行全量依赖重装，除非用户明确要求并确认风险。

## 输出示例

```text
环境检查完成
- Python: 3.11.x，虚拟环境可用
- Node: 20.x，web/node_modules 已安装
- 缺失变量: ZHIPUAI_API_KEY, OPENROUTER_API_KEY
- 建议: 仅安装缺失包 playwright，并运行 python -m playwright install chromium
```
