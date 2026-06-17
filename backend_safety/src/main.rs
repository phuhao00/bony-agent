// src/main.rs — 解析服务 + 工作流状态存储 入口
mod generated;
mod grpc;
mod parser;
mod workflow;

use std::net::SocketAddr;
use std::path::Path;
use tonic::transport::Server;
use tracing::info;

use generated::mediaagent::{
    document_service_server::DocumentServiceServer, video_service_server::VideoServiceServer,
    workflow_state_service_server::WorkflowStateServiceServer,
};
use grpc::{document::DocumentServiceImpl, video::VideoServiceImpl};
use workflow::{
    crypto::try_from_env as workflow_crypto_from_env, service::WorkflowStateServiceImpl,
    state_store::WorkflowStateStore,
};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // 日志初始化（RUST_LOG=info,parser_service=debug）
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_env("RUST_LOG")
                .add_directive("parser_service=info".parse()?),
        )
        .init();

    let port: u16 = std::env::var("PARSER_PORT")
        .unwrap_or_else(|_| "50052".into())
        .parse()?;
    let addr: SocketAddr = format!("0.0.0.0:{port}").parse()?;

    // 工作流存储根目录（遵循项目规范：使用 storage/ 而非 /tmp）
    let storage_base =
        std::env::var("STORAGE_BASE").unwrap_or_else(|_| "../../storage".to_string());
    let store = WorkflowStateStore::new(Path::new(&storage_base)).await?;
    let crypto = workflow_crypto_from_env();

    info!("Media Parser + WorkflowStateStore gRPC service starting on {addr}");

    Server::builder()
        .add_service(DocumentServiceServer::new(DocumentServiceImpl::default()))
        .add_service(VideoServiceServer::new(VideoServiceImpl::default()))
        .add_service(WorkflowStateServiceServer::new(
            WorkflowStateServiceImpl::new(store, crypto),
        ))
        .serve(addr)
        .await?;

    Ok(())
}
