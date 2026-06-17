"""Tests for DashScope precision PSD layer split pipeline."""

import os
from PIL import Image

from tools.image_layer_split_tools import (
    LayerSpec,
    _build_layer_stack,
    _fuse_layout_blocks,
    _write_multi_layer_psd,
)
from tools.qwen_layered_adapter import (
    get_qwen_layered_status,
    is_qwen_layered_available,
    split_with_qwen_layered,
)


class TestQwenLayeredStatus:
    def test_not_available_without_key(self, monkeypatch):
        monkeypatch.delenv("DASHSCOPE_API_KEY", raising=False)
        monkeypatch.delenv("ALIBABA_API_KEY", raising=False)
        assert is_qwen_layered_available() is False
        status = get_qwen_layered_status()
        assert status["ready"] is False
        assert status["provider"] == "dashscope"
        assert "pipeline_stages" in status

    def test_available_with_key(self, monkeypatch):
        monkeypatch.setenv("DASHSCOPE_API_KEY", "sk-test")
        assert is_qwen_layered_available() is True
        status = get_qwen_layered_status()
        assert status["ready"] is True
        assert status["provider"] == "dashscope"


class TestFuseLayout:
    def test_qr_and_icon_in_stack(self):
        source = Image.new("RGBA", (200, 200), (255, 255, 255, 255))
        specs = [
            LayerSpec("背景", "background", 0, 0, 1, 1, z_order=0),
            LayerSpec("产品", "image", 0.1, 0.2, 0.3, 0.3, z_order=2),
            LayerSpec("二维码", "qr", 0.7, 0.7, 0.15, 0.15, z_order=50),
            LayerSpec("图标", "icon", 0.1, 0.8, 0.05, 0.05, z_order=40),
            LayerSpec("标题", "text", 0.1, 0.05, 0.5, 0.08, z_order=100),
        ]
        stack = _build_layer_stack(source, specs)
        types = [s.layer_type for s, _ in stack]
        assert "qr" in types
        assert "icon" in types
        assert types.index("background") == 0


class TestSplitPipeline:
    def test_split_mock_pipeline(self, tmp_path, monkeypatch):
        import tools.image_layer_split_tools as split_mod
        import tools.media_common as media_mod
        import tools.qwen_layered_adapter as mod
        from tools.image_layer_split_tools import LayerSpec

        out_dir = tmp_path / "outputs"
        out_dir.mkdir()
        monkeypatch.setattr(media_mod, "OUTPUT_DIR", str(out_dir))
        monkeypatch.setattr(split_mod, "OUTPUT_DIR", str(out_dir))
        monkeypatch.setenv("DASHSCOPE_API_KEY", "sk-test")

        sample = out_dir / "poster.png"
        source = Image.new("RGBA", (64, 64), (100, 150, 200, 255))
        source.save(sample)

        bg = LayerSpec("背景", "background", 0, 0, 1, 1, z_order=0)
        img = LayerSpec("主图", "image", 0.1, 0.1, 0.4, 0.4, z_order=2)

        monkeypatch.setattr(
            mod,
            "_fuse_layout_blocks",
            lambda *a, **k: ([bg, img], {"vlm_blocks": 1, "ocr_blocks": 0, "qr_blocks": 0}),
        )
        monkeypatch.setattr(
            mod,
            "_refine_layout_blocks_vlm",
            lambda *a, **k: ([bg, img], 1),
        )

        def fake_extract(source, specs, *, image_url, high_quality):
            stack = [(bg, Image.new("RGBA", source.size, (240, 240, 240, 255))), (img, source.copy())]
            return stack, {"element_matting": 1, "generative_background": 1}

        monkeypatch.setattr(mod, "extract_all_layers", fake_extract)

        result = split_with_qwen_layered(
            source,
            image_url=f"/api/media/{sample.name}",
            max_layers=4,
            include_ocr=False,
        )
        assert result["success"] is True
        assert result["engine"] == "dashscope-edit"
        assert result["layer_count"] >= 2
        assert os.path.isfile(result["local_path"])
        assert len(result.get("progress", [])) == 5
        assert result["analysis"]["refined_blocks"] == 1

    def test_split_without_key(self, monkeypatch):
        monkeypatch.delenv("DASHSCOPE_API_KEY", raising=False)
        monkeypatch.delenv("ALIBABA_API_KEY", raising=False)
        source = Image.new("RGBA", (32, 32), (0, 0, 0, 255))
        result = split_with_qwen_layered(source, image_url="http://x/y.png")
        assert result["success"] is False


class TestEngineRouting:
    def test_dashscope_only(self, tmp_path, monkeypatch):
        import tools.image_edit_tools as edit_mod
        import tools.image_layer_split_tools as split_mod
        import tools.qwen_layered_adapter as qwen_mod

        out_dir = tmp_path / "outputs"
        out_dir.mkdir()
        monkeypatch.setattr(split_mod, "OUTPUT_DIR", str(out_dir))
        monkeypatch.setattr(edit_mod, "OUTPUT_DIR", str(out_dir))

        sample = out_dir / "poster.png"
        Image.new("RGBA", (48, 48), (200, 100, 50, 255)).save(sample)

        monkeypatch.setattr(qwen_mod, "is_qwen_layered_available", lambda: True)

        def fake_qwen_split(source, *, image_url, max_layers, include_ocr, high_quality=False):
            out_path = out_dir / "qwen.psd"
            _write_multi_layer_psd(
                str(out_path),
                [("BG_01", source.copy())],
            )
            return {
                "success": True,
                "filename": out_path.name,
                "local_path": str(out_path),
                "download_url": f"/api/media/{out_path.name}",
                "layer_count": 1,
                "layers": [],
                "engine": "dashscope-edit",
            }

        monkeypatch.setattr(qwen_mod, "split_with_qwen_layered", fake_qwen_split)

        from tools.image_layer_split_tools import split_image_to_psd

        result = split_image_to_psd(f"/api/media/{sample.name}", max_layers=4)
        assert result["success"] is True
        assert result["engine"] == "dashscope-edit"

    def test_fails_without_dashscope_key(self, tmp_path, monkeypatch):
        import tools.image_edit_tools as edit_mod
        import tools.image_layer_split_tools as split_mod
        import tools.qwen_layered_adapter as qwen_mod

        out_dir = tmp_path / "outputs"
        out_dir.mkdir()
        monkeypatch.setattr(split_mod, "OUTPUT_DIR", str(out_dir))
        monkeypatch.setattr(edit_mod, "OUTPUT_DIR", str(out_dir))

        sample = out_dir / "poster.png"
        Image.new("RGBA", (48, 48), (200, 100, 50, 255)).save(sample)

        monkeypatch.setattr(qwen_mod, "is_qwen_layered_available", lambda: False)

        from tools.image_layer_split_tools import split_image_to_psd

        result = split_image_to_psd(f"/api/media/{sample.name}", max_layers=8, include_ocr=False)
        assert result["success"] is False
        assert "DASHSCOPE" in result.get("error", "")
