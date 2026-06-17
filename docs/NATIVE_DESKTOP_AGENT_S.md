# Native Desktop Agent-S · PC 软件 GUI 自动化

本模块用于 **原生 PC 桌面应用**（Lark、Photoshop、Finder 等）的 OS 级自动化，与 [Computer Use Agent-S](COMPUTER_USE_AGENT_S.md)（Playwright 浏览器）**完全分离**。

## 架构

```
Observe（Sidecar 全屏截屏）
  → Plan（Qwen-VL 语义动作，click 用 target 描述）
  → Ground（Qwen-VL 单独算 0-1000 坐标）
  → Act（Sidecar /click /type /hotkey）
  → Reflect（可选复盘）
  → Memory（按 app 写入操作记忆）
```

## 入口

- API: `POST /native-use/run`
- 桌面操作员 UI: `/desktop-operator` → GUI 模式
- 代码: `backend/services/agent_s/desktop_runner.py`

## 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `NATIVE_USE_ENGINE` | `agent_s` 或 `legacy` | `agent_s` |
| `NATIVE_USE_MAX_STEPS` | 最大步数 | `15` |
| `NATIVE_USE_ENABLE_REFLECTION` | 每步 Reflection | `true` |
| `LLM_VISION_PROVIDER` | 通义 | `alibaba` |
| `LLM_VISION_MODEL` | 规划 + Grounding | `qwen-vl-max` |

## 多屏 macOS

1. **先打开应用**：未运行则 `open -a Feishu`，再 `activate` 一次展示窗口  
2. **再定位屏幕**：Quartz 记录 `window_id` + `display_index`（如 D2）  
3. **全程窗口截屏**：`screencapture -l window_id`，执行中不再反复抢焦点  
4. 点击坐标 = 窗口左上角 + 截图内像素 / scale  

## 权限（macOS）

1. 系统设置 → 隐私与安全性 → **辅助功能**（授权后端 / Sidecar）
2. **屏幕录制**（用于 screencapture）

## Sidecar

- 由 `native_sidecar_manager.ensure_sidecar_running()` 自动拉起
- 健康检查: `GET /desktop/sidecar/ensure`
- 日志: `logs/native-sidecar.log`

## 与浏览器的区别

| | Native Desktop | Computer Use |
|--|----------------|--------------|
| 截屏 | 全屏 OS | Playwright viewport |
| 点击 | pyautogui / cliclick | page.mouse.click |
| 定位 | Qwen-VL Grounding | UI-TARS + DOM fallback |
| 适用 | 无 Web 版的 PC 软件 | 网页应用 |

## 会话日志

- `storage/desktop/native_sessions/{task_id}/session.json`
- 截图: `step_NN_before.png` / `step_NN_after.png`
- API: `GET /native-use/{task_id}/session-log`
- 图片: `GET /native-use/media/desktop/native_sessions/...`
