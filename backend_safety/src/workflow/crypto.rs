// src/workflow/crypto.rs — ChaCha20-Poly1305 AEAD 加密
// 用于加密节点配置中的敏感字段（API key 等）
// 密钥从环境变量 WORKFLOW_ENCRYPT_KEY 读取（base64 编码的 32 字节）
// 生成: openssl rand -base64 32

use anyhow::{anyhow, Context};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use chacha20poly1305::{
    aead::{Aead, KeyInit, OsRng},
    AeadCore, ChaCha20Poly1305,
};

/// WorkflowCrypto 封装 ChaCha20-Poly1305 加解密
#[derive(Clone)]
pub struct WorkflowCrypto {
    cipher: ChaCha20Poly1305,
}

impl WorkflowCrypto {
    /// 从环境变量 WORKFLOW_ENCRYPT_KEY 初始化
    /// 启动时 panic（fail-fast），确保密钥缺失时服务不启动
    pub fn from_env() -> anyhow::Result<Self> {
        let key_b64 = std::env::var("WORKFLOW_ENCRYPT_KEY").context(
            "WORKFLOW_ENCRYPT_KEY env var is required. \
             Generate with: openssl rand -base64 32",
        )?;
        let key_bytes = B64
            .decode(key_b64.trim())
            .context("WORKFLOW_ENCRYPT_KEY must be valid base64")?;
        if key_bytes.len() != 32 {
            return Err(anyhow!(
                "WORKFLOW_ENCRYPT_KEY must decode to exactly 32 bytes, got {}",
                key_bytes.len()
            ));
        }
        let cipher = ChaCha20Poly1305::new_from_slice(&key_bytes)
            .map_err(|e| anyhow!("Failed to init cipher: {e}"))?;
        Ok(Self { cipher })
    }

    /// 加密明文，返回 base64(12-byte-nonce || ciphertext)
    pub fn encrypt(&self, plaintext: &str) -> anyhow::Result<String> {
        let nonce = ChaCha20Poly1305::generate_nonce(&mut OsRng);
        let ciphertext = self
            .cipher
            .encrypt(&nonce, plaintext.as_bytes())
            .map_err(|e| anyhow!("Encrypt error: {e}"))?;

        // 拼接: nonce(12) + ciphertext
        let mut combined = nonce.to_vec();
        combined.extend_from_slice(&ciphertext);
        Ok(B64.encode(combined))
    }

    /// 解密 encrypt() 的输出，返回原始明文
    pub fn decrypt(&self, encoded: &str) -> anyhow::Result<String> {
        let combined = B64
            .decode(encoded.trim())
            .context("Invalid base64 in ciphertext")?;
        if combined.len() < 12 {
            return Err(anyhow!("Ciphertext too short (< 12 bytes)"));
        }
        let (nonce_bytes, ciphertext) = combined.split_at(12);
        let nonce = chacha20poly1305::Nonce::from_slice(nonce_bytes);
        let plaintext = self
            .cipher
            .decrypt(nonce, ciphertext)
            .map_err(|_| anyhow!("Decryption failed — wrong key or corrupted data"))?;
        String::from_utf8(plaintext).context("Decrypted bytes are not valid UTF-8")
    }
}

/// 如果 WORKFLOW_ENCRYPT_KEY 未设置，返回 None（降级：不加密）
/// 生产环境应始终设置此变量
pub fn try_from_env() -> Option<WorkflowCrypto> {
    match WorkflowCrypto::from_env() {
        Ok(c) => Some(c),
        Err(e) => {
            tracing::warn!("WorkflowCrypto disabled: {e}. Node credentials will not be encrypted.");
            None
        }
    }
}
