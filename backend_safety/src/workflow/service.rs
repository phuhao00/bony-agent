// src/workflow/service.rs — WorkflowStateService gRPC handler
use std::sync::Arc;

use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tonic::{Request, Response, Status};
use tracing::{info, warn};

use crate::generated::mediaagent::{
    workflow_state_service_server::WorkflowStateService,
    DecryptRequest, DecryptResponse, DeleteAck, DeleteWorkflowRequest,
    EncryptRequest, EncryptResponse, ListRunStatesRequest, ListWorkflowsRequest,
    LoadRunStateRequest, LoadRunStateResponse, LoadWorkflowRequest, LoadWorkflowResponse,
    RunStateSummary, SaveAck, SaveRunStateRequest, SaveWorkflowRequest, WorkflowSummary,
};

use super::crypto::WorkflowCrypto;
use super::state_store::WorkflowStateStore;

/// WorkflowStateServiceImpl — Rust gRPC 服务实现
pub struct WorkflowStateServiceImpl {
    store: Arc<WorkflowStateStore>,
    crypto: Option<WorkflowCrypto>,
}

impl WorkflowStateServiceImpl {
    pub fn new(store: WorkflowStateStore, crypto: Option<WorkflowCrypto>) -> Self {
        Self {
            store: Arc::new(store),
            crypto,
        }
    }
}

#[tonic::async_trait]
impl WorkflowStateService for WorkflowStateServiceImpl {
    // ── 工作流定义 ─────────────────────────────────────────────

    async fn save_workflow(
        &self,
        request: Request<SaveWorkflowRequest>,
    ) -> Result<Response<SaveAck>, Status> {
        let req = request.into_inner();
        match self.store.save_workflow(&req.id, &req.payload_json).await {
            Ok(path) => Ok(Response::new(SaveAck {
                success: true,
                path,
            })),
            Err(e) => {
                warn!("save_workflow error: {e}");
                Err(Status::internal(e.to_string()))
            }
        }
    }

    async fn load_workflow(
        &self,
        request: Request<LoadWorkflowRequest>,
    ) -> Result<Response<LoadWorkflowResponse>, Status> {
        let req = request.into_inner();
        match self.store.load_workflow(&req.id).await {
            Ok(Some(payload_json)) => Ok(Response::new(LoadWorkflowResponse {
                found: true,
                payload_json,
            })),
            Ok(None) => Ok(Response::new(LoadWorkflowResponse {
                found: false,
                payload_json: String::new(),
            })),
            Err(e) => Err(Status::internal(e.to_string())),
        }
    }

    async fn delete_workflow(
        &self,
        request: Request<DeleteWorkflowRequest>,
    ) -> Result<Response<DeleteAck>, Status> {
        let req = request.into_inner();
        match self.store.delete_workflow(&req.id).await {
            Ok(success) => Ok(Response::new(DeleteAck {
                success,
                message: if success {
                    "deleted".to_string()
                } else {
                    "not found".to_string()
                },
            })),
            Err(e) => Err(Status::internal(e.to_string())),
        }
    }

    type ListWorkflowsStream = ReceiverStream<Result<WorkflowSummary, Status>>;

    async fn list_workflows(
        &self,
        _request: Request<ListWorkflowsRequest>,
    ) -> Result<Response<Self::ListWorkflowsStream>, Status> {
        let store = Arc::clone(&self.store);
        let (tx, rx) = mpsc::channel(32);

        tokio::spawn(async move {
            match store.list_workflows().await {
                Ok(items) => {
                    for item in items {
                        let summary = WorkflowSummary {
                            id: item.id,
                            name: item.name,
                            description: item.description,
                            created_at: item.created_at,
                            updated_at: item.updated_at,
                            node_count: item.node_count,
                        };
                        if tx.send(Ok(summary)).await.is_err() {
                            break; // client disconnected
                        }
                    }
                }
                Err(e) => {
                    let _ = tx
                        .send(Err(Status::internal(e.to_string())))
                        .await;
                }
            }
        });

        Ok(Response::new(ReceiverStream::new(rx)))
    }

    // ── 运行状态 ────────────────────────────────────────────────

    async fn save_run_state(
        &self,
        request: Request<SaveRunStateRequest>,
    ) -> Result<Response<SaveAck>, Status> {
        let req = request.into_inner();
        match self
            .store
            .save_run_state(&req.run_id, &req.payload_json)
            .await
        {
            Ok(path) => Ok(Response::new(SaveAck {
                success: true,
                path,
            })),
            Err(e) => {
                warn!("save_run_state error: {e}");
                Err(Status::internal(e.to_string()))
            }
        }
    }

    async fn load_run_state(
        &self,
        request: Request<LoadRunStateRequest>,
    ) -> Result<Response<LoadRunStateResponse>, Status> {
        let req = request.into_inner();
        match self.store.load_run_state(&req.run_id).await {
            Ok(Some(payload_json)) => Ok(Response::new(LoadRunStateResponse {
                found: true,
                payload_json,
            })),
            Ok(None) => Ok(Response::new(LoadRunStateResponse {
                found: false,
                payload_json: String::new(),
            })),
            Err(e) => Err(Status::internal(e.to_string())),
        }
    }

    type ListRunStatesStream = ReceiverStream<Result<RunStateSummary, Status>>;

    async fn list_run_states(
        &self,
        request: Request<ListRunStatesRequest>,
    ) -> Result<Response<Self::ListRunStatesStream>, Status> {
        let req = request.into_inner();
        let store = Arc::clone(&self.store);
        let (tx, rx) = mpsc::channel(32);

        tokio::spawn(async move {
            let limit = if req.limit <= 0 {
                0
            } else {
                req.limit as usize
            };
            match store.list_run_states(&req.workflow_id, limit).await {
                Ok(items) => {
                    for item in items {
                        let summary = RunStateSummary {
                            run_id: item.run_id,
                            workflow_id: item.workflow_id,
                            status: item.status,
                            started_at: item.started_at,
                            finished_at: item.finished_at,
                        };
                        if tx.send(Ok(summary)).await.is_err() {
                            break;
                        }
                    }
                }
                Err(e) => {
                    let _ = tx
                        .send(Err(Status::internal(e.to_string())))
                        .await;
                }
            }
        });

        Ok(Response::new(ReceiverStream::new(rx)))
    }

    // ── 凭证加密 ────────────────────────────────────────────────

    async fn encrypt_node_config(
        &self,
        request: Request<EncryptRequest>,
    ) -> Result<Response<EncryptResponse>, Status> {
        let req = request.into_inner();
        match &self.crypto {
            Some(crypto) => match crypto.encrypt(&req.plaintext) {
                Ok(ciphertext) => Ok(Response::new(EncryptResponse { ciphertext })),
                Err(e) => Err(Status::internal(format!("Encrypt failed: {e}"))),
            },
            None => Err(Status::failed_precondition(
                "WORKFLOW_ENCRYPT_KEY not configured",
            )),
        }
    }

    async fn decrypt_node_config(
        &self,
        request: Request<DecryptRequest>,
    ) -> Result<Response<DecryptResponse>, Status> {
        let req = request.into_inner();
        match &self.crypto {
            Some(crypto) => match crypto.decrypt(&req.ciphertext) {
                Ok(plaintext) => Ok(Response::new(DecryptResponse { plaintext })),
                Err(e) => Err(Status::internal(format!("Decrypt failed: {e}"))),
            },
            None => Err(Status::failed_precondition(
                "WORKFLOW_ENCRYPT_KEY not configured",
            )),
        }
    }
}
