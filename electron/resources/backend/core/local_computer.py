import json
import os
import re
import shutil
import shlex
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from core.capabilities import requires_approval
from services.approval_service import approval_service
from utils.logger import setup_logger
from utils.task_manager import task_manager

logger = setup_logger("local_computer")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
COMPUTER_DIR = PROJECT_ROOT / "storage" / "computer"
AUDIT_LOG = COMPUTER_DIR / "local_actions.jsonl"
ROLLBACK_DIR = COMPUTER_DIR / "rollback"
MAX_READ_BYTES = 256 * 1024
MAX_SHELL_OUTPUT_BYTES = 16 * 1024
SHELL_TIMEOUT_SECONDS = 5
MAX_SHELL_ARGS = 24
MAX_SHELL_ARG_LENGTH = 512
MAX_SHELL_COMMAND_LENGTH = 2048

ACTION_CAPABILITIES = {
    "list_dir": "file_read",
    "read_text_file": "file_read",
    "write_text_file": "file_write",
    "delete_path": "file_delete",
    "move_path": "file_write",
    "rename_path": "file_write",
    "mkdir": "file_write",
    "launch_app": "app_launch",
    "shell_command": "shell_command",
}
ROLLBACKABLE_ACTIONS = {"write_text_file", "delete_path", "move_path", "rename_path", "mkdir"}
EXECUTABLE_APPROVED_ACTIONS = {
    "write_text_file",
    "delete_path",
    "shell_command",
    "move_path",
    "rename_path",
    "mkdir",
    "launch_app",
}
SHELL_COMMAND_ALLOWLIST = {"pwd", "ls", "find", "rg", "grep", "cat", "head", "tail", "wc", "du", "df"}
# 静态说明：为何 allowlist 中命令在「当前参数策略」下视为只读（仍需沙箱路径与输出审计）
SHELL_READONLY_PROOF: Dict[str, str] = {
    "pwd": "仅打印当前工作目录路径，不写文件、不启动子 shell。",
    "ls": "仅列出目录条目元数据（在允许的 working_dir 下解析路径），默认不允许重定向或管道。",
    "find": "仅遍历目录树并打印匹配路径；已限制 -maxdepth 等选项与可解析路径必须在允许根内。",
    "rg": "在允许目录内只读搜索文件内容；选项子集无就地写入能力。",
    "grep": "在允许路径上只读匹配行；选项子集无就地写入能力。",
    "cat": "仅顺序读取指定文件内容到 stdout；路径必须在允许根内。",
    "head": "仅读取文件头部行/字节到 stdout；路径必须在允许根内。",
    "tail": "仅读取文件尾部行/字节到 stdout；路径必须在允许根内。",
    "wc": "仅统计行/词/字节数；输入为允许路径内的文件。",
    "du": "仅统计目录/文件占用空间（读元数据）；路径在允许根内。",
    "df": "仅报告文件系统挂载点用量（系统级只读查询），不修改磁盘。",
}
SHELL_BLOCKED_TOKENS = (";", "&", "|", ">", "<", "`", "$", "(", ")", "\n", "\r")
SHELL_OPTION_ALLOWLIST = {
    "pwd": set(),
    "ls": {"-1", "-a", "-A", "-h", "-l", "-la", "-lh", "-al", "-R"},
    "find": {"-maxdepth", "-mindepth", "-name", "-iname", "-type", "-size"},
    "rg": {"-n", "--line-number", "-i", "--ignore-case", "-S", "--smart-case", "--files", "--glob", "--max-count"},
    "grep": {"-n", "-i", "-R", "-r", "-l", "--line-number", "--ignore-case"},
    "cat": set(),
    "head": {"-n"},
    "tail": {"-n"},
    "wc": {"-l", "-w", "-c", "-m"},
    "du": {"-s", "-h", "-sh"},
    "df": {"-h"},
}
SHELL_OPTIONS_WITH_VALUE = {"-maxdepth", "-mindepth", "-name", "-iname", "-type", "-size", "--glob", "--max-count", "-n"}
SHELL_SECRET_PATTERNS = (
    re.compile(r"(?i)\b(api[_-]?key|token|password|secret|authorization)\b\s*[:=]"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b"),
    re.compile(r"\b[A-Za-z0-9_=-]{24,}\.[A-Za-z0-9_=-]{12,}\.[A-Za-z0-9_=-]{12,}\b"),
)


class LocalComputerError(ValueError):
    pass


class LocalComputerService:
    def __init__(
        self,
        *,
        allowed_roots: Optional[List[Path]] = None,
        audit_path: Path = AUDIT_LOG,
    ):
        self._allowed_roots = [root.expanduser().resolve() for root in allowed_roots] if allowed_roots is not None else None
        self.audit_path = audit_path
        self.audit_path.parent.mkdir(parents=True, exist_ok=True)

    def list_allowed_roots(self) -> List[str]:
        return [str(root) for root in self._current_roots()]

    def list_audit_events(
        self,
        *,
        limit: int = 100,
        action: Optional[str] = None,
        status: Optional[str] = None,
        task_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        limit = max(1, min(int(limit), 500))
        if not self.audit_path.exists():
            return []
        events: List[Dict[str, Any]] = []
        with self.audit_path.open("r", encoding="utf-8") as file:
            for line in file:
                line = line.strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if action and event.get("action") != action:
                    continue
                if status and event.get("status") != status:
                    continue
                if task_id and event.get("task_id") != task_id:
                    continue
                events.append(event)
        events.sort(key=lambda item: item.get("created_at") or 0, reverse=True)
        return events[:limit]

    def run_action(
        self,
        *,
        action: str,
        path: Optional[str] = None,
        dest_path: Optional[str] = None,
        content: Optional[str] = None,
        command: Optional[str] = None,
        working_dir: Optional[str] = None,
        app_id: Optional[str] = None,
        url: Optional[str] = None,
        trace_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        action = action.strip().lower()
        capability_id = ACTION_CAPABILITIES.get(action)
        if not capability_id:
            raise LocalComputerError(f"Unsupported local computer action: {action}")

        args = {
            "action": action,
            "path": path,
            "dest_path": dest_path,
            "command": command,
            "working_dir": working_dir,
            "app_id": app_id,
            "url": url,
            "content_preview": (content or "")[:500] if content is not None else None,
        }
        resolved_path: Optional[Path] = None
        resolved_dest_path: Optional[Path] = None
        if path:
            resolved_path = self._resolve_allowed_path(path)
            args["resolved_path"] = str(resolved_path)
        if dest_path:
            resolved_dest_path = self._resolve_allowed_path(dest_path)
            args["resolved_dest_path"] = str(resolved_dest_path)
        if action in {"move_path", "rename_path"}:
            if not resolved_path or not resolved_dest_path:
                raise LocalComputerError("path and dest_path are required for move/rename")
        if action == "mkdir":
            if not resolved_path:
                raise LocalComputerError("path is required for mkdir")
        if action == "launch_app":
            if not app_id:
                raise LocalComputerError("app_id is required for launch_app")
            if url:
                args["url"] = url
        resolved_working_dir: Optional[Path] = None
        if action == "shell_command":
            if not working_dir:
                raise LocalComputerError("working_dir is required for shell_command")
            resolved_working_dir = self._resolve_allowed_path(working_dir)
            if not resolved_working_dir.exists() or not resolved_working_dir.is_dir():
                raise LocalComputerError("working_dir is not a directory")
            args["resolved_working_dir"] = str(resolved_working_dir)
            args["shell_policy"] = self._validate_shell_command(
                command or "",
                metadata=metadata,
                allowed_roots=self._current_roots(),
            )
            if not args["shell_policy"].get("system_assistant"):
                self._validate_shell_arguments(args["shell_policy"]["argv"], resolved_working_dir)

        source = (metadata or {}).get("source") or ""
        auto_execute = source in {"creative_apps", "creative_desktop_agent"}

        if requires_approval(capability_id) and not auto_execute:
            result = self._request_approval(
                capability_id=capability_id,
                action=action,
                args=args,
                execution_payload={
                    "action": action,
                    "path": str(resolved_path) if resolved_path else path,
                    "dest_path": str(resolved_dest_path) if resolved_dest_path else dest_path,
                    "content": content,
                    "command": command,
                    "working_dir": str(resolved_working_dir) if resolved_working_dir else working_dir,
                    "app_id": app_id,
                    "url": url,
                },
                trace_id=trace_id,
                metadata=metadata,
            )
            self._audit(action=action, capability_id=capability_id, status="waiting_approval", args=args, result=result)
            return result

        if action == "list_dir":
            if not resolved_path:
                raise LocalComputerError("path is required for list_dir")
            result = self._list_dir(resolved_path)
        elif action == "read_text_file":
            if not resolved_path:
                raise LocalComputerError("path is required for read_text_file")
            result = self._read_text_file(resolved_path)
        elif action == "launch_app":
            if not app_id:
                raise LocalComputerError("app_id is required for launch_app")
            result = self._execute_launch_app(app_id, url=url)
        elif action == "shell_command":
            if not resolved_working_dir:
                raise LocalComputerError("working_dir is required for shell_command")
            policy = args.get("shell_policy") or {}
            argv = policy.get("argv", [])
            result = self._execute_shell_command(argv, resolved_working_dir, policy)
        else:
            raise LocalComputerError(f"Action cannot run directly: {action}")

        self._audit(action=action, capability_id=capability_id, status="completed", args=args, result=result)
        return result

    def resume_approved_action(self, task_id: str) -> Optional[Dict[str, Any]]:
        task = task_manager.get_task(task_id)
        if not task:
            return None
        if task.get("type") != "local_computer_action":
            raise LocalComputerError("Only local_computer_action tasks can be resumed here")
        if task.get("status") in {"cancelled", "failed", "completed", "expired"}:
            raise LocalComputerError(f"Task is {task.get('status')} and cannot be resumed")

        metadata = task.get("metadata") or {}
        last_approval_id = metadata.get("last_approval_id")
        approved_approval_id = metadata.get("approved_approval_id")
        if not approved_approval_id or approved_approval_id != last_approval_id:
            raise LocalComputerError("Task is waiting for approval before it can resume")

        payload = metadata.get("local_computer_resume")
        if not isinstance(payload, dict):
            raise LocalComputerError("Task has no local computer resume payload")

        action = str(payload.get("action") or "").strip().lower()
        capability_id = ACTION_CAPABILITIES.get(action)
        if not capability_id:
            raise LocalComputerError(f"Unsupported local computer action: {action}")
        if action not in EXECUTABLE_APPROVED_ACTIONS:
            raise LocalComputerError(f"Approved action is not executable yet: {action}")

        target: Optional[Path] = None
        dest_target: Optional[Path] = None
        working_dir: Optional[Path] = None
        task_metadata = task.get("metadata") or {}
        if action == "shell_command":
            working_dir_value = payload.get("working_dir")
            if not working_dir_value:
                raise LocalComputerError("Approved shell action has no working_dir")
            working_dir = self._resolve_allowed_path(str(working_dir_value))
            if not working_dir.exists() or not working_dir.is_dir():
                raise LocalComputerError("working_dir is not a directory")
            command_policy = self._validate_shell_command(
                str(payload.get("command") or ""),
                metadata=task_metadata,
                allowed_roots=self._current_roots(),
            )
            if not command_policy.get("system_assistant") and not command_policy.get("app_automation"):
                self._validate_shell_arguments(command_policy["argv"], working_dir)
        elif action == "launch_app":
            if not payload.get("app_id"):
                raise LocalComputerError("Approved launch_app action has no app_id")
            command_policy = None
        else:
            path_value = payload.get("path")
            if not path_value:
                raise LocalComputerError("Approved action has no path")
            target = self._resolve_allowed_path(str(path_value))
            dest_value = payload.get("dest_path")
            if action in {"move_path", "rename_path"}:
                if not dest_value:
                    raise LocalComputerError("Approved move/rename action has no dest_path")
                dest_target = self._resolve_allowed_path(str(dest_value))
            command_policy = None

        task_manager.update_task(task_id, status="running", progress=50, message=f"执行本地动作：{action}")
        args = {
            "action": action,
            "path": str(target) if target else None,
            "working_dir": str(working_dir) if working_dir else None,
            "approval_id": approved_approval_id,
        }
        try:
            if action == "write_text_file":
                if target is None:
                    raise LocalComputerError("Approved action has no path")
                rollback = self._create_rollback_snapshot(task_id, target)
                result = self._execute_write_text_file(target, str(payload.get("content") or ""), rollback)
            elif action == "delete_path":
                if target is None:
                    raise LocalComputerError("Approved action has no path")
                rollback = self._create_rollback_snapshot(task_id, target)
                result = self._execute_delete_path(target, rollback)
            elif action == "move_path":
                if target is None or dest_target is None:
                    raise LocalComputerError("Approved move action is missing paths")
                rollback = self._create_move_rollback_snapshot(task_id, target, dest_target)
                result = self._execute_move_path(target, dest_target, rollback)
            elif action == "rename_path":
                if target is None or dest_target is None:
                    raise LocalComputerError("Approved rename action is missing paths")
                rollback = self._create_move_rollback_snapshot(task_id, target, dest_target)
                result = self._execute_move_path(target, dest_target, rollback, action="rename_path")
            elif action == "mkdir":
                if target is None:
                    raise LocalComputerError("Approved mkdir action has no path")
                rollback = self._create_mkdir_rollback_snapshot(task_id, target)
                result = self._execute_mkdir(target, rollback)
            elif action == "launch_app":
                rollback = None
                result = self._execute_launch_app(
                    str(payload.get("app_id") or ""),
                    url=str(payload.get("url") or ""),
                )
            else:
                if working_dir is None or command_policy is None:
                    raise LocalComputerError("Approved shell action is missing execution context")
                rollback = None
                timeout = int(command_policy.get("timeout_seconds") or SHELL_TIMEOUT_SECONDS)
                result = self._execute_shell_command(
                    command_policy["argv"],
                    working_dir,
                    timeout_seconds=timeout,
                )
            result.update({"task_id": task_id, "approval_id": approved_approval_id})
            metadata_update: Dict[str, Any] = {"executed_approval_id": approved_approval_id}
            if rollback is not None:
                metadata_update["rollback"] = rollback
            if action == "shell_command":
                timeout = int((command_policy or {}).get("timeout_seconds") or SHELL_TIMEOUT_SECONDS)
                metadata_update["shell_execution"] = {
                    "command": payload.get("command"),
                    "working_dir": str(working_dir),
                    "timeout_seconds": timeout,
                    "output_truncated": result.get("stdout_truncated") or result.get("stderr_truncated"),
                    "risk_flags": result.get("risk_flags", []),
                    "read_only_proof": result.get("read_only_proof", ""),
                }
            task_manager.update_task(
                task_id,
                status="completed",
                progress=100,
                result=result,
                message="本地动作已执行",
                metadata=metadata_update,
            )
            self._audit(action=action, capability_id=capability_id, status="completed", args=args, result=result)
            return result
        except Exception as exc:
            task_manager.update_task(task_id, status="failed", error=str(exc), message="本地动作执行失败")
            error_result = {"success": False, "status": "failed", "error": str(exc), "task_id": task_id}
            self._audit(action=action, capability_id=capability_id, status="failed", args=args, result=error_result)
            raise

    def rollback_action(self, task_id: str) -> Optional[Dict[str, Any]]:
        task = task_manager.get_task(task_id)
        if not task:
            return None
        if task.get("type") != "local_computer_action":
            raise LocalComputerError("Only local_computer_action tasks can be rolled back here")
        if task.get("status") != "completed":
            raise LocalComputerError(f"Task is {task.get('status')} and cannot be rolled back")

        metadata = task.get("metadata") or {}
        if metadata.get("rollback_applied_at"):
            raise LocalComputerError("Rollback has already been applied")
        payload = metadata.get("local_computer_resume")
        rollback = metadata.get("rollback")
        if not isinstance(payload, dict) or not isinstance(rollback, dict):
            raise LocalComputerError("Task has no rollback payload")

        action = str(payload.get("action") or "").strip().lower()
        if action not in ROLLBACKABLE_ACTIONS:
            raise LocalComputerError(f"Action cannot be rolled back: {action}")

        if rollback.get("kind") == "move":
            result = self._apply_move_rollback(task_id, rollback)
            audit_path = rollback.get("source_path")
        elif rollback.get("kind") == "mkdir":
            result = self._apply_mkdir_rollback(task_id, rollback)
            audit_path = rollback.get("target_path")
        else:
            target_path = rollback.get("target_path")
            if not target_path:
                raise LocalComputerError("Rollback payload has no target path")
            target = self._resolve_allowed_path(str(target_path))
            result = self._apply_rollback(task_id, action, target, rollback)
            audit_path = str(target)
        task_manager.update_task(
            task_id,
            status="completed",
            result=result,
            message="本地动作已回滚",
            metadata={"rollback_applied_at": time.time()},
        )
        self._audit(
            action=f"rollback_{action}",
            capability_id=ACTION_CAPABILITIES[action],
            status="completed",
            args={"action": action, "path": audit_path},
            result=result,
        )
        return result

    def _current_roots(self) -> List[Path]:
        if self._allowed_roots is not None:
            return self._allowed_roots
        try:
            from services.computer_service import get_folders

            roots = []
            for folder in get_folders():
                folder_path = folder.get("path")
                if folder_path:
                    root = Path(str(folder_path)).expanduser().resolve()
                    if root.exists() and root.is_dir():
                        roots.append(root)
            return roots
        except Exception as exc:
            logger.warning(f"Failed to load local computer roots: {exc}")
            return []

    def _resolve_allowed_path(self, value: str) -> Path:
        target = Path(value).expanduser().resolve()
        self._assert_allowed_resolved_path(target)
        return target

    def _assert_allowed_resolved_path(self, target: Path) -> None:
        roots = self._current_roots()
        if not roots:
            raise LocalComputerError("No allowed local computer roots configured")
        for root in roots:
            if target == root or root in target.parents:
                return
        raise LocalComputerError("Path is outside allowed local computer roots")

    @staticmethod
    def _validate_shell_command(
        command: str,
        *,
        metadata: Optional[Dict[str, Any]] = None,
        allowed_roots: Optional[List[Path]] = None,
    ) -> Dict[str, Any]:
        command = command.strip()
        if not command:
            raise LocalComputerError("shell command is required")
        meta = metadata or {}
        if meta.get("source") == "system_assistant":
            try:
                from core.system_command_policy import validate_system_shell_command

                policy = validate_system_shell_command(
                    command,
                    recipe_id=meta.get("recipe_id"),
                )
                policy["system_assistant"] = True
                return policy
            except ValueError as exc:
                raise LocalComputerError(str(exc)) from exc

        if meta.get("source") in ("creative_app", "creative_apps", "creative_desktop_agent", "app_automation"):
            try:
                from core.app_command_policy import validate_app_command

                automation_plan = meta.get("automation_plan") or meta.get("creative_plan") or {}
                policy = validate_app_command(
                    command,
                    plan=automation_plan,
                    allowed_roots=allowed_roots,
                )
                return policy
            except ValueError as exc:
                raise LocalComputerError(str(exc)) from exc

        if len(command) > MAX_SHELL_COMMAND_LENGTH:
            raise LocalComputerError("shell command is too long")
        if any(token in command for token in SHELL_BLOCKED_TOKENS):
            raise LocalComputerError("shell command contains blocked shell control characters")
        try:
            parts = shlex.split(command)
        except ValueError as exc:
            raise LocalComputerError(f"shell command cannot be parsed: {exc}") from exc
        if not parts:
            raise LocalComputerError("shell command is required")
        if len(parts) > MAX_SHELL_ARGS:
            raise LocalComputerError("shell command has too many arguments")
        if any(len(part) > MAX_SHELL_ARG_LENGTH for part in parts):
            raise LocalComputerError("shell command has an argument that is too long")
        if any("\x00" in part for part in parts):
            raise LocalComputerError("shell command contains a null byte")
        executable = parts[0]
        if "/" in executable or executable not in SHELL_COMMAND_ALLOWLIST:
            raise LocalComputerError(f"shell command is not allowlisted: {executable}")
        return {
            "executable": executable,
            "argv": parts,
            "allowlisted": True,
            "read_only_proof": SHELL_READONLY_PROOF.get(executable, ""),
        }

    def _validate_shell_arguments(self, argv: List[str], working_dir: Path) -> None:
        executable = argv[0]
        allowed_options = SHELL_OPTION_ALLOWLIST.get(executable, set())
        expecting_value_for: Optional[str] = None
        for arg in argv[1:]:
            if expecting_value_for:
                self._validate_shell_option_value(expecting_value_for, arg)
                expecting_value_for = None
                continue
            if "=" in arg and not arg.startswith(("./", "../", "/")) and arg.split("=", 1)[0].isidentifier():
                raise LocalComputerError("shell environment assignments are not allowed")
            if arg.startswith("-"):
                option = arg.split("=", 1)[0]
                if option not in allowed_options:
                    raise LocalComputerError(f"shell option is not allowlisted for {executable}: {option}")
                if "=" in arg:
                    self._validate_shell_option_value(option, arg.split("=", 1)[1])
                elif option in SHELL_OPTIONS_WITH_VALUE:
                    expecting_value_for = option
                continue
            if arg in {".", ".."} or arg.startswith(("./", "../", "/")) or "/" in arg:
                candidate = (working_dir / arg).resolve() if not Path(arg).is_absolute() else Path(arg).expanduser().resolve()
                self._assert_allowed_resolved_path(candidate)
        if expecting_value_for:
            raise LocalComputerError(f"shell option requires a value: {expecting_value_for}")

    @staticmethod
    def _validate_shell_option_value(option: str, value: str) -> None:
        if not value:
            raise LocalComputerError(f"shell option requires a value: {option}")
        if option in {"-maxdepth", "-mindepth", "--max-count", "-n"}:
            if not value.isdigit() or int(value) > 1000:
                raise LocalComputerError(f"shell option value must be a bounded integer: {option}")
        elif option == "-type":
            if value not in {"f", "d"}:
                raise LocalComputerError("find -type only allows f or d")

    @staticmethod
    def _list_dir(path: Path) -> Dict[str, Any]:
        if not path.exists() or not path.is_dir():
            raise LocalComputerError("path is not a directory")
        entries: List[Dict[str, Any]] = []
        for item in sorted(path.iterdir(), key=lambda child: (not child.is_dir(), child.name.lower()))[:200]:
            try:
                stat = item.stat()
                entries.append(
                    {
                        "name": item.name,
                        "path": str(item),
                        "type": "directory" if item.is_dir() else "file",
                        "size": stat.st_size,
                        "modified_at": stat.st_mtime,
                    }
                )
            except OSError:
                continue
        return {"success": True, "action": "list_dir", "path": str(path), "entries": entries}

    @staticmethod
    def _read_text_file(path: Path) -> Dict[str, Any]:
        if not path.exists() or not path.is_file():
            raise LocalComputerError("path is not a file")
        size = path.stat().st_size
        if size > MAX_READ_BYTES:
            raise LocalComputerError(f"file is too large to read directly: {size} bytes")
        text = path.read_text(encoding="utf-8", errors="replace")
        return {"success": True, "action": "read_text_file", "path": str(path), "size": size, "content": text}

    @staticmethod
    def _request_approval(
        *,
        capability_id: str,
        action: str,
        args: Dict[str, Any],
        execution_payload: Dict[str, Any],
        trace_id: Optional[str],
        metadata: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        task_id = task_manager.create_task(
            "local_computer_action",
            metadata={
                "action": action,
                "capability_id": capability_id,
                "local_computer_resume": execution_payload,
                **(metadata or {}),
            },
        )
        approval = approval_service.create_request(
            capability_id=capability_id,
            proposed_action=f"Local computer action: {action}",
            args=args,
            trace_id=trace_id,
            task_id=task_id,
            metadata={"action": action, **(metadata or {}), "source": "local_computer"},
        )
        task_manager.update_task(
            task_id,
            status="waiting_approval",
            message=f"等待审批：{action}",
            metadata={"last_approval_id": approval["id"]},
        )
        return {
            "success": False,
            "status": "waiting_approval",
            "requires_approval": True,
            "task_id": task_id,
            "approval": approval,
        }

    def _create_rollback_snapshot(self, task_id: str, target: Path) -> Dict[str, Any]:
        ROLLBACK_DIR.mkdir(parents=True, exist_ok=True)
        snapshot_dir = ROLLBACK_DIR / task_id
        snapshot_dir.mkdir(parents=True, exist_ok=True)
        metadata: Dict[str, Any] = {
            "target_path": str(target),
            "existed": target.exists(),
            "created_at": time.time(),
        }
        if target.exists():
            if target.is_file():
                backup_path = snapshot_dir / "before.bin"
                shutil.copy2(target, backup_path)
                metadata.update({"kind": "file", "backup_path": str(backup_path), "size": target.stat().st_size})
            else:
                raise LocalComputerError("Directory rollback snapshots are not supported yet")
        else:
            metadata.update({"kind": "missing"})
        (snapshot_dir / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
        return metadata

    @staticmethod
    def _execute_write_text_file(path: Path, content: str, rollback: Dict[str, Any]) -> Dict[str, Any]:
        if not path.parent.exists() or not path.parent.is_dir():
            raise LocalComputerError("parent directory does not exist")
        path.write_text(content, encoding="utf-8")
        return {
            "success": True,
            "status": "completed",
            "action": "write_text_file",
            "path": str(path),
            "bytes_written": len(content.encode("utf-8")),
            "rollback": rollback,
        }

    @staticmethod
    def _execute_delete_path(path: Path, rollback: Dict[str, Any]) -> Dict[str, Any]:
        if not path.exists():
            raise LocalComputerError("path does not exist")
        if not path.is_file():
            raise LocalComputerError("Only file deletion is executable in this first version")
        path.unlink()
        return {
            "success": True,
            "status": "completed",
            "action": "delete_path",
            "path": str(path),
            "rollback": rollback,
        }

    @staticmethod
    def _truncate_output(value: str) -> Dict[str, Any]:
        data = value.encode("utf-8", errors="replace")
        if len(data) <= MAX_SHELL_OUTPUT_BYTES:
            return {"text": value, "truncated": False, "bytes": len(data)}
        clipped = data[:MAX_SHELL_OUTPUT_BYTES].decode("utf-8", errors="replace")
        return {"text": clipped, "truncated": True, "bytes": len(data)}

    @staticmethod
    def _execute_launch_app(app_id: str, url: Optional[str] = None) -> Dict[str, Any]:
        import sys

        app_id = app_id.strip()
        if not app_id:
            raise LocalComputerError("app_id is required")
        url = (url or "").strip()
        if sys.platform == "darwin":
            argv = ["open", "-a", app_id]
            if url:
                argv.append(url)
        elif sys.platform == "win32":
            argv = ["cmd", "/c", "start", "", app_id]
            if url:
                argv.append(url)
        else:
            argv = ["xdg-open", url if url else app_id]
        completed = subprocess.run(argv, capture_output=True, text=True, timeout=30, check=False)
        return {
            "success": completed.returncode == 0,
            "status": "completed",
            "action": "launch_app",
            "app_id": app_id,
            "url": url,
            "returncode": completed.returncode,
            "stdout": (completed.stdout or "")[:4096],
            "stderr": (completed.stderr or "")[:4096],
        }

    @staticmethod
    def _execute_move_path(
        source: Path,
        dest: Path,
        rollback: Dict[str, Any],
        *,
        action: str = "move_path",
    ) -> Dict[str, Any]:
        if not source.exists():
            raise LocalComputerError("source path does not exist")
        if dest.exists():
            raise LocalComputerError("destination already exists")
        if not dest.parent.exists():
            dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(source), str(dest))
        return {
            "success": True,
            "status": "completed",
            "action": action,
            "path": str(source),
            "dest_path": str(dest),
            "rollback": rollback,
        }

    @staticmethod
    def _execute_mkdir(path: Path, rollback: Dict[str, Any]) -> Dict[str, Any]:
        if path.exists():
            raise LocalComputerError("path already exists")
        path.mkdir(parents=True, exist_ok=False)
        return {
            "success": True,
            "status": "completed",
            "action": "mkdir",
            "path": str(path),
            "rollback": rollback,
        }

    def _create_move_rollback_snapshot(
        self,
        task_id: str,
        source: Path,
        dest: Path,
    ) -> Dict[str, Any]:
        ROLLBACK_DIR.mkdir(parents=True, exist_ok=True)
        snapshot_dir = ROLLBACK_DIR / task_id
        snapshot_dir.mkdir(parents=True, exist_ok=True)
        metadata: Dict[str, Any] = {
            "kind": "move",
            "source_path": str(source),
            "dest_path": str(dest),
            "source_existed": source.exists(),
            "dest_existed": dest.exists(),
            "created_at": time.time(),
        }
        if source.exists() and source.is_file():
            backup_path = snapshot_dir / "source.bin"
            shutil.copy2(source, backup_path)
            metadata["source_backup_path"] = str(backup_path)
        (snapshot_dir / "metadata.json").write_text(
            json.dumps(metadata, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return metadata

    def _create_mkdir_rollback_snapshot(self, task_id: str, target: Path) -> Dict[str, Any]:
        ROLLBACK_DIR.mkdir(parents=True, exist_ok=True)
        snapshot_dir = ROLLBACK_DIR / task_id
        snapshot_dir.mkdir(parents=True, exist_ok=True)
        metadata: Dict[str, Any] = {
            "kind": "mkdir",
            "target_path": str(target),
            "existed": target.exists(),
            "created_at": time.time(),
        }
        (snapshot_dir / "metadata.json").write_text(
            json.dumps(metadata, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return metadata

    def _execute_shell_command(
        self,
        argv: List[str],
        working_dir: Path,
        *,
        timeout_seconds: int = SHELL_TIMEOUT_SECONDS,
    ) -> Dict[str, Any]:
        clean_env = {
            "PATH": os.defpath,
            "LANG": "C.UTF-8",
            "LC_ALL": "C.UTF-8",
        }
        try:
            completed = subprocess.run(
                argv,
                cwd=str(working_dir),
                capture_output=True,
                text=True,
                timeout=timeout_seconds,
                shell=False,
                env=clean_env,
                check=False,
            )
            stdout = self._truncate_output(completed.stdout or "")
            stderr = self._truncate_output(completed.stderr or "")
            risk_flags = self._classify_shell_output_risk(
                returncode=completed.returncode,
                stdout=stdout,
                stderr=stderr,
                timed_out=False,
            )
            exe = argv[0] if argv else ""
            return {
                "success": completed.returncode == 0,
                "status": "completed",
                "action": "shell_command",
                "argv": argv,
                "working_dir": str(working_dir),
                "returncode": completed.returncode,
                "stdout": stdout["text"],
                "stderr": stderr["text"],
                "stdout_truncated": stdout["truncated"],
                "stderr_truncated": stderr["truncated"],
                "stdout_bytes": stdout["bytes"],
                "stderr_bytes": stderr["bytes"],
                "timeout_seconds": timeout_seconds,
                "environment": "sanitized",
                "risk_flags": risk_flags,
                "risk_level": self._risk_level_from_flags(risk_flags),
                "read_only_proof": SHELL_READONLY_PROOF.get(exe, ""),
            }
        except subprocess.TimeoutExpired as exc:
            stdout = self._truncate_output(exc.stdout or "")
            stderr = self._truncate_output(exc.stderr or "")
            risk_flags = self._classify_shell_output_risk(
                returncode=None,
                stdout=stdout,
                stderr=stderr,
                timed_out=True,
            )
            exe = argv[0] if argv else ""
            return {
                "success": False,
                "status": "timeout",
                "action": "shell_command",
                "argv": argv,
                "working_dir": str(working_dir),
                "returncode": None,
                "stdout": stdout["text"],
                "stderr": stderr["text"],
                "stdout_truncated": stdout["truncated"],
                "stderr_truncated": stderr["truncated"],
                "stdout_bytes": stdout["bytes"],
                "stderr_bytes": stderr["bytes"],
                "timeout_seconds": timeout_seconds,
                "environment": "sanitized",
                "risk_flags": risk_flags,
                "risk_level": self._risk_level_from_flags(risk_flags),
                "read_only_proof": SHELL_READONLY_PROOF.get(exe, ""),
            }

    @staticmethod
    def _classify_shell_output_risk(
        *,
        returncode: Optional[int],
        stdout: Dict[str, Any],
        stderr: Dict[str, Any],
        timed_out: bool,
    ) -> List[str]:
        flags: List[str] = []
        if timed_out:
            flags.append("timeout")
        if returncode not in (None, 0):
            flags.append("nonzero_exit")
        if stdout.get("truncated") or stderr.get("truncated"):
            flags.append("output_truncated")
        combined = f"{stdout.get('text') or ''}\n{stderr.get('text') or ''}"
        if any(pattern.search(combined) for pattern in SHELL_SECRET_PATTERNS):
            flags.append("possible_secret")
        return flags

    @staticmethod
    def _risk_level_from_flags(flags: List[str]) -> str:
        if "possible_secret" in flags:
            return "high"
        if "timeout" in flags or "output_truncated" in flags:
            return "medium"
        if "nonzero_exit" in flags:
            return "low"
        return "none"

    @staticmethod
    def _apply_move_rollback(task_id: str, rollback: Dict[str, Any]) -> Dict[str, Any]:
        source = Path(str(rollback.get("source_path") or "")).expanduser().resolve()
        dest = Path(str(rollback.get("dest_path") or "")).expanduser().resolve()
        if dest.exists():
            if source.parent.exists() or source.parent == dest.parent:
                source.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(dest), str(source))
        backup = rollback.get("source_backup_path")
        if backup and not source.exists():
            backup_path = Path(str(backup)).expanduser().resolve()
            expected_root = (ROLLBACK_DIR / task_id).resolve()
            if backup_path == expected_root / "source.bin" and backup_path.exists():
                source.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(backup_path, source)
        return {
            "success": True,
            "status": "completed",
            "action": "rollback_move_path",
            "path": str(source),
            "dest_path": str(dest),
            "task_id": task_id,
        }

    @staticmethod
    def _apply_mkdir_rollback(task_id: str, rollback: Dict[str, Any]) -> Dict[str, Any]:
        target = Path(str(rollback.get("target_path") or "")).expanduser().resolve()
        if target.exists() and target.is_dir() and not any(target.iterdir()):
            target.rmdir()
        return {
            "success": True,
            "status": "completed",
            "action": "rollback_mkdir",
            "path": str(target),
            "task_id": task_id,
        }

    @staticmethod
    def _apply_rollback(task_id: str, action: str, target: Path, rollback: Dict[str, Any]) -> Dict[str, Any]:
        if rollback.get("target_path") != str(target):
            raise LocalComputerError("Rollback target does not match task target")
        existed = bool(rollback.get("existed"))
        backup_path_value = rollback.get("backup_path")
        if existed:
            if not backup_path_value:
                raise LocalComputerError("Rollback backup path is missing")
            backup_path = Path(str(backup_path_value)).expanduser().resolve()
            expected_root = (ROLLBACK_DIR / task_id).resolve()
            if backup_path != expected_root / "before.bin":
                raise LocalComputerError("Rollback backup path is not trusted")
            if not backup_path.exists() or not backup_path.is_file():
                raise LocalComputerError("Rollback backup file is missing")
            if not target.parent.exists() or not target.parent.is_dir():
                raise LocalComputerError("Rollback target parent does not exist")
            shutil.copy2(backup_path, target)
            restored = True
        else:
            if action == "write_text_file" and target.exists():
                if not target.is_file():
                    raise LocalComputerError("Rollback target is not a file")
                target.unlink()
            restored = False
        return {
            "success": True,
            "status": "completed",
            "action": f"rollback_{action}",
            "path": str(target),
            "restored_from_backup": restored,
            "task_id": task_id,
        }

    def _audit(
        self,
        *,
        action: str,
        capability_id: str,
        status: str,
        args: Dict[str, Any],
        result: Dict[str, Any],
    ) -> None:
        record = {
            "id": str(uuid.uuid4()),
            "created_at": time.time(),
            "action": action,
            "capability_id": capability_id,
            "status": status,
            "args": args,
            "result_status": result.get("status") or ("success" if result.get("success") else "error"),
            "task_id": result.get("task_id"),
            "approval_id": (result.get("approval") or {}).get("id") if isinstance(result.get("approval"), dict) else None,
        }
        with self.audit_path.open("a", encoding="utf-8") as file:
            file.write(json.dumps(record, ensure_ascii=False) + "\n")


local_computer_service = LocalComputerService()