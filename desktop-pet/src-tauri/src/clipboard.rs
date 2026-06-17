use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ClipboardSnapshot {
    pub preview: Option<String>,
    pub hash: Option<String>,
    pub len: Option<usize>,
}

#[derive(Default)]
pub struct ClipboardState {
    last_hash: Option<String>,
    last_read: Option<Instant>,
}

const DEBOUNCE: Duration = Duration::from_secs(2);
const PREVIEW_MAX: usize = 200;

pub fn read_clipboard_snapshot(
    state: &Mutex<ClipboardState>,
    include_preview: bool,
) -> Result<ClipboardSnapshot, String> {
    let mut guard = state.lock();
    if let Some(last) = guard.last_read {
        if last.elapsed() < DEBOUNCE {
            return Ok(ClipboardSnapshot {
                preview: None,
                hash: guard.last_hash.clone(),
                len: None,
            });
        }
    }

    let text = match arboard::Clipboard::new().and_then(|mut c| c.get_text()) {
        Ok(t) if !t.trim().is_empty() => t,
        _ => {
            guard.last_read = Some(Instant::now());
            return Ok(ClipboardSnapshot::default());
        }
    };

    let hash = hex::encode(Sha256::digest(text.as_bytes()));
    if guard.last_hash.as_deref() == Some(hash.as_str()) {
        guard.last_read = Some(Instant::now());
        return Ok(ClipboardSnapshot {
            preview: None,
            hash: Some(hash),
            len: Some(text.len()),
        });
    }

    guard.last_hash = Some(hash.clone());
    guard.last_read = Some(Instant::now());

    Ok(ClipboardSnapshot {
        preview: if include_preview {
            Some(text.chars().take(PREVIEW_MAX).collect())
        } else {
            None
        },
        hash: Some(hash),
        len: Some(text.len()),
    })
}
