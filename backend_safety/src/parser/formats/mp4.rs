// src/parser/formats/mp4.rs
// 使用 nom 解析 ISO BMFF (MP4/MOV) box 结构，提取时长、轨道、帧时间戳

use anyhow::Result;
use nom::{
    bytes::complete::take,
    number::complete::{be_u32, be_u64},
    IResult,
};

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct Track {
    pub track_id: u32,
    pub duration_ms: u64,
    pub is_video: bool,
    pub width: u32,
    pub height: u32,
    pub timescale: u32,
}

#[derive(Debug, Default)]
pub struct Mp4Metadata {
    pub duration_ms: u64,
    pub tracks: Vec<Track>,
    pub frame_timestamps_ms: Vec<u64>, // 从 stts box 推算
}

/// Box 头部
struct BoxHeader {
    size: u64,
    box_type: [u8; 4],
}

fn parse_box_header(input: &[u8]) -> IResult<&[u8], BoxHeader> {
    let (rest, size32) = be_u32(input)?;
    let (rest, box_type_bytes) = take(4usize)(rest)?;
    let mut box_type = [0u8; 4];
    box_type.copy_from_slice(box_type_bytes);

    let (rest, size) = if size32 == 1 {
        // 64-bit extended size
        let (r, s) = be_u64(rest)?;
        (r, s)
    } else {
        (rest, size32 as u64)
    };

    Ok((rest, BoxHeader { size, box_type }))
}

/// 递归遍历 box 树，返回感兴趣字段
pub fn parse(data: &[u8]) -> Result<Mp4Metadata> {
    let mut meta = Mp4Metadata::default();
    walk_boxes(data, &mut meta, 0)?;
    Ok(meta)
}

fn walk_boxes(data: &[u8], meta: &mut Mp4Metadata, depth: usize) -> Result<()> {
    if depth > 16 {
        return Ok(());
    } // 防止无限递归

    let mut pos = 0usize;
    while pos + 8 <= data.len() {
        let slice = &data[pos..];
        let Ok((_, hdr)) = parse_box_header(slice) else {
            break;
        };

        let header_size = if hdr.size == 1 { 16 } else { 8 };
        let total = hdr.size as usize;
        if total < header_size || pos + total > data.len() {
            break;
        }

        let payload = &data[pos + header_size..pos + total];

        match &hdr.box_type {
            b"moov" | b"trak" | b"mdia" | b"minf" | b"stbl" => {
                walk_boxes(payload, meta, depth + 1)?;
            }
            b"mvhd" => parse_mvhd(payload, meta),
            b"tkhd" => parse_tkhd(payload, meta),
            b"stts" => parse_stts(payload, meta),
            _ => {}
        }

        pos += total;
    }
    Ok(())
}

fn parse_mvhd(data: &[u8], meta: &mut Mp4Metadata) {
    if data.len() < 4 {
        return;
    }
    let version = data[0];
    if version == 0 && data.len() >= 20 {
        // v0: creation(4) + modification(4) + timescale(4) + duration(4)
        let timescale = u32::from_be_bytes([data[12], data[13], data[14], data[15]]);
        let duration = u32::from_be_bytes([data[16], data[17], data[18], data[19]]);
        if timescale > 0 {
            meta.duration_ms = (duration as u64 * 1000) / timescale as u64;
        }
    } else if version == 1 && data.len() >= 32 {
        // v1: creation(8) + modification(8) + timescale(4) + duration(8)
        let timescale = u32::from_be_bytes([data[24], data[25], data[26], data[27]]);
        let duration = u64::from_be_bytes(data[28..36].try_into().unwrap_or([0; 8]));
        if timescale > 0 {
            meta.duration_ms = (duration * 1000) / timescale as u64;
        }
    }
}

fn parse_tkhd(data: &[u8], meta: &mut Mp4Metadata) {
    if data.len() < 4 {
        return;
    }
    let version = data[0];
    // 简单解析 track_id
    let track_id = if version == 0 && data.len() >= 16 {
        u32::from_be_bytes([data[12], data[13], data[14], data[15]])
    } else if version == 1 && data.len() >= 24 {
        u32::from_be_bytes([data[20], data[21], data[22], data[23]])
    } else {
        return;
    };
    meta.tracks.push(Track {
        track_id,
        duration_ms: 0,
        is_video: false,
        width: 0,
        height: 0,
        timescale: 0,
    });
}

fn parse_stts(data: &[u8], meta: &mut Mp4Metadata) {
    // stts: version(1) + flags(3) + entry_count(4) + [sample_count(4) + sample_delta(4)] * N
    if data.len() < 8 {
        return;
    }
    let entry_count = u32::from_be_bytes([data[4], data[5], data[6], data[7]]) as usize;
    let mut offset = 8usize;
    let mut ts_ms: u64 = 0;

    for _ in 0..entry_count {
        if offset + 8 > data.len() {
            break;
        }
        let sample_count = u32::from_be_bytes(data[offset..offset + 4].try_into().unwrap()) as u64;
        let sample_delta =
            u32::from_be_bytes(data[offset + 4..offset + 8].try_into().unwrap()) as u64;
        // 假设 timescale=90000（H.264 常见值），转换为毫秒
        for _ in 0..sample_count.min(1000) {
            // 避免 frames 列表过大，只存关键帧估算时间戳
            meta.frame_timestamps_ms.push(ts_ms * 1000 / 90000);
            ts_ms += sample_delta;
        }
        offset += 8;
    }
}
