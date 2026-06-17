# ── 构建阶段 ──────────────────────────────────────────────
FROM rust:1.78-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    protobuf-compiler \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# 先复制 Cargo 文件以利用层缓存
COPY Cargo.toml build.rs ./
COPY src/ ./src/
COPY ../proto/ ../proto/

RUN cargo build --release --bin parser-service

# ── 运行阶段 ──────────────────────────────────────────────
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /build/target/release/parser-service .

ENV PARSER_PORT=50052
ENV RUST_LOG=info

EXPOSE 50052

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD test -S /proc/1/fd/0 || exit 1

CMD ["./parser-service"]
