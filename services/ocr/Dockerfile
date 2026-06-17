# ── 构建阶段 ──────────────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /build
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ── 运行阶段 ──────────────────────────────────────────────
FROM python:3.11-slim

# 系统依赖（libGL for OpenCV）
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgl1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /install /usr/local

WORKDIR /app

# proto stubs（由构建上下文注入）
COPY generated/ ./generated/
COPY engine.py server.py ./

ENV OCR_PORT=50051
ENV OCR_WORKERS=4
ENV OCR_MAX_MESSAGE_MB=20
ENV USE_GPU=0
# PaddleOCR 模型缓存目录
ENV HOME=/app

EXPOSE 50051

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD python3 -c "import grpc; ch = grpc.insecure_channel('localhost:50051'); \
    from mediaagent import ocr_pb2_grpc; ocr_pb2_grpc.OCRServiceStub(ch)" \
    || exit 1

CMD ["python3", "server.py"]
