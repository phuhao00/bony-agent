# ── 构建阶段 ──────────────────────────────────────────────
FROM golang:1.22-alpine AS builder

RUN apk add --no-cache protobuf protobuf-dev

# 安装 protoc-gen-go 插件
RUN go install google.golang.org/protobuf/cmd/protoc-gen-go@latest \
    && go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest

WORKDIR /build

COPY go.mod ./
RUN go mod download

COPY . .
# 生成 proto stubs（假设 proto/ 目录挂载）
RUN mkdir -p generated/mediaagent && \
    protoc -I ../proto \
    --go_out=generated --go_opt=paths=source_relative \
    --go-grpc_out=generated --go-grpc_opt=paths=source_relative \
    ../proto/mediaagent/common.proto \
    ../proto/mediaagent/directory.proto 2>/dev/null || true

RUN go build -o directory-service ./cmd/server

# ── 运行阶段 ──────────────────────────────────────────────
FROM alpine:3.19

RUN apk add --no-cache ca-certificates

WORKDIR /app
COPY --from=builder /build/directory-service .

ENV DIRECTORY_PORT=50053
ENV MAX_MESSAGE_MB=50
ENV GRPC_REFLECTION=1

EXPOSE 50053

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD nc -z localhost 50053 || exit 1

CMD ["./directory-service"]
