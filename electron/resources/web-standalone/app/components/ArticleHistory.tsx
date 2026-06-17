"use client";

import {
    AlertCircle,
    Calendar,
    Clock,
    FileText,
    History,
    Loader2,
    RotateCcw,
    Trash2,
    X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface HistoryVersion {
  id: string;
  title: string;
  content: string;
  htmlContent: string;
  timestamp: number;
  wordCount: number;
  type: "auto" | "manual";
}

interface ArticleHistoryProps {
  currentTitle: string;
  currentContent: string;
  currentHtml: string;
  onRestore: (version: HistoryVersion) => void;
}

const STORAGE_KEY = "article_history";
const MAX_VERSIONS = 20; // 最多保存20个版本

function readStoredHistory(): HistoryVersion[] {
  if (typeof window === "undefined") return [];

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.sort(
      (a: HistoryVersion, b: HistoryVersion) => b.timestamp - a.timestamp,
    );
  } catch (error) {
    console.error("Failed to load history:", error);
    return [];
  }
}

export default function ArticleHistory({
  currentTitle,
  currentContent,
  currentHtml,
  onRestore,
}: ArticleHistoryProps) {
  const [versions, setVersions] = useState<HistoryVersion[]>(readStoredHistory);
  const [isLoading] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<HistoryVersion | null>(
    null,
  );
  const [showPreview, setShowPreview] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const saveVersion = useCallback(
    (type: "auto" | "manual" = "auto") => {
      if (!currentContent || currentContent.length < 10) return;

      setIsSaving(true);

      const newVersion: HistoryVersion = {
        id: Date.now().toString(),
        title: currentTitle || "未命名文章",
        content: currentContent,
        htmlContent: currentHtml,
        timestamp: Date.now(),
        wordCount: currentContent.replace(/<[^>]*>/g, "").length,
        type,
      };

      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        const existing: HistoryVersion[] = stored ? JSON.parse(stored) : [];

        // 检查是否和最后一个版本相同（避免重复保存）
        const lastVersion = existing[0];
        if (
          lastVersion &&
          lastVersion.content === newVersion.content &&
          lastVersion.title === newVersion.title
        ) {
          setIsSaving(false);
          return;
        }

        // 添加新版本，限制数量
        const updated = [newVersion, ...existing].slice(0, MAX_VERSIONS);

        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        setVersions(updated);
      } catch (error) {
        console.error("Failed to save version:", error);
      }

      setIsSaving(false);
    },
    [currentContent, currentHtml, currentTitle],
  );

  // 自动保存当前版本
  useEffect(() => {
    if (!currentContent || currentContent.length < 10) return;

    const timer = setTimeout(() => {
      saveVersion("auto");
    }, 30000); // 30秒自动保存

    return () => clearTimeout(timer);
  }, [currentContent, saveVersion]);

  const deleteVersion = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();

    try {
      const updated = versions.filter((v) => v.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      setVersions(updated);

      if (selectedVersion?.id === id) {
        setSelectedVersion(null);
        setShowPreview(false);
      }
    } catch (error) {
      console.error("Failed to delete version:", error);
    }
  };

  const handleRestore = (version: HistoryVersion) => {
    if (
      confirm(`确定要恢复到 "${version.title}" 这个版本吗？当前内容将被替换。`)
    ) {
      onRestore(version);
      setShowPreview(false);
      setSelectedVersion(null);
    }
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    // 小于1分钟
    if (diff < 60000) return "刚刚";

    // 小于1小时
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;

    // 小于24小时
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;

    // 小于7天
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;

    // 超过7天显示具体日期
    return date.toLocaleDateString("zh-CN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatFullTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-medium text-gray-800 flex items-center gap-2">
            <History size={18} />
            历史版本
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            共 {versions.length} 个版本 · 最多保留 {MAX_VERSIONS} 个
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isSaving && (
            <span className="text-xs text-green-600 flex items-center gap-1">
              <Loader2 size={12} className="animate-spin" />
              保存中...
            </span>
          )}
          <button
            onClick={() => saveVersion("manual")}
            className="px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
          >
            立即保存
          </button>
        </div>
      </div>

      {/* 版本列表 */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-gray-400 mb-2" />
          <span className="text-sm text-gray-500">加载中...</span>
        </div>
      ) : versions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-gray-400">
          <Clock size={48} className="mb-3 opacity-30" />
          <p className="text-sm">暂无历史版本</p>
          <p className="text-xs mt-1">编辑内容后会自动保存</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {versions.map((version, index) => (
            <div
              key={version.id}
              onClick={() => {
                setSelectedVersion(version);
                setShowPreview(true);
              }}
              className={`group relative p-3 rounded-xl border cursor-pointer transition-all ${
                selectedVersion?.id === version.id
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
              }`}
            >
              {/* 版本标签 */}
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    version.type === "auto"
                      ? "bg-gray-100 text-gray-600"
                      : "bg-blue-100 text-blue-600"
                  }`}
                >
                  {version.type === "auto" ? "自动保存" : "手动保存"}
                </span>
                {index === 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-600">
                    最新
                  </span>
                )}
              </div>

              {/* 标题和时间 */}
              <div className="font-medium text-gray-800 text-sm truncate mb-1">
                {version.title}
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <Calendar size={12} />
                  {formatTime(version.timestamp)}
                </span>
                <span className="flex items-center gap-1">
                  <FileText size={12} />
                  {version.wordCount} 字
                </span>
              </div>

              {/* 删除按钮 */}
              <button
                onClick={(e) => deleteVersion(version.id, e)}
                className="absolute top-2 right-2 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                title="删除此版本"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 预览/恢复弹窗 */}
      {showPreview && selectedVersion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            {/* 头部 */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <div>
                <h3 className="font-semibold text-gray-800">版本预览</h3>
                <p className="text-sm text-gray-500">
                  {formatFullTime(selectedVersion.timestamp)}
                </p>
              </div>
              <button
                onClick={() => {
                  setShowPreview(false);
                  setSelectedVersion(null);
                }}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* 预览内容 */}
            <div className="flex-1 overflow-y-auto p-5">
              <div className="mb-4 p-4 bg-blue-50 rounded-lg border border-blue-100">
                <div className="flex items-center gap-2 text-sm text-blue-800 mb-1">
                  <AlertCircle size={16} />
                  <span className="font-medium">版本信息</span>
                </div>
                <p className="text-sm text-blue-600">
                  标题: {selectedVersion.title}
                </p>
                <p className="text-sm text-blue-600">
                  字数: {selectedVersion.wordCount} · 保存方式:{" "}
                  {selectedVersion.type === "auto" ? "自动保存" : "手动保存"}
                </p>
              </div>

              <div
                className="prose prose-sm max-w-none border border-gray-200 rounded-lg p-4 bg-white"
                dangerouslySetInnerHTML={{
                  __html: selectedVersion.htmlContent,
                }}
              />
            </div>

            {/* 底部按钮 */}
            <div className="flex items-center justify-between px-5 py-4 border-t border-gray-200 bg-gray-50">
              <button
                onClick={() => {
                  setShowPreview(false);
                  setSelectedVersion(null);
                }}
                className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
              >
                关闭
              </button>
              <button
                onClick={() => handleRestore(selectedVersion)}
                className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
              >
                <RotateCcw size={16} />
                恢复此版本
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
