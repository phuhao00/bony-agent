"""Tests for image edit prompt planning and enhancement."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from tools.image_edit_tools import _enhance_instruction_prompt, _looks_like_add_subject_request


def test_add_subject_prompt_is_detected():
    assert _looks_like_add_subject_request("帮我加一只小猪佩奇在图片上")


def test_add_subject_prompt_is_enhanced_with_placement_and_scene_constraints():
    prompt = _enhance_instruction_prompt("帮我加一只小猪佩奇在图片上")
    assert "新增主体" in prompt
    assert "合理遮挡、阴影、透视、光照" in prompt
    assert "粉色卡通小猪" in prompt
    assert "保持原图已有主体" in prompt
