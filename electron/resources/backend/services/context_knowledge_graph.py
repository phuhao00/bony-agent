"""
My Context · 知识图谱：多维度真实关系图谱。

维度设计（每条边都对应一种真实管理/调用关系）：
  - 执行层：FastAPI Backend ← 调度 → LangGraph Planner → Agent Registry → 各 Agent
  - AI 模型层：各 Agent → 使用 → 已配置 LLM（按 capability 映射）
  - 数据层：Agent/后端 → 读写 → RAG 知识库 → 各知识文档
  - 平台层：发布类 Agent → 输出到 → 各平台（仅已连接）
  - 任务层：定时任务 → 触发 → 对应 Agent → 对应平台
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List, Set

from agents.registry import AgentRegistry
from core.llm_provider import PROVIDERS, get_api_key
from tools.connectors.manager import get_connector_manager
from utils.logger import setup_logger

logger = setup_logger("context_knowledge_graph")

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

KB_DOC_CAP = 12
JOB_CAP = 10

# Agent capability → LLM provider 映射（capability 关键词 → provider id）
CAP_TO_LLM: List[tuple[str, str]] = [
    ("image", "alibaba"),
    ("video", "alibaba"),
    ("image", "jimeng"),
    ("video", "jimeng"),
    ("video", "bytedance"),
    ("script", "alibaba"),
    ("copywriting", "alibaba"),
    ("copywriting", "deepseek"),
    ("review", "google"),
    ("rag", "alibaba"),
    ("trend", "google"),
    ("trend", "deepseek"),
]


def _safe_id(prefix: str, raw: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9_-]+", "-", raw).strip("-").lower()
    if not s:
        s = "x"
    return f"{prefix}-{s}"[:96]


def _dedupe_links(links: List[Dict[str, str]], node_ids: Set[str]) -> List[Dict[str, str]]:
    seen: Set[tuple[str, str]] = set()
    out: List[Dict[str, str]] = []
    for lnk in links:
        a, b = lnk.get("source", ""), lnk.get("target", "")
        if a not in node_ids or b not in node_ids or a == b:
            continue
        key = tuple(sorted((a, b)))
        if key in seen:
            continue
        seen.add(key)
        out.append({"source": a, "target": b})
    return out


def build_context_knowledge_graph() -> Dict[str, Any]:
    nodes: List[Dict[str, str]] = []
    links: List[Dict[str, str]] = []
    seen: Set[str] = set()

    def add_node(nid: str, name: str, entity_type: str) -> None:
        if nid in seen:
            return
        seen.add(nid)
        nodes.append({"id": nid, "name": name, "type": entity_type})

    def add_link(a: str, b: str) -> None:
        if a != b:
            links.append({"source": a, "target": b})

    # ── 核心架构节点 ──────────────────────────────────────────────────────
    H_BACKEND = "hub-fastapi-backend"
    H_REGISTRY = "hub-agent-registry"
    H_LANGGRAPH = "hub-langgraph-planner"
    H_RAG = "hub-rag-knowledge-base"

    add_node(H_BACKEND, "FastAPI Backend", "service")
    add_node(H_REGISTRY, "Agent Registry", "service")
    add_node(H_LANGGRAPH, "LangGraph Planner", "creative_work")
    add_node(H_RAG, "RAG Knowledge Base", "service")

    # 执行层真实关系
    add_link(H_BACKEND, H_REGISTRY)       # Backend 管理 Registry
    add_link(H_BACKEND, H_LANGGRAPH)      # Backend 通过 LangGraph 编排
    add_link(H_LANGGRAPH, H_REGISTRY)     # Planner 从 Registry 选 Agent
    add_link(H_BACKEND, H_RAG)            # Backend 向 RAG 存取知识

    # ── 已配置的 LLM 供应商 ────────────────────────────────────────────
    configured_llms: Set[str] = set()
    llm_node_map: Dict[str, str] = {}   # provider_id → node_id

    try:
        for pid in PROVIDERS:
            try:
                if get_api_key(pid):
                    configured_llms.add(pid)
                    cfg = PROVIDERS[pid]
                    nid = _safe_id("llm", pid)
                    llm_node_map[pid] = nid
                    add_node(nid, cfg.name, "service")
                    # LangGraph Planner 使用所有已配置 LLM
                    add_link(H_LANGGRAPH, nid)
            except Exception:
                continue
    except Exception as e:
        logger.warning("context graph: llm providers skipped: %s", e)

    # ── Agents：按 capability 连接到对应 LLM ───────────────────────────
    registry = AgentRegistry()
    agents = registry.list_all()

    agent_node_map: Dict[str, str] = {}  # agent_id → node_id

    for info in agents:
        aid = str(info.get("agent_id") or "unknown")
        caps: List[str] = [c.lower() for c in (info.get("capabilities") or [])]
        nid = _safe_id("agent", aid)
        agent_node_map[aid] = nid
        label = aid.replace("_", " ").replace("-", " ").title()
        add_node(nid, label[:80], "creative_work")
        # Agent → Registry（Agent 被 Registry 管理）
        add_link(H_REGISTRY, nid)
        # Agent → 使用对应 LLM（按 capability 精确匹配）
        linked_llms: Set[str] = set()
        for cap_kw, pid in CAP_TO_LLM:
            if pid in configured_llms and any(cap_kw in c for c in caps):
                if pid not in linked_llms:
                    add_link(nid, llm_node_map[pid])
                    linked_llms.add(pid)
        # 没有精确匹配时：fallback 连接 LangGraph（说明该 Agent 由 Planner 编排）
        if not linked_llms:
            add_link(nid, H_LANGGRAPH)

    # ── 平台连接器：仅已连接的平台 ────────────────────────────────────
    platform_node_map: Dict[str, str] = {}  # platform_id → node_id

    try:
        mgr = get_connector_manager()
        for p in mgr.get_all_platforms():
            if not p.get("connected"):
                continue  # 未连接的平台不显示
            pid_str = str(p.get("platform_id") or "unknown")
            pname = str(p.get("platform_name") or pid_str)
            nid = _safe_id("platform", pid_str)
            platform_node_map[pid_str] = nid
            add_node(nid, pname, "service")
            # 平台 ← Backend 管理（发布 API）
            add_link(H_BACKEND, nid)
            # 发布类 Agent → 平台
            for aid, anid in agent_node_map.items():
                if any(kw in aid.lower() for kw in ("publish", "poster", "platform", "distribute")):
                    add_link(anid, nid)
    except Exception as e:
        logger.warning("context graph: platforms skipped: %s", e)

    # ── RAG 文档：连接到 RAG 及使用该知识库的 Agent ──────────────────
    try:
        from utils.rag_manager import get_rag_manager

        rag = get_rag_manager()
        if rag:
            docs = rag.get_documents_info()
            for i, doc in enumerate(docs):
                if i >= KB_DOC_CAP:
                    break
                did = str(doc.get("id") or "")
                fname = str(doc.get("filename") or did[:12] or "document")
                nid = _safe_id("kb", did or fname)
                add_node(nid, fname[:80], "defined_term")
                add_link(H_RAG, nid)
                # RAG 类 Agent → 文档
                for aid, anid in agent_node_map.items():
                    if any(kw in aid.lower() for kw in ("rag", "knowledge", "retriev", "search")):
                        add_link(anid, nid)
    except Exception as e:
        logger.warning("context graph: rag skipped: %s", e)

    # ── 定时任务：连接到触发的 Agent 与目标平台 ──────────────────────
    try:
        from services.scheduler import scheduler_service

        jobs = scheduler_service.get_all_jobs()
        for i, job in enumerate(jobs):
            if i >= JOB_CAP:
                break
            jid = str(job.get("id") or "")
            jname = str(job.get("name") or "Scheduled Job")
            nid = _safe_id("job", jid or jname)
            add_node(nid, jname[:80], "event")

            # 任务 → Backend（由 Backend 调度）
            add_link(H_BACKEND, nid)

            # 任务 → 目标平台（仅已连接）
            has_platform_link = False
            for plat in job.get("platforms") or []:
                pnid = platform_node_map.get(str(plat))
                if pnid:
                    add_link(nid, pnid)
                    has_platform_link = True

            # 任务 → 对应 Agent（按任务类型推断）
            job_type = str(job.get("type") or job.get("task_type") or "").lower()
            for aid, anid in agent_node_map.items():
                aid_lower = aid.lower()
                if (
                    (job_type and any(kw in aid_lower for kw in job_type.split("_")))
                    or (not job_type and any(kw in aid_lower for kw in ("publish", "post")))
                ):
                    add_link(nid, anid)

            # 如果任务没有任何有意义的连接，跳过（避免孤岛）
            if not has_platform_link and nid in seen:
                # 至少连 Backend 保持可见
                pass

    except Exception as e:
        logger.warning("context graph: scheduler skipped: %s", e)

    node_ids = {n["id"] for n in nodes}
    links = _dedupe_links(links, node_ids)

    return {"nodes": nodes, "links": links}
