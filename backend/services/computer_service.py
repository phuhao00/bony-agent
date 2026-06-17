"""
ComputerService — 本地文件夹注册、后台索引、偏好管理。
将用户添加的本地路径遍历后送入 RAGManager 建立向量索引，
使 AI 可通过 search_knowledge_base 搜索本机文件内容。
"""
import json
import logging
import os
import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger("computer_service")

PROJECT_ROOT = Path(__file__).parent.parent.parent
COMPUTER_DIR = PROJECT_ROOT / "storage" / "computer"
FOLDERS_FILE = COMPUTER_DIR / "folders.json"
PREFS_FILE = COMPUTER_DIR / "index_prefs.json"

# 支持索引的扩展名（与 RAGManager 保持一致）
INDEXABLE_EXTENSIONS = {".txt", ".md", ".pdf", ".docx", ".doc", ".json", ".csv"}

# 跳过高噪声目录，避免 Downloads/项目目录全量 walk 过慢
SKIP_DIR_NAMES = frozenset({
    "node_modules", "__pycache__", ".git", ".svn", ".hg",
    "venv", ".venv", "Library", "Caches", "Cache", "cache",
    ".Trash", ".npm", ".yarn", "dist", "build", ".next",
    "target", ".gradle", ".m2", "site-packages", "Pods",
    ".cursor", "vendor", "tmp", "temp",
})

INDEX_BATCH_SIZE = 64
PERSIST_EVERY_N_DOCS = 32
_STATUS_CACHE: Dict[str, Any] = {"ts": 0.0, "data": None}
_STATUS_CACHE_TTL = 15.0
_index_lock = threading.Lock()
_index_threads: Dict[str, threading.Thread] = {}
_index_control_lock = threading.Lock()
_index_control: Dict[str, Dict[str, Any]] = {}

DEFAULT_PREFS: Dict[str, Any] = {
    "storageLimitGiB": 24,
    "maxFileMiB": 32,
    "indexPdfOcr": False,
}


def _ensure_dirs() -> None:
    COMPUTER_DIR.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# JSON helpers
# ---------------------------------------------------------------------------

def _load_folders() -> List[Dict]:
    _ensure_dirs()
    if not FOLDERS_FILE.exists():
        return []
    try:
        return json.loads(FOLDERS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save_folders(folders: List[Dict]) -> None:
    _ensure_dirs()
    FOLDERS_FILE.write_text(
        json.dumps(folders, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def _load_prefs() -> Dict[str, Any]:
    _ensure_dirs()
    if not PREFS_FILE.exists():
        return dict(DEFAULT_PREFS)
    try:
        data = json.loads(PREFS_FILE.read_text(encoding="utf-8"))
        return {**DEFAULT_PREFS, **data}
    except Exception:
        return dict(DEFAULT_PREFS)


def _save_prefs(prefs: Dict[str, Any]) -> None:
    _ensure_dirs()
    PREFS_FILE.write_text(
        json.dumps(prefs, ensure_ascii=False, indent=2), encoding="utf-8"
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _should_skip_dir(name: str) -> bool:
    lowered = name.lower()
    return lowered in SKIP_DIR_NAMES or name.startswith(".")


def _count_files(path: str) -> int:
    return len(_collect_indexable_files(path, _load_prefs()["maxFileMiB"]))


def _collect_indexable_files(path: str, max_size_mib: float) -> List[str]:
    """迭代扫描可索引文件，跳过高噪声目录。"""
    max_bytes = int(max_size_mib * 1024 * 1024)
    result: List[str] = []
    stack = [os.path.expanduser(path.strip())]
    while stack:
        current = stack.pop()
        try:
            with os.scandir(current) as it:
                for entry in it:
                    try:
                        if entry.is_dir(follow_symlinks=False):
                            if not _should_skip_dir(entry.name):
                                stack.append(entry.path)
                            continue
                        if not entry.is_file(follow_symlinks=False):
                            continue
                        ext = Path(entry.name).suffix.lower()
                        if ext not in INDEXABLE_EXTENSIONS:
                            continue
                        if entry.stat(follow_symlinks=False).st_size <= max_bytes:
                            result.append(entry.path)
                    except OSError:
                        continue
        except OSError as exc:
            logger.debug("Skip directory during scan %s: %s", current, exc)
    return result


def _rag_storage_mib() -> float:
    rag_dir = PROJECT_ROOT / "storage" / "rag"
    if not rag_dir.exists():
        return 0.0
    total = 0
    try:
        for dirpath, dirnames, filenames in os.walk(rag_dir, topdown=True):
            dirnames[:] = [d for d in dirnames if not _should_skip_dir(d)]
            for fname in filenames:
                try:
                    total += os.path.getsize(os.path.join(dirpath, fname))
                except OSError:
                    pass
    except OSError:
        pass
    return total / (1024 ** 2)


def _sort_files_for_indexing(files: List[str]) -> List[str]:
    """文本类优先，PDF 靠后，让用户更快看到进度。"""
    priority = {
        ".txt": 0, ".md": 0, ".json": 0, ".csv": 0,
        ".docx": 1, ".doc": 1,
        ".pdf": 3,
    }

    def sort_key(path: str) -> tuple:
        ext = Path(path).suffix.lower()
        return (priority.get(ext, 2), path.lower())

    return sorted(files, key=sort_key)


def _already_indexed_paths(doc_ids: List[str]) -> set:
    if not doc_ids:
        return set()
    try:
        from utils.rag_manager import get_rag_manager
        rm = get_rag_manager()
        if not rm:
            return set()
        paths: set = set()
        for doc_id in doc_ids:
            meta = rm.documents_meta.get(doc_id) or {}
            fp = meta.get("filepath")
            if fp:
                paths.add(os.path.normpath(fp))
        return paths
    except Exception:
        return set()


def _update_folder_field(folder_id: str, **kwargs) -> None:
    """原子更新注册表中某个文件夹的字段。"""
    folders = _load_folders()
    for f in folders:
        if f["id"] == folder_id:
            f.update(kwargs)
            break
    _save_folders(folders)


def _reset_index_control(folder_id: str) -> Dict[str, Any]:
    with _index_control_lock:
        control = {"cancel": False, "pause": threading.Event()}
        control["pause"].set()
        _index_control[folder_id] = control
        return control


def _get_index_control(folder_id: str) -> Dict[str, Any]:
    with _index_control_lock:
        control = _index_control.get(folder_id)
        if control is None:
            control = _reset_index_control(folder_id)
        return control


def _clear_index_control(folder_id: str) -> None:
    with _index_control_lock:
        _index_control.pop(folder_id, None)


def _wait_if_paused(folder_id: str) -> bool:
    """暂停时阻塞；返回 False 表示应取消索引。"""
    control = _get_index_control(folder_id)
    while not control["pause"].is_set():
        if control["cancel"]:
            return False
        time.sleep(0.25)
    return not control["cancel"]


def _persist_rag_index(rm: Any) -> None:
    try:
        from utils.rag_manager import PERSIST_DIR
        if rm and rm.index:
            rm.index.storage_context.persist(persist_dir=PERSIST_DIR)
            rm._save_documents_meta()
    except Exception as exc:
        logger.warning("Persist RAG index after stop: %s", exc)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_status() -> Dict[str, Any]:
    """返回真实磁盘使用量 + RAG 索引目录大小（带短 TTL 缓存）。"""
    now = time.time()
    cached = _STATUS_CACHE.get("data")
    if cached is not None and now - float(_STATUS_CACHE.get("ts") or 0) < _STATUS_CACHE_TTL:
        return dict(cached)

    try:
        usage = shutil.disk_usage(str(PROJECT_ROOT))
        total_gib = usage.total / (1024 ** 3)
        free_gib = usage.free / (1024 ** 3)
        used_gib = usage.used / (1024 ** 3)
    except Exception:
        total_gib = free_gib = used_gib = 0.0

    prefs = _load_prefs()
    payload = {
        "disk": {
            "totalGiB": round(total_gib, 1),
            "freeGiB": round(free_gib, 1),
            "usedGiB": round(used_gib, 1),
        },
        "index": {
            "usedMiB": round(_rag_storage_mib(), 1),
            "limitGiB": prefs["storageLimitGiB"],
        },
    }
    _STATUS_CACHE["ts"] = now
    _STATUS_CACHE["data"] = payload
    return payload


def get_folders() -> List[Dict]:
    return _load_folders()


def add_folder(name: str, path: str) -> Dict[str, Any]:
    """
    添加文件夹到注册表。
    验证路径存在且是目录；文件扫描在后台索引线程中执行，避免阻塞 API。
    """
    path = os.path.expanduser(path.strip())
    if not os.path.isdir(path):
        return {"success": False, "error": f"路径不存在或不是目录: {path}"}

    folders = _load_folders()
    for f in folders:
        if os.path.normpath(f["path"]) == os.path.normpath(path):
            return {"success": False, "error": "该路径已添加"}

    entry: Dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "name": name or Path(path).name,
        "path": path,
        "file_count": 0,
        "total_to_index": 0,
        "indexed_count": 0,
        "processed_count": 0,
        "added_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "last_indexed_at": None,
        "status": "pending",
        "doc_ids": [],
        "error_msg": None,
    }
    folders.append(entry)
    _save_folders(folders)
    return {"success": True, "folder": entry}


def remove_folder(folder_id: str) -> Dict[str, Any]:
    """从注册表删除文件夹，并从 RAG 索引中清除对应文档。"""
    folders = _load_folders()
    target = next((f for f in folders if f["id"] == folder_id), None)
    if not target:
        return {"success": False, "error": "文件夹不存在"}
    if target.get("status") in ("indexing", "pending", "paused"):
        cancel_index_folder(folder_id)
        _wait_index_thread(folder_id)

    doc_ids: List[str] = target.get("doc_ids") or []
    if doc_ids:
        try:
            from utils.rag_manager import get_rag_manager
            rm = get_rag_manager()
            if rm:
                rm.delete_documents_batch(doc_ids)
        except Exception as e:
            logger.warning(f"Failed to purge docs from RAG: {e}")

    folders = [f for f in folders if f["id"] != folder_id]
    _save_folders(folders)
    return {"success": True}


def _wait_index_thread(folder_id: str, timeout: float = 10.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        with _index_lock:
            thread = _index_threads.get(folder_id)
            if not thread or not thread.is_alive():
                return
        time.sleep(0.05)


def start_index_folder(folder_id: str) -> None:
    """在独立守护线程中启动索引，避免阻塞 FastAPI worker。"""
    folders = _load_folders()
    target = next((f for f in folders if f["id"] == folder_id), None)
    if target and target.get("status") == "paused":
        return

    with _index_lock:
        existing = _index_threads.get(folder_id)
        if existing and existing.is_alive():
            return
        _reset_index_control(folder_id)
        thread = threading.Thread(
            target=index_folder_background,
            args=(folder_id,),
            daemon=True,
            name=f"computer-index-{folder_id[:8]}",
        )
        _index_threads[folder_id] = thread
        thread.start()


def pause_index_folder(folder_id: str) -> Dict[str, Any]:
    """暂停正在进行的索引（当前文件完成后生效）。"""
    folders = _load_folders()
    target = next((f for f in folders if f["id"] == folder_id), None)
    if not target:
        return {"success": False, "error": "文件夹不存在"}
    if target.get("status") not in ("indexing", "pending"):
        return {"success": False, "error": "当前没有进行中的索引任务"}

    control = _get_index_control(folder_id)
    control["cancel"] = False
    control["pause"].clear()
    _update_folder_field(folder_id, status="paused", error_msg=None)
    return {"success": True}


def resume_index_folder(folder_id: str) -> Dict[str, Any]:
    """从暂停或部分完成状态继续索引。"""
    folders = _load_folders()
    target = next((f for f in folders if f["id"] == folder_id), None)
    if not target:
        return {"success": False, "error": "文件夹不存在"}
    if target.get("status") not in ("paused", "partial"):
        return {"success": False, "error": "当前状态无法继续索引"}

    control = _get_index_control(folder_id)
    control["cancel"] = False
    control["pause"].set()
    _update_folder_field(folder_id, status="indexing", error_msg=None)

    with _index_lock:
        existing = _index_threads.get(folder_id)
        if not existing or not existing.is_alive():
            thread = threading.Thread(
                target=index_folder_background,
                args=(folder_id,),
                daemon=True,
                name=f"computer-index-{folder_id[:8]}",
            )
            _index_threads[folder_id] = thread
            thread.start()
    return {"success": True}


def cancel_index_folder(folder_id: str) -> Dict[str, Any]:
    """取消索引，保留已入库内容。"""
    folders = _load_folders()
    target = next((f for f in folders if f["id"] == folder_id), None)
    if not target:
        return {"success": False, "error": "文件夹不存在"}
    if target.get("status") not in ("indexing", "pending", "paused"):
        return {"success": False, "error": "当前没有可取消的索引任务"}

    control = _get_index_control(folder_id)
    control["cancel"] = True
    control["pause"].set()
    return {"success": True}


def resume_pending_index_jobs() -> None:
    """服务启动时恢复 pending/indexing 状态的文件夹索引。"""
    for folder in _load_folders():
        if folder.get("status") in ("pending", "indexing"):
            start_index_folder(folder["id"])
        elif folder.get("status") == "paused":
            _update_folder_field(folder["id"], status="partial")


def index_folder_background(folder_id: str) -> None:
    """
    后台索引：扫描 → 逐文件 ingest（实时进度）→ 定期 persist。
    支持断点续传；My Computer 默认跳过 PDF OCR 以加速 bulk 索引。
    """
    try:
        folders = _load_folders()
        target = next((f for f in folders if f["id"] == folder_id), None)
        if not target:
            logger.error("Folder %s not found during indexing", folder_id)
            return

        prefs = _load_prefs()
        allow_pdf_ocr = bool(prefs.get("indexPdfOcr", False))

        all_doc_ids: List[str] = list(target.get("doc_ids") or [])
        done_paths = _already_indexed_paths(all_doc_ids)
        already_done = len(done_paths)

        all_files = _sort_files_for_indexing(
            _collect_indexable_files(target["path"], prefs["maxFileMiB"])
        )
        total = len(all_files)
        pending_files = [
            f for f in all_files if os.path.normpath(f) not in done_paths
        ]

        _update_folder_field(
            folder_id,
            status="indexing",
            total_to_index=total,
            file_count=total,
            indexed_count=len(all_doc_ids),
            processed_count=already_done,
            error_msg=None,
        )

        if not all_files:
            _update_folder_field(
                folder_id,
                status="indexed",
                last_indexed_at=time.strftime("%Y-%m-%dT%H:%M:%S"),
                doc_ids=all_doc_ids,
                file_count=0,
                total_to_index=0,
                indexed_count=len(all_doc_ids),
                processed_count=0,
                error_msg=None,
            )
            return

        if not pending_files:
            _update_folder_field(
                folder_id,
                status="indexed",
                last_indexed_at=time.strftime("%Y-%m-%dT%H:%M:%S"),
                doc_ids=all_doc_ids,
                file_count=total,
                total_to_index=total,
                indexed_count=len(all_doc_ids),
                processed_count=total,
            )
            return

        from utils.rag_manager import get_rag_manager
        rm = get_rag_manager()
        if not rm:
            _update_folder_field(
                folder_id,
                status="error",
                error_msg="RAG manager 未初始化（缺少 API Key？）",
            )
            return

        ingest_errors: List[str] = []
        processed = already_done
        stopped = False

        for i, file_path in enumerate(pending_files):
            if not _wait_if_paused(folder_id):
                stopped = True
                break

            processed += 1
            is_last = i == len(pending_files) - 1
            should_persist = is_last or (
                len(all_doc_ids) > 0 and len(all_doc_ids) % PERSIST_EVERY_N_DOCS == 0
            )
            result = rm.ingest_documents(
                [file_path],
                persist=should_persist,
                allow_pdf_ocr=allow_pdf_ocr,
            )

            if result.get("success"):
                batch_ids = [d["id"] for d in result.get("documents", [])]
                all_doc_ids.extend(batch_ids)
            else:
                err = result.get("error", "未知错误")
                if err and "无可用文本" not in str(err):
                    ingest_errors.append(f"{os.path.basename(file_path)}: {err}")

            if processed % 5 == 0 or processed == total:
                _update_folder_field(
                    folder_id,
                    status="indexing",
                    indexed_count=len(all_doc_ids),
                    processed_count=processed,
                    total_to_index=total,
                    file_count=total,
                    doc_ids=all_doc_ids,
                )

            if _get_index_control(folder_id)["cancel"]:
                stopped = True
                break

        if stopped:
            _persist_rag_index(rm)
            _update_folder_field(
                folder_id,
                status="partial",
                doc_ids=all_doc_ids,
                file_count=total,
                total_to_index=total,
                indexed_count=len(all_doc_ids),
                processed_count=processed,
                error_msg=None,
            )
            logger.info(
                "Index cancelled/paused-out for folder %s at %s/%s (%s docs)",
                folder_id,
                processed,
                total,
                len(all_doc_ids),
            )
            return

        if all_doc_ids:
            _update_folder_field(
                folder_id,
                status="indexed",
                last_indexed_at=time.strftime("%Y-%m-%dT%H:%M:%S"),
                doc_ids=all_doc_ids,
                file_count=total,
                total_to_index=total,
                indexed_count=len(all_doc_ids),
                processed_count=total,
                error_msg=("; ".join(ingest_errors[:3]) if ingest_errors else None),
            )
            logger.info(
                "Indexed folder %s: %s/%s files, %s docs",
                folder_id,
                processed,
                total,
                len(all_doc_ids),
            )
        else:
            _update_folder_field(
                folder_id,
                status="error",
                processed_count=processed,
                error_msg=ingest_errors[0] if ingest_errors else "未能写入任何文档",
            )
    except Exception as e:
        logger.error("Background indexing failed for folder %s: %s", folder_id, e, exc_info=True)
        _update_folder_field(folder_id, status="error", error_msg=str(e))
    finally:
        with _index_lock:
            _index_threads.pop(folder_id, None)
        _clear_index_control(folder_id)
        _STATUS_CACHE["ts"] = 0.0
        _STATUS_CACHE["data"] = None


def reindex_folder(folder_id: str) -> Dict[str, Any]:
    """将文件夹重置为 pending 并清除旧 doc_ids。"""
    folders = _load_folders()
    target = next((f for f in folders if f["id"] == folder_id), None)
    if not target:
        return {"success": False, "error": "文件夹不存在"}

    if target.get("status") in ("indexing", "pending", "paused"):
        cancel_index_folder(folder_id)
        _wait_index_thread(folder_id)
        folders = _load_folders()
        target = next((f for f in folders if f["id"] == folder_id), None)
        if not target:
            return {"success": False, "error": "文件夹不存在"}

    old_doc_ids: List[str] = target.get("doc_ids") or []
    if old_doc_ids:
        try:
            from utils.rag_manager import get_rag_manager
            rm = get_rag_manager()
            if rm:
                rm.delete_documents_batch(old_doc_ids)
        except Exception as e:
            logger.warning(f"Failed to purge old docs before reindex: {e}")

    _update_folder_field(
        folder_id,
        status="pending",
        doc_ids=[],
        indexed_count=0,
        processed_count=0,
        error_msg=None,
        last_indexed_at=None,
    )
    return {"success": True}


def get_index_prefs() -> Dict[str, Any]:
    return _load_prefs()


def save_index_prefs(prefs: Dict[str, Any]) -> Dict[str, Any]:
    existing = _load_prefs()
    if "storageLimitGiB" in prefs:
        existing["storageLimitGiB"] = float(prefs["storageLimitGiB"])
    if "maxFileMiB" in prefs:
        existing["maxFileMiB"] = float(prefs["maxFileMiB"])
    if "indexPdfOcr" in prefs:
        existing["indexPdfOcr"] = bool(prefs["indexPdfOcr"])
    _save_prefs(existing)
    return existing


# ---------------------------------------------------------------------------
# Directory browser
# ---------------------------------------------------------------------------

def browse_directory(path: str) -> Dict[str, Any]:
    """列出指定路径下的子目录，用于前端目录树浏览器。"""
    target = os.path.expanduser(path.strip()) if path.strip() else "/"
    if not os.path.isdir(target):
        return {"success": False, "error": f"路径不存在或不是目录: {target}"}

    try:
        entries = []
        with os.scandir(target) as it:
            for entry in it:
                if entry.is_dir(follow_symlinks=False):
                    entries.append({
                        "name": entry.name,
                        "path": entry.path,
                    })
        entries.sort(key=lambda x: x["name"].lower())

        parent = None
        if target != "/":
            p = Path(target).parent
            parent = str(p) if str(p) != target else "/"

        return {
            "success": True,
            "current": target,
            "parent": parent,
            "directories": entries,
        }
    except PermissionError:
        return {"success": False, "error": "没有权限访问该目录"}
    except Exception as e:
        return {"success": False, "error": str(e)}
