# backend_safety

> 高性能安全底层引擎 — 二进制解析 · 加密处理 · 私钥安全存储

Rust 编写的安全关键后端模块，处理系统中对**性能**、**内存安全**和**密码学正确性**要求最高的部分。

| 能力                 | 说明                                                       |
| -------------------- | ---------------------------------------------------------- |
| **大文件二进制解析** | 零拷贝流式解析，处理 GB 级媒体/日志/数据文件，无 OOM 风险  |
| **敏感数据加密**     | AES-256-GCM + ChaCha20-Poly1305，密钥派生，安全擦除内存    |
| **私钥安全存储**     | 基于 OS Keychain / HSM 的私钥封存，支持 BIP-39/BIP-32 派生 |

---

## 快速开始

```bash
# 依赖
Rust 1.78+ (edition 2021)
OpenSSL 或 ring（纯 Rust）

# 构建
cargo build --release

# 测试（含安全性 fuzzing）
cargo test
cargo +nightly fuzz run parser_fuzz

# 运行服务（gRPC + HTTP/2）
cargo run --release --bin server
```

服务默认监听 `:9090`（gRPC）和 `:9091`（HTTP metrics），详见 `config/default.toml`。

---

## 目录结构

```
backend_safety/
├── src/
│   ├── main.rs                  # 程序入口
│   ├── server/                  # gRPC / REST 接口层
│   ├── parser/                  # 大文件二进制解析
│   │   ├── mod.rs
│   │   ├── stream.rs            # 流式零拷贝读取
│   │   ├── formats/             # 各格式解析器（mp4/mkv/zip/pdf...）
│   │   └── schema.rs            # 解析结果数据结构
│   ├── crypto/                  # 加密处理
│   │   ├── mod.rs
│   │   ├── aead.rs              # AES-256-GCM / ChaCha20-Poly1305
│   │   ├── kdf.rs               # PBKDF2 / Argon2id 密钥派生
│   │   ├── zeroize.rs           # 内存安全擦除
│   │   └── envelope.rs          # 信封加密（DEK + KEK 分离）
│   ├── keystore/                # 私钥安全存储
│   │   ├── mod.rs
│   │   ├── vault.rs             # 密钥保险库抽象接口
│   │   ├── os_keychain.rs       # macOS Keychain / Linux Secret Service
│   │   ├── encrypted_file.rs    # 软件态加密文件后端（fallback）
│   │   ├── bip39.rs             # 助记词生成与校验
│   │   └── bip32.rs             # HD 钱包派生路径
│   └── error.rs                 # 统一错误类型（thiserror）
├── proto/
│   └── safety.proto             # gRPC 接口定义
├── config/
│   └── default.toml             # 服务配置
├── fuzz/
│   ├── fuzz_targets/
│   │   ├── parser_fuzz.rs       # 解析器模糊测试
│   │   └── crypto_fuzz.rs       # 加密/解密模糊测试
│   └── Cargo.toml
├── benches/
│   ├── parser_bench.rs          # 解析性能基准
│   └── crypto_bench.rs          # 加密性能基准
├── docs/
│   └── DESIGN.md                # 架构设计文档
└── Cargo.toml
```

---

## 核心接口（gRPC）

```protobuf
service SafetyService {
  // 二进制解析
  rpc ParseFile(ParseRequest) returns (stream ParseChunk);
  rpc ParseMetadata(ParseRequest) returns (FileMetadata);

  // 加密
  rpc Encrypt(EncryptRequest) returns (EncryptResponse);
  rpc Decrypt(DecryptRequest) returns (DecryptResponse);
  rpc DeriveKey(DeriveKeyRequest) returns (DeriveKeyResponse);

  // 私钥管理
  rpc GenerateKeypair(GenerateRequest) returns (KeypairResponse);
  rpc ImportPrivateKey(ImportKeyRequest) returns (KeyHandle);
  rpc Sign(SignRequest) returns (SignResponse);
  rpc ExportPublicKey(KeyHandle) returns (PublicKeyResponse);
  rpc DeleteKey(KeyHandle) returns (DeleteResponse);
}
```

完整定义见 [proto/safety.proto](proto/safety.proto)。

---

## 配置说明

```toml
# config/default.toml
[server]
grpc_port = 9090
metrics_port = 9091

[parser]
max_file_size_gb = 10
chunk_size_bytes = 65536      # 零拷贝读取块大小
worker_threads = 8            # Rayon 线程池大小

[crypto]
default_aead = "chacha20poly1305"   # 或 "aes256gcm"
kdf = "argon2id"
argon2_memory_kib = 65536
argon2_iterations = 3
argon2_parallelism = 4

[keystore]
backend = "os_keychain"       # "os_keychain" | "encrypted_file"
keychain_service = "backend_safety"
encrypted_file_path = "./storage/keys.vault"
# 生产环境建议配置 HSM PKCS#11 路径
# pkcs11_module = "/usr/lib/pkcs11/opensc-pkcs11.so"
```

---

## 安全特性

- **内存安全**：Rust 所有权系统，无 buffer overflow / use-after-free
- **密钥材料零驻留**：所有密钥/明文在离开作用域时通过 `zeroize` crate 强制清零
- **常量时间比较**：所有 MAC 校验使用 `subtle::ConstantTimeEq`，防止时序攻击
- **模糊测试**：解析器和加密模块均配有 `cargo-fuzz` 目标
- **审计依赖**：使用 `cargo-audit` 定期扫描已知 CVE
- **最小权限**：服务进程不持有明文私钥，仅通过 KeyHandle 引用

---

## 与其他模块的集成

```
Python FastAPI (backend/)
        │  gRPC call
        ▼
backend_safety (Rust)
        │  OS API
        ▼
macOS Keychain / Linux Kernel Keyring

Go Service (backend_massive_concurrent/)
        │  gRPC call
        ▼
backend_safety
        │  解析结果 stream
        ▼
结构化数据回传
```
