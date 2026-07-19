# Arena.ai Agent 沙箱适配指南

> 本指南让 bony-agent 在 **Arena.ai Agent Mode** 这类精简沙箱（无 docker / 无 Go / 无 Rust /
> 无系统 ffmpeg / 内存 ≤2GB / 仅出站网络）中，也能跑通**内容生成全链路**。
>
> 适配思路：不做侵入式重构，只做**自举垫片 + 降级利用 + 外部打桩**，对桌面/正常部署零影响。

---

## 1. 沙箱环境矩阵（实测基线：Python 3.13 / Node 20 / ~1.9GB RAM / 22GB 盘）

| 能力 | 沙箱状态 | 适配方式 |
| --- | --- | --- |
| Python ≥3.10 | ✅ 可用 | 直接创建 venv 安装 `backend/requirements.txt` |
| ffmpeg | ⚠️ 系统无 | 复用 `main.py:_setup_ffmpeg()` 既有自举：imageio-ffmpeg 静态二进制 symlink 至 `storage/bin` |
| **ffprobe** | ❌ 系统无，imageio 也不含 | **本分支新增**：`tools/ffprobe_shim.py` 纯标准库垫片，缺失时自动安装到 `storage/bin` |
| edge-tts 配音 | ✅ 可用（需出站网络） | 免费 TTS，全链路中唯一"真实生成"环节 |
| CJK 字幕烧录 | ✅ 可用 | 需系统有 CJK 字体（Noto Sans CJK 实测 OK），缺字体时流水线自动降级为无字幕拷贝 |
| B-roll 素材 | ❌ 无 Pexels/Pixabay Key | 复用代码自带 `synthetic` 降级：本地合成画面直接出片 |
| LLM 文案 | ❌ 无任何 Key | 本地 OpenAI 兼容桩（`scripts/arena/llm_stub.py`），经 `LLM_PROVIDER=ollama` 无缝接入 |
| Go 高并发引擎 / Rust 安全引擎 / Playwright 浏览器 / Docker / 前端构建 | ❌ 沙箱限制 | 全部为**可选组件**，后端核心链路不依赖；文档保留接入指引 |

## 2. 本适配分支改动清单

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `backend/tools/ffprobe_shim.py` | 新增 | ffprobe 兼容垫片：`format=duration` / `stream=width,height`（plain/csv/json） |
| `backend/main.py` | 修改 | `_setup_ffmpeg()` 升级：ffprobe 缺失时自动安装垫片（仅 POSIX、仅缺失时启用，正常环境无行为变化） |
| `scripts/arena/setup_arena.sh` | 新增 | 一键环境搭建 + 环境体检 + 冒烟导入 |
| `scripts/arena/e2e_test.sh` | 新增 | 无 Key 全链路干跑（桩 LLM + 真实 edge-tts + 合成素材 + 真实合成/烧录） |
| `scripts/arena/llm_stub.py` | 新增 | OpenAI 兼容 LLM 桩（`/v1/chat/completions`、`/v1/models`） |
| `backend/.env.arena.example` | 新增 | 沙箱 env 模板（干跑模式 + 真实 Key 接入指引） |
| `docs/ARENA_AI_AGENT.md` | 新增 | 本文档 |

## 3. 快速上手（沙箱内三条命令）

```bash
git clone <your-fork> && cd bony-agent
bash scripts/arena/setup_arena.sh      # 建 venv、装依赖、体检、触发自举垫片
bash scripts/arena/e2e_test.sh         # 全链路干跑：主题 → 成片 MP4
```

自定义主题：`SUBJECT="东京旅行攻略" bash scripts/arena/e2e_test.sh`

## 4. 干跑链路图

```
SUBJECT ──► LLM 桩(旁白文案) ──► LLM 桩(检索词) ──► edge-tts【真实联网语音】
                                                        │
合成素材 synthetic（无 Key 自动降级）◄──── 配音时长 ─────┘
        │                                                ▼
        └──► ffmpeg 拼接无声视频 ──► 混音(旁白) ──► SRT+libass 烧录中文字幕 ──► MP4
```

## 5. 实测结果（Arena 沙箱，2026-07-19）

| 指标 | 结果 |
| --- | --- |
| 接口 | `POST /tools/video/auto` → `GET /tools/video/auto/{task_id}` 轮询 |
| 端到端耗时 | **约 33 秒**（提交 → completed） |
| 成片 | 27.67s · 1080×1920 (9:16) · H.264 + AAC · edge-tts 真实人声 · CJK 硬字幕 |
| 素材模式 | `synthetic`（提示语：配置 PEXELS_API_KEY 可获取真实 B-roll） |

## 6. 接入真实服务（解锁完整能力）

| 配置 | 解锁能力 |
| --- | --- |
| `ALIBABA_API_KEY` 等任一 LLM Key | 真实文案/检索词/27+ Agent |
| `PEXELS_API_KEY` / `PIXABAY_API_KEY` | 真实免版权 B-roll |
| `JIMENG_*` / `ARK_API_KEY` / DashScope | 即梦图片、SeaDance/短剧视频、HappyHorse |
| 平台 Cookie 登录 + Playwright | 14 平台自动发布（沙箱无浏览器，需宿主机/容器外） |
| Go 1.22+ / Rust toolchain | `backend_massive_concurrent` / `backend_safety` 引擎 |
| Node 20 + 内存 ≥4GB | `web/` Next.js 前端 |

## 7. 已知限制

- 桩 LLM 输出为**固定模板**，只验证链路连通性与真实媒体合成，不代表生成质量。
- `synthetic` 素材为纯色/渐变画面，仅用于占位验证。
- `storage/bin/` 为运行期产物，已在 `.gitignore` 覆盖范围内，不会污染仓库。
- Windows 下暂不自动安装 ffprobe 垫片（有条件可自行将 `tools/ffprobe_shim.py` 加入 PATH）。
