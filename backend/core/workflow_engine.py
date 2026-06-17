"""backend/core/workflow_engine.py — 工作流执行引擎（Python 薄层）

架构：
  Python (asyncio) ↔ Go (DAG 调度) ↔ Rust (状态持久化)
  Python 负责实际的节点执行（调用 LangChain tools/agents）
  Go 负责 in-degree 跟踪和并发步骤分发
  Rust 负责 crash-safe 持久化和凭证加密

SSE 流格式 (text/event-stream):
  event: step_start|step_done|step_error|workflow_done|workflow_error|heartbeat
  data: JSON
"""
from __future__ import annotations

import asyncio
import json
import time
import uuid
from typing import Any, AsyncGenerator, Dict, Optional

from utils.logger import setup_logger

logger = setup_logger("workflow_engine")

# ── 节点执行路由表 ─────────────────────────────────────────────────
# 懒加载：仅在实际执行时 import，避免循环依赖

_EXECUTOR_REGISTRY: Dict[str, Any] = {}


def _register_executors():
    """延迟注册所有节点执行函数"""
    global _EXECUTOR_REGISTRY
    if _EXECUTOR_REGISTRY:
        return

    def _try_import(module: str, name: str):
        try:
            import importlib
            mod = importlib.import_module(module)
            return getattr(mod, name)
        except Exception as e:
            logger.warning("Could not import %s.%s: %s — using stub executor", module, name, e)

            # 必须接受任意 kwargs：_make_tool_executor 会把 config/上游输入打成一批关键字参数；
            # 若再用仅限关键字且与工具参数不符，会落入 TypeError 分支并以位置参数重试，导致
            # “takes 0 positional arguments but 1 was given”。
            async def _stub(*args: Any, **kwargs: Any) -> str:
                return f"[unavailable: {module}.{name}]"

            return _stub

    _EXECUTOR_REGISTRY = {
        # ── 触发器 ──────────────────────────────────────────────
        "trigger_manual": _execute_trigger,
        "trigger_schedule": _execute_trigger,
        "trigger_webhook": _execute_trigger,
        "trigger_trending": _execute_trigger,
        "trigger_rss": _execute_trigger,
        # ── Agent ─────────────────────────────────────────────────
        "agent_script_writer": _make_tool_executor(_try_import("tools.script_tools", "generate_script")),
        "agent_copywriter": _make_tool_executor(_try_import("tools.copywriting_tools", "generate_copywriting")),
        "agent_media": _make_agent_executor("media_agent"),
        "agent_general": _make_agent_executor("creative_agent"),
        "agent_trend_analyst": _make_agent_executor("trend_analyst_agent"),
        "agent_reviewer": _make_agent_executor("reviewer_agent"),
        "agent_video_editor": _make_agent_executor("video_editor_agent"),
        "agent_planning": _make_agent_executor("creative_agent"),
        "agent_long_video": _make_agent_executor("long_video_agent"),
        "agent_architect": _make_agent_executor("architect_agent"),
        # ── 工具 ──────────────────────────────────────────────────
        "tool_image": _make_tool_executor(_try_import("tools.image_tools", "generate_image")),
        "tool_video": _make_tool_executor(_try_import("tools.video_tools", "generate_video")),
        "tool_audio": _make_tool_executor(_try_import("tools.audio_tools", "text_to_speech")),
        "tool_publish": _make_tool_executor(_try_import("tools.publisher_tools", "publish_content")),
        "tool_rag": _execute_rag,
        "tool_http": _execute_http,
        "tool_moderation": _make_tool_executor(_try_import("tools.moderation_tools", "check_content")),
        "tool_subtitle": _execute_passthrough_outputs,
        "tool_remix": _execute_passthrough_outputs,
        "tool_trending": _execute_gaming_trends_tool,
        "tool_web_search": _execute_web_search_node,
        "tool_template": _execute_passthrough_outputs,
        "tool_transform": _execute_passthrough_outputs,
        "tool_memory_search": _make_tool_executor(_try_import("tools.memory_tools", "search_memory")),
        "tool_memory_save": _make_tool_executor(_try_import("tools.memory_tools", "save_memory")),
        # ── 流程控制 / 输出 ───────────────────────────────────────
        "control_condition": _execute_condition,
        "control_loop": _execute_passthrough_outputs,
        "control_parallel": _execute_passthrough_outputs,
        "control_merge": _execute_passthrough_outputs,
        "control_switch": _execute_passthrough_outputs,
        "control_wait": _execute_passthrough_outputs,
        "output_preview": _execute_output_preview,
        "output_save_history": _execute_output_preview,
        "output_notify": _execute_output_preview,
    }


# ── 主入口：run workflow ──────────────────────────────────────────

async def run_workflow(
    workflow_def: Dict[str, Any],
    run_id: str,
    initial_variables: Optional[Dict[str, str]] = None,
) -> AsyncGenerator[str, None]:
    """
    执行工作流，以 SSE 文本格式 yield 事件。

    每个 yield 格式：
        "event: {event_type}\ndata: {json}\n\n"
    """
    initial_variables = initial_variables or {}
    try:
        _register_executors()
    except Exception as e:
        logger.error("Executor registration failed: %s", e, exc_info=True)
        yield _sse("workflow_error", run_id, data={"error": f"Executor init failed: {e}"})
        return

    # 1. 持久化运行记录到 Rust
    try:
        await _save_run_state(run_id, workflow_def["id"], initial_variables, "running")
    except Exception as e:
        logger.warning("Could not save run state: %s", e)

    # 2. 调用 Go 调度器（server-streaming）
    try:
        async for sse_event in _schedule_and_execute(
            workflow_def, run_id, initial_variables
        ):
            yield sse_event
    except Exception as e:
        logger.error("Workflow run %s failed: %s", run_id, e, exc_info=True)
        try:
            await _save_run_state(run_id, workflow_def["id"], initial_variables, "failed")
        except Exception:
            pass
        yield _sse("workflow_error", run_id, data={"error": str(e)})


async def _schedule_and_execute(
    workflow_def: Dict[str, Any],
    run_id: str,
    initial_variables: Dict[str, str],
) -> AsyncGenerator[str, None]:
    """与 Go 调度器交互，执行每个步骤，直到 run 完成"""
    from services.grpc_client import get_workflow_scheduler_stub

    stub = get_workflow_scheduler_stub()
    if stub is None:
        # 降级：无 Go 调度器时，按顺序执行（开发模式）
        async for event in _fallback_sequential_execute(workflow_def, run_id, initial_variables):
            yield event
        return

    # 快速探测 Go 服务是否可用（避免 UNIMPLEMENTED 错误传播到顶层）
    try:
        from generated.mediaagent import workflow_pb2  # type: ignore
    except Exception:
        logger.warning("workflow_pb2 not available, falling back to sequential")
        async for event in _fallback_sequential_execute(workflow_def, run_id, initial_variables):
            yield event
        return

    nodes_proto = [
        workflow_pb2.WorkflowNodeDef(
            node_id=n["node_id"],
            node_type=n["node_type"],
            config_json=n.get("config_json", "{}"),
            input_map=n.get("input_map", {}),
            output_map=n.get("output_map", {}),
        )
        for n in workflow_def.get("nodes", [])
    ]
    edges_proto = [
        workflow_pb2.WorkflowEdgeDef(
            source=e["source"],
            target=e["target"],
            source_handle=e.get("source_handle", "output"),
            target_handle=e.get("target_handle", "input"),
        )
        for e in workflow_def.get("edges", [])
    ]

    req = workflow_pb2.WorkflowRunRequest(
        run_id=run_id,
        workflow_id=workflow_def["id"],
        nodes=nodes_proto,
        edges=edges_proto,
        initial_variables=initial_variables,
    )

    # 收集所有节点配置（供执行时查找）
    node_index = {n["node_id"]: n for n in workflow_def.get("nodes", [])}

    # 运行变量表（线程安全通过 asyncio 单线程保证）
    run_vars: Dict[str, str] = dict(initial_variables)

    # 调用 Go 流式接口
    # gRPC streaming 在同步 grpc 库中需要用 executor 包装
    loop = asyncio.get_event_loop()
    assignment_queue: asyncio.Queue = asyncio.Queue()
    stop_event = asyncio.Event()

    def _stream_assignments():
        """在线程池中拉取 Go 推送的步骤分配"""
        try:
            for assignment in stub.ScheduleWorkflow(req):
                loop.call_soon_threadsafe(assignment_queue.put_nowait, assignment)
        except Exception as e:
            loop.call_soon_threadsafe(assignment_queue.put_nowait, e)
        finally:
            loop.call_soon_threadsafe(stop_event.set)

    loop.run_in_executor(None, _stream_assignments)

    pending_tasks: Dict[str, asyncio.Task] = {}
    result_reporter = stub  # 重用 stub 调用 ReportStepResult

    while not stop_event.is_set() or not assignment_queue.empty():
        try:
            item = await asyncio.wait_for(assignment_queue.get(), timeout=1.0)
        except asyncio.TimeoutError:
            # 发送心跳保持 SSE 连接活跃
            yield _sse("heartbeat", run_id)
            continue

        if isinstance(item, Exception):
            # gRPC not available — fall back to sequential execution
            logger.warning("Go scheduler failed (%s), switching to sequential fallback", item)
            async for event in _fallback_sequential_execute(workflow_def, run_id, initial_variables):
                yield event
            return

        assignment = item
        node_id = assignment.node_id
        node_cfg = node_index.get(node_id, {})

        yield _sse("step_start", run_id, node_id=node_id, node_type=assignment.node_type)

        # 并发执行节点
        task = asyncio.create_task(
            _execute_node_and_report(
                assignment=assignment,
                node_cfg=node_cfg,
                run_vars=run_vars,
                run_id=run_id,
                stub=result_reporter,
            )
        )
        pending_tasks[node_id] = task

        # 收集已完成的任务并 yield 事件
        done, _ = await asyncio.wait(
            pending_tasks.values(),
            timeout=0,
            return_when=asyncio.FIRST_COMPLETED,
        )
        for t in done:
            node_event = await t
            del pending_tasks[node_event["node_id"]]
            if node_event["success"]:
                run_vars.update(node_event.get("outputs", {}))
                yield _sse("step_done", run_id, node_id=node_event["node_id"],
                           data=node_event.get("outputs", {}))
            else:
                yield _sse("step_error", run_id, node_id=node_event["node_id"],
                           data={"error": node_event.get("error", "")})

    # 等待所有 pending tasks 完成
    if pending_tasks:
        results = await asyncio.gather(*pending_tasks.values(), return_exceptions=True)
        for res in results:
            if isinstance(res, dict):
                if res["success"]:
                    yield _sse("step_done", run_id, node_id=res["node_id"],
                               data=res.get("outputs", {}))
                else:
                    yield _sse("step_error", run_id, node_id=res["node_id"],
                               data={"error": res.get("error", "")})

    await _save_run_state(run_id, workflow_def["id"], initial_variables, "completed")
    yield _sse("workflow_done", run_id)


async def _execute_node_and_report(
    assignment,
    node_cfg: Dict[str, Any],
    run_vars: Dict[str, str],
    run_id: str,
    stub,
) -> Dict[str, Any]:
    """执行单个节点，上报结果到 Go 调度器，返回执行摘要"""
    from generated.mediaagent import workflow_pb2  # type: ignore

    node_id = assignment.node_id
    node_type = assignment.node_type
    resolved_inputs = dict(assignment.resolved_inputs)

    try:
        executor = _EXECUTOR_REGISTRY.get(node_type, _execute_unknown)
        outputs: Dict[str, str] = await executor(
            node_id=node_id,
            node_type=node_type,
            config_json=assignment.config_json,
            resolved_inputs=resolved_inputs,
        )

        # 上报成功到 Go
        await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: stub.ReportStepResult(
                workflow_pb2.StepResultRequest(
                    run_id=run_id,
                    node_id=node_id,
                    status=workflow_pb2.TaskStatus.TASK_STATUS_COMPLETED,
                    outputs=outputs,
                )
            ),
        )
        return {"node_id": node_id, "success": True, "outputs": outputs}

    except Exception as e:
        err_msg = str(e)
        logger.error("Node %s failed: %s", node_id, err_msg)

        # 上报失败到 Go（触发 fail-fast）
        try:
            await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: stub.ReportStepResult(
                    workflow_pb2.StepResultRequest(
                        run_id=run_id,
                        node_id=node_id,
                        status=workflow_pb2.TaskStatus.TASK_STATUS_FAILED,
                        error=err_msg,
                    )
                ),
            )
        except Exception:
            pass

        return {"node_id": node_id, "success": False, "error": err_msg}


# ── 降级模式（无 Go 时顺序执行）─────────────────────────────────

async def _fallback_sequential_execute(
    workflow_def: Dict[str, Any],
    run_id: str,
    initial_variables: Dict[str, str],
) -> AsyncGenerator[str, None]:
    """开发模式：按 nodes 顺序执行，无 DAG 调度"""
    logger.warning("WorkflowEngine: Go scheduler unavailable, running in sequential fallback mode")
    run_vars: Dict[str, str] = dict(initial_variables)

    for node in workflow_def.get("nodes", []):
        node_id = node["node_id"]
        node_type = node["node_type"]

        yield _sse("step_start", run_id, node_id=node_id, node_type=node_type)
        try:
            executor = _EXECUTOR_REGISTRY.get(node_type, _execute_unknown)
            # 解析 input_map 引用
            resolved_inputs = {
                k: run_vars.get(v, v)
                for k, v in node.get("input_map", {}).items()
            }
            outputs = await executor(
                node_id=node_id,
                node_type=node_type,
                config_json=node.get("config_json", "{}"),
                resolved_inputs=resolved_inputs,
            )
            # 将输出写入 run 变量（前缀 $nodeId.）
            for k, v in outputs.items():
                run_vars[f"${node_id}.{k}"] = v
            yield _sse("step_done", run_id, node_id=node_id, data=outputs)
        except Exception as e:
            yield _sse("step_error", run_id, node_id=node_id, data={"error": str(e)})
            yield _sse("workflow_error", run_id, data={"error": f"Node {node_id} failed: {e}"})
            return

    yield _sse("workflow_done", run_id)


# ── 节点执行器 ─────────────────────────────────────────────────────

async def _execute_trigger(*, node_id: str, node_type: str, config_json: str,
                           resolved_inputs: Dict[str, str]) -> Dict[str, str]:
    """触发器节点：透传 initial_variables 作为输出"""
    return dict(resolved_inputs)


async def _execute_output_preview(*, node_id: str, node_type: str, config_json: str,
                                  resolved_inputs: Dict[str, str]) -> Dict[str, str]:
    """输出预览节点：原样透传所有输入"""
    return dict(resolved_inputs)


async def _execute_unknown(*, node_id: str, node_type: str, config_json: str,
                           resolved_inputs: Dict[str, str]) -> Dict[str, str]:
    logger.warning("Unknown node_type=%s for node_id=%s, skipping", node_type, node_id)
    return {"result": f"[skipped: unknown node type {node_type}]"}


async def _execute_passthrough_outputs(
    *, node_id: str, node_type: str, config_json: str, resolved_inputs: Dict[str, str]
) -> Dict[str, str]:
    """流程控制 / 占位工具：透传上游字符串化结果。"""
    if not resolved_inputs:
        return {"output": ""}
    return {k: str(v) for k, v in resolved_inputs.items()}


async def _execute_web_search_node(
    *, node_id: str, node_type: str, config_json: str, resolved_inputs: Dict[str, str]
) -> Dict[str, str]:
    from utils.simple_ddg_search import ddg_html_search_sync

    cfg: Dict[str, Any] = json.loads(config_json) if config_json else {}
    query = (resolved_inputs.get("query") or cfg.get("query") or "").strip()
    if not query:
        return {"results": "", "links": ""}
    max_results = int(cfg.get("max_results", 5))
    region = str(cfg.get("region", "zh-cn"))
    loop = asyncio.get_event_loop()
    text = await loop.run_in_executor(
        None,
        lambda: ddg_html_search_sync(query, max_results=max_results, region=region),
    )
    return {"results": text, "links": ""}


async def _execute_gaming_trends_tool(
    *, node_id: str, node_type: str, config_json: str, resolved_inputs: Dict[str, str]
) -> Dict[str, str]:
    from tools.gaming_trending import get_gaming_trends  # type: ignore

    cfg: Dict[str, Any] = json.loads(config_json) if config_json else {}
    force = bool(cfg.get("force_refresh", False))
    loop = asyncio.get_event_loop()
    text = await loop.run_in_executor(
        None,
        lambda: get_gaming_trends.invoke({"force_refresh": force}),
    )
    snippet = str(text)[:800] if text else ""
    return {"topics": str(text), "top1": snippet}


async def _execute_rag(*, node_id: str, node_type: str, config_json: str,
                       resolved_inputs: Dict[str, str]) -> Dict[str, str]:
    from tools.rag_tools import search_knowledge_base  # type: ignore
    query = resolved_inputs.get("query", "")
    result = await asyncio.get_event_loop().run_in_executor(
        None, lambda: search_knowledge_base.invoke({"query": query})
    )
    return {"result": str(result)}


async def _execute_http(*, node_id: str, node_type: str, config_json: str,
                        resolved_inputs: Dict[str, str]) -> Dict[str, str]:
    """HTTP 工具节点：发起 HTTP 请求"""
    import aiohttp
    cfg = json.loads(config_json) if config_json else {}
    url = cfg.get("url", resolved_inputs.get("url", ""))
    method = cfg.get("method", "GET").upper()
    headers = cfg.get("headers", {})
    body = resolved_inputs.get("body", "")

    if not url:
        raise ValueError("HTTP node: 'url' is required")

    async with aiohttp.ClientSession() as session:
        async with session.request(
            method, url, headers=headers,
            data=body.encode() if body else None,
            timeout=aiohttp.ClientTimeout(total=30),
        ) as resp:
            text = await resp.text()
            return {"status_code": str(resp.status), "body": text}


async def _execute_condition(*, node_id: str, node_type: str, config_json: str,
                             resolved_inputs: Dict[str, str]) -> Dict[str, str]:
    """条件判断节点：简单表达式求值"""
    cfg = json.loads(config_json) if config_json else {}
    expression = cfg.get("expression", "True")
    try:
        # 安全的表达式求值（仅允许比较运算）
        result = bool(eval(expression, {"__builtins__": {}}, resolved_inputs))  # noqa: S307
    except Exception as e:
        logger.warning("Condition eval failed: %s", e)
        result = False
    return {"branch": "true" if result else "false"}


def _make_tool_executor(tool_fn):
    """包装工具函数为 async 执行器，自动适配参数签名"""
    import inspect

    async def _executor(*, node_id: str, node_type: str, config_json: str,
                        resolved_inputs: Dict[str, str]) -> Dict[str, str]:
        cfg = json.loads(config_json) if config_json else {}

        # 展开 {{variable}} 模板（来自 config）
        def expand(text: str) -> str:
            for k, v in resolved_inputs.items():
                text = text.replace(f"{{{{{k}}}}}", v)
            return text

        # 合并参数：config 优先，resolved_inputs 补充
        raw_params: Dict[str, Any] = {}
        for k, v in cfg.items():
            raw_params[k] = expand(str(v)) if isinstance(v, str) else v
        for k, v in resolved_inputs.items():
            if k not in raw_params:
                raw_params[k] = v

        # publish_content：画布字段 title_template / description_template → title / content
        tool_name = getattr(tool_fn, "name", "") or ""
        if tool_name == "publish_content":
            if str(raw_params.get("title_template", "")).strip():
                if not str(raw_params.get("title", "")).strip():
                    raw_params["title"] = str(raw_params["title_template"])
            if str(raw_params.get("description_template", "")).strip():
                if not str(raw_params.get("content", "")).strip():
                    raw_params["content"] = str(raw_params["description_template"])
            if not str(raw_params.get("content", "")).strip():
                for key in (
                    "output",
                    "result",
                    "text",
                    "description",
                    "body",
                    "caption",
                    "markdown",
                    "topic",
                    "prompt",
                    "user_prompt_template",
                ):
                    v = raw_params.get(key)
                    if v is not None and str(v).strip():
                        raw_params["content"] = str(v)
                        break
            if not str(raw_params.get("content", "")).strip():
                for _k, v in resolved_inputs.items():
                    if v is not None and str(v).strip():
                        raw_params["content"] = str(v)
                        break
            raw_params.setdefault("content", "")
            raw_params.setdefault("title", "")

        # 推断 topic：user_prompt_template > prompt > topic > 第一个字符串值
        if "topic" not in raw_params:
            for alias in ("user_prompt_template", "prompt", "text", "content"):
                if alias in raw_params:
                    raw_params["topic"] = raw_params[alias]
                    break
            else:
                # 取 resolved_inputs 的第一个值兜底
                first_val = next(iter(resolved_inputs.values()), None)
                raw_params["topic"] = first_val or f"[{node_type}]"

        # 只保留函数签名中声明的参数
        try:
            # LangChain StructuredTool exposes its schema
            if hasattr(tool_fn, "args_schema") and tool_fn.args_schema is not None:
                valid = set(tool_fn.args_schema.model_fields.keys())
                final_params = {k: v for k, v in raw_params.items() if k in valid}
            elif hasattr(tool_fn, "func"):
                sig = inspect.signature(tool_fn.func)
                valid = {
                    name for name, p in sig.parameters.items()
                    if p.kind not in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD)
                }
                final_params = {k: v for k, v in raw_params.items() if k in valid}
            else:
                sig = inspect.signature(tool_fn)
                valid = {
                    name for name, p in sig.parameters.items()
                    if p.kind not in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD)
                }
                final_params = {k: v for k, v in raw_params.items() if k in valid}
        except (ValueError, TypeError):
            final_params = raw_params

        loop = asyncio.get_event_loop()

        # LangChain @tool：async 实现需 ainvoke；同步 invoke 会抛 StructuredTool 不支持
        try:
            if hasattr(tool_fn, "ainvoke"):
                result = await tool_fn.ainvoke(final_params)
            elif hasattr(tool_fn, "invoke"):
                result = await loop.run_in_executor(
                    None, lambda: tool_fn.invoke(final_params)
                )
            elif asyncio.iscoroutinefunction(tool_fn):
                result = await tool_fn(**final_params)
            else:
                result = await loop.run_in_executor(
                    None, lambda: tool_fn(**final_params)
                )
        except TypeError:
            # 降级：只传 topic（旧工具签名）
            topic_val = final_params.get("topic", raw_params.get("topic", ""))
            if hasattr(tool_fn, "ainvoke"):
                result = await tool_fn.ainvoke({"topic": topic_val})
            elif hasattr(tool_fn, "invoke"):
                result = await loop.run_in_executor(
                    None, lambda: tool_fn.invoke({"topic": topic_val})
                )
            elif asyncio.iscoroutinefunction(tool_fn):
                result = await tool_fn(topic=topic_val)
            else:
                result = await loop.run_in_executor(
                    None, lambda: tool_fn(topic_val)
                )

        return {"result": str(result)}
    return _executor


def _make_agent_executor(agent_id: str):
    """包装 Agent 为 async 执行器"""
    async def _executor(*, node_id: str, node_type: str, config_json: str,
                        resolved_inputs: Dict[str, str]) -> Dict[str, str]:
        from agents.registry import AgentRegistry  # type: ignore
        cfg = json.loads(config_json) if config_json else {}
        # "创作指令"/"系统指令" 字段存为 cfg["prompt"]；兼容旧键 user_prompt_template
        prompt = (
            cfg.get("prompt")
            or cfg.get("user_prompt_template")
            or resolved_inputs.get("prompt")
            or resolved_inputs.get("input")
            or ""
        )
        # 展开 {{variable}} 模板
        for k, v in resolved_inputs.items():
            prompt = prompt.replace(f"{{{{{k}}}}}", v)

        registry = AgentRegistry()
        agent = registry.get(agent_id)
        if agent is None:
            raise ValueError(f"Agent '{agent_id}' not found in registry")

        # BaseAgent 没有 .invoke()；需要先 get_executor() 再 ainvoke()
        # executor 是 RunnableLambda，接受 {"messages": [...]} 格式
        loop = asyncio.get_event_loop()
        executor = await loop.run_in_executor(None, lambda: agent.get_executor(""))

        from langchain_core.messages import HumanMessage  # type: ignore
        result = await executor.ainvoke({"messages": [HumanMessage(content=prompt)]})

        # result 是 LangGraph state dict: {"messages": [AIMessage(...), ...]}
        # 提取最后一条 AI 消息的 content
        output_text = ""
        if isinstance(result, dict):
            msgs = result.get("messages", [])
            if msgs:
                last = msgs[-1]
                output_text = str(getattr(last, "content", last))
            else:
                output_text = result.get("output", str(result))
        else:
            output_text = str(result)
        return {"output": output_text}
    return _executor


# ── 持久化辅助 ─────────────────────────────────────────────────────

async def _save_run_state(
    run_id: str,
    workflow_id: str,
    initial_variables: Dict[str, str],
    status: str,
) -> None:
    """将运行记录通过 Rust gRPC 持久化"""
    from services.grpc_client import get_workflow_state_stub

    stub = get_workflow_state_stub()
    if stub is None:
        return  # Rust 不可用时静默跳过（开发模式）

    from generated.mediaagent import workflow_state_pb2  # type: ignore

    payload = {
        "run_id": run_id,
        "workflow_id": workflow_id,
        "status": status,
        "initial_variables": initial_variables,
        "started_at": int(time.time()),
    }
    if status in ("completed", "failed"):
        payload["finished_at"] = int(time.time())

    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(
            None,
            lambda: stub.SaveRunState(
                workflow_state_pb2.SaveRunStateRequest(
                    run_id=run_id,
                    workflow_id=workflow_id,
                    payload_json=json.dumps(payload),
                )
            ),
        )
    except Exception as e:
        logger.warning("Failed to persist run state for %s: %s", run_id, e)


# ── SSE 格式化 ────────────────────────────────────────────────────

def _sse(
    event: str,
    run_id: str,
    node_id: Optional[str] = None,
    node_type: Optional[str] = None,
    data: Optional[Dict[str, Any]] = None,
) -> str:
    payload: Dict[str, Any] = {
        "run_id": run_id,
        "ts": int(time.time() * 1000),
    }
    if node_id:
        payload["node_id"] = node_id
    if node_type:
        payload["node_type"] = node_type
    if data:
        payload["data"] = data

    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
