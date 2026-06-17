"""
OpenCut 项目持久化存储
"""

import json
import os
import shutil
import uuid
from typing import Dict, List, Optional

from opencut.models import TProject
from utils.logger import setup_logger

logger = setup_logger("opencut_project_store")


class ProjectStore:
    """项目存储管理"""

    def __init__(self, storage_dir: str):
        self.storage_dir = storage_dir
        self.projects_dir = os.path.join(storage_dir, "projects")
        self.exports_dir = os.path.join(storage_dir, "exports")
        self.index_file = os.path.join(storage_dir, "projects_index.json")

        os.makedirs(self.projects_dir, exist_ok=True)
        os.makedirs(self.exports_dir, exist_ok=True)

        self._index: Dict[str, dict] = {}
        self._load_index()

    def _project_file(self, project_id: str) -> str:
        return os.path.join(self.projects_dir, f"{project_id}.json")

    def _load_index(self):
        if os.path.exists(self.index_file):
            try:
                with open(self.index_file, "r", encoding="utf-8") as f:
                    self._index = json.load(f)
            except Exception as e:
                logger.warning("Failed to load project index: %s", e)
                self._index = {}

    def _save_index(self):
        try:
            with open(self.index_file, "w", encoding="utf-8") as f:
                json.dump(self._index, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.warning("Failed to save project index: %s", e)

    def create(self, name: str = "") -> TProject:
        """创建新项目"""
        project = TProject(
            metadata={
                "name": name or "New project",
            }
        )
        # model_post_init 会自动设置 current_scene_id
        self.save(project)
        return project

    def save(self, project: TProject):
        """保存项目"""
        project.metadata.updated_at = __import__("datetime").datetime.utcnow()
        project.version = project.version + 1 if project.version else 1

        data = project.model_dump(by_alias=True, mode="json")
        project_id = project.metadata.id
        project_file = self._project_file(project_id)

        try:
            with open(project_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)

            self._index[project_id] = {
                "id": project_id,
                "name": project.metadata.name,
                "thumbnail": project.metadata.thumbnail or "",
                "duration": project.metadata.duration,
                "updatedAt": project.metadata.updated_at.isoformat(),
                "createdAt": project.metadata.created_at.isoformat(),
            }
            self._save_index()
        except Exception as e:
            logger.error("Failed to save project %s: %s", project_id, e)
            raise

    def load(self, project_id: str) -> Optional[TProject]:
        """加载项目"""
        project_file = self._project_file(project_id)
        if not os.path.exists(project_file):
            return None
        try:
            with open(project_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            return TProject.model_validate(data)
        except Exception as e:
            logger.error("Failed to load project %s: %s", project_id, e)
            return None

    def delete(self, project_id: str) -> bool:
        """删除项目"""
        project_file = self._project_file(project_id)
        if os.path.exists(project_file):
            try:
                os.remove(project_file)
            except Exception as e:
                logger.warning("Failed to delete project file: %s", e)
        if project_id in self._index:
            del self._index[project_id]
            self._save_index()
            return True
        return False

    def list_all(self) -> List[dict]:
        """列出所有项目摘要"""
        return list(self._index.values())

    def export_path(self, project_id: str, suffix: str = ".mp4") -> str:
        """生成导出文件路径"""
        return os.path.join(self.exports_dir, f"{project_id}_{uuid.uuid4()}{suffix}")

    def frame_path(self, project_id: str, time: float, suffix: str = ".png") -> str:
        """生成帧缓存路径"""
        return os.path.join(self.exports_dir, f"{project_id}_frame_{int(time * 1000)}{suffix}")

    def cleanup_frames(self, project_id: str):
        """清理项目的帧缓存"""
        for fname in os.listdir(self.exports_dir):
            if fname.startswith(f"{project_id}_frame_"):
                try:
                    os.remove(os.path.join(self.exports_dir, fname))
                except Exception as e:
                    logger.warning("Failed to remove frame cache: %s", e)
