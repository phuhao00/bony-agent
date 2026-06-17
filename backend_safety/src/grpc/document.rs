// src/grpc/document.rs — DocumentService gRPC 实现

use tokio_stream::wrappers::ReceiverStream;
use tonic::{Request, Response, Status};
use tracing::{info, warn};
use uuid::Uuid;

use crate::generated::mediaagent::{
    document_service_server::DocumentService, DocumentBatchRequest, DocumentBatchResponse,
    DocumentChunk, DocumentMetadata, DocumentRequest, DocumentResponse, PageContent, TaskStatus,
};
use crate::parser::document as doc_parser;

#[derive(Debug, Default)]
pub struct DocumentServiceImpl;

#[tonic::async_trait]
impl DocumentService for DocumentServiceImpl {
    // ── ParseDocument（同步）────────────────────────────────
    async fn parse_document(
        &self,
        request: Request<DocumentRequest>,
    ) -> Result<Response<DocumentResponse>, Status> {
        let req = request.into_inner();
        let req_id = if req.request_id.is_empty() {
            Uuid::new_v4().to_string()
        } else {
            req.request_id.clone()
        };
        info!("ParseDocument req_id={req_id}");

        let t0 = std::time::Instant::now();

        // 读取数据
        let (data, path_hint): (Vec<u8>, Option<std::path::PathBuf>) = match req
            .source
            .as_ref()
            .ok_or_else(|| Status::invalid_argument("source required"))?
        {
            crate::generated::mediaagent::document_request::Source::FileData(b) => {
                (b.clone(), None)
            }
            crate::generated::mediaagent::document_request::Source::FilePath(p) => {
                let bytes = tokio::fs::read(p)
                    .await
                    .map_err(|e| Status::not_found(format!("Cannot read file: {e}")))?;
                (bytes, Some(std::path::PathBuf::from(p)))
            }
        };

        // 解析
        let result =
            doc_parser::parse_document(&data, path_hint.as_deref(), req.start_page, req.end_page)
                .map_err(|e| Status::internal(e.to_string()))?;

        let pages: Vec<PageContent> = result
            .pages
            .iter()
            .map(|p| PageContent {
                page_number: p.page,
                text: p.text.clone(),
                tables: vec![],
                text_blocks: vec![],
            })
            .collect();

        let file_name = path_hint
            .as_ref()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        let meta = DocumentMetadata {
            file_name,
            file_path: path_hint
                .as_ref()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default(),
            file_size: data.len() as i64,
            page_count: result.page_count,
            format: format!("{:?}", result.format).to_lowercase(),
            ..Default::default()
        };

        let latency = t0.elapsed().as_millis() as i64;
        info!(
            "ParseDocument done req_id={req_id} pages={} latency={latency}ms",
            result.page_count
        );

        Ok(Response::new(DocumentResponse {
            request_id: req_id,
            metadata: Some(meta),
            full_text: result.full_text,
            pages,
            status: TaskStatus::Completed as i32,
            latency_ms: latency,
            ..Default::default()
        }))
    }

    // ── ParseDocumentStream（服务端流式）────────────────────
    type ParseDocumentStreamStream = ReceiverStream<Result<DocumentChunk, Status>>;

    async fn parse_document_stream(
        &self,
        request: Request<DocumentRequest>,
    ) -> Result<Response<Self::ParseDocumentStreamStream>, Status> {
        let req = request.into_inner();
        let req_id = if req.request_id.is_empty() {
            Uuid::new_v4().to_string()
        } else {
            req.request_id.clone()
        };

        let (tx, rx) = tokio::sync::mpsc::channel(32);

        tokio::spawn(async move {
            let data_result: Result<(Vec<u8>, Option<std::path::PathBuf>), Status> =
                match req.source.as_ref() {
                    Some(crate::generated::mediaagent::document_request::Source::FileData(b)) => {
                        Ok((b.clone(), None))
                    }
                    Some(crate::generated::mediaagent::document_request::Source::FilePath(p)) => {
                        tokio::fs::read(p)
                            .await
                            .map(|b| (b, Some(std::path::PathBuf::from(p))))
                            .map_err(|e| Status::not_found(e.to_string()))
                    }
                    None => Err(Status::invalid_argument("source required")),
                };

            let (data, path_hint) = match data_result {
                Ok(v) => v,
                Err(e) => {
                    let _ = tx.send(Err(e)).await;
                    return;
                }
            };

            let result = match doc_parser::parse_document(
                &data,
                path_hint.as_deref(),
                req.start_page,
                req.end_page,
            ) {
                Ok(r) => r,
                Err(e) => {
                    let _ = tx.send(Err(Status::internal(e.to_string()))).await;
                    return;
                }
            };

            let total = result.pages.len() as i32;
            for (idx, page) in result.pages.into_iter().enumerate() {
                let is_last = idx as i32 == total - 1;
                let chunk = DocumentChunk {
                    request_id: req_id.clone(),
                    page: Some(PageContent {
                        page_number: page.page,
                        text: page.text,
                        tables: vec![],
                        text_blocks: vec![],
                    }),
                    total_pages: total,
                    is_last,
                    status: TaskStatus::Running as i32,
                    ..Default::default()
                };
                if tx.send(Ok(chunk)).await.is_err() {
                    break;
                }
            }
        });

        Ok(Response::new(ReceiverStream::new(rx)))
    }

    // ── ParseBatch（双向流式）───────────────────────────────
    type ParseBatchStream = ReceiverStream<Result<DocumentBatchResponse, Status>>;

    async fn parse_batch(
        &self,
        request: Request<tonic::Streaming<DocumentBatchRequest>>,
    ) -> Result<Response<Self::ParseBatchStream>, Status> {
        let mut stream = request.into_inner();
        let (tx, rx) = tokio::sync::mpsc::channel(32);

        tokio::spawn(async move {
            while let Ok(Some(batch_req)) = stream.message().await {
                let idx = batch_req.batch_index;
                let inner = match batch_req.request {
                    Some(r) => r,
                    None => continue,
                };
                // 复用同步解析（简化）
                let data = match inner.source.as_ref() {
                    Some(crate::generated::mediaagent::document_request::Source::FileData(b)) => {
                        b.clone()
                    }
                    Some(crate::generated::mediaagent::document_request::Source::FilePath(p)) => {
                        match tokio::fs::read(p).await {
                            Ok(b) => b,
                            Err(e) => {
                                let _ = tx.send(Err(Status::not_found(e.to_string()))).await;
                                continue;
                            }
                        }
                    }
                    None => continue,
                };
                let req_id = inner.request_id.clone();
                let result =
                    doc_parser::parse_document(&data, None, inner.start_page, inner.end_page);
                match result {
                    Ok(r) => {
                        let resp = DocumentResponse {
                            request_id: req_id,
                            full_text: r.full_text,
                            status: TaskStatus::Completed as i32,
                            ..Default::default()
                        };
                        let _ = tx
                            .send(Ok(DocumentBatchResponse {
                                response: Some(resp),
                                batch_index: idx,
                            }))
                            .await;
                    }
                    Err(e) => {
                        warn!("ParseBatch item failed: {e}");
                    }
                }
            }
        });

        Ok(Response::new(ReceiverStream::new(rx)))
    }
}
