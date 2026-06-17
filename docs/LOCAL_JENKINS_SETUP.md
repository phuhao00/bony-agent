# 本机 Jenkins 联调记录（tutu Mac）

> 2026-06-04 已完成本地安装与 `jenkins_local_finish.py` 配置。凭证勿提交 Git。

## 端口对照（别混）

| 端口 | 服务 | 用途 |
|------|------|------|
| **8000** | AI Media Agent **FastAPI 后端** | `/feishu/ops/jenkins/*`、`/health`；改 `backend/.env` 后需**重启此进程** |
| **3000** | Next.js **Web** | 飞书工作台 → 运维 → 发布流水线（经 `/api/feishu/ops/jenkins/*` 代理到 8000） |
| **8080** | **Jenkins** Web/API | `JENKINS_URL` 必须指向 `http://127.0.0.1:8080`，不是 8000 |

快速自检：

```bash
curl -s http://127.0.0.1:8000/health
curl -s http://127.0.0.1:8000/feishu/ops/jenkins/health
curl -sf http://127.0.0.1:8080/login
```

## 环境摘要

| 项 | 值 |
|----|-----|
| 安装方式 | Homebrew `jenkins-lts` |
| 服务 | `brew services start jenkins-lts` |
| 数据目录 | `~/.jenkins` |
| Web UI | http://127.0.0.1:8080 |
| 登录用户 | `admin` |
| Web 登录密码 | 已改为自定义，见 `storage/jenkins/local_credentials.json`（不进 Git） |
| 白名单 Job | `deploy-agent-backend`（参数 `BRANCH`） |

## 登录凭证（Web UI）

| 用途 | 说明 |
|------|------|
| 用户名 | `admin` |
| 当前密码 | 记录在 **`storage/jenkins/local_credentials.json`** 的 `admin_password` 字段（2026-06-04 起已不用初始安装密码） |
| Jenkins 地址 | http://127.0.0.1:8080 |

本机查看（密码不会出现在 Git 仓库的 `docs/` 里）：

```bash
cat storage/jenkins/local_credentials.json
# 或只看密码：
python3 -c "import json; print(json.load(open('storage/jenkins/local_credentials.json'))['admin_password'])"
```

**历史：** 首次安装时用过 `~/.jenkins/secrets/initialAdminPassword`，已在 UI 中改为自定义密码后失效。

### 两套凭证（别混用）

| 场景 | 用什么 |
|------|--------|
| 浏览器登录 Jenkins UI | `admin` + `storage/jenkins/local_credentials.json` → `admin_password` |
| AI Media Agent 后端 / 运维 API | `backend/.env` 里的 `JENKINS_API_TOKEN`（由 `jenkins_local_finish.py` 生成） |
| 本地凭证汇总 | `storage/jenkins/local_credentials.json`（`storage/` 已 gitignore） |

API Token **不能**当网页登录密码用；初始安装密码 **也建议不要**长期写在 `.env` 里当 Token（仅本地临时联调时可由脚本回退）。

### 修改 Web 密码后

若再次在 Jenkins UI 修改 `admin` 密码，请同步更新 `storage/jenkins/local_credentials.json` 里的 `admin_password`（勿写入 `docs/` 或提交 Git）。

### 维护建议

1. **用户 admin → Security → API Token** 轮换 Token 时，同步更新 `backend/.env` 的 `JENKINS_API_TOKEN`。
2. 改 `.env` 后重启后端，再跑 `./scripts/verify_jenkins_local.sh`。

## 项目内配置文件

| 文件 | 作用 |
|------|------|
| `backend/.env` | `JENKINS_URL` / `JENKINS_USER` / `JENKINS_API_TOKEN` |
| `storage/meal/feishu_config.json` | `jenkins.enabled` + `allowed_jobs` |
| `storage/jenkins/local_credentials.json` | 本地凭证备份（`storage/` 已 gitignore） |

## 常用命令

```bash
# 验证 Jenkins + 后端 API（改 .env 后若 API 仍报未配置，先重启后端）
./scripts/verify_jenkins_local.sh

# 仅重新写入配置（Jenkins 已运行时）
./venv/bin/python scripts/jenkins_local_finish.py

# 完整安装（首次）
./scripts/setup_local_jenkins.sh
```

## 运维入口

- Web：**飞书工作台 → 运维 → 发布流水线**
- 飞书：`运维 Jenkins` / `运维部署 …` → `运维确认 <计划ID>`

## 注意事项

1. **改 `.env` 后必须重启后端**（`load_dotenv()` 在进程启动时加载）。
2. Python 访问 `127.0.0.1:8080` 若 502，检查系统 `HTTP_PROXY`；`jenkins_service` 已设置 `trust_env=False` 并绕过本地代理。
3. 生产环境请使用独立 API Token，勿长期使用初始安装密码。

## 验证清单（通过即联调 OK）

- [ ] `brew services list` 中 `jenkins-lts` 为 `started`
- [ ] `curl -sf http://127.0.0.1:8080/login`
- [ ] `./scripts/verify_jenkins_local.sh` 全部 PASS
- [ ] http://localhost:3000 → 飞书工作台 → 运维 → 发布流水线显示「已连接」

详见 [`JENKINS_OPS.md`](./JENKINS_OPS.md)。
