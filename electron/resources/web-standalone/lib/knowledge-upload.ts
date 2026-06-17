/** 与 backend/utils/rag_manager.py SUPPORTED_EXTENSIONS 对齐 */
export const KNOWLEDGE_SUPPORTED_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".pdf",
  ".docx",
  ".doc",
  ".json",
  ".csv",
  ".xlsx",
  ".xls",
]);

export const KNOWLEDGE_ACCEPT_ATTR =
  ".txt,.md,.pdf,.docx,.doc,.json,.csv,.xlsx,.xls";

export const KNOWLEDGE_MAX_BYTES = 20 * 1024 * 1024;

export function knowledgeFileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

export function isSupportedKnowledgeFile(file: File): boolean {
  const ext = knowledgeFileExtension(file.name);
  if (!KNOWLEDGE_SUPPORTED_EXTENSIONS.has(ext)) return false;
  if (file.size > KNOWLEDGE_MAX_BYTES) return false;
  return true;
}

export function partitionKnowledgeFiles(files: File[]): {
  supported: File[];
  skippedUnsupported: number;
  skippedOversized: number;
} {
  let skippedUnsupported = 0;
  let skippedOversized = 0;
  const supported: File[] = [];
  for (const file of files) {
    const ext = knowledgeFileExtension(file.name);
    if (!KNOWLEDGE_SUPPORTED_EXTENSIONS.has(ext)) {
      skippedUnsupported += 1;
      continue;
    }
    if (file.size > KNOWLEDGE_MAX_BYTES) {
      skippedOversized += 1;
      continue;
    }
    supported.push(file);
  }
  return { supported, skippedUnsupported, skippedOversized };
}

type FsEntry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file: (
    success: (file: File) => void,
    error?: () => void,
  ) => void;
  createReader?: () => {
    readEntries: (
      success: (entries: FsEntry[]) => void,
      error?: () => void,
    ) => void;
  };
};

async function readEntryFiles(entry: FsEntry, bucket: File[]): Promise<void> {
  if (entry.isFile) {
    await new Promise<void>((resolve) => {
      entry.file(
        (file) => {
          bucket.push(file);
          resolve();
        },
        () => resolve(),
      );
    });
    return;
  }
  if (!entry.isDirectory || !entry.createReader) return;

  const reader = entry.createReader();
  await new Promise<void>((resolve) => {
    const readBatch = () => {
      reader.readEntries(
        async (entries) => {
          if (!entries.length) {
            resolve();
            return;
          }
          await Promise.all(
            entries.map((child) => readEntryFiles(child, bucket)),
          );
          readBatch();
        },
        () => resolve(),
      );
    };
    readBatch();
  });
}

/** 从拖拽 DataTransfer 收集文件（含文件夹递归） */
export async function collectFilesFromDataTransfer(
  dataTransfer: DataTransfer,
): Promise<File[]> {
  const items = dataTransfer.items;
  if (!items?.length) return Array.from(dataTransfer.files ?? []);

  const entries: FsEntry[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.() as FsEntry | null;
    if (entry) entries.push(entry);
  }

  if (!entries.length) return Array.from(dataTransfer.files ?? []);

  const bucket: File[] = [];
  await Promise.all(entries.map((entry) => readEntryFiles(entry, bucket)));
  return bucket;
}

export function collectFilesFromFileList(files: FileList | null): File[] {
  if (!files?.length) return [];
  return Array.from(files);
}
