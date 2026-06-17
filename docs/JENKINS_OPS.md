# Jenkins 可视化运维

在 **飞书工作台 → 运维** 中管理 Jenkins 白名单 Job：查看最近构建、触发构建、查看控制台日志；飞书群内可通过「对话 → 计划 → 确认」或 **@机器人自然语言** 直接触发构建。

## 本地安装（macOS + Homebrew）

```bash
# 1. 安装并启动（首次）
brew install jenkins-lts
brew services start jenkins-lts

# 2. 写入 .env、白名单 Job、创建测试流水线并触发一次构建
./venv/bin/python scripts/jenkins_local_finish.py

# 或一键：./scripts/setup_local_jenkins.sh
```

- 数据目录默认：`~/.jenkins`
- 首次登录：用户 `admin`，密码见 `~/.jenkins/secrets/initialAdminPassword`（详见 [`LOCAL_JENKINS_SETUP.md` § 登录凭证](./LOCAL_JENKINS_SETUP.md#登录凭证web-ui)）
- Jenkins UI：http://127.0.0.1:8080
- 完成后 **重启后端**，再打开飞书工作台 → 运维 → 发布流水线
- 本机已配置记录见 [`LOCAL_JENKINS_SETUP.md`](./LOCAL_JENKINS_SETUP.md)
- 一键验证：`./scripts/verify_jenkins_local.sh`

若 Python 请求 Jenkins 返回 502，多为系统 `HTTP_PROXY` 干扰；`jenkins_service` 已对 `127.0.0.1` 绕过代理。

## 环境变量

在 `backend/.env` 中配置：

```bash
JENKINS_URL=https://your-jenkins.example.com
JENKINS_USER=your_username
JENKINS_API_TOKEN=your_api_token
```

**Web 登录**与 **API Token** 是两套凭证，说明见 [`LOCAL_JENKINS_SETUP.md`](./LOCAL_JENKINS_SETUP.md)。

API Token 在 Jenkins：**用户 admin → Security → API Token** 创建；写入 `backend/.env` 的 `JENKINS_API_TOKEN`。

## 白名单 Job

编辑 `storage/meal/feishu_config.json`：

```json
{
  "ops_admin_open_ids": ["ou_xxxxxxxx"],
  "ops_auto_jenkins_build": true,
  "ops_auto_jenkins_require_admin": true,
  "ops_auto_jenkins_min_confidence": 0.65,
  "ops_auto_jenkins_context_hours": 1.0,
  "ops_auto_jenkins_cooldown_sec": 90,
  "jenkins": {
    "enabled": true,
    "url": "",
    "username": "",
    "allowed_jobs": [
      {
        "name": "deploy-agent-backend",
        "label": "部署 Agent 后端",
        "risk": "high",
        "parameters": [
          {
            "name": "BRANCH",
            "default": "main",
            "choices": ["main", "hh/super-agent"]
          }
        ]
      }
    ],
    "poll_timeout_sec": 120,
    "console_max_chars": 8000
  }
}
```

- `url` / `username` 留空时使用环境变量
- `enabled: true` 且具备 URL + Token 后才会真正调用 Jenkins
- 仅 `allowed_jobs` 中的 `name` 可被触发或查询

## 飞书指令

| 指令 | 说明 |
|------|------|
| `运维 Jenkins` | 列出白名单 Job 及最近构建（只读） |
| `运维部署 触发 deploy-agent-backend 分支 main` | AI 生成计划（可含 `jenkins_trigger_build`） |
| `运维确认 <计划ID>` | 执行计划（含 Jenkins 触发） |
| @机器人 + 自然语言 | 如「帮我把 main 部署一下」→ **直接触发**白名单 Job（见下节） |

需在 `feishu_config.json` 配置 `ops_admin_open_ids` 限制操作人。

## 群聊自然语言自动构建

**流程：** 群聊 @机器人 → 消息含部署/构建等关键词 → LLM 解析 Job 与参数 → 立即 `trigger_build`（无 `运维确认`）。

**前提：**

- 后端 `:8000` 已启动且飞书长连接/Webhook 正常
- `jenkins.enabled: true`，`backend/.env` 中 `JENKINS_*` 有效
- `ops_auto_jenkins_build: true`（默认开启）
- `ops_admin_open_ids` 包含操作人 `open_id`（`ops_auto_jenkins_require_admin` 默认 true）
- 群聊必须 @机器人；私聊可直接发自然语言

**示例：**

```
@机器人 把 deploy-agent-backend 的 main 分支构建一下
```

**审计：** 触发记录写入 `storage/meal/feishu_ops_auto_build_log.json`；同群 `ops_auto_jenkins_cooldown_sec` 秒内防连发（默认 90s）。

## Web 界面（飞书工作台 → 运维）

- **发布流水线**：左侧选 Job，右侧看构建历史与控制台；「运行构建」侧栏填写参数。
- **流水线配置**：可视化新增/编辑白名单 Job（名称、显示名、构建参数、启用 Jenkins、飞书自动构建与 `ops_admin_open_ids`），保存到 `storage/meal/feishu_config.json`，**无需手改 JSON**。
- **智能计划**：用自然语言描述发布/运维，生成步骤卡片后一次确认执行（与飞书 `运维部署` / `运维确认` 相同）。
- **系统快照**：服务、飞书、Jenkins 连通性一览。
- 构建进行中页面每 8 秒自动刷新。

### 新增一条构建项目（推荐流程）

1. 在 Jenkins 中先创建好 Job（名称与参数名记下）。
2. 打开 **飞书工作台 → 运维 → 流水线配置**。
3. 勾选「启用 Jenkins」，点击 **+ 新增流水线**，填写 Job 名称（与 Jenkins 一致）、显示名称、参数（如 `BRANCH` 及可选分支列表）。
4. 点击 **保存配置**，回到 **发布流水线** 重试连接并触发构建。

API：`GET/PUT /feishu/ops/jenkins/config`（前端代理 `/api/feishu/ops/jenkins/config`）。

## Web API

| 方法 | 路径 |
|------|------|
| GET | `/feishu/ops/jenkins/health` |
| GET | `/feishu/ops/jenkins/jobs` |
| GET | `/feishu/ops/jenkins/builds?job_name=&limit=` |
| GET | `/feishu/ops/jenkins/console?job_name=&build_number=` |
| POST | `/feishu/ops/jenkins/trigger` body: `{ job_name, build_params }` |

Next.js 代理前缀：`/api/feishu/ops/jenkins/*`。

## 白名单动作（部署计划）

- `jenkins_trigger_build` — 触发构建（high risk）
- `jenkins_build_status` — 查询构建状态

与 `status_snapshot`、`feishu_reconnect` 等一样，由 LLM 解析后经 `运维确认` 执行，**不会执行任意 shell**。

## 后续（可选）

- Jenkins 构建完成 Webhook → 自动推送飞书群
- 文件夹型 Job 名使用 `folder/subjob` 路径格式
