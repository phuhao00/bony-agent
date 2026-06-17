# System Assistant（电脑助手）

本地电脑维护子系统：安装/卸载软件、修复网络、配置环境、整理文件。

## 能力边界

| 支持 | 不支持 |
|------|--------|
| Homebrew / winget 安装常用应用 | 注册表深度清理 |
| 网络诊断、DNS 刷新 | 内核/驱动级修复 |
| 开发工具版本检查 | 任意 Shell 命令 |
| My Computer 登记目录内文件整理 | 全盘任意路径写入 |

## 入口

- **独立页面**：`/system-assistant`
- **主聊天**：关键词路由至 `system_assistant` Agent
- **工作台**：ops → 电脑助手
- **侧边栏**：更多 → 电脑助手

## API

| 端点 | 说明 |
|------|------|
| `GET /system-assistant/environment` | 后端环境画像（平台、包管理器、能力门控） |
| `GET /system-assistant/suggestions` | 基于诊断的规则型推荐 |
| `GET /system-assistant/recipes` | Recipe 列表（按 server 平台过滤） |
| `GET /system-assistant/catalog` | 应用目录 |
| `POST /system-assistant/catalog` | 添加自定义应用 |
| `GET /system-assistant/diagnostics/quick` | 快速诊断 |
| `POST /system-assistant/run` | 启动工作流 |
| `GET /system-assistant/tasks/{id}` | 任务状态 |
| `POST /system-assistant/tasks/{id}/resume` | 审批后继续 |

### 环境画像示例

`GET /system-assistant/environment?client_platform=darwin`

```json
{
  "server_platform": "darwin",
  "client_platform": "darwin",
  "platform_mismatch": false,
  "package_managers": {"brew": true, "winget": false},
  "install_recipe_id": "install.brew_cask",
  "capabilities": {"install": true, "network": true, "organize": true, "media_organize": true},
  "ui_labels": {"platform_name": "macOS", "package_manager": "Homebrew"}
}
```

## 独立页交互

1. **推荐视图**（默认）：进入页自动诊断 + 智能推荐卡片 + 快捷预设
2. **自然语言 Composer**：固定 `agent_id=system_assistant` 流式对话
3. **分类操作**：安装/卸载/网络/环境/整理（命令预览来自 environment API）
4. **内联审批**：等待审批时可在结果面板直接批准/拒绝
5. **整理确认**：preview 后可一键 `organize.apply_batch`
6. **图片媒体**：压缩/编辑/合成视频写入子目录（`Compressed/`、`Edited/`、`Slideshows/`），去重移至 `Duplicates/`；保留原图
7. **EXIF**：`by_exif_date` 按拍摄时间归档；编辑支持 EXIF 自动旋转；视频可按 EXIF 排序

## Recipe 类别

- **install** / **uninstall** — 应用安装卸载
- **repair** — 重装、清缓存
- **network** — 诊断、DNS 刷新
- **env** — 开发工具检查与安装
- **organize** — 文件整理 preview / apply；图片分类（含 EXIF 拍摄日期）、去重、压缩、水印/自动旋转编辑、合成幻灯片视频（可配 BGM）

## 安全模型

1. **Recipe 白名单**：LLM 与 UI 仅可选预定义工作流
2. **Shell 分层策略**：[`backend/core/system_command_policy.py`](../backend/core/system_command_policy.py)
3. **审批门控**：安装/卸载/网络修复/批量移动默认需审批
4. **文件沙箱**：整理文件限制在 My Computer 登记目录
5. **执行环境**：命令在后端主机 subprocess 执行；UI 展示 server 环境，client/server 不一致时显示警告

## 相关模块

- [`backend/core/system_environment.py`](../backend/core/system_environment.py) — 环境探测与命令构建
- [`backend/services/system_suggestions.py`](../backend/services/system_suggestions.py) — 规则型推荐
- [`backend/services/system_assistant_service.py`](../backend/services/system_assistant_service.py)
- [`backend/core/system_recipes.py`](../backend/core/system_recipes.py)
- [`backend/core/file_media_ops.py`](../backend/core/file_media_ops.py) — 图片扫描、压缩、编辑、幻灯片视频
- [`backend/core/local_computer.py`](../backend/core/local_computer.py) — move/rename/mkdir/launch_app
- [`backend/agents/system_assistant_agent.py`](../backend/agents/system_assistant_agent.py)
- [`backend/tools/system_tools.py`](../backend/tools/system_tools.py)

## 验证

```bash
./venv/bin/python -m pytest tests/test_system_assistant.py -q
```

## Web vs Electron

- **Web / Electron**：诊断与安装均走后端 subprocess（以 server 环境为准）
- **Electron 客户端 OS**：仅用于 mismatch 检测与展示，不用于命令执行
