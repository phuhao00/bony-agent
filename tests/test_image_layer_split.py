"""Tests for block-based image layer split."""

import os

from PIL import Image

from tools.image_layer_split_tools import (
    LayerSpec,
    _OcrFragment,
    _box_iou,
    _cluster_ocr_fragments,
    _compose_layout_blocks,
    _extract_layer_rgba,
    _merge_layer_specs,
    _parse_layer_specs,
    _should_merge_fragments,
    split_image_to_psd,
)


class TestLayerSplitHelpers:
    def test_parse_layer_specs(self):
        payload = {
            "blocks": [
                {
                    "name": "背景",
                    "type": "background",
                    "x": 0,
                    "y": 0,
                    "width": 1,
                    "height": 1,
                },
                {
                    "name": "产品图",
                    "type": "image",
                    "x": 0.1,
                    "y": 0.2,
                    "width": 0.5,
                    "height": 0.3,
                },
            ]
        }
        specs = _parse_layer_specs(payload)
        assert len(specs) == 2
        assert specs[0].layer_type == "background"
        assert specs[1].layer_type == "image"

    def test_merge_layer_specs_adds_background_and_image(self):
        specs = _merge_layer_specs(
            [LayerSpec("人物", "subject", 0.2, 0.2, 0.5, 0.6)],
            [LayerSpec("标题", "text", 0.1, 0.05, 0.8, 0.08)],
            include_ocr=True,
        )
        assert specs[0].layer_type == "background"
        assert any(s.name == "人物" for s in specs)
        assert any(s.layer_type == "text" for s in specs)

    def test_extract_layer_rgba_background(self):
        source = Image.new("RGBA", (40, 40), (10, 20, 30, 255))
        spec = LayerSpec("背景", "background", 0, 0, 1, 1)
        out = _extract_layer_rgba(source, spec)
        assert out.size == (40, 40)
        assert out.getpixel((0, 0))[:3] == (10, 20, 30)

    def test_filter_layer_specs_removes_overlap(self):
        bg = LayerSpec("背景", "background", 0, 0, 1, 1)
        a = LayerSpec("图片A", "image", 0.2, 0.2, 0.5, 0.5)
        b = LayerSpec("图片B", "image", 0.25, 0.25, 0.45, 0.45)
        from tools.image_layer_split_tools import _dedupe_blocks, MIN_IMAGE_AREA_RATIO, IOU_DEDUP_THRESHOLD

        filtered = [bg] + _dedupe_blocks(
            [a, b],
            min_area=MIN_IMAGE_AREA_RATIO,
            iou_threshold=IOU_DEDUP_THRESHOLD,
        )
        assert len(filtered) == 2
        assert _box_iou(a, b) > 0.4

    def test_ocr_fragment_clustering(self):
        f1 = _OcrFragment(10, 10, 80, 30, "Hello")
        f2 = _OcrFragment(90, 12, 160, 32, "World")
        f3 = _OcrFragment(12, 80, 120, 98, "Line2")
        groups = _cluster_ocr_fragments([f1, f2, f3], 200.0)
        assert len(groups) == 2
        assert _should_merge_fragments(f1, f2, 200.0) is True
        assert _should_merge_fragments(f1, f3, 200.0) is False
        assert len(groups[0]) == 2
        assert len(groups[1]) == 1

    def test_compose_layout_prioritizes_ocr_text(self):
        vision = [
            LayerSpec("背景", "background", 0, 0, 1, 1, z_order=0),
            LayerSpec("插图", "image", 0.1, 0.3, 0.4, 0.4, z_order=2),
        ]
        text = [
            LayerSpec("主标题", "text", 0.1, 0.05, 0.8, 0.1, z_order=100),
            LayerSpec("副标题", "text", 0.1, 0.16, 0.6, 0.06, z_order=101),
        ]
        composed = _compose_layout_blocks(vision, text, include_ocr=True, max_layers=12)
        assert sum(1 for s in composed if s.layer_type == "text") == 2
        assert sum(1 for s in composed if s.layer_type == "image") == 1


class TestSplitImageToPsd:
    def test_split_requires_dashscope(self, tmp_path, monkeypatch):
        import tools.image_edit_tools as edit_mod
        import tools.image_layer_split_tools as split_mod
        import tools.qwen_layered_adapter as qwen_mod

        out_dir = tmp_path / "outputs"
        out_dir.mkdir()
        monkeypatch.setattr(split_mod, "OUTPUT_DIR", str(out_dir))
        monkeypatch.setattr(edit_mod, "OUTPUT_DIR", str(out_dir))
        monkeypatch.setenv("DASHSCOPE_API_KEY", "sk-test")
        monkeypatch.setattr(qwen_mod, "_fuse_layout_blocks", lambda *a, **k: (
            [
                LayerSpec("背景", "background", 0, 0, 1, 1, z_order=0),
                LayerSpec("块", "image", 0.1, 0.1, 0.5, 0.5, z_order=2),
            ],
            {"vlm_blocks": 1, "ocr_blocks": 0, "qr_blocks": 0},
        ))
        monkeypatch.setattr(qwen_mod, "_refine_layout_blocks_vlm", lambda *a, **k: (a[2], 0))
        monkeypatch.setattr(
            qwen_mod,
            "extract_all_layers",
            lambda source, specs, **k: (
                [(specs[0], Image.new("RGBA", source.size, (240, 240, 240, 255))), (specs[1], source.copy())],
                {"generative_background": 1},
            ),
        )

        sample = out_dir / "poster.png"
        Image.new("RGBA", (64, 64), (120, 80, 200, 255)).save(sample)

        result = split_image_to_psd(f"/api/media/{sample.name}", max_layers=8, include_ocr=False)
        assert result["success"] is True
        assert result["filename"].endswith(".psd")
        assert result["layer_count"] >= 2
        assert os.path.isfile(result["local_path"])
        assert result["engine"] == "dashscope-edit"

    def test_missing_url(self):
        result = split_image_to_psd("")
        assert result["success"] is False
