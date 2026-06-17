# 架构设计文档

> backend_massive_concurrent — 高并发数据引擎

---

## 一、项目目标

| 目标              | 指标                          |
| ----------------- | ----------------------------- |
| 批量抓取吞吐      | ≥ 500 URL/s（网络不限速场景） |
| 聚合查询 P99 延迟 | ≤ 上游最慢接口延迟 + 10ms     |
| 文件事件响应延迟  | ≤ 300ms（含防抖）             |
| 内存占用          | 万级并发任务下 < 500 MB       |

---

## 二、模块划分

### 2.1 数据抓取 (`internal/scraper`)

**核心问题**：大量 URL 需要并发抓取，但必须避免打爆下游或本机资源。

**方案：Worker Pool + 令牌桶**

```
                   ┌─────────────────────────────┐
 输入 URL 列表 ──▶  │  Dispatcher（带缓冲 channel） │
                   └──────────┬──────────────────┘
                              │  分发任务
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
         Worker #1       Worker #2  ...  Worker #N
              │               │               │
        RateLimiter ──── 令牌桶（全局共享）────
              │
         http.Client（带超时 & 重试）
              │
         Result Channel
              │
              ▼
         ResultCollector（写入 DB / 内存缓存）
```

**关键设计决策**：

- Worker 数量从 `configs.scraper.worker_pool_size` 读取，运行时可通过 API 动态调整
- 每个 Worker 从 `jobs chan Job` 消费，实现背压（back-pressure）
- `RateLimiter` 使用 `golang.org/x/time/rate`，令牌桶算法，全局共享，防止超速
- HTTP Client 使用自定义 `Transport`，启用连接池（`MaxIdleConnsPerHost`）
- 重试使用指数退避 + jitter，避免惊群效应
- 任务状态机：`pending → running → done | failed`，通过 `sync.Map` 跟踪

**文件**：

```
internal/scraper/
├── dispatcher.go   # 任务分发，管理 worker pool 生命周期
├── worker.go       # 单个 worker，负责 HTTP 抓取
├── job.go          # Job 结构体，任务状态机
├── result.go       # Result 结构体，收集器
└── scraper.go      # 对外暴露的 Scraper 接口
```

---

### 2.2 文件系统监控 (`internal/watcher`)

**核心问题**：fsnotify 原始事件频率高（编辑器保存一次可触发 5+ 事件），需要防抖聚合；同时支持多目录、递归监控、文件类型过滤。

**方案：fsnotify + Debouncer + Event Bus**

```
 inotify / kqueue / FSEvents
         │
         ▼
   fsnotify.Watcher
         │  原始事件（高频）
         ▼
   Debouncer（按路径分组，time.AfterFunc 防抖）
         │  聚合后事件（低频）
         ▼
   Filter（glob 规则匹配）
         │  通过的事件
         ▼
   Event Bus（chan WatchEvent，带缓冲）
         │
    ┌────┴────┐
    ▼         ▼
  SSE 推送  内部订阅者（如触发重新索引）
```

**关键设计决策**：

- 递归监控通过 `filepath.Walk` 初始化时注册所有子目录，并在 `CREATE` 事件中动态添加新目录
- 防抖时间窗口可配置（默认 200ms），同一路径在窗口内的多次事件合并为一次
- 事件类型归一化为 `CREATE | MODIFY | DELETE | RENAME`
- 通过 `context.Context` 控制生命周期，`Stop()` 后 channel 关闭，订阅者自动退出

**文件**：

```
internal/watcher/
├── watcher.go      # 顶层 Watcher，管理多个目录
├── debouncer.go    # 事件防抖器
├── filter.go       # glob 过滤规则
└── event.go        # WatchEvent 类型定义
```

---

### 2.3 聚合查询 (`internal/aggregator`)

**核心问题**：单次业务查询需要同时请求多个上游接口（如：同时查图片生成状态 + 视频生成状态 + 知识库状态），串行太慢，需要并行 Fan-out + 超时控制。

**方案：errgroup + context 超时**

```
POST /aggregate
  body: { targets: [URL_A, URL_B, URL_C], timeout: "3s" }
        │
        ▼
  Aggregator.Query(ctx, targets)
        │
        ├── go fetch(ctx, URL_A) ──▶ result chan
        ├── go fetch(ctx, URL_B) ──▶ result chan
        └── go fetch(ctx, URL_C) ──▶ result chan
                                         │
                                   WithTimeout ctx
                                         │
                                    等待所有完成
                                    或 ctx 超时
                                         │
                                         ▼
                                   合并响应返回
```

**关键设计决策**：

- 使用 `golang.org/x/sync/errgroup` 管理并发 goroutine，自动传播 cancel
- `fail_fast: true` 时任意上游报错即通过 `cancel()` 中止其他请求（errgroup.WithContext）
- `fail_fast: false` 时收集所有结果，部分失败在响应中标记 `"status": "error"`
- 响应结果附带每个上游的耗时，便于排查慢接口
- 内置缓存（`pkg/cache`），相同 target 在 TTL 内命中缓存，不重复请求上游

**文件**：

```
internal/aggregator/
├── aggregator.go   # 对外接口，Query() 方法
├── fetcher.go      # 单个上游 HTTP 请求封装
└── result.go       # AggregateResult 结构体
```

---

### 2.4 公共包 (`pkg/`)

| 包              | 职责                                                       |
| --------------- | ---------------------------------------------------------- |
| `pkg/pool`      | 通用 goroutine worker pool，可复用于 scraper 和 aggregator |
| `pkg/ratelimit` | 令牌桶限流，封装 `golang.org/x/time/rate`                  |
| `pkg/cache`     | 轻量内存缓存，`sync.Map` + TTL 清理 goroutine              |

---

## 三、HTTP 层 (`internal/server`)

使用标准库 `net/http` + `chi` 路由（轻量，兼容标准 Handler 接口）。

**中间件链**：

```
请求 ──▶ Recovery ──▶ RequestID ──▶ Logger ──▶ RateLimit ──▶ Handler
```

**SSE 推送**（文件变更事件）：

```go
// GET /watch/events
// 客户端保持长连接，服务端通过 WatchEvent channel 持续推送
w.Header().Set("Content-Type", "text/event-stream")
for event := range eventBus {
    fmt.Fprintf(w, "data: %s\n\n", event.JSON())
    flusher.Flush()
}
```

---

## 四、配置与启动流程

```
main()
  │
  ├── 加载 configs/config.yaml（viper）
  ├── 初始化 logger（zap，结构化日志）
  ├── 启动 Watcher（注册目录，开始监听）
  ├── 启动 Scraper worker pool
  ├── 初始化 Aggregator（注入 cache & fetcher）
  ├── 注册 HTTP 路由
  └── http.ListenAndServe（graceful shutdown via signal）
```

**优雅关闭**：捕获 `SIGINT` / `SIGTERM`，先停止接收新请求，等待 in-flight 请求完成（最长 30s），再关闭 Watcher 和 worker pool。

---

## 五、技术选型

| 组件     | 选型                         | 理由                                               |
| -------- | ---------------------------- | -------------------------------------------------- |
| 路由     | `go-chi/chi`                 | 轻量，零依赖，兼容标准接口                         |
| 文件监控 | `fsnotify/fsnotify`          | 跨平台（Linux inotify / macOS FSEvents / Windows） |
| 并发控制 | `golang.org/x/sync/errgroup` | 官方，简洁，支持 context 传播                      |
| 限流     | `golang.org/x/time/rate`     | 官方令牌桶，线程安全                               |
| 配置     | `spf13/viper`                | 支持 yaml / env / 热重载                           |
| 日志     | `uber-go/zap`                | 高性能结构化日志，零分配                           |
| 测试     | `testify` + `httptest`       | 标准化断言，HTTP mock                              |

---

## 六、开发计划

### Phase 1 — 基础骨架（1周）

- [ ] 项目结构初始化，`go.mod`
- [ ] `pkg/pool`：通用 worker pool
- [ ] `pkg/ratelimit`：令牌桶封装
- [ ] `internal/server`：基础 HTTP 框架 + 健康检查

### Phase 2 — 核心功能（2周）

- [ ] `internal/scraper`：Worker pool + 抓取 + 状态跟踪
- [ ] `internal/watcher`：fsnotify + 防抖 + 过滤 + SSE 推送
- [ ] `internal/aggregator`：Fan-out / Fan-in + 缓存

### Phase 3 — 生产加固（1周）

- [ ] 集成测试覆盖三个模块
- [ ] Prometheus metrics 暴露（`/metrics`）
- [ ] `configs/config.yaml` 完善 + 文档
- [ ] Docker 镜像 + `docker-compose.yml`
- [ ] Graceful shutdown 验证

---

## 七、性能基准目标（Benchmark）

```bash
go test -bench=. -benchmem ./...
```

| 测试                            | 目标                                |
| ------------------------------- | ----------------------------------- |
| `BenchmarkWorkerPool`           | 10万任务入队/出队 < 100ms           |
| `BenchmarkRateLimiter`          | 并发 1000 goroutine 取令牌无锁争用  |
| `BenchmarkAggregator_10Targets` | 10个上游 50ms 返回，聚合耗时 < 60ms |
| `BenchmarkDebouncer`            | 1万事件经防抖后输出数 ≤ 目录数 × 2  |
