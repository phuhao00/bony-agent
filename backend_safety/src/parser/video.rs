// src/parser/video.rs — 视频元数据 + 关键帧提取

use anyhow::{Context, Result};
use std::path::Path;
use super::formats::mp4;

pub struct VideoInfo {
    pub duration_ms: u64,
    pub container: String,
    pub frame_timestamps_ms: Vec<u64>,
}

pub fn get_metadata(data: &[u8], path_hint: Option<&Path>) -> Result<VideoInfo> {
    let container = path_hint
        .and_then(|p| p.extension())
        .and_then(|e| e.to_str())
        .unwrap_or("mp4")
        .to_lowercase();

    let meta = mp4::parse(data).context("Failed to parse video metadata")?;

    Ok(VideoInfo {
        duration_ms: meta.duration_ms,
        container,
        frame_timestamps_ms: meta.frame_timestamps_ms,
    })
}

/// 从时间戳列表中均匀采样 max_frames 个关键帧时间点
pub fn sample_keyframe_timestamps(timestamps: &[u64], max_frames: usize) -> Vec<u64> {
    if timestamps.is_empty() || max_frames == 0 {
        return vec![];
    }
    if timestamps.len() <= max_frames {
        return timestamps.to_vec();
    }
    let step = timestamps.len() / max_frames;
    (0..max_frames).map(|i| timestamps[i * step]).collect()
}
