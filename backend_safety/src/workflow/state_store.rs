// src/workflow/state_store.rs — 原子化 JSON 持久化
// 使用 tempfile + rename 保证 crash-safe 写入

use std::path::{Path, PathBuf};
use tokio::fs;
use tracing::{info, warn};

/// WorkflowStateStore 管理工作流定义和运行状态的文件存储
pub struct WorkflowStateStore {
    /// 工作流定义目录: storage/workflows/
    workflows_dir: PathBuf,
    /// 运行状态目录: storage/workflows/runs/
    runs_dir: PathBuf,
}

impl WorkflowStateStore {
    /// 创建并初始化存储目录
    pub async fn new(base_dir: &Path) -> anyhow::Result<Self> {
        let workflows_dir = base_dir.join("workflows");
        let runs_dir = workflows_dir.join("runs");
        fs::create_dir_all(&workflows_dir).await?;
        fs::create_dir_all(&runs_dir).await?;
        info!(
            "WorkflowStateStore initialized at {}",
            workflows_dir.display()
        );
        Ok(Self {
            workflows_dir,
            runs_dir,
        })
    }

    // ── 工作流定义 CRUD ──────────────────────────────────────────

    /// 原子写入工作流定义 JSON
    pub async fn save_workflow(&self, id: &str, payload_json: &str) -> anyhow::Result<String> {
        let target = self.workflow_path(id);
        let written_path = atomic_write(&target, payload_json.as_bytes()).await?;
        info!("Saved workflow id={id} → {written_path}");
        Ok(written_path)
    }

    /// 读取工作流定义 JSON（不存在返回 None）
    pub async fn load_workflow(&self, id: &str) -> anyhow::Result<Option<String>> {
        let path = self.workflow_path(id);
        read_optional(&path).await
    }

    /// 删除工作流定义文件
    pub async fn delete_workflow(&self, id: &str) -> anyhow::Result<bool> {
        let path = self.workflow_path(id);
        if path.exists() {
            fs::remove_file(&path).await?;
            info!("Deleted workflow id={id}");
            Ok(true)
        } else {
            warn!("Delete workflow id={id}: not found");
            Ok(false)
        }
    }

    /// 列出所有工作流摘要（从文件名和 JSON 解析）
    pub async fn list_workflows(&self) -> anyhow::Result<Vec<WorkflowFileMeta>> {
        list_json_files(&self.workflows_dir, false).await
    }

    // ── 运行状态 CRUD ────────────────────────────────────────────

    /// 原子写入运行状态 JSON
    pub async fn save_run_state(&self, run_id: &str, payload_json: &str) -> anyhow::Result<String> {
        let target = self.run_path(run_id);
        let written_path = atomic_write(&target, payload_json.as_bytes()).await?;
        info!("Saved run state run_id={run_id} → {written_path}");
        Ok(written_path)
    }

    /// 读取运行状态 JSON（不存在返回 None）
    pub async fn load_run_state(&self, run_id: &str) -> anyhow::Result<Option<String>> {
        let path = self.run_path(run_id);
        read_optional(&path).await
    }

    /// 列出指定工作流的所有运行状态摘要
    pub async fn list_run_states(
        &self,
        workflow_id: &str,
        limit: usize,
    ) -> anyhow::Result<Vec<RunStateMeta>> {
        let mut entries = Vec::new();
        let mut read_dir = fs::read_dir(&self.runs_dir).await?;

        while let Some(entry) = read_dir.next_entry().await? {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }

            let content = match fs::read_to_string(&path).await {
                Ok(c) => c,
                Err(e) => {
                    warn!("Failed to read run state {:?}: {e}", path);
                    continue;
                }
            };

            // 解析最小字段（避免解析大型完整 payload）
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
                let wf_id = v["workflow_id"].as_str().unwrap_or("").to_string();
                if !workflow_id.is_empty() && wf_id != workflow_id {
                    continue;
                }
                entries.push(RunStateMeta {
                    run_id: v["run_id"].as_str().unwrap_or("").to_string(),
                    workflow_id: wf_id,
                    status: v["status"].as_str().unwrap_or("unknown").to_string(),
                    started_at: v["started_at"].as_i64().unwrap_or(0),
                    finished_at: v["finished_at"].as_i64().unwrap_or(0),
                });
            }

            if limit > 0 && entries.len() >= limit {
                break;
            }
        }

        // 按 started_at 降序排列（最新在前）
        entries.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        Ok(entries)
    }

    // ── 辅助 ─────────────────────────────────────────────────────

    fn workflow_path(&self, id: &str) -> PathBuf {
        // 清理 ID 防止路径穿越
        let safe_id = sanitize_id(id);
        self.workflows_dir.join(format!("{safe_id}.json"))
    }

    fn run_path(&self, run_id: &str) -> PathBuf {
        let safe_id = sanitize_id(run_id);
        self.runs_dir.join(format!("{safe_id}.json"))
    }
}

/// 文件元数据（工作流列表用）
pub struct WorkflowFileMeta {
    pub id: String,
    pub name: String,
    pub description: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub node_count: i32,
}

/// 运行状态元数据（run 列表用）
pub struct RunStateMeta {
    pub run_id: String,
    pub workflow_id: String,
    pub status: String,
    pub started_at: i64,
    pub finished_at: i64,
}

// ── 内部工具函数 ──────────────────────────────────────────────────

/// 原子写入: write → temp file → fsync → rename
async fn atomic_write(target: &Path, data: &[u8]) -> anyhow::Result<String> {
    let parent = target.parent().unwrap_or(Path::new("."));
    let tmp_path = parent.join(format!(
        ".tmp_{}.{}",
        target.file_name().unwrap_or_default().to_string_lossy(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .subsec_nanos()
    ));

    // 写入临时文件
    fs::write(&tmp_path, data).await?;

    // fsync — 确保数据落盘（重要：保证 rename 后可读）
    let file = std::fs::File::open(&tmp_path)?;
    file.sync_all()?;
    drop(file);

    // 原子 rename
    fs::rename(&tmp_path, target).await?;

    Ok(target.to_string_lossy().to_string())
}

/// 读取文件，不存在时返回 None
async fn read_optional(path: &Path) -> anyhow::Result<Option<String>> {
    match fs::read_to_string(path).await {
        Ok(content) => Ok(Some(content)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// 列出目录下的 .json 文件并解析摘要字段
async fn list_json_files(dir: &Path, _recursive: bool) -> anyhow::Result<Vec<WorkflowFileMeta>> {
    let mut results = Vec::new();
    let mut read_dir = fs::read_dir(dir).await?;

    while let Some(entry) = read_dir.next_entry().await? {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        // 跳过 runs/ 子目录
        if path.is_dir() {
            continue;
        }

        let content = match fs::read_to_string(&path).await {
            Ok(c) => c,
            Err(e) => {
                warn!("Cannot read {:?}: {e}", path);
                continue;
            }
        };

        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
            let id = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            results.push(WorkflowFileMeta {
                id: v["id"].as_str().unwrap_or(&id).to_string(),
                name: v["name"].as_str().unwrap_or("").to_string(),
                description: v["description"].as_str().unwrap_or("").to_string(),
                created_at: v["created_at"].as_i64().unwrap_or(0),
                updated_at: v["updated_at"].as_i64().unwrap_or(0),
                node_count: v["nodes"].as_array().map(|a| a.len() as i32).unwrap_or(0),
            });
        }
    }

    // 按 updated_at 降序
    results.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(results)
}

/// 清理 ID，只保留 ASCII 字母数字、连字符、下划线（防止路径穿越）
fn sanitize_id(id: &str) -> String {
    id.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(128)
        .collect()
}
