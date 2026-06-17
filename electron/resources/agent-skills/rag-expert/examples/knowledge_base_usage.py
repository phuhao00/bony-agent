"""
知识库操作示例脚本

演示如何通过 Python 代码直接操作知识库。
运行环境: 在 backend/ 目录下运行，需要设置 ZHIPUAI_API_KEY 环境变量。
"""

import os
import sys

# 确保可以导入项目模块
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))

from utils.rag_manager import get_rag_manager, save_knowledge_file, SUPPORTED_EXTENSIONS


def example_upload_and_query():
    """示例: 上传文档并查询"""
    
    # 1. 获取 RAG 管理器实例（单例）
    rag = get_rag_manager()
    if not rag:
        print("❌ RAG 管理器初始化失败，请确保 ZHIPUAI_API_KEY 已设置")
        return
    
    # 2. 查看初始状态
    status = rag.get_status()
    print(f"📊 知识库状态: {status['status']['document_count']} 个文档, "
          f"索引大小: {status['status']['index_size_human']}")
    
    # 3. 上传示例文档
    sample_content = """
    # AI Media Agent 使用指南
    
    ## 功能介绍
    AI Media Agent 是一个全链路内容生产与分发数字员工，支持：
    - 视频脚本生成
    - AI 图片/视频生成
    - 多平台自动发布
    - 私有知识库管理
    
    ## 快速开始
    1. 启动后端: cd backend && python main.py
    2. 启动前端: cd web && npm run dev
    3. 访问 http://localhost:3000
    """.encode("utf-8")
    
    filepath = save_knowledge_file(sample_content, "使用指南.md")
    if filepath:
        result = rag.ingest_documents([filepath])
        if result["success"]:
            print(f"✅ 文档上传成功: {result['documents']}")
        else:
            print(f"❌ 上传失败: {result['error']}")
    
    # 4. 查询知识库
    query_result = rag.query("如何启动项目?", top_k=3)
    if query_result["success"]:
        print(f"\n🔍 查询结果:\n{query_result['answer']}")
        if query_result.get("sources"):
            print(f"\n📚 参考来源 ({len(query_result['sources'])} 条):")
            for s in query_result["sources"]:
                print(f"  - 相似度: {s['score']:.2%} | {s['text'][:80]}...")
    
    # 5. 列出所有文档
    docs = rag.get_documents_info()
    print(f"\n📋 知识库文档列表 ({len(docs)} 个):")
    for doc in docs:
        print(f"  - {doc['filename']} ({doc.get('size', 0)} bytes) [{doc['id'][:8]}...]")


def example_api_queries():
    """示例: 通过 HTTP API 查询（使用 requests）"""
    try:
        import requests
    except ImportError:
        print("需要安装 requests: pip install requests")
        return
    
    BASE = "http://localhost:8000"
    
    # 状态
    r = requests.get(f"{BASE}/knowledge/status")
    print(f"状态: {r.json()}")
    
    # 上传
    with open("example.txt", "w") as f:
        f.write("这是一个示例文档，用于测试知识库功能。")
    with open("example.txt", "rb") as f:
        r = requests.post(f"{BASE}/knowledge/upload", files={"file": f})
    print(f"上传: {r.json()}")
    os.remove("example.txt")
    
    # 查询
    r = requests.post(f"{BASE}/knowledge/query", json={"query": "测试", "top_k": 3})
    print(f"查询: {r.json()}")


if __name__ == "__main__":
    print("=== 知识库操作示例 ===\n")
    example_upload_and_query()
