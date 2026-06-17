"""Tests for image export tools."""

import os

from PIL import Image

from tools.image_export_tools import export_image_file


class TestExportImageFile:
    def test_export_png(self, tmp_path, monkeypatch):
        import tools.image_edit_tools as edit_mod
        import tools.image_export_tools as mod

        out_dir = tmp_path / "outputs"
        out_dir.mkdir()
        monkeypatch.setattr(mod, "OUTPUT_DIR", str(out_dir))
        monkeypatch.setattr(edit_mod, "OUTPUT_DIR", str(out_dir))

        sample = out_dir / "sample.png"
        Image.new("RGBA", (32, 32), (10, 20, 30, 255)).save(sample)
        url = f"/api/media/{sample.name}"

        result = export_image_file(url, "png")
        assert result["success"] is True
        assert result["filename"].endswith(".png")
        assert os.path.isfile(result["local_path"])

    def test_export_jpeg(self, tmp_path, monkeypatch):
        import tools.image_edit_tools as edit_mod
        import tools.image_export_tools as mod

        out_dir = tmp_path / "outputs"
        out_dir.mkdir()
        monkeypatch.setattr(mod, "OUTPUT_DIR", str(out_dir))
        monkeypatch.setattr(edit_mod, "OUTPUT_DIR", str(out_dir))

        sample = out_dir / "sample.png"
        Image.new("RGBA", (32, 32), (10, 20, 30, 255)).save(sample)

        result = export_image_file(f"/api/media/{sample.name}", "jpeg", jpeg_quality=85)
        assert result["success"] is True
        assert result["filename"].endswith(".jpg")
        assert result["format"] == "jpeg"

    def test_export_psd_with_layers(self, tmp_path, monkeypatch):
        import tools.image_edit_tools as edit_mod
        import tools.image_export_tools as mod

        out_dir = tmp_path / "outputs"
        out_dir.mkdir()
        monkeypatch.setattr(mod, "OUTPUT_DIR", str(out_dir))
        monkeypatch.setattr(edit_mod, "OUTPUT_DIR", str(out_dir))

        sample = out_dir / "sample.png"
        source = out_dir / "source.png"
        Image.new("RGBA", (32, 32), (10, 20, 30, 255)).save(sample)
        Image.new("RGBA", (32, 32), (200, 100, 50, 255)).save(source)

        result = export_image_file(
            f"/api/media/{sample.name}",
            "psd",
            source_image_url=f"/api/media/{source.name}",
        )
        assert result["success"] is True
        assert result["filename"].endswith(".psd")
        assert os.path.getsize(result["local_path"]) > 100

    def test_invalid_format(self, tmp_path, monkeypatch):
        import tools.image_edit_tools as edit_mod
        import tools.image_export_tools as mod

        out_dir = tmp_path / "outputs"
        out_dir.mkdir()
        monkeypatch.setattr(mod, "OUTPUT_DIR", str(out_dir))
        monkeypatch.setattr(edit_mod, "OUTPUT_DIR", str(out_dir))

        sample = out_dir / "sample.png"
        Image.new("RGBA", (8, 8), (0, 0, 0, 255)).save(sample)

        result = export_image_file(f"/api/media/{sample.name}", "webp")
        assert result["success"] is False

    def test_missing_url(self):
        result = export_image_file("", "png")
        assert result["success"] is False
