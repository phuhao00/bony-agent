# backend_massive_concurrent

> 高并发数据引擎 — 本地文件监控 · 多源数据抓取 · 聚合查询接口

Go 编写的后端服务，专注于三个核心能力：

| 能力             | 说明                                                       |
| ---------------- | ---------------------------------------------------------- |
| **数据抓取**     | goroutine 池 + rate limiter，批量并发抓取多个外部接口/页面 |
| **文件系统监控** | fsnotify 驱动的本地目录变更监听，支持过滤规则与事件聚合    |
| **聚合查询**     | Fan-out / Fan-in 模式，单次请求并行调用多路上游，统一响应  |

---

## 快速开始

```bash
# 依赖
go 1.22+

# 安装
git clone <repo>
cd backend_massive_concurrent
go mod tidy

# 运行
go run ./cmd/server

# 测试
go test ./...
```

服务默认监听 `:8080`，详见 `configs/config.yaml`。

---

## 目录结构

```
backend_massive_concurrent/
├── cmd/
│   └── server/         # 程序入口，初始化 & 启动
├── configs/
│   └── config.yaml     # 端口、并发数、抓取目标、监控目录等
├── internal/
│   ├── scraper/        # 数据抓取模块
│   ├── watcher/        # 文件系统监控模块
│   ├── aggregator/     # 聚合查询模块
│   └── server/         # HTTP 路由 & 中间件
├── pkg/
│   ├── pool/           # goroutine worker pool
│   ├── ratelimit/      # 令牌桶限流
│   └── cache/          # 内存缓存 (sync.Map / groupcache)
├── api/
│   └── openapi.yaml    # 接口文档
├── docs/
│   └── DESIGN.md       # 架构设计文档
└── tests/
    └── integration/    # 集成测试
```

---

## 核心接口

| 方法     | 路径                 | 说明                     |
| -------- | -------------------- | ------------------------ |
| `GET`    | `/health`            | 服务健康检查             |
| `POST`   | `/scrape`            | 触发一次批量抓取任务     |
| `GET`    | `/scrape/status/:id` | 查询抓取任务状态         |
| `GET`    | `/watch/events`      | SSE 推送文件变更事件流   |
| `POST`   | `/watch/add`         | 添加监控目录             |
| `DELETE` | `/watch/remove`      | 移除监控目录             |
| `POST`   | `/aggregate`         | 并行聚合查询多个上游接口 |

详细参数见 [api/openapi.yaml](api/openapi.yaml)。

---

## 配置说明

```yaml
# configs/config.yaml
server:
  port: 8080
  read_timeout: 30s
  write_timeout: 60s

scraper:
  worker_pool_size: 50 # 并发 goroutine 数
  rate_limit_rps: 100 # 全局限速（请求/秒）
  retry_max: 3
  retry_backoff: 500ms
  timeout_per_request: 10s

watcher:
  dirs:
    - path: ./storage/outputs
      recursive: true
      filters: ["*.json", "*.mp4"]
  debounce: 200ms # 事件防抖，合并高频变更

aggregator:
  timeout: 5s # 单次聚合超时
  fail_fast: false # 部分上游失败是否立即返回
  cache_ttl: 30s
```

---

## 并发模型

```
请求到来
   │
   ▼
[Dispatcher] ──fan-out──▶ Worker #1 ──▶ 外部接口/文件
                       ──▶ Worker #2 ──▶ 外部接口/文件
                       ──▶ Worker #N ──▶ 外部接口/文件
                           │
                    fan-in ▼
               [Result Aggregator]
                           │
                           ▼
                      统一响应返回
```

详细设计见 [docs/DESIGN.md](docs/DESIGN.md)。
