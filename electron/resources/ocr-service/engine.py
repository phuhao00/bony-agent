"""
OCR 引擎封装
支持 PaddleOCR（主）和 EasyOCR（降级兜底）
"""
from __future__ import annotations

import io
import logging
import os
from dataclasses import dataclass, field
from typing import List, Optional

import numpy as np
from PIL import Image

logger = logging.getLogger("ocr.engine")

# ── 数据类 ─────────────────────────────────────────────────

@dataclass
class BBox:
    x: float
    y: float
    width: float
    height: float


@dataclass
class TextBlock:
    text: str
    confidence: float
    bbox: BBox
    language: str = "unknown"
    page: int = 1


@dataclass
class OCRResult:
    full_text: str
    blocks: List[TextBlock]
    avg_confidence: float
    detected_language: str
    tables: list = field(default_factory=list)


# ── 引擎实现 ───────────────────────────────────────────────

class PaddleOCREngine:
    """PaddleOCR 封装，支持多语言。"""

    # PaddleOCR 语言代码映射
    _LANG_MAP = {
        "ch_sim": "ch",
        "ch_tra": "chinese_cht",
        "en": "en",
        "ja": "japan",
        "ko": "korean",
        "ar": "arabic",
        "fr": "french",
        "de": "german",
    }

    def __init__(self) -> None:
        self._models: dict = {}

    def _get_model(self, lang_code: str):
        from paddleocr import PaddleOCR  # 懒加载，避免启动过慢

        paddle_lang = self._LANG_MAP.get(lang_code, "ch")
        if paddle_lang not in self._models:
            use_gpu = os.getenv("USE_GPU", "0") == "1"
            self._models[paddle_lang] = PaddleOCR(
                use_angle_cls=True,
                lang=paddle_lang,
                use_gpu=use_gpu,
                show_log=False,
            )
        return self._models[paddle_lang]

    def run(self, image: np.ndarray, languages: List[str], page: int = 1) -> OCRResult:
        # 主语言取第一个
        lang = languages[0] if languages else "ch_sim"
        model = self._get_model(lang)

        raw = model.ocr(image, cls=True)
        if not raw or raw[0] is None:
            return OCRResult("", [], 0.0, lang)

        blocks: List[TextBlock] = []
        h, w = image.shape[:2]

        for line in raw[0]:
            points, (text, conf) = line
            # points: [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]
            xs = [p[0] for p in points]
            ys = [p[1] for p in points]
            bx = min(xs) / w
            by = min(ys) / h
            bw = (max(xs) - min(xs)) / w
            bh = (max(ys) - min(ys)) / h
            blocks.append(TextBlock(
                text=text,
                confidence=float(conf),
                bbox=BBox(bx, by, bw, bh),
                page=page,
            ))

        full_text = "\n".join(b.text for b in blocks)
        avg_conf = (sum(b.confidence for b in blocks) / len(blocks)) if blocks else 0.0
        return OCRResult(full_text, blocks, avg_conf, lang)


class EasyOCREngine:
    """EasyOCR 降级引擎。"""

    _LANG_MAP = {
        "ch_sim": "ch_sim",
        "ch_tra": "ch_tra",
        "en": "en",
        "ja": "ja",
        "ko": "ko",
        "ar": "ar",
        "fr": "fr",
        "de": "de",
    }

    def __init__(self) -> None:
        self._readers: dict = {}

    def _get_reader(self, languages: List[str]):
        import easyocr  # 懒加载

        key = tuple(sorted(languages))
        if key not in self._readers:
            use_gpu = os.getenv("USE_GPU", "0") == "1"
            mapped = [self._LANG_MAP.get(l, l) for l in languages]
            self._readers[key] = easyocr.Reader(mapped, gpu=use_gpu)
        return self._readers[key]

    def run(self, image: np.ndarray, languages: List[str], page: int = 1) -> OCRResult:
        reader = self._get_reader(languages)
        results = reader.readtext(image)
        h, w = image.shape[:2]

        blocks: List[TextBlock] = []
        for (pts, text, conf) in results:
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            bx = min(xs) / w
            by = min(ys) / h
            bw = (max(xs) - min(xs)) / w
            bh = (max(ys) - min(ys)) / h
            blocks.append(TextBlock(
                text=text,
                confidence=float(conf),
                bbox=BBox(bx, by, bw, bh),
                page=page,
            ))

        full_text = "\n".join(b.text for b in blocks)
        avg_conf = (sum(b.confidence for b in blocks) / len(blocks)) if blocks else 0.0
        lang = languages[0] if languages else "en"
        return OCRResult(full_text, blocks, avg_conf, lang)


# ── 统一接口 ───────────────────────────────────────────────

class OCREngine:
    """
    统一 OCR 接口，优先使用 PaddleOCR，不可用时降级 EasyOCR。
    """

    def __init__(self) -> None:
        self._engine: Optional[PaddleOCREngine | EasyOCREngine] = None
        self._engine_name = ""

    def _init_engine(self) -> None:
        if self._engine is not None:
            return
        try:
            import paddleocr  # noqa: F401
            self._engine = PaddleOCREngine()
            self._engine_name = "paddleocr"
            logger.info("OCR engine: PaddleOCR")
        except ImportError:
            logger.warning("PaddleOCR not available, falling back to EasyOCR")
            try:
                import easyocr  # noqa: F401
                self._engine = EasyOCREngine()
                self._engine_name = "easyocr"
                logger.info("OCR engine: EasyOCR")
            except ImportError as e:
                raise RuntimeError(
                    "Neither PaddleOCR nor EasyOCR is installed. "
                    "Run: pip install paddleocr paddlepaddle  OR  pip install easyocr"
                ) from e

    @property
    def engine_name(self) -> str:
        self._init_engine()
        return self._engine_name

    def run(
        self,
        image_bytes: Optional[bytes] = None,
        image_path: Optional[str] = None,
        languages: Optional[List[str]] = None,
        page: int = 1,
    ) -> OCRResult:
        self._init_engine()

        if languages is None:
            languages = ["ch_sim", "en"]

        # 加载图片为 numpy array
        if image_bytes is not None:
            img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        elif image_path is not None:
            img = Image.open(image_path).convert("RGB")
        else:
            raise ValueError("Either image_bytes or image_path must be provided")

        arr = np.array(img)
        return self._engine.run(arr, languages, page=page)


# 模块级单例
_engine_instance: Optional[OCREngine] = None


def get_engine() -> OCREngine:
    global _engine_instance
    if _engine_instance is None:
        _engine_instance = OCREngine()
    return _engine_instance
