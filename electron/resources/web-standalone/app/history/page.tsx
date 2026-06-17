"use client";

import { useEffect, useState } from "react";

interface HistoryItem {
  id: string;
  type: string;
  prompt: string;
  result: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

export default function HistoryPage() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      const response = await fetch("/api/history");
      const data = await response.json();
      setHistory(data.items || []);
    } catch (error) {
      console.error("Failed to fetch history:", error);
    } finally {
      setLoading(false);
    }
  };

  const deleteRecord = async (id: string) => {
    if (!confirm("确定要删除这条记录吗？")) return;

    setDeleting(id);
    try {
      const response = await fetch(`/api/history/${id}`, {
        method: "DELETE",
      });
      if (response.ok) {
        setHistory(history.filter((item) => item.id !== id));
      } else {
        alert("删除失败");
      }
    } catch (error) {
      console.error("Failed to delete record:", error);
      alert("删除失败");
    } finally {
      setDeleting(null);
    }
  };

  const downloadRecord = async (id: string, type: string) => {
    try {
      const response = await fetch(`/api/history/${id}/download`);
      if (!response.ok) {
        if (response.status === 404) {
          alert("文件不存在，可能已被删除");
        } else {
          alert("下载失败");
        }
        return;
      }

      // 获取文件名
      const contentDisposition = response.headers.get("content-disposition");
      let filename = `download.${type === "video" ? "mp4" : type === "image" ? "jpg" : "txt"}`;
      if (contentDisposition) {
        const match = contentDisposition.match(
          /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/,
        );
        if (match && match[1]) {
          filename = match[1].replace(/['"]/g, "");
        }
      }

      // 创建下载链接
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Failed to download record:", error);
      alert("下载失败");
    }
  };

  const clearAllHistory = async () => {
    if (!confirm("确定要清空所有历史记录吗？此操作不可恢复！")) return;

    try {
      const response = await fetch("/api/history", {
        method: "DELETE",
      });
      if (response.ok) {
        setHistory([]);
      } else {
        alert("清空失败");
      }
    } catch (error) {
      console.error("Failed to clear history:", error);
      alert("清空失败");
    }
  };

  // 从 result 字段中提取本地文件名（优先）或 URL
  const extractMediaPath = (result: string): string | null => {
    if (!result) return null;

    // 优先匹配本地路径中的文件名，然后构建 /api/media/ URL
    // 格式: ./storage/outputs/xxx.jpg 或 /Users/.../storage/outputs/xxx.jpg
    const localMatch = result.match(
      /storage\/outputs\/([a-f0-9\-]+\.(jpg|png|jpeg|gif|webp|mp4|webm|mov))/i,
    );
    if (localMatch) {
      // 使用前端 API 代理访问本地文件
      return `/api/media/${localMatch[1]}`;
    }

    // 如果没有本地路径，则尝试提取 URL（可能会有授权问题）
    const urlMatch = result.match(/\*\*URL:\*\*\s*(https?:\/\/[^\s\n]+)/);
    if (urlMatch) {
      return urlMatch[1];
    }

    return null;
  };

  const filteredHistory = history.filter((item) => {
    if (filter === "all") return true;
    return item.type === filter;
  });

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "image":
        return "🖼️";
      case "video":
        return "🎬";
      case "script":
        return "📝";
      case "copywriting":
        return "✍️";
      default:
        return "📄";
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case "image":
        return "图片";
      case "video":
        return "视频";
      case "script":
        return "脚本";
      case "copywriting":
        return "文案";
      default:
        return "其他";
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6">
        {/* Header */}
        <div className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">📚 历史记录</h1>
            <p className="text-gray-500 mt-1">查看所有生成的内容记录</p>
          </div>
          {history.length > 0 && (
            <button
              onClick={clearAllHistory}
              className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors font-medium"
            >
              🗑️ 清空全部
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="flex gap-2 mb-6">
          {["all", "image", "video", "script", "copywriting"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${filter === f
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
            >
              {f === "all" ? "全部" : `${getTypeIcon(f)} ${getTypeLabel(f)}`}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div className="text-center py-20">
            <div className="text-gray-500">加载中...</div>
          </div>
        ) : filteredHistory.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-xl border border-gray-200">
            <div className="text-4xl mb-4">📭</div>
            <h3 className="text-lg font-medium text-gray-700">暂无记录</h3>
            <p className="text-gray-500 mt-1">
              开始使用工具生成内容后，记录将显示在这里
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredHistory.map((item) => {
              const mediaUrl = extractMediaPath(item.result);

              return (
                <div
                  key={item.id}
                  className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm transition-shadow"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3 flex-1">
                      <span className="text-2xl">{getTypeIcon(item.type)}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-800 truncate">
                          {item.prompt.length > 50
                            ? item.prompt.substring(0, 50) + "..."
                            : item.prompt}
                        </div>
                        <div className="text-sm text-gray-500">
                          {getTypeLabel(item.type)} · {item.timestamp}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      {/* 下载按钮 - 对所有生成内容显示，包括脚本和文案等文本类型 */}
                      <button
                        onClick={() => downloadRecord(item.id, item.type)}
                        className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                        title="下载"
                      >
                        <span>⬇️</span>
                      </button>
                      {/* 删除按钮 */}
                      <button
                        onClick={() => deleteRecord(item.id)}
                        disabled={deleting === item.id}
                        className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        title="删除"
                      >
                        {deleting === item.id ? (
                          <span className="text-sm">...</span>
                        ) : (
                          <span>🗑️</span>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Preview */}
                  {item.type === "image" && mediaUrl && (
                    <div className="mt-3">
                      <img
                        src={mediaUrl}
                        alt="Generated"
                        className="max-h-48 rounded-lg object-contain bg-gray-100"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.style.display = "none";
                        }}
                      />
                    </div>
                  )}

                  {item.type === "video" && mediaUrl && (
                    <div className="mt-3">
                      <video
                        src={mediaUrl}
                        controls
                        className="max-h-48 rounded-lg"
                        onError={(e) => {
                          const target = e.target as HTMLVideoElement;
                          target.style.display = "none";
                        }}
                      />
                    </div>
                  )}

                  {(item.type === "script" || item.type === "copywriting") && (
                    <div className="mt-3 text-sm text-gray-800 bg-gray-50 p-3 rounded-lg whitespace-pre-wrap">
                      {item.result.length > 300
                        ? item.result.substring(0, 300) + "..."
                        : item.result}
                    </div>
                  )}

                  {/* Show result text for image/video if no URL extracted */}
                  {(item.type === "image" || item.type === "video") &&
                    !mediaUrl &&
                    item.result && (
                      <div className="mt-3 text-sm text-gray-600 bg-gray-50 p-3 rounded-lg">
                        {item.result.length > 200
                          ? item.result.substring(0, 200) + "..."
                          : item.result}
                      </div>
                    )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
