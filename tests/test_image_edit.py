"""Unit tests for image edit tools."""

from tools.image_edit_tools import (
    MAX_REFERENCE_IMAGES,
    MODE_TO_FUNCTION,
    VALID_MODES,
    WAN25_I2I_MODEL,
    _build_dashscope_edit_body,
    _build_wan25_reference_body,
    compose_inpaint_reference_prompt,
    compose_inpaint_refine_prompt,
    compose_reference_prompt,
    compose_watermark_prompt,
    composite_reference_into_mask,
    _extract_edit_result_urls,
    _local_path_from_url,
    _resolve_prompt,
    validate_edit_request,
)
from PIL import Image, ImageDraw


class TestValidateEditRequest:
    def test_invalid_mode(self):
        assert validate_edit_request("foo", "test", "") is not None

    def test_inpaint_requires_mask(self):
        err = validate_edit_request("inpaint", "add hat", "")
        assert err is not None
        assert "mask" in err.lower()

    def test_remove_requires_mask(self):
        err = validate_edit_request("remove", "", "")
        assert err is not None

    def test_instruction_requires_prompt(self):
        err = validate_edit_request("instruction", "", "")
        assert err is not None

    def test_valid_instruction(self):
        assert validate_edit_request("instruction", "change sky", "") is None

    def test_valid_inpaint(self):
        assert validate_edit_request("inpaint", "red hat", "http://x/m.png") is None

    def test_inpaint_replace_with_ref_no_prompt(self):
        assert validate_edit_request(
            "inpaint",
            "",
            "http://x/m.png",
            ["http://x/ref.png"],
        ) is None

    def test_inpaint_replace_too_many_refs(self):
        err = validate_edit_request(
            "inpaint",
            "",
            "http://x/m.png",
            ["http://x/r1.png", "http://x/r2.png"],
        )
        assert err is not None
        assert "最多" in err

    def test_valid_outpaint(self):
        assert validate_edit_request("outpaint", "extend", "") is None

    def test_watermark_prompt_optional(self):
        assert validate_edit_request("watermark", "", "") is None

    def test_watermark_area_requires_mask(self):
        err = validate_edit_request("watermark", "", "", watermark_mode="area")
        assert err is not None
        assert "涂抹" in err

    def test_watermark_text_requires_content(self):
        err = validate_edit_request("watermark", "", "", watermark_mode="text")
        assert err is not None
        assert "文字" in err

    def test_watermark_text_valid(self):
        assert validate_edit_request(
            "watermark", "", "", watermark_mode="text", watermark_text="sample.com"
        ) is None

    def test_compose_watermark_prompt_text(self):
        text = compose_watermark_prompt("", target_text="一泽达", watermark_mode="text")
        assert "一泽达" in text
        assert "硬性约束" in text

    def test_compose_watermark_prompt_area(self):
        text = compose_watermark_prompt("", watermark_mode="area")
        assert "涂抹区域" in text

    def test_watermark_dashscope_uses_mask_function(self):
        body = _build_dashscope_edit_body(
            model_id="wanx2.1-imageedit",
            mode="watermark",
            prompt="去除水印",
            source_ref="data:image/png;base64,abc",
            mask_ref="data:image/png;base64,mask",
        )
        assert body["input"]["function"] == "description_edit_with_mask"
        assert body["input"]["mask_image_url"] == "data:image/png;base64,mask"

    def test_watermark_dashscope_text_uses_description_edit(self):
        body = _build_dashscope_edit_body(
            model_id="wanx2.1-imageedit",
            mode="watermark",
            prompt="去除文字一泽达",
            source_ref="data:image/png;base64,abc",
            mask_ref="data:image/png;base64,mask",
            watermark_mode="text",
            strength=0.5,
        )
        assert body["input"]["function"] == "description_edit_with_mask"
        assert body["input"]["mask_image_url"] == "data:image/png;base64,mask"

    def test_locate_target_in_ocr_blocks_partial(self):
        from tools.image_edit_tools import _locate_target_in_ocr_blocks

        blocks = [{
            "text": "一泽达国际物流供应链",
            "x": 0.1,
            "y": 0.05,
            "width": 0.8,
            "height": 0.08,
        }]
        boxes = _locate_target_in_ocr_blocks(blocks, "一泽达")
        assert len(boxes) == 1
        assert boxes[0]["x"] >= 0.1
        assert boxes[0]["width"] < 0.8

    def test_locate_target_fuzzy_ocr_split(self):
        from tools.image_edit_tools import _locate_target_in_ocr_blocks

        blocks = [{
            "text": "一泽达国际",
            "x": 0.61,
            "y": 0.04,
            "width": 0.18,
            "height": 0.07,
        }]
        boxes = _locate_target_in_ocr_blocks(blocks, "一泽达")
        assert len(boxes) == 1

    def test_locate_all_occurrences_with_pinyin(self):
        from tools.image_edit_tools import _locate_target_in_ocr_blocks

        blocks = [
            {"text": "泽达国际", "x": 0.169, "y": 0.043, "width": 0.154, "height": 0.07},
            {"text": "一泽达国际", "x": 0.616, "y": 0.043, "width": 0.18, "height": 0.07},
            {
                "text": "YIZEDA INTERNATIONAL LOGISTICS SUPPLY CHAIN",
                "x": 0.136,
                "y": 0.17,
                "width": 0.189,
                "height": 0.019,
            },
            {
                "text": "YIZEDA INTERNATIONAL LOGISTICS SUPPLY CHAIN",
                "x": 0.612,
                "y": 0.171,
                "width": 0.184,
                "height": 0.019,
            },
        ]
        exact = _locate_target_in_ocr_blocks(blocks, "一泽达", include_aliases=False)
        assert len(exact) >= 2
        with_alias = _locate_target_in_ocr_blocks(blocks, "一泽达", include_aliases=True)
        assert len(with_alias) >= len(exact)

    def test_resolve_watermark_routing_auto_to_text(self):
        from tools.image_edit_tools import _resolve_watermark_routing

        mode, target, extra, aliases = _resolve_watermark_routing(
            "auto", "", "一泽达", ""
        )
        assert mode == "text"
        assert target == "一泽达"
        assert extra == ""
        assert aliases is False

    def test_resolve_watermark_routing_text_from_prompt(self):
        from tools.image_edit_tools import _resolve_watermark_routing

        mode, target, extra, _ = _resolve_watermark_routing(
            "text", "", "一泽达", ""
        )
        assert mode == "text"
        assert target == "一泽达"

    def test_render_text_removal_mask(self):
        from tools.image_edit_tools import _render_text_removal_mask

        mask = _render_text_removal_mask(100, 100, [{"x": 0.1, "y": 0.1, "width": 0.2, "height": 0.1}])
        assert mask.size == (100, 100)
        assert max(mask.getdata()) == 255
        assert min(mask.getdata()) == 0

    def test_validate_text_removal_boxes_rejects_huge(self):
        from tools.image_edit_tools import _validate_text_removal_boxes

        huge = [{"x": 0.0, "y": 0.0, "width": 0.9, "height": 0.5}]
        assert _validate_text_removal_boxes(huge) == []
        ok = [{"x": 0.1, "y": 0.05, "width": 0.15, "height": 0.08}]
        assert len(_validate_text_removal_boxes(ok)) == 1
        multi = [
            {"x": 0.1, "y": 0.05, "width": 0.12, "height": 0.06},
            {"x": 0.6, "y": 0.05, "width": 0.12, "height": 0.06},
            {"x": 0.1, "y": 0.17, "width": 0.08, "height": 0.02},
        ]
        assert len(_validate_text_removal_boxes(multi)) == 3

    def test_local_inpaint_text_regions(self):
        from tools.image_edit_tools import _local_inpaint_text_regions

        img = Image.new("RGB", (80, 40), (20, 40, 120))
        draw = ImageDraw.Draw(img)
        draw.text((10, 10), "TEST", fill=(255, 220, 0))
        mask = Image.new("L", (80, 40), 0)
        ImageDraw.Draw(mask).rectangle([8, 6, 52, 28], fill=255)
        out = _local_inpaint_text_regions(img, mask)
        assert out.size == (80, 40)

    def test_resolve_watermark_edit_strength_caps_default(self):
        from tools.image_edit_tools import _resolve_watermark_edit_strength

        assert _resolve_watermark_edit_strength("text", 0.5) == 0.35
        assert _resolve_watermark_edit_strength("text", 0.3) == 0.3
        assert _resolve_watermark_edit_strength("auto", 0.5) == 0.5

    def test_upscale_prompt_optional(self):
        assert validate_edit_request("upscale", "", "") is None

    def test_style_global_requires_prompt(self):
        assert validate_edit_request("style_global", "", "") is not None

    def test_reference_requires_refs(self):
        err = validate_edit_request("reference", "apply style from ref", "")
        assert err is not None
        assert "参考图" in err

    def test_reference_too_many_refs(self):
        err = validate_edit_request(
            "reference",
            "test",
            "",
            ["http://a/1.png", "http://a/2.png", "http://a/3.png"],
        )
        assert err is not None

    def test_valid_reference(self):
        assert validate_edit_request(
            "reference",
            "参考图2风格",
            "",
            ["http://a/ref.png"],
        ) is None

    def test_reference_needs_prompt_or_target(self):
        err = validate_edit_request("reference", "", "", ["http://a/ref.png"], "")
        assert err is not None


class TestComposeInpaintReferencePrompt:
    def test_includes_mask_and_reference(self):
        text = compose_inpaint_reference_prompt("边缘自然融合")
        assert "蒙版" in text
        assert "粘贴" in text
        assert "边缘自然融合" in text

    def test_refine_prompt(self):
        text = compose_inpaint_refine_prompt("统一插画风")
        assert "融合" in text
        assert "统一插画风" in text


class TestCompositeReferenceIntoMask:
    def test_pastes_reference_in_mask_bbox(self):
        source = Image.new("RGBA", (100, 100), (10, 10, 10, 255))
        mask = Image.new("L", (100, 100), 0)
        for x in range(20, 60):
            for y in range(30, 70):
                mask.putpixel((x, y), 255)
        reference = Image.new("RGB", (80, 40), (200, 50, 50))
        out = composite_reference_into_mask(source, mask.convert("RGBA"), reference, feather=0)
        assert out.getpixel((40, 50))[:3] == (200, 50, 50)
        assert out.getpixel((5, 5))[:3] == (10, 10, 10)

    def test_rgba_black_background_does_not_treat_as_full_mask(self):
        """Frontend exports black RGBA pixels with alpha=255 outside strokes."""
        source = Image.new("RGBA", (100, 100), (10, 10, 10, 255))
        mask = Image.new("RGBA", (100, 100), (0, 0, 0, 255))
        for x in range(20, 60):
            for y in range(30, 70):
                mask.putpixel((x, y), (255, 255, 255, 255))
        reference = Image.new("RGB", (80, 40), (200, 50, 50))
        out = composite_reference_into_mask(source, mask, reference, feather=0)
        assert out.getpixel((40, 50))[:3] == (200, 50, 50)
        assert out.getpixel((5, 5))[:3] == (10, 10, 10)

    def test_rejects_unchanged_composite(self):
        source = Image.new("RGBA", (50, 50), (100, 100, 100, 255))
        mask = Image.new("L", (50, 50), 0)
        mask.putpixel((25, 25), 255)
        reference = Image.new("RGB", (20, 20), (100, 100, 100))
        import pytest

        with pytest.raises(ValueError, match="未能贴入"):
            composite_reference_into_mask(source, mask.convert("RGBA"), reference, feather=0)

    def test_rejects_full_frame_mask(self):
        source = Image.new("RGBA", (100, 100), (10, 10, 10, 255))
        mask = Image.new("L", (100, 100), 255)
        reference = Image.new("RGB", (40, 40), (200, 50, 50))
        import pytest

        with pytest.raises(ValueError, match="覆盖面积过大"):
            composite_reference_into_mask(source, mask.convert("RGBA"), reference, feather=0)

    def test_contain_scales_reference_inside_small_bbox(self):
        source = Image.new("RGBA", (200, 200), (10, 10, 10, 255))
        mask = Image.new("L", (200, 200), 0)
        for x in range(80, 120):
            for y in range(80, 120):
                mask.putpixel((x, y), 255)
        reference = Image.new("RGB", (400, 100), (255, 128, 0))
        out = composite_reference_into_mask(
            source,
            mask.convert("RGBA"),
            reference,
            feather=0,
            fit_mode="contain",
        )
        assert out.getpixel((100, 100))[:3] == (255, 128, 0)
        assert out.getpixel((10, 10))[:3] == (10, 10, 10)
        assert out.getpixel((150, 150))[:3] == (10, 10, 10)


class TestComposeReferencePrompt:
    def test_replace_material_with_target(self):
        text = compose_reference_prompt(
            intent="replace_material",
            user_prompt="用图2的花瓶替换",
            reference_target="图1桌面上的花瓶",
            reference_roles=["material"],
            ref_count=1,
        )
        assert "素材替换" in text
        assert "图1桌面上的花瓶" in text
        assert "图2" in text

    def test_recompose_layout_unlocks(self):
        text = compose_reference_prompt(
            intent="recompose_layout",
            user_prompt="重新排列产品",
            ref_count=2,
        )
        assert "布局重组" in text


class TestModeToFunction:
    def test_all_modes_mapped(self):
        for mode in VALID_MODES:
            if mode == "reference":
                continue
            assert mode in MODE_TO_FUNCTION

    def test_instruction_function(self):
        assert MODE_TO_FUNCTION["instruction"] == "description_edit"

    def test_style_global_function(self):
        assert MODE_TO_FUNCTION["style_global"] == "stylization_all"

    def test_upscale_function(self):
        assert MODE_TO_FUNCTION["upscale"] == "super_resolution"

    def test_watermark_function(self):
        assert MODE_TO_FUNCTION["watermark"] == "remove_watermark"


class TestResolvePrompt:
    def test_remove_default(self):
        assert "移除" in _resolve_prompt("remove", "")

    def test_watermark_default(self):
        assert _resolve_prompt("watermark", "") == "去除图像中的文字水印"


class TestBuildDashscopeBody:
    def test_instruction_body(self):
        body = _build_dashscope_edit_body(
            model_id="wanx2.1-imageedit",
            mode="instruction",
            prompt="make it blue",
            source_ref="data:image/png;base64,abc",
        )
        assert body["model"] == "wanx2.1-imageedit"
        assert body["input"]["function"] == "description_edit"
        assert body["input"]["base_image_url"] == "data:image/png;base64,abc"
        assert "mask_image_url" not in body["input"]
        assert body["parameters"]["strength"] == 0.5

    def test_inpaint_includes_mask(self):
        body = _build_dashscope_edit_body(
            model_id="wanx2.1-imageedit",
            mode="inpaint",
            prompt="hat",
            source_ref="data:image/png;base64,abc",
            mask_ref="data:image/png;base64,mask",
        )
        assert body["input"]["function"] == "description_edit_with_mask"
        assert body["input"]["mask_image_url"] == "data:image/png;base64,mask"

    def test_outpaint_scales(self):
        body = _build_dashscope_edit_body(
            model_id="wanx2.1-imageedit",
            mode="outpaint",
            prompt="extend",
            source_ref="data:image/png;base64,abc",
            expand_top=1.5,
            expand_left=1.2,
        )
        assert body["input"]["function"] == "expand"
        assert body["parameters"]["top_scale"] == 1.5
        assert body["parameters"]["left_scale"] == 1.2

    def test_upscale_factor(self):
        body = _build_dashscope_edit_body(
            model_id="wanx2.1-imageedit",
            mode="upscale",
            prompt="图像超分",
            source_ref="data:image/png;base64,abc",
            upscale_factor=3,
        )
        assert body["input"]["function"] == "super_resolution"
        assert body["parameters"]["upscale_factor"] == 3

    def test_variant_count(self):
        body = _build_dashscope_edit_body(
            model_id="wanx2.1-imageedit",
            mode="instruction",
            prompt="test",
            source_ref="data:image/png;base64,abc",
            n=3,
            seed=42,
        )
        assert body["parameters"]["n"] == 3
        assert body["parameters"]["seed"] == 42


class TestBuildWan25ReferenceBody:
    def test_reference_body_order(self):
        body = _build_wan25_reference_body(
            prompt="参考图2修改图1",
            source_ref="data:image/png;base64,src",
            reference_refs=[
                "data:image/png;base64,ref1",
                "data:image/png;base64,ref2",
            ],
            n=2,
            seed=99,
        )
        assert body["model"] == WAN25_I2I_MODEL
        assert body["input"]["images"] == [
            "data:image/png;base64,src",
            "data:image/png;base64,ref1",
            "data:image/png;base64,ref2",
        ]
        assert body["parameters"]["n"] == 2
        assert body["parameters"]["seed"] == 99


class TestExtractResultUrls:
    def test_multiple_urls(self):
        urls = _extract_edit_result_urls({
            "results": [{"url": "http://a/1.png"}, {"url": "http://a/2.png"}],
        })
        assert urls == ["http://a/1.png", "http://a/2.png"]


class TestLocalPathFromUrl:
    def test_api_media_path(self, tmp_path, monkeypatch):
        import tools.image_edit_tools as mod

        out_file = tmp_path / "test.png"
        out_file.write_bytes(b"png")
        monkeypatch.setattr(mod, "OUTPUT_DIR", str(tmp_path))
        path = _local_path_from_url("/api/media/test.png")
        assert path == str(out_file)

    def test_data_uri_returns_none(self):
        assert _local_path_from_url("data:image/png;base64,xx") is None
