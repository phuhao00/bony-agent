from langchain.tools import tool
from services.learning_data_pipeline import append_event
from services.memory_quality import prepare_memory_write
from utils.vector_store import get_vector_store
from utils.logger import setup_logger
import json
import time

logger = setup_logger("memory_tools")

@tool
def search_memory(query: str) -> str:
    """
    搜索历史记忆库。
    当你需要回忆用户之前的请求、生成的作品或者查找相关的风格参考时，使用此工具。
    输入应该是一个具体的搜索查询，例如 '之前生成的小猪佩奇' 或 '赛博朋克风格的描述'。
    """
    logger.info("[memory] search_memory query=%r", query)
    store = get_vector_store()
    if not store:
        logger.error("[memory] vector store not initialized")
        return "Error: Memory store not initialized."

    results = store.search_memory(query, k=3)
    logger.info("[memory] search returned %d result(s)", len(results) if results else 0)

    if not results:
        return "No relevant memories found."

    formatted_results = []
    for i, res in enumerate(results):
        formatted_results.append(
            f"Result {i+1}:\nContent: {res['content']}\nMetadata: {res['metadata']}\n"
        )

    return "\n---\n".join(formatted_results)

@tool
def save_memory(content: str, memory_type: str = "fact", source: str = "user", metadata: dict | None = None) -> str:
    """
    保存一条长期记忆。
    适用于用户明确要求记住偏好、项目事实、流程经验，或 Agent 经过审批后沉淀复盘结论。
    自动推断的内容应在 metadata 中标记 inferred=true，并由上层审批/质量闸门控制。
    """
    normalized = (content or "").strip()
    if not normalized:
        return json.dumps({"success": False, "error": "content is required"}, ensure_ascii=False)

    logger.info("[memory] save_memory type=%s source=%s content=%r", memory_type, source, normalized[:80])
    store = get_vector_store()
    if not store:
        logger.error("[memory] vector store not initialized")
        return json.dumps({"success": False, "error": "Memory store not initialized."}, ensure_ascii=False)

    merged_metadata = dict(metadata or {})
    merged_metadata.update({
        "type": memory_type or "fact",
        "source": source or "user",
        "confidence": float(merged_metadata.get("confidence", 1.0)),
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    })
    prepared = prepare_memory_write(normalized, metadata=merged_metadata, store=store)
    if prepared["action"] == "rejected":
        return json.dumps({"success": False, **prepared}, ensure_ascii=False)
    if prepared["action"] == "duplicate":
        return json.dumps(
            {"success": True, "id": prepared.get("duplicate_id", ""), "duplicate": True, **prepared},
            ensure_ascii=False,
        )
    if prepared["action"] == "candidate":
        append_event(
            "memory_candidate",
            source="memory_tools.save_memory",
            action="save_memory",
            status="candidate",
            summary=prepared["content"],
            metadata={"candidate_id": prepared.get("candidate_id", ""), "risk_flags": prepared.get("risk_flags", [])},
        )
        return json.dumps({"success": True, "status": "candidate", **prepared}, ensure_ascii=False)

    memory_id = store.add_memory(prepared["content"], prepared["metadata"])
    append_event(
        "memory_write",
        source="memory_tools.save_memory",
        action="save_memory",
        status="approved",
        summary=prepared["content"],
        metadata={"memory_id": memory_id, "risk_flags": prepared.get("risk_flags", [])},
    )
    return json.dumps(
        {"success": True, "id": memory_id, "content": prepared["content"], "metadata": prepared["metadata"]},
        ensure_ascii=False,
    )

def save_generation_to_memory(prompt: str, url: str, type: str):
    """
    (非 Tool) 辅助函数，用于将生成的作品自动保存到向量库。
    """
    logger.info("[memory] save_generation_to_memory type=%s url=%s", type, url)
    store = get_vector_store()
    if store:
        content = f"Generated {type}: {prompt}"
        metadata = {
            "type": type,
            "url": url,
            "prompt": prompt
        }
        store.add_memory(content, metadata)
        logger.info("[memory] saved type=%s prompt=%r", type, prompt[:60])
    else:
        logger.warning("[memory] vector store not initialized, skip save type=%s", type)
