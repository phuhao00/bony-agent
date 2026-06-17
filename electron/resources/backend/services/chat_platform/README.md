# Chat Platform Bridge

受 [Vercel Chat SDK](https://github.com/vercel/chat) 的 Thread/Message 抽象启发，将外部 IM 平台（飞书 / Discord）的消息统一接入 AI Media Agent 的 Agent 聊天能力。

## 设计原则

- **零侵入**：不修改现有 `meal_feishu_handler.py`、`feishu_ops.py`、`discord_bot.py` 等模块。
- **统一抽象**：`PlatformMessage`、`PlatformThread`、`BasePlatformAdapter` 对齐 Chat SDK 的核心概念。
- **复用 Agent 能力**：通过 `chat_service.invoke_agent_chat()` 调用现有 Agent 图谱。

## 已支持平台

| 平台 | 接入方式 | 开关 | 说明 |
|------|----------|------|------|
| 飞书 / Lark | Webhook `/chat-platform/webhook/feishu` | `CHAT_PLATFORM_FEISHU_ENABLED` | 复用 `meal_feishu_api` 发消息 |
| Discord | Gateway (`discord.py`) | `CHAT_PLATFORM_DISCORD_ENABLED` + `CHAT_PLATFORM_DISCORD_BOT_TOKEN` | 监听消息事件 |

## 环境变量

```bash
# 飞书（复用已有 FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_ENCRYPT_KEY）
CHAT_PLATFORM_FEISHU_ENABLED=true

# Discord
CHAT_PLATFORM_DISCORD_ENABLED=true
CHAT_PLATFORM_DISCORD_BOT_TOKEN=your-bot-token

# 通用
CHAT_PLATFORM_DEFAULT_AGENT_ID=media_agent
CHAT_PLATFORM_RATE_LIMIT_ENABLED=true
CHAT_PLATFORM_RATE_LIMIT_PER_SENDER=20
CHAT_PLATFORM_RATE_LIMIT_WINDOW=60
```

## 飞书配置

1. 在飞书开放平台「事件与回调」中订阅 `im.message.receive_v1`。
2. 设置请求地址为 `https://<your-backend>/chat-platform/webhook/feishu`。
3. 配置 Encrypt Key 时，网关会自动校验 `X-Lark-Signature`。
4. 机器人首次添加或 @ 机器人时，会自动响应文本消息。

## Discord 配置

1. 在 [Discord Developer Portal](https://discord.com/developers/applications) 创建 Bot，获取 Token。
2. 开启 `MESSAGE CONTENT INTENT`。
3. 将 Bot 加入服务器。
4. 在群聊中 @Bot 或私聊 Bot 即可触发 Agent 回复。

## 消息处理规则

- 忽略 Bot 自身消息。
- 私聊 / DM 消息默认处理。
- 群聊 / 频道中只处理 `@Bot` 的消息。
- 单用户限流默认 60 秒内最多 20 条。

## 测试

```bash
cd backend
source .venv/bin/activate
python -m pytest tests/test_chat_platform.py -v
```
