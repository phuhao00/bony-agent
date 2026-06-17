# Hermes × AI Media Agent 集成手册

## 架构概览

- **Hermes 本体**：独立安装（`hermes` CLI），负责长会话、Gateway、自改进 Skill
- **桥接层**：`hermes_tools.py`、`mcp_presets`（hermes-local / ai_media_agent）、`hermes_sidecar.py`
- **本平台**：媒体生成、发布、RAG、审批；通过 MCP Server 暴露工具给 Hermes

## 快速验证

```bash
# 1. Hermes 状态
curl http://127.0.0.1:8000/api/hermes/status

# 2. 委托任务
curl -X POST http://127.0.0.1:8000/api/hermes/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Summarize AI media trends in 3 bullets"}'

# 3. Skill 同步
./venv/bin/python scripts/sync_hermes_skills.py from_hermes

# 4. Sidecar（模拟 Telegram 入站）
curl -X POST http://127.0.0.1:8000/api/hermes/sidecar/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"你好","session_source":{"platform":"telegram","chat_id":"demo"}}'
```

## MCP 双向桥

### 本平台 → Hermes

1. 打开 **Settings → Capabilities → MCP**
2. 安装预设 **Hermes Agent MCP**（`hermes-local`）
3. 主 Agent 自动获得 `hermes-local__*` 工具（会话检索、发消息等）

### Hermes → 本平台

1. 启动 `./start_local.sh`（默认启动 Media MCP `:36850`）
2. 在 Hermes 配置 HTTP MCP：

```yaml
# ~/.hermes/config.yaml — mcp_servers 段示例
ai_media:
  url: http://127.0.0.1:36850/mcp
  transport: http
```

或使用：`hermes mcp add --url http://127.0.0.1:36850/mcp`

## 配置

| 文件 | 用途 |
|------|------|
| `storage/hermes_instances.json` | Hermes 实例、research_backend 偏好 |
| `storage/hermes_sidecar_sessions.json` | Gateway session_id 映射 |
| `storage/skills_quarantine/` | 外部 Skill 隔离区 |

## 任务分工

| 场景 | 推荐 |
|------|------|
| Telegram/Discord 日常问答 | Hermes Gateway |
| 文生图/视频/发布 | 本平台 |
| 多节点 A2A | OpenClaw |
| 流水线调研 | Hermes（auto）→ DuckDuckGo 降级 |

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/hermes/status` | 健康与 Gateway 状态 |
| GET/POST | `/api/hermes/config` | 实例配置 |
| POST | `/api/hermes/chat` | CLI 委托 |
| POST | `/api/hermes/sidecar/chat` | Gateway 转发 |
| POST | `/api/hermes/skills/sync` | Skill 双向同步 |

## 安全约束

- Media MCP 仅 bind `127.0.0.1`
- 平台 OAuth/Cookie 不写入 Hermes config
- 发布类 MCP 工具走现有审批策略
- 外部 Skill 导入前 quarantine 扫描

## OpenClaw 共存

- 不强制 `hermes claw migrate`
- OpenClaw：`storage/lobster_nodes.json`
- Hermes：`storage/hermes_instances.json`
- 龙虾流水线 Step 2：`research_backend=auto` 时优先 Hermes，失败降级 OpenClaw
