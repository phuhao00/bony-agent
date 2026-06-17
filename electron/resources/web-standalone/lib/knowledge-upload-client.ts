export type UploadStage =
  | "queued"
  | "reading"
  | "analyzing"
  | "uploading"
  | "indexing"
  | "done"
  | "error";

export type FileUploadItem = {
  id: string;
  fileName: string;
  fileSize: number;
  stage: UploadStage;
  progress: number;
  categoryId?: string;
  categoryName?: string;
  autoAssigned?: boolean;
  error?: string;
};

export type UploadKnowledgeOptions = {
  file: File;
  autoCategory?: boolean;
  category?: string;
  onStage?: (stage: UploadStage, progress: number) => void;
};

export type UploadKnowledgeResult = {
  success: boolean;
  assignedCategory?: string;
  autoAssigned?: boolean;
  documentId?: string;
  error?: string;
};

const STAGE_LABELS: Record<UploadStage, string> = {
  queued: "排队中",
  reading: "读取文件",
  analyzing: "智能分析分类",
  uploading: "上传中",
  indexing: "解析转化并入库",
  done: "完成",
  error: "失败",
};

/** 各阶段进度上限 —— 只有 done/error 才到 100 */
const STAGE_PROGRESS_CAP: Record<UploadStage, number> = {
  queued: 5,
  reading: 12,
  analyzing: 18,
  uploading: 55,
  indexing: 95,
  done: 100,
  error: 100,
};

export function uploadStageLabel(stage: UploadStage): string {
  return STAGE_LABELS[stage];
}

/** 从文件列表推导总进度，避免与单文件状态不一致 */
export function computeOverallUploadProgress(items: FileUploadItem[]): number {
  if (!items.length) return 0;
  const sum = items.reduce((acc, item) => acc + item.progress, 0);
  return Math.round(sum / items.length);
}

export function isUploadBatchFinished(items: FileUploadItem[]): boolean {
  return (
    items.length > 0 &&
    items.every((item) => item.stage === "done" || item.stage === "error")
  );
}

function clampStageProgress(stage: UploadStage, value: number): number {
  const cap = STAGE_PROGRESS_CAP[stage];
  const prevCap =
    stage === "uploading"
      ? STAGE_PROGRESS_CAP.analyzing
      : stage === "indexing"
        ? STAGE_PROGRESS_CAP.uploading
        : stage === "done" || stage === "error"
          ? STAGE_PROGRESS_CAP.indexing
          : 0;
  return Math.max(prevCap, Math.min(cap, Math.round(value)));
}

function parseUploadResponse(
  status: number,
  raw: string,
): UploadKnowledgeResult {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return { success: false, error: "响应解析失败" };
  }

  if (status < 200 || status >= 300) {
    const detail =
      (typeof data.detail === "string" && data.detail) ||
      (typeof data.error === "string" && data.error) ||
      `上传失败 (${status})`;
    return { success: false, error: detail };
  }

  if (data.success !== true) {
    const detail =
      (typeof data.detail === "string" && data.detail) ||
      (typeof data.error === "string" && data.error) ||
      "上传失败";
    return { success: false, error: detail };
  }

  const documents = Array.isArray(data.documents) ? data.documents : [];
  if (!documents.length) {
    return { success: false, error: "服务端未返回已入库的文档" };
  }

  const firstDoc = documents[0] as { id?: string };
  return {
    success: true,
    assignedCategory:
      typeof data.assigned_category === "string"
        ? data.assigned_category
        : undefined,
    autoAssigned: data.auto_assigned === true,
    documentId: typeof firstDoc.id === "string" ? firstDoc.id : undefined,
  };
}

export function uploadKnowledgeFile(
  options: UploadKnowledgeOptions,
): Promise<UploadKnowledgeResult> {
  const { file, autoCategory = true, category, onStage } = options;

  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("file", file);
    formData.append("auto_optimize", "true");
    if (autoCategory) {
      formData.append("auto_category", "true");
      formData.append("category", "auto");
    } else if (category) {
      formData.append("category", category);
    }

    let indexingTimer: ReturnType<typeof setInterval> | null = null;
    let indexingProgress = STAGE_PROGRESS_CAP.uploading;

    const emit = (stage: UploadStage, progress: number) => {
      onStage?.(stage, clampStageProgress(stage, progress));
    };

    const stopIndexingPulse = () => {
      if (indexingTimer) {
        clearInterval(indexingTimer);
        indexingTimer = null;
      }
    };

    const startIndexingPulse = () => {
      stopIndexingPulse();
      indexingProgress = STAGE_PROGRESS_CAP.uploading + 2;
      emit("indexing", indexingProgress);
      indexingTimer = setInterval(() => {
        indexingProgress = Math.min(indexingProgress + 1, STAGE_PROGRESS_CAP.indexing);
        emit("indexing", indexingProgress);
        if (indexingProgress >= STAGE_PROGRESS_CAP.indexing) {
          stopIndexingPulse();
        }
      }, 2500);
    };

    emit("uploading", STAGE_PROGRESS_CAP.analyzing + 2);

    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      const ratio = Math.min(1, event.loaded / Math.max(event.total, 1));
      const pct =
        STAGE_PROGRESS_CAP.analyzing +
        2 +
        ratio * (STAGE_PROGRESS_CAP.uploading - STAGE_PROGRESS_CAP.analyzing - 2);
      emit("uploading", pct);
    });

    xhr.upload.addEventListener("loadend", () => {
      startIndexingPulse();
    });

    xhr.addEventListener("load", () => {
      stopIndexingPulse();
      const result = parseUploadResponse(xhr.status, xhr.responseText || "");
      if (result.success) {
        emit("done", 100);
      } else {
        emit("error", 100);
      }
      resolve(result);
    });

    xhr.addEventListener("error", () => {
      stopIndexingPulse();
      emit("error", 100);
      resolve({ success: false, error: "网络错误" });
    });

    xhr.addEventListener("abort", () => {
      stopIndexingPulse();
      emit("error", 100);
      resolve({ success: false, error: "已取消" });
    });

    xhr.addEventListener("timeout", () => {
      stopIndexingPulse();
      emit("error", 100);
      resolve({ success: false, error: "上传超时，PDF/OCR 可能仍在处理，请稍后刷新列表" });
    });

    xhr.open("POST", "/api/knowledge/upload");
    xhr.timeout = 600_000;
    xhr.send(formData);
  });
}

export function createUploadItem(file: File): FileUploadItem {
  return {
    id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
    fileName: file.name,
    fileSize: file.size,
    stage: "queued",
    progress: 0,
  };
}
