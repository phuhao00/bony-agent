"use client";

import {
  forwardRef,
  type InputHTMLAttributes,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

export type AttachedFile = {
  id: string;
  file: File;
  /** 来自文件夹选择器时的相对路径，用于区分同名文件 */
  relativePath?: string;
  category: "image" | "document" | "video" | "unknown";
  preview?: string;
  extractedText?: string;
  extracting?: boolean;
  error?: string;
};

export type MultimodalInputHandle = {
  openImagePicker: () => void;
  openFilePicker: () => void;
  openFolderPicker: () => void;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  files: AttachedFile[];
  onFilesChange: React.Dispatch<React.SetStateAction<AttachedFile[]>>;
  placeholder?: string;
  rows?: number;
  className?: string;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
};

const ALLOWED_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".bmp",
  ".pdf",
  ".docx",
  ".doc",
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".html",
  ".mp4",
  ".mov",
  ".webm",
  ".mkv",
]);

const SIZE_LIMITS: Record<string, number> = {
  image: 20 * 1024 * 1024,
  document: 50 * 1024 * 1024,
  video: 100 * 1024 * 1024,
};

function getCategory(file: File): AttachedFile["category"] {
  const t = file.type.toLowerCase();
  if (t.startsWith("image/")) return "image";
  if (
    t === "application/pdf" ||
    t.includes("wordprocessingml") ||
    t.includes("msword") ||
    t.startsWith("text/") ||
    t === "application/json"
  )
    return "document";
  if (t.startsWith("video/")) return "video";
  const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(ext))
    return "image";
  if (
    [".pdf", ".docx", ".doc", ".txt", ".md", ".csv", ".json", ".html"].includes(
      ext,
    )
  )
    return "document";
  if ([".mp4", ".mov", ".webm", ".mkv"].includes(ext)) return "video";
  return "unknown";
}

const CATEGORY_COLORS: Record<string, string> = {
  image: "bg-emerald-50 text-emerald-700 border-emerald-200",
  document: "bg-blue-50 text-blue-700 border-blue-200",
  video: "bg-purple-50 text-purple-700 border-purple-200",
  unknown: "bg-slate-50 text-slate-500 border-slate-200",
};

const CATEGORY_ICONS: Record<string, string> = {
  image: "🖼️",
  document: "📄",
  video: "🎬",
  unknown: "📎",
};

/** 单次选取（含文件夹内）最多加入队列的数量，防止极端目录拖垮前端 */
const MAX_FILES_PER_SELECTION = 200;

/** 达到该数量及以上时跳过生成图片预览（避免大量 Data URL 卡顿） */
const BULK_PREVIEW_THRESHOLD = 12;

const SKIP_FILE_BASENAME = new Set([
  ".ds_store",
  "thumbs.db",
  "desktop.ini",
]);

function folderRelativePath(file: File): string | undefined {
  const p = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return p && String(p).trim() ? String(p).trim() : undefined;
}

function shouldSkipBrowserArtifact(file: File): boolean {
  const base = file.name.trim().toLowerCase();
  if (!base.length) return true;
  if (base.startsWith("._")) return true;
  if (SKIP_FILE_BASENAME.has(base)) return true;
  const lower = base.toLowerCase();
  if (lower === ".ds_store" || lower.endsWith(".ds_store")) return true;
  return false;
}

const MultimodalInput = forwardRef<MultimodalInputHandle, Props>(
  function MultimodalInput(
    {
      value,
      onChange,
      onKeyDown,
      files,
      onFilesChange,
      placeholder,
      rows = 1,
      className = "",
      inputRef: externalRef,
    },
    ref,
  ) {
    const internalRef = useRef<HTMLTextAreaElement>(null);
    const textareaRef = externalRef ?? internalRef;
    const fileInputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const folderInputRef = useRef<HTMLInputElement>(null);
    const [dragOver, setDragOver] = useState(false);

    useImperativeHandle(ref, () => ({
      openImagePicker: () => imageInputRef.current?.click(),
      openFilePicker: () => fileInputRef.current?.click(),
      openFolderPicker: () => folderInputRef.current?.click(),
    }));

    const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value);
      e.target.style.height = "auto";
      e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
    };

    const addFiles = async (incoming: FileList | File[]) => {
      let arr = Array.from(incoming).filter((f) => !shouldSkipBrowserArtifact(f));
      if (arr.length > MAX_FILES_PER_SELECTION) {
        alert(
          `单次最多添加 ${MAX_FILES_PER_SELECTION} 个文件（已截取前 ${MAX_FILES_PER_SELECTION} 个）。`,
        );
        arr = arr.slice(0, MAX_FILES_PER_SELECTION);
      }

      const newFiles: AttachedFile[] = [];
      const bulkNoPreview =
        arr.length >= BULK_PREVIEW_THRESHOLD || incoming.length >= BULK_PREVIEW_THRESHOLD;

      const skipped: string[] = [];
      for (const f of arr) {
        const ext = "." + (f.name.split(".").pop() || "").toLowerCase();
        if (!ALLOWED_EXT.has(ext)) {
          skipped.push(folderRelativePath(f) || f.name);
          continue;
        }

        const cat = getCategory(f);
        const limit = SIZE_LIMITS[cat] ?? 50 * 1024 * 1024;
        if (f.size > limit) {
          alert(`文件 "${f.name}" 超过 ${limit / 1024 / 1024}MB 限制`);
          continue;
        }

        const rel = folderRelativePath(f);
        const entry: AttachedFile = {
          id: `${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}-${newFiles.length}`}`,
          file: f,
          relativePath: rel,
          category: cat,
          extracting: cat !== "unknown",
        };

        if (cat === "image" && !bulkNoPreview) {
          entry.preview = await readAsDataURL(f);
        }

        newFiles.push(entry);
      }

      if (skipped.length) {
        alert(
          `以下文件类型不支持，已跳过：\n${skipped.slice(0, 8).join("\n")}${skipped.length > 8 ? "\n…" : ""}`,
        );
      }
      if (!newFiles.length) return;

      const merged = [...files, ...newFiles];
      onFilesChange(merged);

      for (const entry of newFiles) {
        if (entry.category === "unknown") continue;
        extractText(entry, onFilesChange);
      }
    };

    const removeFile = (id: string) => {
      onFilesChange(files.filter((f) => f.id !== id));
    };

    const handleDrop = (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
    };

    const handlePaste = (e: React.ClipboardEvent) => {
      const items = Array.from(e.clipboardData.items);
      const fileItems = items
        .filter((i) => i.kind === "file")
        .map((i) => i.getAsFile())
        .filter(Boolean) as File[];
      if (fileItems.length) addFiles(fileItems);
    };

    return (
      <div className={`relative ${className}`}>
        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-t-2xl border border-dashed border-blue-400 bg-blue-50/90">
            <span className="text-sm font-medium text-blue-600">
              松开以上传
            </span>
          </div>
        )}

        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pb-2 pt-3">
            {files.map((f) => (
              <FileBadge key={f.id} file={f} onRemove={() => removeFile(f.id)} />
            ))}
          </div>
        )}

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <textarea
            ref={textareaRef as React.RefObject<HTMLTextAreaElement>}
            rows={rows}
            className="chat-composer-input chat-placeholder-high-contrast min-h-[3rem] w-full resize-none bg-transparent px-4 py-3 text-[15px] leading-relaxed text-neutral-900 focus:outline-none"
            value={value}
            placeholder={placeholder}
            onChange={handleTextChange}
            onKeyDown={onKeyDown}
            onPaste={handlePaste}
          />
        </div>

        <input
          ref={imageInputRef}
          type="file"
          className="hidden"
          multiple
          accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,.png,.jpg,.jpeg,.webp,.gif,.bmp"
          onChange={(e) => {
            const picked = e.target.files;
            if (picked?.length) addFiles(picked);
            e.target.value = "";
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          multiple
          accept=".png,.jpg,.jpeg,.webp,.gif,.bmp,.pdf,.docx,.doc,.txt,.md,.csv,.json,.html,.mp4,.mov,.webm,.mkv"
          onChange={(e) => {
            const picked = e.target.files;
            if (picked?.length) addFiles(picked);
            e.target.value = "";
          }}
        />
        <input
          ref={folderInputRef}
          type="file"
          className="hidden"
          multiple
          // Chromium / WebKit / Firefox folder selection；accept 会被多数浏览器忽略
          {...({
            webkitdirectory: "",
            directory: "",
            mozdirectory: "",
          } as InputHTMLAttributes<HTMLInputElement>)}
          onChange={(e) => {
            const picked = e.target.files;
            if (picked?.length) addFiles(picked);
            e.target.value = "";
          }}
        />
      </div>
    );
  },
);

export default MultimodalInput;

function FileBadge({
  file,
  onRemove,
}: {
  file: AttachedFile;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const colorClass = CATEGORY_COLORS[file.category];
  const icon = CATEGORY_ICONS[file.category];
  const displayPath =
    file.relativePath &&
    file.relativePath !== file.file.name &&
    file.relativePath.includes("/")
      ? file.relativePath
      : file.file.name;

  return (
    <div
      className={`relative flex max-w-[220px] flex-col overflow-hidden rounded-lg border text-xs ${colorClass}`}
    >
      {file.category === "image" && file.preview ? (
        <img
          src={file.preview}
          alt={displayPath}
          className="h-20 w-full object-cover"
        />
      ) : (
        <div className="flex items-center gap-1.5 px-3 py-2">
          <span>{icon}</span>
          <span
            className="max-w-[168px] truncate font-medium"
            title={displayPath}
          >
            {displayPath}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between gap-1 px-2 pb-1.5">
        {file.extracting ? (
          <span className="flex items-center gap-1 opacity-60">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
            提取中...
          </span>
        ) : file.error ? (
          <span className="truncate text-red-500">{file.error}</span>
        ) : file.extractedText ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="underline underline-offset-2 opacity-70 hover:opacity-100"
          >
            {expanded ? "收起" : "预览"}
          </button>
        ) : (
          <span className="opacity-40">{file.category}</span>
        )}
        <button
          type="button"
          onClick={onRemove}
          className="ml-auto rounded-full p-0.5 opacity-60 transition-all hover:bg-black/10 hover:opacity-100"
          aria-label="移除"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {expanded && file.extractedText && (
        <div className="mt-0.5 max-h-32 overflow-y-auto whitespace-pre-wrap border-t border-current/10 px-2 pb-2 text-[10px] leading-4 text-slate-600">
          {file.extractedText.slice(0, 800)}
          {file.extractedText.length > 800 && "..."}
        </div>
      )}
    </div>
  );
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function extractText(
  entry: AttachedFile,
  setFiles: React.Dispatch<React.SetStateAction<AttachedFile[]>>,
) {
  try {
    const formData = new FormData();
    formData.append("file", entry.file);
    formData.append("task_type", "auto");
    formData.append("options", "{}");

    const res = await fetch("/api/multimodal/analyze", {
      method: "POST",
      body: formData,
    });
    const data = await res.json();
    const text: string = data.result || "";

    setFiles((prev) =>
      prev.map((f) =>
        f.id === entry.id
          ? { ...f, extractedText: text, extracting: false }
          : f,
      ),
    );
  } catch {
    setFiles((prev) =>
      prev.map((f) =>
        f.id === entry.id ? { ...f, error: "提取失败", extracting: false } : f,
      ),
    );
  }
}
