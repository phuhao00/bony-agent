"""Music Production recipe registry."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class RecipeStep:
    id: str
    kind: str
    description: str


@dataclass(frozen=True)
class MusicRecipe:
    id: str
    name: str
    category: str
    description: str
    risk_level: str
    requires_approval: bool
    capability_id: str
    steps: List[RecipeStep] = field(default_factory=list)
    params_schema: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        data["steps"] = [asdict(s) for s in self.steps]
        return data


MUSIC_RECIPES: Dict[str, MusicRecipe] = {
    "music.text_to_music": MusicRecipe(
        id="music.text_to_music",
        name="文本生成音乐",
        category="compose",
        description="根据风格、情绪、时长等描述生成一段完整音乐。",
        risk_level="low",
        requires_approval=False,
        capability_id="music_production",
        params_schema={
            "prompt": {"type": "string", "required": True, "label": "音乐描述"},
            "style": {"type": "string", "required": False, "label": "风格", "default": "流行"},
            "mood": {"type": "string", "required": False, "label": "情绪", "default": "欢快"},
            "duration": {"type": "integer", "required": False, "label": "时长（秒）", "default": 30},
            "instrumental": {"type": "boolean", "required": False, "label": "是否纯音乐", "default": False},
            "structure": {"type": "string", "required": False, "label": "结构标签（Intro,Verse,Chorus...）"},
        },
        steps=[
            RecipeStep("parse", "analyze", "解析音乐需求与风格参数"),
            RecipeStep("compose", "generate", "调用音乐模型生成音频"),
            RecipeStep("deliver", "export", "返回音频文件与元数据"),
        ],
    ),
    "music.lyrics_to_music": MusicRecipe(
        id="music.lyrics_to_music",
        name="歌词生成音乐",
        category="compose",
        description="粘贴歌词，AI 为其谱曲并生成完整歌曲。",
        risk_level="low",
        requires_approval=False,
        capability_id="music_production",
        params_schema={
            "lyrics": {"type": "string", "required": True, "label": "歌词"},
            "style": {"type": "string", "required": False, "label": "风格", "default": "流行"},
            "mood": {"type": "string", "required": False, "label": "情绪", "default": "抒情"},
            "duration": {"type": "integer", "required": False, "label": "时长（秒）", "default": 60},
        },
        steps=[
            RecipeStep("parse", "analyze", "解析歌词结构与情感"),
            RecipeStep("compose", "generate", "根据歌词生成旋律与伴奏"),
            RecipeStep("deliver", "export", "返回歌曲音频与歌词时间轴"),
        ],
    ),
    "music.reference_style": MusicRecipe(
        id="music.reference_style",
        name="参考风格生成",
        category="compose",
        description="上传参考音频，生成相似风格的新音乐。",
        risk_level="low",
        requires_approval=False,
        capability_id="music_production",
        params_schema={
            "prompt": {"type": "string", "required": True, "label": "音乐描述"},
            "reference_url": {"type": "string", "required": True, "label": "参考音频 URL"},
            "style": {"type": "string", "required": False, "label": "风格", "default": "与参考相似"},
            "duration": {"type": "integer", "required": False, "label": "时长（秒）", "default": 30},
        },
        steps=[
            RecipeStep("parse", "analyze", "解析需求与参考音频风格"),
            RecipeStep("compose", "generate", "生成相似风格音乐"),
            RecipeStep("deliver", "export", "返回音频文件"),
        ],
    ),
    "music.bgm_for_video": MusicRecipe(
        id="music.bgm_for_video",
        name="视频配乐生成",
        category="video",
        description="为指定视频或视频主题生成一段可无缝循环的 BGM。",
        risk_level="low",
        requires_approval=False,
        capability_id="music_production",
        params_schema={
            "prompt": {"type": "string", "required": True, "label": "视频主题/情绪"},
            "duration": {"type": "integer", "required": False, "label": "时长（秒）", "default": 30},
            "loop": {"type": "boolean", "required": False, "label": "是否可循环", "default": True},
        },
        steps=[
            RecipeStep("parse", "analyze", "解析视频情绪与节奏需求"),
            RecipeStep("compose", "generate", "生成适配 BGM"),
            RecipeStep("deliver", "export", "返回音频与循环建议"),
        ],
    ),
}


def get_recipe(recipe_id: str) -> Optional[MusicRecipe]:
    return MUSIC_RECIPES.get(recipe_id)


def list_recipes(category: Optional[str] = None) -> List[Dict[str, Any]]:
    recipes = list(MUSIC_RECIPES.values())
    if category:
        recipes = [r for r in recipes if r.category == category]
    return [r.to_dict() for r in recipes]
