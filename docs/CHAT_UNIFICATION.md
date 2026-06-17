# 聊天链路统一说明

## 当前架构

主对话存在两条路径：

| 路径 | 入口 | 运行时 |
|------|------|--------|
| **默认（推荐）** | `POST /api/chat` → `proxyAgentChatStream` | Python `/agent/chat/stream` |
| 遗留 | `CHAT_LEGACY_AI_SDK=1` 时 | Next.js Vercel AI SDK + 本地 `tools.ts` |

多 Agent 编排：`POST /api/multi-agent/stream` → Python `/multi-agent/stream`

## 环境变量

```bash
# web/.env.local
# 设为 1 才启用 Next 侧本地 tool 定义（不推荐）
# CHAT_LEGACY_AI_SDK=1

BACKEND_URL=http://localhost:8000
```

## 目标状态

- Next.js 仅做 SSE/JSON 代理与鉴权透传
- Tool 定义与执行全部在 Python backend
- Memory / trace 统一写入 backend `trace_store`

## 通用代理

新增 `web/app/api/backend/[...path]/route.ts` 可将任意 REST 路径转发到 FastAPI，减少 200+ 薄代理文件的重复维护。SSE 与 multipart 上传仍使用专用 route。
