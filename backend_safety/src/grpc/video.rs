// src/grpc/video.rs — VideoService gRPC 实现

use tonic::{Request, Response, Status};
use tracing::info;
use uuid::Uuid;

use crate::generated::mediaagent::{
    video_service_server::VideoService, AudioResponse, KeyFrame, KeyFrameResponse, TaskStatus,
    VideoMetadata as ProtoVideoMetadata, VideoRequest,
};
use crate::parser::video as vid_parser;

#[derive(Debug, Default)]
pub struct VideoServiceImpl;

#[tonic::async_trait]
impl VideoService for VideoServiceImpl {
    // ── GetMetadata ───────────────────────────────────────
    async fn get_metadata(
        &self,
        request: Request<VideoRequest>,
    ) -> Result<Response<ProtoVideoMetadata>, Status> {
        let req = request.into_inner();
        let req_id = if req.request_id.is_empty() {
            Uuid::new_v4().to_string()
        } else {
            req.request_id.clone()
        };
        info!("GetMetadata req_id={req_id}");

        let (data, path_hint) = load_source(&req).await?;

        let info = vid_parser::get_metadata(&data, path_hint.as_deref())
            .map_err(|e| Status::internal(e.to_string()))?;

        let file_name = path_hint
            .as_ref()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        Ok(Response::new(ProtoVideoMetadata {
            file_name,
            file_path: path_hint
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default(),
            file_size: data.len() as i64,
            duration_ms: info.duration_ms as i64,
            container: info.container,
            ..Default::default()
        }))
    }

    // ── ExtractKeyFrames ──────────────────────────────────
    async fn extract_key_frames(
        &self,
        request: Request<VideoRequest>,
    ) -> Result<Response<KeyFrameResponse>, Status> {
        let req = request.into_inner();
        let req_id = if req.request_id.is_empty() {
            Uuid::new_v4().to_string()
        } else {
            req.request_id.clone()
        };
        let max_frames = if req.max_frames <= 0 {
            10
        } else {
            req.max_frames as usize
        };

        info!("ExtractKeyFrames req_id={req_id} max_frames={max_frames}");

        let (data, path_hint) = load_source(&req).await?;

        let info = vid_parser::get_metadata(&data, path_hint.as_deref())
            .map_err(|e| Status::internal(e.to_string()))?;

        let timestamps =
            vid_parser::sample_keyframe_timestamps(&info.frame_timestamps_ms, max_frames);

        let frames: Vec<KeyFrame> = timestamps
            .into_iter()
            .enumerate()
            .map(|(i, ts)| {
                KeyFrame {
                    timestamp_ms: ts as i64,
                    frame_index: i as i32,
                    // 实际帧提取需 ffmpeg；这里返回时间戳坐标，由 Python 端调用 ffmpeg 提取
                    ..Default::default()
                }
            })
            .collect();

        let meta = ProtoVideoMetadata {
            file_size: data.len() as i64,
            duration_ms: info.duration_ms as i64,
            container: info.container,
            ..Default::default()
        };

        Ok(Response::new(KeyFrameResponse {
            request_id: req_id,
            metadata: Some(meta),
            frames,
            status: TaskStatus::Completed as i32,
            ..Default::default()
        }))
    }

    // ── ExtractAudio ──────────────────────────────────────
    async fn extract_audio(
        &self,
        request: Request<VideoRequest>,
    ) -> Result<Response<AudioResponse>, Status> {
        let req = request.into_inner();
        let req_id = if req.request_id.is_empty() {
            Uuid::new_v4().to_string()
        } else {
            req.request_id.clone()
        };

        // 音频提取委托给 ffmpeg 子进程
        let (_, path_hint) = load_source(&req).await?;
        let video_path = path_hint
            .ok_or_else(|| Status::invalid_argument("file_path required for audio extraction"))?;

        let audio_format = if req.audio_format.is_empty() {
            "wav".to_string()
        } else {
            req.audio_format.clone()
        };
        let out_path = video_path.with_extension(&audio_format);

        let status = tokio::process::Command::new("ffmpeg")
            .args([
                "-i",
                video_path.to_str().unwrap_or(""),
                "-vn",
                "-acodec",
                if audio_format == "mp3" {
                    "libmp3lame"
                } else {
                    "pcm_s16le"
                },
                "-y",
                out_path.to_str().unwrap_or(""),
            ])
            .status()
            .await
            .map_err(|e| Status::internal(format!("ffmpeg failed: {e}")))?;

        if !status.success() {
            return Err(Status::internal("ffmpeg exited with non-zero status"));
        }

        Ok(Response::new(AudioResponse {
            request_id: req_id,
            audio_path: out_path.to_string_lossy().to_string(),
            status: crate::generated::mediaagent::TaskStatus::Completed as i32,
            ..Default::default()
        }))
    }
}

// ── 辅助：加载数据源 ────────────────────────────────────────
async fn load_source(req: &VideoRequest) -> Result<(Vec<u8>, Option<std::path::PathBuf>), Status> {
    match req
        .source
        .as_ref()
        .ok_or_else(|| Status::invalid_argument("source required"))?
    {
        crate::generated::mediaagent::video_request::Source::FileData(b) => Ok((b.clone(), None)),
        crate::generated::mediaagent::video_request::Source::FilePath(p) => {
            let bytes = tokio::fs::read(p)
                .await
                .map_err(|e| Status::not_found(format!("Cannot read file: {e}")))?;
            Ok((bytes, Some(std::path::PathBuf::from(p))))
        }
    }
}
