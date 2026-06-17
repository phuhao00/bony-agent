"""
多媒体工具集 (Facade)
该模块现在作为统一入口，从各个子模块导入功能。
实际实现已拆分到:
- media_common.py: 通用基础设施
- image_tools.py: 图像生成
- video_tools.py: 视频生成
- audio_tools.py: 音频/TTS/ASR
- subtitle_tools.py: 字幕生成与处理
- remix_tools.py: 视频混剪与AI编排
"""

# Re-export everything from sub-modules using relative imports for robustness
from .media_common import (
    MEDIA_REGISTRY, OUTPUT_DIR, TEMP_DIR, PROJECT_ROOT, UPLOAD_DIR,
    PROVIDER_CAPABILITIES,
    _resolve_provider, _check_provider_capability, _get_provider_api_key,
    load_media_registry, save_media_registry, download_file, get_video_duration,
    save_upload_file
)

from .image_tools import (
    generate_image
)

from .image_edit_tools import (
    edit_image,
    validate_edit_request,
    resolve_image_reference,
    save_mask_bytes,
)

from .video_tools import (
    generate_video,
    generate_video_from_image,
    generate_video_internal,
    generate_video_from_image_internal,
    generate_happyhorse_t2v_internal,
    generate_happyhorse_i2v_internal,
)

from .audio_tools import (
    generate_speech,
    generate_speech_edge_tts,
    generate_speech_pyttsx3,
    generate_narration_script,
    add_audio_to_video,
    extract_audio_from_video,
    transcribe_audio_whisper,
    transcribe_audio_glm_asr,
    get_available_bgm,
    VOICE_OPTIONS,
    NARRATION_STYLES,
    PRESET_BGM,
    BGM_DIR
)

from .subtitle_tools import (
    generate_subtitle_for_video,
    add_subtitle_to_prompt,
    generate_subtitle_text,
    generate_subtitle_image,
    overlay_subtitle_on_video,
    add_subtitles_from_asr,
    create_srt_file,
    burn_subtitles_with_pillow,
    add_subtitles_to_video,
    add_subtitles_drawtext,
    SUBTITLE_STYLES
)

from .remix_tools import (
    remix_videos,
    ai_remix_videos,
    analyze_image_content,
    generate_fusion_prompt,
    generate_remix_script
)

from .opencut_tools import (
    cut_video_segment,
    split_video,
    merge_clips,
    change_video_speed,
    overlay_video,
    add_text_overlay,
    apply_video_filter,
    extract_audio_track,
    replace_audio_track,
    generate_opencut_project,
    execute_edit_script,
)

from .opencut_bridge import OpenCutClient

# 保持 logger 以防万一
from utils.logger import setup_logger
logger = setup_logger("media_tools")
