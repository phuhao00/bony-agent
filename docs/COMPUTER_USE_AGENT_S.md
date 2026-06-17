# Computer Use · Agent-S 实现说明

本项目借鉴 [Agent-S](https://github.com/simular-ai/agent-s) 的 **单步 Observe-Act 循环**：

1. 截取 Playwright 视口 PNG  
2. 视觉 LLM 规划 **一个** 下一步动作  
3. （可选）UI-TARS grounding 将自然语言描述 → 坐标  
4. `PlaywrightBrowserACI` 在浏览器内执行（**无** `pyautogui`）  
5. （可选）Reflection 复盘  
6. 通过 `task_manager` 写入 `metadata.computer_use`，前端每 2s 轮询  

## 引擎选择

| 环境变量 | 说明 | 默认 |
|----------|------|------|
| `COMPUTER_USE_ENGINE` | `agent_s` 或 `legacy` | `agent_s` |

- **agent_s**：`backend/services/agent_s/` 单步截图循环  
- **legacy**：原 `computer_use_service.py` 批量 JSON 规划  

## UI-TARS Grounding（完整视觉定位）

| 环境变量 | 说明 | 默认 |
|----------|------|------|
| `COMPUTER_USE_GROUND_URL` | OpenAI 兼容 HTTP 端点（vLLM/TGI/HF） | 空（禁用，走 Playwright fallback） |
| `COMPUTER_USE_GROUND_MODEL` | 如 `ui-tars-1.5-7b` | `ui-tars-1.5-7b` |
| `COMPUTER_USE_GROUND_WIDTH` | 坐标分辨率宽 | `1920` |
| `COMPUTER_USE_GROUND_HEIGHT` | 坐标分辨率高 | `1080` |
| `COMPUTER_USE_GROUND_API_KEY` | 可选 Bearer Token | 空 |

坐标从 grounding 分辨率缩放到 Playwright 视口（默认 1280×800）。

### 本地部署 UI-TARS（示例）

```bash
# 示例：vLLM 部署 ByteDance/UI-TARS-1.5-7B
# pip install vllm  # 在 GPU 机器上
# vllm serve ByteDance/UI-TARS-1.5-7B --port 8080

export COMPUTER_USE_GROUND_URL=http://localhost:8080
export COMPUTER_USE_GROUND_MODEL=ui-tars-1.5-7b
export COMPUTER_USE_GROUND_WIDTH=1920
export COMPUTER_USE_GROUND_HEIGHT=1080
```

## 其他环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `COMPUTER_USE_MAX_STEPS` | 最大步数 | `15` |
| `COMPUTER_USE_ENABLE_REFLECTION` | 每步 Reflection | `true` |
| `COMPUTER_USE_REQUIRE_APPROVAL` | 强制开关步骤审批（`false`=全自动） | 跟随前端请求，默认关 |
| `COMPUTER_USE_VIEWPORT_WIDTH` | 视口宽 | `1280` |
| `COMPUTER_USE_VIEWPORT_HEIGHT` | 视口高 | `800` |
| `LLM_VISION_MODEL` | 主视觉规划模型 | 按供应商默认 |
| `LLM_VISION_PROVIDER` | 视觉供应商覆盖 | 空 |

## API 行为（异步）

- `POST /computer-use/run` → 立即返回 `{ task_id, status: "pending" }`  
- `GET /tasks/{id}` → `metadata.computer_use` 含 `stages`、`last_plan`、`preview_screenshot_base64`  
- `POST /tasks/{id}/resume` → 审批后异步恢复，同样立即返回  
- `POST /tasks/{id}/cancel` → 设置 `cancel_requested`，下一步检查时终止  

## gui-agents 依赖说明

官方 `gui-agents>=0.3.2` 要求 Python ≤3.12。当前开发环境若为 **Python 3.13**，将使用本仓库内置的 Agent-S 兼容实现（`agent_s/` 模块），行为对齐单步循环 + ACI + grounding，不依赖 `pyautogui`。

在 Python 3.12 环境中可额外安装：

```bash
pip install "gui-agents>=0.3.2"
```

## 验收清单

1. 点击运行 **<1s** 返回 `task_id`  
2. 进度显示「第 N 步 · click/type」等真实步骤  
3. 每 2s poll 可见最新 viewport 截图  
4. UI-TARS 配置正确时，搜索任务可 fill → Enter → 截图  
5. 审批默认开启，每步高风险动作可暂停  
6. 取消在下一步生效  
7. `COMPUTER_USE_ENGINE=legacy` 仍可用  
