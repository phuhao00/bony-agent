"""Media tool facade.

Use this package for new imports. The implementation stays in the legacy
modules to preserve compatibility with existing agents and API routes.
"""

from ..audio_tools import (
    add_audio_to_video,
    extract_audio_from_video,
    generate_narration_script,
    generate_speech,
    transcribe_audio_glm_asr,
    transcribe_audio_whisper,
)
from ..image_tools import generate_image
from ..media_common import (
    OUTPUT_DIR,
    PROJECT_ROOT,
    TEMP_DIR,
    UPLOAD_DIR,
    download_file,
    get_video_duration,
    save_upload_file,
)
from ..remix_tools import ai_remix_videos, remix_videos
from ..subtitle_tools import add_subtitles_to_video, generate_subtitle_for_video
from ..video_tools import (
    generate_video,
    generate_video_from_image,
    generate_video_from_image_internal,
    generate_video_internal,
)

__all__ = [
    "OUTPUT_DIR",
    "PROJECT_ROOT",
    "TEMP_DIR",
    "UPLOAD_DIR",
    "add_audio_to_video",
    "add_subtitles_to_video",
    "ai_remix_videos",
    "download_file",
    "extract_audio_from_video",
    "generate_image",
    "generate_narration_script",
    "generate_speech",
    "generate_subtitle_for_video",
    "generate_video",
    "generate_video_from_image",
    "generate_video_from_image_internal",
    "generate_video_internal",
    "get_video_duration",
    "remix_videos",
    "save_upload_file",
    "transcribe_audio_glm_asr",
    "transcribe_audio_whisper",
]
