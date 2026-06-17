"""
OCR gRPC 服务端
端口: 50051（可通过 OCR_PORT 环境变量覆盖）
"""
from __future__ import annotations

import concurrent.futures
import logging
import os
import sys
import time
import uuid
from pathlib import Path

import grpc

# ── proto stubs（优先从 generated/ 导入，否则从同级 generated/） ──
_HERE = Path(__file__).parent
_PROJ_ROOT = _HERE.parent.parent
sys.path.insert(0, str(_PROJ_ROOT / "backend" / "generated"))
sys.path.insert(0, str(_HERE / "generated"))

try:
    from mediaagent import ocr_pb2, ocr_pb2_grpc, common_pb2
except ImportError as e:
    raise ImportError(
        "Proto stubs not found. Run: ./scripts/gen_proto.sh"
    ) from e

from engine import get_engine, OCRResult

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("ocr.server")

# ── 辅助转换 ──────────────────────────────────────────────

def _result_to_response(result: OCRResult, request_id: str, latency_ms: int) -> ocr_pb2.OCRResponse:
    blocks = []
    for b in result.blocks:
        blocks.append(common_pb2.TextBlock(
            text=b.text,
            confidence=b.confidence,
            bbox=common_pb2.BoundingBox(
                x=b.bbox.x,
                y=b.bbox.y,
                width=b.bbox.width,
                height=b.bbox.height,
            ),
            language=b.language,
            page=b.page,
        ))

    return ocr_pb2.OCRResponse(
        request_id=request_id,
        full_text=result.full_text,
        blocks=blocks,
        avg_confidence=result.avg_confidence,
        detected_language=result.detected_language,
        status=common_pb2.TASK_STATUS_COMPLETED,
        latency_ms=latency_ms,
    )


# ── 服务实现 ───────────────────────────────────────────────

class OCRServiceServicer(ocr_pb2_grpc.OCRServiceServicer):

    def __init__(self) -> None:
        self._engine = get_engine()
        try:
            logger.info("OCRServiceServicer ready (engine=%s)", self._engine.engine_name)
        except RuntimeError as exc:
            logger.warning("OCRServiceServicer started with no OCR engine: %s", exc)
            logger.warning("OCR calls will fail until paddleocr or easyocr is installed")

    def ExtractText(
        self,
        request: ocr_pb2.OCRRequest,
        context: grpc.ServicerContext,
    ) -> ocr_pb2.OCRResponse:
        t0 = time.monotonic()
        req_id = request.request_id or str(uuid.uuid4())

        try:
            source = request.WhichOneof("source")
            image_bytes = request.image_data if source == "image_data" else None
            image_path = request.image_path if source == "image_path" else None
            languages = list(request.languages) if request.languages else ["ch_sim", "en"]

            logger.info("ExtractText req_id=%s source=%s langs=%s", req_id, source, languages)

            result = self._engine.run(
                image_bytes=image_bytes,
                image_path=image_path,
                languages=languages,
            )
            latency = int((time.monotonic() - t0) * 1000)
            logger.info("ExtractText done req_id=%s blocks=%d latency=%dms", req_id, len(result.blocks), latency)
            return _result_to_response(result, req_id, latency)

        except Exception as exc:
            logger.exception("ExtractText failed req_id=%s", req_id)
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(exc))
            return ocr_pb2.OCRResponse(
                request_id=req_id,
                status=common_pb2.TASK_STATUS_FAILED,
                error=common_pb2.Error(code=500, message=str(exc)),
            )

    def ExtractBatch(
        self,
        request_iterator,
        context: grpc.ServicerContext,
    ):
        for batch_req in request_iterator:
            t0 = time.monotonic()
            req = batch_req.request
            req_id = req.request_id or str(uuid.uuid4())
            try:
                source = req.WhichOneof("source")
                result = self._engine.run(
                    image_bytes=req.image_data if source == "image_data" else None,
                    image_path=req.image_path if source == "image_path" else None,
                    languages=list(req.languages) if req.languages else ["ch_sim", "en"],
                )
                latency = int((time.monotonic() - t0) * 1000)
                yield ocr_pb2.OCRBatchResponse(
                    response=_result_to_response(result, req_id, latency),
                    batch_index=batch_req.batch_index,
                )
            except Exception as exc:
                logger.exception("ExtractBatch item failed req_id=%s", req_id)
                yield ocr_pb2.OCRBatchResponse(
                    response=ocr_pb2.OCRResponse(
                        request_id=req_id,
                        status=common_pb2.TASK_STATUS_FAILED,
                        error=common_pb2.Error(code=500, message=str(exc)),
                    ),
                    batch_index=batch_req.batch_index,
                )


# ── 启动入口 ───────────────────────────────────────────────

def serve() -> None:
    port = int(os.getenv("OCR_PORT", "50051"))
    max_workers = int(os.getenv("OCR_WORKERS", "4"))
    max_message_mb = int(os.getenv("OCR_MAX_MESSAGE_MB", "20"))

    server = grpc.server(
        concurrent.futures.ThreadPoolExecutor(max_workers=max_workers),
        options=[
            ("grpc.max_receive_message_length", max_message_mb * 1024 * 1024),
            ("grpc.max_send_message_length", max_message_mb * 1024 * 1024),
        ],
    )
    ocr_pb2_grpc.add_OCRServiceServicer_to_server(OCRServiceServicer(), server)
    server.add_insecure_port(f"[::]:{port}")
    server.start()
    logger.info("OCR gRPC service listening on port %d (workers=%d)", port, max_workers)

    try:
        server.wait_for_termination()
    except KeyboardInterrupt:
        logger.info("Shutting down OCR service...")
        server.stop(grace=5)


if __name__ == "__main__":
    serve()
