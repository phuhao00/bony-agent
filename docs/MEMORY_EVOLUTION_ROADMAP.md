# 记忆进化路线图（Memory Evolution Roadmap）

> 创建时间：2026-05-31  
> 范围：记忆网图与 Dream Engine 的语言生态演进路径  
> 当前阶段：**MVP（Python-first）**

---

## 概述

当前 MVP 以 Python 为主语言，Go/Rust 仅负责已有的 gRPC 微服务（目录检索、文档解析等）。  
本路线图定义了**未来两个演进节点**的触发条件与迁移范围。

---

## 当前架构（MVP）

```
Python FastAPI
  ├── memory_coordinator.py   — 在线路径：prefetch + cache
  ├── dream_engine.py         — 离线路径：LLM digest + 卡片
  ├── dream_store.py          — 持久化：gRPC stub + file fallback
  ├── memory_graph_export.py  — 图导出：四 mode + 120s snapshot
  └── learning_data_pipeline.py — 统一 JSONL 读写
```

**不变原则**：
- LLM 调用永远在 Python
- dream digest 生成永远在 Python
- Go/Rust 只负责**高吞吐 I/O** 和**内存安全的计算密集**任务

---

## F1：Go EvolutionWatcher

### 触发条件（满足任意一条时启动迁移）

| 条件 | 度量方式 |
|------|---------|
| **traces > 5000** | `wc -l storage/traces/*.json 2>/dev/null \| tail -1` |
| **扫盘 > 3s** | `collect_window()` 的实测 elapsed_ms > 3000 （见 `[dream-engine] collect_window_ms` 日志） |
| **内存占用 > 500MB** | `ps aux \| grep uvicorn` 的 RSS 列 |

### 迁移范围

```
backend_massive_concurrent/internal/evolution/
  ├── watcher.go         — fs.Watch + debounce（500ms）通知 Python
  ├── trace_index.go     — BTree 索引，O(log n) 按时间范围扫描
  └── jsonl_streamer.go  — 流式读取 JSONL（128KB 块 I/O）
```

**gRPC 接口**（proto/mediaagent/evolution.proto）：

```protobuf
service EvolutionService {
  rpc WatchEvents(WatchRequest) returns (stream EventBatch);
  rpc IndexedQuery(QueryRequest) returns (EventPage);
}
```

**Python 端变更**：

- `dream_engine.collect_window()` → 优先调用 gRPC `IndexedQuery`，降级为当前文件扫描
- `grpc_client.py` 新增 `get_evolution_stub()`（端口 50054）

### 预期收益

- `collect_window` 从 O(n) 线性扫描 → O(log n) 索引查询
- 支持 5万+ traces 的 7 天窗口（目前 5000 条约 3s）

---

## F2：Rust Evolution 模块

### 触发条件（满足任意一条时启动迁移）

| 条件 | 度量方式 |
|------|---------|
| **memory_usage.jsonl > 100MB** | `du -sh storage/evolution/memory_usage.jsonl` |
| **图构建 > 1s** | `export_memory_graph()` 的实测 elapsed_ms > 1000 （见 `[memory-graph]` 日志） |
| **共现边 > 100k** | `memory_graph_export` 的 `link_count` 日志 |

### 迁移范围

```
backend_safety/src/evolution/
  ├── stream_jsonl_window.rs  — SIMD 加速 JSON 解析，零拷贝读取
  ├── build_co_recall_edges.rs — 记忆共现图构建（并行 rayon）
  └── atomic_snapshot.rs     — 原子写 snapshot（mmap + rename）
```

**gRPC 接口**（proto/mediaagent/evolution.proto，与 F1 共用）：

```protobuf
service EvolutionService {
  rpc BuildCoRecallGraph(BuildRequest) returns (GraphSnapshot);
  rpc StreamJsonlWindow(WindowRequest) returns (stream EventChunk);
}
```

**Python 端变更**：

- `memory_graph_export._build_memories_graph()` → 调用 gRPC `BuildCoRecallGraph`
- `_SNAP_CACHE` 仍保留（作为 Python 层二级缓存）

### 预期收益

- 图构建从 Python O(n²) 共现计算 → Rust rayon 并行，100k 记忆 < 200ms
- JSONL 读取从 Python line-by-line → Rust SIMD，100MB 文件 < 500ms

---

## 演进决策树

```
当前状态
  ↓ collect_window > 3s 或 traces > 5k
[ F1 ] 迁移 Go EvolutionWatcher
  ↓ 图构建 > 1s 或 usage.jsonl > 100MB
[ F2 ] 迁移 Rust Evolution 模块
```

---

## 不迁移的内容

| 功能 | 永远保留在 Python | 原因 |
|------|------------------|------|
| LLM digest 生成 | `dream_engine.generate_digest` | LangChain 生态 |
| 伴侣状态管理 | `companion_state.py` | 业务逻辑频繁迭代 |
| Dream 卡片 UI API | FastAPI 路由 | 快速迭代 |
| 记忆写入质量门控 | `memory_quality.py` | 依赖 LLM 评分 |

---

## 监控指标

在 `[dream-engine]` 和 `[memory-graph]` 日志中已埋点：

```
[dream-engine] collect_window_ms=1234 events=456
[memory-graph] mode=memories nodes=200 links=301 elapsed_ms=89
[memory-latency] prefetch_ms=45 hits=3 cache=miss priority=2
```

**告警阈值**（建议在 Sentry / Datadog 配置）：

| 指标 | 警告 | 触发 F1/F2 |
|------|------|-----------|
| `collect_window_ms` | > 1000 | > 3000 |
| `elapsed_ms`（graph） | > 300 | > 1000 |
| `prefetch_ms` | > 100 | > 500 |
