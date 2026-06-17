# Windows 部署指南

AI Agent 全链路内容生产与分发数字员工 - Windows 部署文档

> 桌面安装包总览见 [`INSTALLATION.md`](./INSTALLATION.md)（v1.0.36 ZIP 包补充说明见下文）。

## 📋 系统要求

### 必需软件

| 软件    | 版本要求    | 下载地址                          |
| ------- | ----------- | --------------------------------- |
| Python  | 3.10 或更高 | https://www.python.org/downloads/ |
| Node.js | 18.0 或更高 | https://nodejs.org/               |
| Git     | 最新版本    | https://git-scm.com/download/win  |

### 硬件建议

- **CPU**: 4核或以上
- **内存**: 8GB 或以上
- **硬盘**: 10GB 可用空间
- **网络**: 稳定的互联网连接（用于 API 调用）

## 📦 发布包结构

```
ai-agent-windows/
├── backend/                 # Python 后端
│   ├── main.py             # FastAPI 入口
│   ├── requirements.txt    # Python 依赖
│   ├── .env.example        # 环境变量模板
│   ├── agents/             # AI Agent 实现
│   ├── tools/              # 工具集
│   │   ├── media_tools.py      # 图片/视频生成
│   │   ├── copywriting_tools.py # 文案生成
│   │   ├── script_tools.py     # 脚本生成
│   │   ├── moderation_tools.py # 内容审核
│   │   ├── publisher_tools.py  # 多平台发布
│   │   └── connectors/         # 平台连接器
│   ├── utils/              # 工具函数
│   └── core/               # 核心配置
│
├── web/                    # Next.js 前端
│   ├── app/               # 页面组件
│   ├── package.json       # Node 依赖
│   └── .env.local         # 前端配置
│
├── storage/               # 数据存储
│   ├── outputs/           # 生成的媒体文件
│   ├── uploads/           # 上传的文件
│   ├── memory/            # 记忆存储
│   ├── rag/               # RAG 知识库
│   └── temp/              # 临时文件
│
├── logs/                  # 日志目录
│
└── windows/               # Windows 脚本
    ├── install.bat        # 安装脚本
    ├── start.bat          # 启动脚本
    ├── stop.bat           # 停止脚本
    └── README.txt         # 快速说明
```

## 🚀 快速开始

### 步骤 1: 解压发布包

将 `ai-agent-windows.zip` 解压到目标目录，例如：

```
C:\ai-agent\
```

### 步骤 2: 配置环境变量

1. 复制环境变量模板：

   ```
   复制 backend\.env.example 为 backend\.env
   ```

2. 编辑 `backend\.env` 文件，填写必要的 API 密钥：

   ```env
   # 必填 - 智谱AI API密钥
   ZHIPUAI_API_KEY=your_zhipuai_api_key_here

   # 可选 - OpenAI API密钥（如果使用OpenAI模型）
   OPENAI_API_KEY=your_openai_api_key_here

   # 可选 - 其他配置
   LOG_LEVEL=INFO
   ```

### 步骤 3: 安装依赖

双击运行 `windows\install.bat`

该脚本会自动：

- 创建 Python 虚拟环境
- 安装后端 Python 依赖
- 安装前端 Node.js 依赖
- 安装 Playwright 浏览器（用于平台登录）

⏱️ 首次安装可能需要 5-10 分钟，请耐心等待。

### 步骤 4: 启动服务

双击运行 `windows\start.bat`

启动后：

- 后端 API: http://localhost:8000
- 前端界面: http://localhost:3000
- API 文档: http://localhost:8000/docs

### 步骤 5: 访问应用

在浏览器中打开 http://localhost:3000 即可使用。

## 🛠️ 功能模块

### 内容创作

| 功能     | 路径                  | 说明                     |
| -------- | --------------------- | ------------------------ |
| AI 对话  | `/`                   | 与 AI Agent 对话生成内容 |
| 脚本生成 | `/create/script`      | 生成视频脚本             |
| 文案生成 | `/create/copywriting` | 生成营销文案             |

### 媒体生成

| 功能     | 路径                | 说明                         |
| -------- | ------------------- | ---------------------------- |
| 图片生成 | `/media/image`      | AI 图片生成 (CogView-3-Plus) |
| 视频生成 | `/media/video`      | AI 视频生成 (CogVideoX)      |
| 分镜生成 | `/media/storyboard` | 视频分镜脚本生成             |

### 内容管理

| 功能     | 路径          | 说明             |
| -------- | ------------- | ---------------- |
| 历史记录 | `/history`    | 查看生成历史     |
| 内容审核 | `/moderation` | 内容安全审核     |
| 平台管理 | `/platforms`  | 管理社交平台连接 |

## 🔌 平台连接

支持连接的社交平台：

| 平台      | 状态    | 发布功能      |
| --------- | ------- | ------------- |
| 抖音      | ✅ 支持 | 视频发布      |
| 快手      | ✅ 支持 | 视频发布      |
| 小红书    | ✅ 支持 | 图文/视频发布 |
| B站       | ✅ 支持 | 视频发布      |
| 微博      | ✅ 支持 | 图文发布      |
| YouTube   | ✅ 支持 | 视频发布      |
| TikTok    | ✅ 支持 | 视频发布      |
| Twitter/X | ✅ 支持 | 图文发布      |

### 连接方式

1. 进入 **平台管理** 页面
2. 选择要连接的平台
3. 点击 **浏览器登录**
4. 在弹出的浏览器中完成登录
5. 登录成功后自动保存凭证

## ⚠️ 常见问题

### Q: 安装时报错 "Python 不是内部命令"

**A**: 请确保 Python 已添加到系统 PATH 环境变量。安装 Python 时勾选 "Add Python to PATH"。

### Q: 安装时报错 "npm 不是内部命令"

**A**: 请确保 Node.js 已正确安装并添加到 PATH。

### Q: 后端启动失败，提示 API Key 未设置

**A**: 请检查 `backend\.env` 文件是否正确配置了 `ZHIPUAI_API_KEY`。

### Q: 前端页面打不开

**A**:

1. 确认后端已启动（检查 http://localhost:8000/docs）
2. 确认前端已启动（查看启动窗口是否有错误）
3. 检查防火墙是否阻止了 3000/8000 端口

### Q: 浏览器登录失败

**A**:

1. 确保 Playwright 浏览器已安装（运行 `install.bat`）
2. 检查网络连接是否正常
3. 部分平台可能有登录验证，请手动完成

### Q: 图片/视频生成失败

**A**:

1. 检查 API Key 是否有效
2. 检查 API 余额是否充足
3. 查看日志文件 `logs/` 目录获取详细错误

## 📝 日志查看

日志文件位于 `logs/` 目录：

- `agent.log` - 主要运行日志
- `error.log` - 错误日志

## 🔄 更新升级

1. 备份 `backend\.env` 文件和 `storage\` 目录
2. 下载新版本并解压
3. 恢复 `.env` 文件和 `storage\` 目录
4. 运行 `install.bat` 更新依赖
5. 运行 `start.bat` 启动服务

## 📞 技术支持

如遇问题，请：

1. 查看 `logs/` 目录下的日志文件
2. 检查 FAQ 常见问题
3. 提交 Issue 到项目仓库

---

**版本**: 1.0.0  
**更新日期**: 2026-02-03
