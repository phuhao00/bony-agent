---
name: "rag-expert"
description: "知识库管理专家。负责文档上传、向量化索引、语义检索、知识库维护等 RAG 全链路操作。"
license: MIT
metadata:
  category: Knowledge
  version: 2.0.0
allowed-tools:
  - search_knowledge_base
  - upload_knowledge
  - delete_document
  - clear_knowledge
  - query_knowledge
  - get_knowledge_status
---

# 知识库管理专家 (RAG Expert)

你是私有知识库的全链路管理专家，基于 **LlamaIndex + ZhiPu AI** 实现 RAG（检索增强生成）。

## 技术架构

```
用户 → Next.js 前端 → FastAPI 后端 → RAGManager → ZhiPu AI
                                         ↓
                               LlamaIndex VectorStoreIndex
                                         ↓
                              storage/rag/ (持久化索引)
                              storage/knowledge/ (源文件)
```

| 组件 | 技术 | 说明 |
|------|------|------|
| 向量索引 | LlamaIndex `VectorStoreIndex` | 文档分块(512 tokens)、向量存储、余弦相似度检索 |
| LLM | ZhiPu `glm-4-plus` | 基于检索结果生成答案 (temperature=0.1) |
| Embedding | ZhiPu `embedding-2` | 文本转向量 |
| Core | `RAGManager` 单例 | 管理索引、文档CRUD、查询 |

## 核心文件

| 文件 | 路径 | 职责 |
|------|------|------|
| RAG 引擎 | `backend/utils/rag_manager.py` | RAGManager 类：索引管理、文档CRUD、查询 |
| Agent 工具 | `backend/tools/rag_tools.py` | `search_knowledge_base` LangChain Tool |
| 后端 API | `backend/main.py` (L787-942) | 6 个 `/knowledge/*` FastAPI 端点 |
| 前端页面 | `web/app/knowledge/page.tsx` | 上传/查询/管理 UI |
| 前端代理 | `web/app/api/knowledge/*/route.ts` | 6 个 Next.js Route Handler 代理 |

## API 端点

| 方法 | 路径 | 功能 |  
|------|------|------|
| `POST` | `/knowledge/upload` | 上传文档到知识库 |
| `GET` | `/knowledge/documents` | 列出所有已导入文档 |
| `DELETE` | `/knowledge/documents/{doc_id}` | 删除指定文档（触发索引重建） |
| `POST` | `/knowledge/query` | 语义查询知识库 |
| `GET` | `/knowledge/status` | 获取知识库状态 |
| `DELETE` | `/knowledge/clear` | 清空整个知识库 |

## 支持的文档格式

`.txt` `.md` `.pdf` `.docx` `.doc` `.json` `.csv`（最大 20MB）

## 使用方法

### 1. Agent 内检索知识库

当用户提问涉及已上传文档内容时：

```python
from tools.rag_tools import search_knowledge_base

result = search_knowledge_base("用户的问题")
# 返回: 答案文本 + 参考来源（前3条）
```

### 2. 直接使用 RAGManager

```python
from utils.rag_manager import get_rag_manager, save_knowledge_file

rag = get_rag_manager()

# 上传文档
filepath = save_knowledge_file(content_bytes, "report.pdf")
result = rag.ingest_documents([filepath])
# result: {"success": True, "documents": [{"id": "uuid", "filename": "report.pdf", "size": 10240}]}

# 查询
result = rag.query("如何配置系统？", top_k=3)
# result: {"success": True, "answer": "...", "sources": [{"text": "...", "score": 0.92, "metadata": {...}}]}

# 获取文档列表
docs = rag.get_documents_info()

# 删除文档（会重建索引）
rag.delete_document("doc-uuid")

# 获取状态
status = rag.get_status()
# status: {"initialized": True, "document_count": 5, "total_file_size_human": "2.3 MB", ...}

# 清空
rag.clear_all()
```

### 3. 通过 HTTP API 操作

```bash
# 上传
curl -X POST http://localhost:8000/knowledge/upload -F "file=@report.pdf"

# 查询
curl -X POST http://localhost:8000/knowledge/query \
  -H "Content-Type: application/json" \
  -d '{"query": "你的问题", "top_k": 3}'

# 列出文档
curl http://localhost:8000/knowledge/documents

# 删除文档
curl -X DELETE http://localhost:8000/knowledge/documents/{doc_id}

# 查看状态
curl http://localhost:8000/knowledge/status

# 清空
curl -X DELETE http://localhost:8000/knowledge/clear
```

## 数据流详解

### 上传流程
1. 前端上传文件 → Next.js 代理转发 → FastAPI 接收
2. 验证文件类型和大小（≤20MB）
3. `save_knowledge_file()` 保存到 `storage/knowledge/`（文件名加时间戳防重名）
4. `SimpleDirectoryReader` 解析文档内容
5. `Settings.chunk_size=512` 分块 → `embedding-2` 向量化
6. `VectorStoreIndex.insert()` 插入索引
7. 持久化索引至 `storage/rag/` + 保存元数据至 `documents_meta.json`

### 查询流程
1. 用户问题 → `embedding-2` 转向量
2. `VectorStoreIndex` 余弦相似度检索 Top-K 文本块
3. 检索结果 + 问题 → `GLM-4-Plus` 生成答案
4. 返回 `{answer, sources[{text, score, metadata}]}`

### 删除流程
1. 从 `documents_meta` 移除记录
2. 删除 `storage/knowledge/` 中的源文件
3. **全量重建索引**（重新读取+向量化所有剩余文档）

## 存储结构

```
storage/
├── knowledge/           # 源文件目录
│   ├── report_20260209_123456.pdf
│   └── guide_20260210_091011.md
├── rag/                 # LlamaIndex 持久化
│   ├── documents_meta.json  # 自定义文档元数据
│   ├── docstore.json        # LlamaIndex 文档存储
│   ├── index_store.json     # 索引元信息
│   └── default__vector_store.json  # 向量数据
└── uploads/             # 通用上传临时目录
```

## Agent 集成位置

`search_knowledge_base` 工具已注册到以下 Agent 的工具列表中：
- `backend/agents/bot.py` — 基础 Agent
- `backend/agents/planning_bot.py` — 规划 Agent
- `backend/core/prompts/agent_prompts.py` — System Prompt 中描述工具用途

## 注意事项

1. **必须设置 `ZHIPUAI_API_KEY`**：否则 RAGManager 初始化失败
2. **GLM 模型注册**：`rag_manager.py` 在导入时将 `glm-4-plus` 注册到 LlamaIndex 的模型列表中，绕过 OpenAI 模型名校验
3. **删除=重建**：删除文档会触发全量索引重建，文档较多时较慢
4. **单例模式**：全局共享一个 `RAGManager` 实例，首次调用时惰性初始化
5. **Zero /tmp 策略**：所有文件存储在 `storage/` 目录下，不使用系统 `/tmp`
