# 架构设计文档

> backend_safety — 高性能安全底层引擎（Rust）

---

## 一、项目目标与性能指标

| 模块       | 目标                   | 指标                                |
| ---------- | ---------------------- | ----------------------------------- |
| 二进制解析 | 流式解析 GB 级文件     | 峰值内存 < 128 MB（与文件大小无关） |
| 二进制解析 | MP4/MKV 解析吞吐       | ≥ 500 MB/s（NVMe 本地磁盘）         |
| 加密       | ChaCha20-Poly1305 吞吐 | ≥ 1 GB/s（单线程）                  |
| 加密       | Argon2id 密钥派生      | 300–500 ms（可调，防暴力破解）      |
| 私钥操作   | secp256k1 签名         | ≥ 10,000 签名/s                     |
| 私钥存储   | 密钥写入/读取          | 无明文落盘，OS Keychain 隔离        |

---

## 二、模块设计

### 2.1 大文件二进制解析 (`src/parser/`)

**核心问题**：Python/Go 解析 GB 级二进制文件时，通常需要将全文件载入内存，导致 OOM；且 GC 语言的字节操作性能远低于 Rust。

**方案：零拷贝流式解析 + Rayon 并行**

```
磁盘文件
   │
   ▼
BufReader（mmap 或 O_DIRECT，chunk_size = 64KB）
   │
   ▼
FormatDetector（魔数识别：MP4/MKV/ZIP/PDF/ELF...）
   │
   ▼
FormatParser（nom 解析器组合子，零拷贝引用原始 buffer）
   │  解析 atom/box/chunk
   ▼
SchemaBuilder（结构化元数据 + 感兴趣数据段偏移量）
   │
   ├──▶ 流式 gRPC 响应（ParseChunk stream）
   └──▶ 元数据摘要（FileMetadata）
```

**关键设计决策**：

- 使用 `nom` 解析器组合子框架——声明式描述二进制格式，无需手写状态机
- 解析器操作 `&[u8]` 切片引用，不复制数据（零拷贝）
- 大文件通过 `memmap2` 做内存映射，OS 负责分页，用户态永远只持有窗口引用
- `Rayon` 线程池并行解析独立数据块（如视频的多个 track）
- 恶意格式保护：所有 `nom` 解析器设置深度/长度上限，防止 parser bomb（zip bomb / 嵌套攻击）
- 解析器通过 `cargo-fuzz` 模糊测试，覆盖畸形输入场景

**支持格式（可扩展）**：

| 格式         | 用途                             |
| ------------ | -------------------------------- |
| MP4 / MOV    | 视频元数据、track 信息、时间轴   |
| MKV / WebM   | Matroska 容器解析                |
| ZIP / gzip   | 压缩包目录结构，不解压提取元数据 |
| PDF          | 对象流、XRef table、元数据       |
| ELF          | 二进制可执行文件分析             |
| 自定义二进制 | 通过 schema 描述文件扩展         |

**文件**：

```
src/parser/
├── mod.rs          # Parser trait 定义，FormatDetector
├── stream.rs       # 流式读取，mmap 封装
├── formats/
│   ├── mp4.rs      # ISO Base Media File Format (ISOBMFF)
│   ├── mkv.rs      # EBML / Matroska
│   ├── zip.rs      # ZIP End of Central Directory
│   └── ...
└── schema.rs       # ParseResult, FileMetadata, ParseChunk
```

---

### 2.2 敏感数据加密 (`src/crypto/`)

**核心问题**：Python 的 `cryptography` 库和 Go 的 `crypto/aes` 均依赖 CGO 或 C 扩展；Rust 的 `ring` / `aws-lc-rs` 提供经过 FIPS 验证的纯 Rust 或硬件加速实现，且内存安全由编译器保证。

**方案：信封加密 + 密钥隔离**

```
明文数据
   │
   ▼
[信封加密 Envelope Encryption]
   │
   ├── 1. 生成随机 DEK（Data Encryption Key，256-bit）
   │
   ├── 2. DEK 加密明文：ChaCha20-Poly1305 or AES-256-GCM
   │        nonce = random 96-bit（每次加密独立）
   │        密文 = nonce || ciphertext || tag
   │
   ├── 3. DEK 用 KEK（Key Encryption Key）加密
   │        KEK 来自 Keystore（不出安全边界）
   │
   └── 4. 返回：{ encrypted_dek, nonce, ciphertext, aad }
              │
              ▼
         DEK 使用完毕立即 zeroize（Zeroize trait）
```

**密钥派生（KDF）**：

```
用户密码/口令
   │
   ▼
Argon2id（memory=64MB, iterations=3, parallelism=4）
   │  防 GPU/ASIC 暴力破解
   ▼
256-bit 派生密钥（用作 KEK 或直接加密）
```

**关键设计决策**：

- **算法选型**：优先 `ChaCha20-Poly1305`（移动/嵌入式友好，无 padding oracle），备选 `AES-256-GCM`（硬件 AES-NI 场景）
- **Nonce 管理**：每次加密强随机 nonce，96-bit，96-bit nonce 在 2^32 次加密前不重复（NIST SP 800-38D）
- **AAD（Additional Authenticated Data）**：绑定文件 ID / 用户 ID，防止密文被挪用到其他上下文
- **内存安全**：所有密钥/明文变量实现 `Zeroize` trait，离开 scope 时编译器保证清零（防止被 swap 到磁盘或 core dump 泄露）
- **常量时间**：MAC 校验使用 `subtle::ConstantTimeEq`，防止通过响应时间推断 tag 内容
- **禁止使用**：ECB 模式、MD5/SHA-1 作为 MAC、自实现加密算法

**文件**：

```
src/crypto/
├── mod.rs          # Crypto trait，算法选择
├── aead.rs         # AEAD 加密/解密（ring crate）
├── kdf.rs          # Argon2id / PBKDF2（argon2 crate）
├── zeroize.rs      # 内存安全擦除辅助类型 SecretBytes
└── envelope.rs     # 信封加密组合逻辑
```

---

### 2.3 私钥安全存储 (`src/keystore/`)

**核心问题**：私钥（尤其区块链私钥）一旦泄露不可撤销；普通文件存储、环境变量、数据库字段均有泄露风险（日志、备份、内存 dump）。

**方案：分层存储抽象 + OS 安全飞地**

```
                    KeystoreVault trait
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
   OsKeychainBackend  EncryptedFile   Pkcs11Backend
   (macOS Keychain /  Backend         (HSM / YubiKey)
   Linux Keyring)     (软件 fallback)
```

**OsKeychainBackend**（推荐）：

- macOS：`Security.framework` Keychain，私钥存储在 Secure Enclave（Apple Silicon）
- Linux：`libsecret` / kernel keyring（`KEY_SPEC_SESSION_KEYRING`）
- 密钥通过 `KeyHandle`（随机 UUID）引用，应用层永远不持有明文私钥字节

**EncryptedFileBackend**（开发/无 Keychain 场景）：

```
私钥明文
   │
   ▼
Argon2id(master_password) ──▶ KEK
   │
   ▼
AES-256-GCM 加密私钥
   │
   ▼
./storage/keys.vault（{ key_id, encrypted_key, nonce, salt }[] }）
```

**BIP-39 / BIP-32 支持**：

```
entropy (128~256 bit)
   │
   ├── BIP-39 ──▶ 助记词（12~24 个英文单词）
   │               │
   │               ▼
   └── BIP-32 ──▶ Master Key ──▶ m/44'/60'/0'/0/0（派生路径）
                                        │
                                        ▼
                                  以太坊地址 / 公钥
```

**关键设计决策**：

- `KeyHandle` 设计：类似 capability token，仅用于引用密钥，服务重启后失效，需重新认证
- 签名操作在 Keystore 内部完成（`Sign(handle, message) -> Signature`），私钥字节不离开安全边界
- 支持 secp256k1（比特币/以太坊）、ed25519（Solana/Cosmos）、P-256（通用 TLS）
- 密钥导出仅允许公钥导出，私钥导出需要显式授权（二次验证）
- 审计日志：每次签名/访问操作记录到不可篡改日志（append-only，可对接区块链存证）

**文件**：

```
src/keystore/
├── mod.rs              # KeystoreVault trait，KeyHandle 类型
├── vault.rs            # 组合后端，统一入口
├── os_keychain.rs      # macOS / Linux OS 集成
├── encrypted_file.rs   # 软件态加密文件存储
├── bip39.rs            # 助记词（bip39 crate）
└── bip32.rs            # HD 派生（bitcoin crate / k256）
```

---

## 三、跨语言集成

本服务通过 **gRPC** 对外暴露，与 Python（FastAPI）和 Go（高并发引擎）双向集成：

```
┌─────────────────────┐        gRPC / TLS        ┌──────────────────────┐
│  Python FastAPI      │ ◀────────────────────▶   │  backend_safety      │
│  backend/main.py     │                           │  (Rust, port 9090)   │
└─────────────────────┘                           └──────────────────────┘
                                                            │
┌─────────────────────┐        gRPC / TLS                  │
│  Go 高并发引擎       │ ◀──────────────────────────────────┘
│  backend_massive_   │   解析大文件时调用 ParseFile stream
│  concurrent/        │   加密抓取结果时调用 Encrypt
└─────────────────────┘
```

**gRPC 连接安全**：

- mTLS（双向 TLS），客户端需提供证书，防止未授权调用
- gRPC 拦截器做请求鉴权（JWT / HMAC-SHA256 签名）

---

## 四、技术选型

| 组件         | 选型                             | 理由                           |
| ------------ | -------------------------------- | ------------------------------ |
| 异步运行时   | `tokio`                          | 工业级 async，gRPC server 必选 |
| gRPC         | `tonic`                          | Rust 原生，code-gen from proto |
| 二进制解析   | `nom`                            | 组合子，零拷贝，安全，可 fuzz  |
| 内存映射     | `memmap2`                        | 跨平台 mmap，安全封装          |
| 并行计算     | `rayon`                          | CPU 密集任务数据并行           |
| 加密         | `ring` / `aws-lc-rs`             | FIPS 140-2，经大规模生产验证   |
| Argon2       | `argon2` crate                   | 官方实现，内存硬化 KDF         |
| 内存安全擦除 | `zeroize`                        | 防编译器优化掉清零操作         |
| 常量时间     | `subtle`                         | 防时序攻击                     |
| BIP-39/32    | `bip39` + `k256`                 | secp256k1 标准实现             |
| OS Keychain  | `keyring` crate                  | 跨平台 Keychain 抽象           |
| 错误处理     | `thiserror` + `anyhow`           | 结构化错误类型                 |
| 配置         | `config` crate                   | TOML / env 分层配置            |
| 日志         | `tracing` + `tracing-subscriber` | 结构化，异步友好               |
| 模糊测试     | `cargo-fuzz` (libFuzzer)         | 解析器安全必备                 |
| 安全审计     | `cargo-audit`                    | 自动扫描依赖 CVE               |

---

## 五、威胁模型

| 威胁                               | 缓解措施                                              |
| ---------------------------------- | ----------------------------------------------------- |
| 内存读取（core dump / /proc/mem）  | `zeroize` 擦除密钥，`mlock` 锁定关键内存页（防 swap） |
| 时序攻击                           | `subtle::ConstantTimeEq` 全面替换 `==` 用于安全比较   |
| Parser Bomb（zip bomb / 嵌套攻击） | nom 解析器硬编码深度/长度上限                         |
| 私钥文件泄露                       | 密钥仅存 OS Keychain，明文永不落盘                    |
| 中间人攻击                         | gRPC mTLS，证书固定（Certificate Pinning）            |
| 依赖供应链攻击                     | `cargo audit`，`cargo deny`，lock file 固定版本       |
| 暴力破解密钥派生                   | Argon2id（内存硬化），限制 KDF 并发调用次数           |
| Nonce 重用                         | 每次加密强随机 nonce，禁止计数器 nonce                |

---

## 六、开发计划

### Phase 1 — 基础框架（1周）

- [ ] `Cargo.toml`，workspace 配置
- [ ] `proto/safety.proto` 接口定义
- [ ] `tonic` gRPC server 框架搭建
- [ ] `config` 配置加载，`tracing` 日志

### Phase 2 — 加密模块（1周）

- [ ] `src/crypto/aead.rs`：ChaCha20-Poly1305 + AES-256-GCM
- [ ] `src/crypto/kdf.rs`：Argon2id 密钥派生
- [ ] `src/crypto/zeroize.rs`：SecretBytes 类型
- [ ] `src/crypto/envelope.rs`：信封加密
- [ ] 单元测试 + `cargo-fuzz` 目标

### Phase 3 — 私钥存储（1周）

- [ ] `KeystoreVault` trait 定义
- [ ] `OsKeychainBackend`（macOS 优先）
- [ ] `EncryptedFileBackend`（fallback）
- [ ] BIP-39 助记词，BIP-32 派生路径
- [ ] secp256k1 / ed25519 签名

### Phase 4 — 二进制解析（1.5周）

- [ ] `src/parser/stream.rs`：mmap 流式读取
- [ ] MP4 / ISOBMFF 解析器（nom）
- [ ] ZIP 目录结构解析器
- [ ] 模糊测试覆盖，parser bomb 防护

### Phase 5 — 集成与生产加固（0.5周）

- [ ] gRPC mTLS 配置
- [ ] `cargo-audit` CI 集成
- [ ] Prometheus metrics（`metrics` crate）
- [ ] Docker 镜像（distroless base，最小攻击面）

---

## 七、性能基准

```bash
cargo bench
```

| 基准                     | 目标                             |
| ------------------------ | -------------------------------- |
| `bench_chacha20_1mb`     | ≥ 1 GB/s                         |
| `bench_argon2id`         | 300~500ms（security/speed 权衡） |
| `bench_mp4_parse_1gb`    | ≤ 2s，峰值 RSS < 128 MB          |
| `bench_sign_secp256k1`   | ≥ 10,000 ops/s                   |
| `bench_encrypt_envelope` | ≥ 100,000 ops/s（不含 KDF）      |
