# AI Media Agent — 前端架构文档

> Next.js 16 + React 19 + TypeScript + Tailwind CSS 4 的前端架构设计、路由组织、状态管理与组件分层。

---

## 一、技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 框架 | Next.js (App Router) | 16 |
| UI 库 | React | 19 |
| 语言 | TypeScript | 5.x |
| 样式 | Tailwind CSS | 4 |
| 图标 | Lucide React | — |
| 国际化 | next-intl / 自定义 i18n | — |

---

## 二、目录结构

```
web/
├── app/                          # App Router
│   ├── page.tsx                  # 主对话界面
│   ├── layout.tsx                # 根布局（主题、字体、全局样式）
│   ├── globals.css               # CSS 变量主题令牌
│   ├── api/                      # API 代理路由（BFF）
│   │   ├── chat/route.ts
│   │   ├── multi-agent/stream/route.ts
│   │   ├── context/memory/route.ts
│   │   ├── capabilities/route.ts
│   │   ├── tasks/[id]/cancel/route.ts
│   │   ├── tasks/[id]/resume/route.ts
│   │   ├── approvals/route.ts
│   │   ├── media-pipeline/start/route.ts
│   │   ├── media-pipeline/[task_id]/step/route.ts
│   │   ├── research/web-search/route.ts
│   │   └── ...
│   ├── workbench/                # 工作台（工具聚合入口）
│   ├── create/                   # 创作中心
│   ├── media/                    # 媒体生成
│   ├── companion/                # AI 伙伴
│   ├── pipeline/                 # 爆款流水线
│   ├── computer-use/             # Computer Use
│   ├── hermes-agent/             # Hermes Agent 文档入口
│   ├── lark-cli/                 # Lark CLI 助手
│   ├── knowledge/                # 知识库
│   ├── platforms/                # 平台管理
│   ├── scheduler/                # 定时发布
│   ├── trending/                 # 游戏热点
│   ├── history/                  # 历史记录
│   ├── moderation/               # 内容审核
│   ├── openclaw/                 # OpenClaw
│   ├── architecture/             # 项目架构图
│   ├── ai-news/                  # AI 资讯日报
│   ├── login/                    # 认证入口
│   └── settings/                 # 设置中心
│       ├── capabilities/         # 能力配置（6 个 Tab）
│       │   ├── page.tsx
│       │   ├── CapabilitiesConnectionsTab.tsx
│       │   ├── CapabilitiesSkillsTab.tsx
│       │   ├── CapabilitiesScheduledTab.tsx
│       │   └── CapabilitiesMCPTab.tsx
│       ├── context/              # My context
│       │   ├── page.tsx
│       │   ├── KnowledgeGraphPanel.tsx
│       │   └── MemoryPanel.tsx
│       ├── my-computer/          # My Computer 设置
│       ├── customization/        # 个性化
│       └── users/                # 用户管理
├── components/                   # 共享 React 组件
│   ├── Sidebar.tsx
│   ├── MarkdownSummaryPreview.tsx
│   ├── PublishModal.tsx
│   ├── CompanionCharacter.tsx
│   └── OfficeBackground.tsx
├── contexts/                     # React Context
│   ├── AuthContext.tsx
│   └── PrefsContext.tsx
├── hooks/                        # 自定义 Hooks
├── lib/                          # 工具库
│   └── i18n.ts
├── messages/                     # 国际化文案
│   ├── zh.json
│   └── en.json
├── types/                        # TypeScript 类型
└── public/                       # 静态资源
```

---

## 三、主题设计系统

### 3.1 CSS 变量令牌

`web/app/globals.css` 定义统一的明暗主题变量：

```css
:root {
  --shell-bg: #ffffff;
  --foreground: #171717;
  --label-secondary: #737373;
  --card-bg: #ffffff;
  --chrome-rail-bg: #f5f5f5;
  --nav-active-fill: #e5e5e5;
  --separator: #e5e5e5;
  --separator-subtle: #f0f0f0;
  --accent: #3b82f6;
  --status-danger-text: #dc2626;
  --status-danger-bg: #fef2f2;
  --status-success-text: #16a34a;
  --status-success-bg: #f0fdf4;
}

html.theme-dark {
  --shell-bg: #0a0a0a;
  --foreground: #e5e5e5;
  --label-secondary: #a3a3a3;
  --card-bg: #171717;
  /* ... */
}
```

### 3.2 通用类

| 类名 | 用途 |
|------|------|
| `.page-canvas` | 内页画布，继承 `--foreground` |
| `.card-surface` | 实心卡片 + 发丝边框 + 轻阴影 |
| `.popover-vibrant` | 对话框/浮层磨砂底 |

**约定：** 列表、表单、对话 Markdown 等正文优先使用 `text-[color:var(--foreground)]`，避免在深色卡片上叠 `text-slate-800`。

---

## 四、路由与导航

### 4.1 侧边栏路由

`Sidebar.tsx` 定义主导航：

| 路径 | 名称 | 图标 |
|------|------|------|
| `/` | AI 对话 | MessageCircle |
| `/workbench` | 工作台 | LayoutGrid |
| `/companion` | AI 伙伴 | User |
| `/pipeline` | 爆款流水线 | Factory |
| `/media` | 媒体生成 | Image |
| `/create` | 创作中心 | PenTool |
| `/scheduler` | 定时发布 | Clock |
| `/knowledge` | 知识库 | BookOpen |
| `/platforms` | 平台管理 | Globe |
| `/trending` | 游戏热点 | Flame |
| `/history` | 历史记录 | History |
| `/settings/capabilities` | 能力配置 | Settings |
| `/settings/context` | My context | Brain |
| `/computer-use` | Computer Use | Monitor |

### 4.2 API 代理层

前端不直接调用 `:8000`，全部走 Next.js API Route 代理：

```typescript
// app/api/chat/route.ts
export async function POST(request: Request) {
  const body = await request.json();
  const res = await fetch(`${BACKEND_URL}/multi-agent/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return new Response(res.body, { headers: res.headers });
}
```

**SSE 代理特殊处理：** `app/api/multi-agent/stream/route.ts` 使用原生 `http(s).request` 而非 `fetch(undici)`，解决 Next.js 默认 300s body timeout 问题（长视频等工具可能数分钟不吐分片）。部署环境设置 `maxDuration = 800`。

---

## 五、状态管理

### 5.1 认证上下文

`AuthContext.tsx` 提供：
- `AuthUser` 类型定义
- `login` / `logout` / `register` 签名
- 真实接入时需替换 Provider 实现

### 5.2 偏好设置

`PrefsContext.tsx` 管理：
- 主题切换（light/dark/system）
- 语言切换（zh/en）
- 字体大小

### 5.3 本地状态

各页面使用 React `useState` / `useReducer` 管理本地状态；跨页面共享状态通过 Context 或 URL 参数传递。

---

## 六、关键组件

### 6.1 MarkdownSummaryPreview

对话内 Markdown 渲染组件：
- 标题、段落、表格、代码块、列表映射
- 已与主题令牌对齐
- 主对话气泡使用 `card-surface` 作为容器

### 6.2 MultimodalInput

多模态输入组件：
- 拖拽上传、预览、格式校验
- 支持图片（JPG/PNG/WEBP）、音频（MP3/WAV）、视频（MP4/MOV）

### 6.3 MemoryPanel

`settings/context/MemoryPanel.tsx`：
- **Memories 视图**：记忆库列表
- **Hits 视图**：recall 轨迹（查询语句、命中排名、记忆内容、媒体引用）
- 支持 `missing + snapshot_available` 状态提示

### 6.4 Capabilities 页面

`settings/capabilities/page.tsx` 包含 6 个 Tab：
1. 能力矩阵
2. 连接摘要
3. 技能管理
4. 定时任务
5. MCP 服务器
6. 审批与任务

---

## 七、媒体路径规范化

### 7.1 后端提取

`/multi-agent/stream` 在 SSE 事件中自动推断 `media_url`：
- Markdown 图片 `![alt](url)`
- 本地 `/media/` 或 `/storage/outputs/` 路径
- 外链 HTTP URL

### 7.2 前端处理

- `companion/page.tsx` 复用 `extractCompanionMediaUrlFromText`
- `OfficeBackground.tsx` 的 `normaliseMediaUrl` 将 `/media/<file>` 映射到 `/api/media/<file>` 磁盘代理
- 原因：FastAPI 静态路由在 Next.js dev 端口 `:3000` 不可用

---

## 八、性能优化

### 8.1 代码分割

- Next.js App Router 自动按路由分割
- 大组件（如 `MarkdownSummaryPreview`）使用动态导入

### 8.2 图片优化

- 使用 Next.js `<Image>` 组件
- 生成媒体使用适当压缩

### 8.3 SSE 长连接

- 大请求设置 `maxDuration = 800`
- 使用原生 HTTP 代理避免 undici timeout

---

## 九、前端开发规范

1. **主题令牌优先**：新增 UI 必须使用 CSS 变量，禁止硬编码 `slate-*` / `bg-white`
2. **类型安全**：所有 API 响应定义 TypeScript 接口
3. **错误处理**：API 代理统一处理 `500` / `422` / 网络错误
4. **无障碍**：按钮和表单元素必须有明确的 `aria-label`
5. **国际化**：新增文案同时补充 `zh.json` 与 `en.json`

---

_文档版本：2026-05-10_
