"""
媒体资源管理

参考 OpenCut classic 的 MediaAssetData 概念，但适配当前工程的文件系统。
"""

import os
import shutil
import subprocess
import uuid
from typing import Any, Dict, List, Optional

from utils.logger import setup_logger

logger = setup_logger("opencut_media_asset")


class MediaAssetData:
    """媒体资源元数据"""

    def __init__(
        self,
        asset_id: str = "",
        name: str = "",
        file_path: str = "",
        asset_type: str = "video",  # video | image | audio
        duration: float = 0.0,
        width: int = 0,
        height: int = 0,
        fps: float = 30.0,
        thumbnail_path: str = "",
        waveform_path: str = "",
        metadata: Optional[Dict[str, Any]] = None,
    ):
        self.asset_id = asset_id or str(uuid.uuid4())
        self.name = name
        self.file_path = file_path
        self.asset_type = asset_type
        self.duration = duration
        self.width = width
        self.height = height
        self.fps = fps
        self.thumbnail_path = thumbnail_path
        self.waveform_path = waveform_path
        self.metadata = metadata or {}

    def to_dict(self) -> Dict[str, Any]:
        return {
            "assetId": self.asset_id,
            "name": self.name,
            "filePath": self.file_path,
            "assetType": self.asset_type,
            "duration": self.duration,
            "width": self.width,
            "height": self.height,
            "fps": self.fps,
            "thumbnailPath": self.thumbnail_path,
            "waveformPath": self.waveform_path,
            "metadata": self.metadata,
        }

    def to_frontend_dict(self) -> Dict[str, Any]:
        """前端友好的字段命名"""
        return {
            "assetId": self.asset_id,
            "name": self.name,
            "path": self.file_path,
            "assetType": self.asset_type,
            "duration": self.duration,
            "width": self.width,
            "height": self.height,
            "fps": self.fps,
            "thumbnailPath": self.thumbnail_path,
            "waveformPath": self.waveform_path,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "MediaAssetData":
        return cls(
            asset_id=data.get("assetId", ""),
            name=data.get("name", ""),
            file_path=data.get("filePath", ""),
            asset_type=data.get("assetType", "video"),
            duration=float(data.get("duration", 0) or 0),
            width=int(data.get("width", 0) or 0),
            height=int(data.get("height", 0) or 0),
            fps=float(data.get("fps", 30) or 30),
            thumbnail_path=data.get("thumbnailPath", ""),
            waveform_path=data.get("waveformPath", ""),
            metadata=data.get("metadata", {}),
        )


class MediaAssetManager:
    """媒体资源管理器"""

    def __init__(self, storage_dir: str):
        self.storage_dir = storage_dir
        self.assets_dir = os.path.join(storage_dir, "assets")
        self.thumbnails_dir = os.path.join(storage_dir, "thumbnails")
        self.waveforms_dir = os.path.join(storage_dir, "waveforms")
        self.index_file = os.path.join(storage_dir, "assets_index.json")

        os.makedirs(self.assets_dir, exist_ok=True)
        os.makedirs(self.thumbnails_dir, exist_ok=True)
        os.makedirs(self.waveforms_dir, exist_ok=True)

        self._assets: Dict[str, MediaAssetData] = {}
        self._load_index()

    def _load_index(self):
        import json
        if os.path.exists(self.index_file):
            try:
                with open(self.index_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for item in data:
                    asset = MediaAssetData.from_dict(item)
                    self._assets[asset.asset_id] = asset
            except Exception as e:
                logger.warning("Failed to load media asset index: %s", e)

    def _save_index(self):
        import json
        try:
            with open(self.index_file, "w", encoding="utf-8") as f:
                json.dump([a.to_dict() for a in self._assets.values()], f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.warning("Failed to save media asset index: %s", e)

    def register(self, source_path: str, name: str = "", asset_type: str = "") -> MediaAssetData:
        """注册一个已存在的媒体文件"""
        if not os.path.exists(source_path):
            raise FileNotFoundError(f"Media file not found: {source_path}")

        if not name:
            name = os.path.basename(source_path)

        if not asset_type:
            ext = os.path.splitext(source_path)[1].lower()
            if ext in [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]:
                asset_type = "image"
            elif ext in [".mp3", ".wav", ".aac", ".flac", ".m4a", ".ogg"]:
                asset_type = "audio"
            else:
                asset_type = "video"

        asset_id = str(uuid.uuid4())
        target_path = os.path.join(self.assets_dir, f"{asset_id}_{os.path.basename(source_path)}")
        shutil.copy2(source_path, target_path)

        duration, width, height, fps = self._probe_media(target_path, asset_type)

        thumbnail_path = ""
        waveform_path = ""
        if asset_type in ["video", "image"]:
            thumbnail_path = self._generate_thumbnail(target_path, asset_type)
        if asset_type == "audio":
            waveform_path = self._generate_waveform(target_path)

        asset = MediaAssetData(
            asset_id=asset_id,
            name=name,
            file_path=target_path,
            asset_type=asset_type,
            duration=duration,
            width=width,
            height=height,
            fps=fps,
            thumbnail_path=thumbnail_path,
            waveform_path=waveform_path,
        )
        self._assets[asset_id] = asset
        self._save_index()
        return asset

    def _probe_media(self, file_path: str, asset_type: str) -> tuple:
        """使用 ffprobe 获取媒体信息"""
        duration = 0.0
        width = 0
        height = 0
        fps = 30.0

        if not shutil.which("ffprobe"):
            return duration, width, height, fps

        try:
            if asset_type == "image":
                result = subprocess.run(
                    ["ffprobe", "-v", "error", "-select_streams", "v:0",
                     "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", file_path],
                    capture_output=True, text=True, check=True,
                )
                parts = result.stdout.strip().split("x")
                if len(parts) == 2:
                    width, height = int(parts[0]), int(parts[1])
                return 0.0, width, height, fps

            result = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", file_path],
                capture_output=True, text=True, check=True,
            )
            duration = float(result.stdout.strip() or 0)

            result = subprocess.run(
                ["ffprobe", "-v", "error", "-select_streams", "v:0",
                 "-show_entries", "stream=width,height,r_frame_rate", "-of", "csv=p=0", file_path],
                capture_output=True, text=True, check=True,
            )
            # output: width,height,num/den
            lines = result.stdout.strip().split("\n")
            if lines and lines[0]:
                parts = lines[0].split(",")
                if len(parts) >= 2:
                    width = int(parts[0]) if parts[0] else 0
                    height = int(parts[1]) if parts[1] else 0
                if len(parts) >= 3:
                    fps_str = parts[2]
                    if "/" in fps_str:
                        num, den = fps_str.split("/")
                        fps = float(num) / float(den) if float(den) else 30.0
                    else:
                        fps = float(fps_str) if fps_str else 30.0
        except Exception as e:
            logger.warning("Failed to probe media %s: %s", file_path, e)

        return duration, width, height, fps

    def _generate_thumbnail(self, file_path: str, asset_type: str) -> str:
        if not shutil.which("ffmpeg"):
            return ""
        try:
            thumb_path = os.path.join(self.thumbnails_dir, f"{uuid.uuid4()}.jpg")
            if asset_type == "image":
                cmd = ["ffmpeg", "-y", "-i", file_path, "-vf", "scale=320:-1", "-q:v", "2", thumb_path]
            else:
                cmd = ["ffmpeg", "-y", "-i", file_path, "-ss", "00:00:00.100",
                       "-vframes", "1", "-vf", "scale=320:-1", "-q:v", "2", thumb_path]
            subprocess.run(cmd, capture_output=True, check=True)
            return thumb_path
        except Exception as e:
            logger.warning("Failed to generate thumbnail: %s", e)
            return ""

    def _generate_waveform(self, file_path: str) -> str:
        """生成音频波形图（PNG）"""
        if not shutil.which("ffmpeg"):
            return ""
        try:
            wave_path = os.path.join(self.waveforms_dir, f"{uuid.uuid4()}.png")
            cmd = [
                "ffmpeg", "-y", "-i", file_path,
                "-filter_complex", "aformat=channel_layouts=mono,showwavespic=s=800x200:colors=#ffffff",
                "-frames:v", "1", wave_path,
            ]
            subprocess.run(cmd, capture_output=True, check=True)
            return wave_path
        except Exception as e:
            logger.warning("Failed to generate waveform: %s", e)
            return ""

    def get(self, asset_id: str) -> Optional[MediaAssetData]:
        return self._assets.get(asset_id)

    def list_all(self) -> List[MediaAssetData]:
        return list(self._assets.values())

    def delete(self, asset_id: str) -> bool:
        asset = self._assets.pop(asset_id, None)
        if asset:
            try:
                if asset.file_path and os.path.exists(asset.file_path):
                    os.remove(asset.file_path)
                if asset.thumbnail_path and os.path.exists(asset.thumbnail_path):
                    os.remove(asset.thumbnail_path)
                if asset.waveform_path and os.path.exists(asset.waveform_path):
                    os.remove(asset.waveform_path)
            except Exception as e:
                logger.warning("Failed to delete asset files: %s", e)
            self._save_index()
            return True
        return False
