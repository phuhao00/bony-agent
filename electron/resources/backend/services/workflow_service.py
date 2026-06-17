"""backend/services/workflow_service.py — 工作流 CRUD 服务层（通过 Rust gRPC）"""
from __future__ import annotations

import json
import time
from typing import Any, Dict, List, Optional

from utils.logger import setup_logger

logger = setup_logger("workflow_service")


class WorkflowService:
    """工作流 CRUD 操作的服务层，委托给 Rust WorkflowStateService"""

    # ── 工作流定义 CRUD ──────────────────────────────────────────

    async def create_workflow(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """创建工作流，持久化并返回完整定义"""
        now = int(time.time())
        if "id" not in payload:
            import uuid
            payload["id"] = str(uuid.uuid4())
        payload.setdefault("created_at", now)
        payload["updated_at"] = now

        await self._save(payload["id"], payload)
        return payload

    async def get_workflow(self, workflow_id: str) -> Optional[Dict[str, Any]]:
        """获取工作流定义，不存在返回 None"""
        return await self._load(workflow_id)

    async def update_workflow(
        self, workflow_id: str, updates: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """更新工作流字段"""
        existing = await self._load(workflow_id)
        if existing is None:
            return None
        existing.update(updates)
        existing["updated_at"] = int(time.time())
        await self._save(workflow_id, existing)
        return existing

    async def delete_workflow(self, workflow_id: str) -> bool:
        """删除工作流，返回是否成功"""
        stub = self._get_state_stub()
        if stub is None:
            return self._file_delete(workflow_id)

        from generated.mediaagent import workflow_state_pb2  # type: ignore
        import asyncio

        try:
            resp = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: stub.DeleteWorkflow(
                    workflow_state_pb2.DeleteWorkflowRequest(id=workflow_id)
                ),
            )
            return resp.success
        except Exception as e:
            logger.warning("gRPC delete failed (%s), falling back to file", e)
            return self._file_delete(workflow_id)

    async def list_workflows(self) -> List[Dict[str, Any]]:
        """列出所有工作流摘要"""
        stub = self._get_state_stub()
        if stub is None:
            return await self._file_list()

        from generated.mediaagent import workflow_state_pb2  # type: ignore
        import asyncio

        try:
            summaries = []
            responses = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: list(stub.ListWorkflows(
                    workflow_state_pb2.ListWorkflowsRequest()
                )),
            )
            for s in responses:
                summaries.append({
                    "id": s.id,
                    "name": s.name,
                    "description": s.description,
                    "node_count": s.node_count,
                    "created_at": s.created_at,
                    "updated_at": s.updated_at,
                })
            return summaries
        except Exception as e:
            logger.warning("gRPC list failed (%s), falling back to file", e)
            return await self._file_list()

    # ── 运行状态 ─────────────────────────────────────────────────

    async def list_runs(
        self, workflow_id: str, limit: int = 20
    ) -> List[Dict[str, Any]]:
        """列出工作流的运行历史"""
        stub = self._get_state_stub()
        if stub is None:
            return []

        from generated.mediaagent import workflow_state_pb2  # type: ignore
        import asyncio

        try:
            responses = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: list(stub.ListRunStates(
                    workflow_state_pb2.ListRunStatesRequest(
                        workflow_id=workflow_id,
                        limit=limit,
                    )
                )),
            )
            return [
                {
                    "run_id": r.run_id,
                    "workflow_id": r.workflow_id,
                    "status": r.status,
                    "started_at": r.started_at,
                    "finished_at": r.finished_at,
                }
                for r in responses
            ]
        except Exception as e:
            logger.error("Failed to list runs for %s: %s", workflow_id, e)
            return []

    async def get_run(self, run_id: str) -> Optional[Dict[str, Any]]:
        """获取单个运行记录"""
        stub = self._get_state_stub()
        if stub is None:
            return None

        from generated.mediaagent import workflow_state_pb2  # type: ignore
        import asyncio

        try:
            resp = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: stub.LoadRunState(
                    workflow_state_pb2.LoadRunStateRequest(run_id=run_id)
                ),
            )
            if resp.found:
                return json.loads(resp.payload_json)
            return None
        except Exception as e:
            logger.error("Failed to get run %s: %s", run_id, e)
            return None

    # ── 凭证加密 ─────────────────────────────────────────────────

    async def encrypt_credential(self, plaintext: str) -> Optional[str]:
        """加密节点凭证，返回 ciphertext 或 None（加密不可用时）"""
        stub = self._get_state_stub()
        if stub is None:
            return None

        from generated.mediaagent import workflow_state_pb2  # type: ignore
        import asyncio

        try:
            resp = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: stub.EncryptNodeConfig(
                    workflow_state_pb2.EncryptRequest(plaintext=plaintext)
                ),
            )
            return resp.ciphertext
        except Exception as e:
            logger.warning("Encrypt failed: %s", e)
            return None

    # ── 内部辅助 ─────────────────────────────────────────────────

    async def _save(self, workflow_id: str, data: Dict[str, Any]) -> None:
        stub = self._get_state_stub()
        payload_json = json.dumps(data, ensure_ascii=False)

        if stub is None:
            self._file_save(workflow_id, payload_json)
            return

        from generated.mediaagent import workflow_state_pb2  # type: ignore
        import asyncio

        try:
            await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: stub.SaveWorkflow(
                    workflow_state_pb2.SaveWorkflowRequest(
                        id=workflow_id,
                        payload_json=payload_json,
                    )
                ),
            )
        except Exception as e:
            logger.warning("Rust state store unavailable (%s), falling back to file", e)
            self._file_save(workflow_id, payload_json)

    async def _load(self, workflow_id: str) -> Optional[Dict[str, Any]]:
        stub = self._get_state_stub()

        if stub is None:
            raw = self._file_load(workflow_id)
            return json.loads(raw) if raw else None

        from generated.mediaagent import workflow_state_pb2  # type: ignore
        import asyncio

        try:
            resp = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: stub.LoadWorkflow(
                    workflow_state_pb2.LoadWorkflowRequest(id=workflow_id)
                ),
            )
            if resp.found:
                return json.loads(resp.payload_json)
            return None
        except Exception as e:
            logger.warning("gRPC load failed (%s), falling back to file", e)
            raw = self._file_load(workflow_id)
            return json.loads(raw) if raw else None

    def _get_state_stub(self):
        try:
            from services.grpc_client import get_workflow_state_stub  # type: ignore
            return get_workflow_state_stub()
        except Exception:
            return None

    # ── 文件系统降级（Rust 不可用时）─────────────────────────────

    def _get_storage_dir(self):
        from pathlib import Path
        d = Path(__file__).parent.parent.parent / "storage" / "workflows"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _file_save(self, workflow_id: str, payload_json: str) -> None:
        path = self._get_storage_dir() / f"{workflow_id}.json"
        path.write_text(payload_json, encoding="utf-8")

    def _file_load(self, workflow_id: str) -> Optional[str]:
        path = self._get_storage_dir() / f"{workflow_id}.json"
        if path.exists():
            return path.read_text(encoding="utf-8")
        return None

    def _file_delete(self, workflow_id: str) -> bool:
        path = self._get_storage_dir() / f"{workflow_id}.json"
        if path.exists():
            path.unlink()
            return True
        return False

    async def _file_list(self) -> List[Dict[str, Any]]:
        d = self._get_storage_dir()
        results = []
        for f in sorted(d.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                results.append({
                    "id": data.get("id", f.stem),
                    "name": data.get("name", ""),
                    "description": data.get("description", ""),
                    "node_count": len(data.get("nodes", [])),
                    "created_at": data.get("created_at", 0),
                    "updated_at": data.get("updated_at", 0),
                })
            except Exception:
                pass
        return results


# 全局单例
_workflow_service: Optional[WorkflowService] = None


def get_workflow_service() -> WorkflowService:
    global _workflow_service
    if _workflow_service is None:
        _workflow_service = WorkflowService()
    return _workflow_service
