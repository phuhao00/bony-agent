"use client";

import type { Editor } from "@tiptap/react";
import { AlertCircle, Check, Loader2, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface AICompletionProps {
  editor: Editor | null;
  isEnabled: boolean;
  llmProvider?: string;
  llmModel?: string;
}

// 缓存最近的补全结果避免重复请求
const completionCache = new Map<string, string>();
const DEBUG_AI_COMPLETION = process.env.NEXT_PUBLIC_DEBUG_AI_COMPLETION === "1";

const debugLog = (...args: unknown[]) => {
  if (DEBUG_AI_COMPLETION) {
    console.debug(...args);
  }
};

// AI 补全 API 调用
const fetchAICompletion = async (
  fullContext: string,
  currentLine: string,
  llmProvider?: string,
  llmModel?: string,
): Promise<string | null> => {
  // 检查缓存
  const cacheKey = fullContext.slice(-100);
  if (completionCache.has(cacheKey)) {
    debugLog("[AI Completion] Returning cached result");
    return completionCache.get(cacheKey)!;
  }

  try {
    const requestBody = {
      messages: [
        {
          role: "system",
          content: `你是专业的写作助手。根据文章上下文，续写下一句或一段话。
要求：
1. 内容必须与上下文主题相关，延续原文风格和语气
2. 续写要自然流畅，像人类写作一样
3. 只返回续写的纯文本内容，不要解释、不要重复原文
4. 续写长度控制在 20-60 字之间
5. 不要以"因此"、"总之"、"综上所述"等总结性词语开头，除非原文确实在总结`,
        },
        {
          role: "user",
          content: `文章上下文：\n${fullContext.slice(-300)}\n\n正在写的句子：${currentLine}\n\n请续写（只返回续写部分，不要重复上文）：`,
        },
      ],
      stream: false,
      provider: llmProvider,
      model: llmModel,
    };

    debugLog("[AI Completion] Sending request:", requestBody);

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    const responseText = await response.text();
    debugLog("[AI Completion] Raw response:", responseText);

    if (!response.ok) {
      console.error(
        "[AI Completion] API error:",
        response.status,
        responseText,
      );
      throw new Error(
        `API request failed: ${response.status} - ${responseText}`,
      );
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { content: responseText };
    }

    // 尝试多种可能的响应格式
    let completion = null;
    if (typeof data === "string") {
      completion = data;
    } else if (data.content) {
      completion = data.content;
    } else if (data.result) {
      completion = data.result;
    } else if (data.message) {
      completion =
        typeof data.message === "string" ? data.message : data.message.content;
    }

    // 清理返回的内容
    if (completion) {
      const cleaned = completion
        .replace(/^["']|["']$/g, "")
        .replace(/^(续写|建议|补全)[:：]?\s*/i, "")
        .replace(/^[,，、]\s*/, "")
        .replace(/\n+/g, " ")
        .trim();

      if (cleaned.length < 5) {
        return null;
      }

      completionCache.set(cacheKey, cleaned);
      if (completionCache.size > 50) {
        const firstKey = completionCache.keys().next().value;
        if (firstKey) {
          completionCache.delete(firstKey);
        }
      }

      return cleaned;
    }

    return null;
  } catch (error) {
    console.error("[AI Completion] Error:", error);
    return null;
  }
};

export default function AICompletion({
  editor,
  isEnabled,
  llmProvider,
  llmModel,
}: AICompletionProps) {
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [showGhostText, setShowGhostText] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRequestRef = useRef<string>("");
  const isMounted = useRef(false);

  debugLog(
    "[AI Completion] Render - editor:",
    !!editor,
    "isEnabled:",
    isEnabled,
  );

  // 获取光标位置
  const getCursorPosition = useCallback(() => {
    if (!editor || editor.isDestroyed || !editor.view)
      return { top: 0, left: 0 };

    try {
      const { from } = editor.state.selection;
      // Tiptap view properties can throw if not fully mounted even if editor.view exists
      const coords = editor.view.coordsAtPos(from);
      if (!coords) return { top: 0, left: 0 };

      const editorRect = editor.view.dom.getBoundingClientRect();

      return {
        top: coords.top - editorRect.top + 24,
        left: coords.left - editorRect.left,
      };
    } catch (e) {
      console.error("[AI Completion] Error getting cursor position:", e);
      return { top: 0, left: 0 };
    }
  }, [editor]);

  // 获取上下文
  const getContext = useCallback(() => {
    if (!editor || editor.isDestroyed) return { fullText: "", currentLine: "" };

    try {
      const { from } = editor.state.selection;
      const fullText = editor.getText() || "";
      const currentLineStart = editor.state.doc.resolve(from).start();
      const currentLine =
        editor.state.doc.textBetween(currentLineStart, from, " ") || "";

      return { fullText, currentLine };
    } catch (e) {
      console.error("[AI Completion] Error getting context:", e);
      return { fullText: "", currentLine: "" };
    }
  }, [editor]);

  // 请求 AI 补全
  const requestCompletion = useCallback(async () => {
    debugLog("[AI Completion] requestCompletion called");

    if (!editor || !isEnabled) {
      debugLog(
        "[AI Completion] Early return - editor:",
        !!editor,
        "isEnabled:",
        isEnabled,
      );
      return;
    }

    const { from, to } = editor.state.selection;
    if (from !== to) {
      debugLog("[AI Completion] Selection active, skipping");
      return;
    }

    const { fullText, currentLine } = getContext();
    debugLog("[AI Completion] Context:", {
      fullTextLength: fullText.length,
      currentLine,
    });

    if (currentLine.trim().length < 3) {
      debugLog("[AI Completion] Current line too short:", currentLine.length);
      return;
    }

    const requestKey = `${fullText.slice(-100)}_${currentLine}`;
    if (requestKey === lastRequestRef.current) {
      debugLog("[AI Completion] Duplicate request, skipping");
      return;
    }
    lastRequestRef.current = requestKey;

    setIsLoading(true);
    setError(null);

    try {
      const completion = await fetchAICompletion(
        fullText,
        currentLine,
        llmProvider,
        llmModel,
      );

      const currentFrom = editor.state.selection.from;
      if (currentFrom !== from) {
        debugLog("[AI Completion] Cursor moved, ignoring result");
        return;
      }

      if (completion) {
        debugLog("[AI Completion] Got suggestion:", completion);
        setSuggestion(completion);
        setPosition(getCursorPosition());
        setShowGhostText(true);
      } else {
        debugLog("[AI Completion] No suggestion returned");
      }
    } catch (err) {
      setError("获取建议失败");
      console.error("Completion error:", err);
    } finally {
      setIsLoading(false);
    }
  }, [editor, isEnabled, getContext, getCursorPosition, llmProvider, llmModel]);

  // 接受补全
  const acceptCompletion = useCallback(() => {
    if (!editor || !suggestion) return;

    editor.chain().focus().insertContent(suggestion).run();

    setSuggestion(null);
    setShowGhostText(false);
    lastRequestRef.current = "";
  }, [editor, suggestion]);

  // 拒绝补全
  const rejectCompletion = useCallback(() => {
    setSuggestion(null);
    setShowGhostText(false);
    lastRequestRef.current = "";
  }, []);

  // 监听编辑器变化
  useEffect(() => {
    debugLog(
      "[AI Completion] useEffect triggered - editor:",
      !!editor,
      "isEnabled:",
      isEnabled,
    );

    if (!editor || !isEnabled) return;

    // 标记组件已挂载
    isMounted.current = true;

    const handleUpdate = () => {
      debugLog("[AI Completion] Editor update event");

      if (!isMounted.current) return;

      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }

      setSuggestion(null);
      setShowGhostText(false);
      setError(null);

      debounceTimer.current = setTimeout(() => {
        if (isMounted.current) {
          requestCompletion();
        }
      }, 500);
    };

    const handleSelectionUpdate = () => {
      debugLog("[AI Completion] Selection update event");
      setSuggestion(null);
      setShowGhostText(false);
      lastRequestRef.current = "";
    };

    editor.on("update", handleUpdate);
    editor.on("selectionUpdate", handleSelectionUpdate);

    debugLog("[AI Completion] Event listeners registered");

    return () => {
      debugLog("[AI Completion] Cleanup");
      isMounted.current = false;
      editor.off("update", handleUpdate);
      editor.off("selectionUpdate", handleSelectionUpdate);
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [editor, isEnabled, requestCompletion]);

  // 键盘快捷键
  useEffect(() => {
    if (!isEnabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!suggestion) return;

      if (e.key === "Tab") {
        e.preventDefault();
        acceptCompletion();
      } else if (e.key === "Escape") {
        e.preventDefault();
        rejectCompletion();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isEnabled, suggestion, acceptCompletion, rejectCompletion]);

  if (!isEnabled || !editor) {
    debugLog(
      "[AI Completion] Not rendering - isEnabled:",
      isEnabled,
      "editor:",
      !!editor,
    );
    return null;
  }

  return (
    <>
      {/* Ghost Text 层 */}
      {showGhostText && suggestion && (
        <div
          className="absolute pointer-events-none z-10"
          style={{
            top: position.top,
            left: position.left,
          }}
        >
          <span className="text-gray-400 opacity-60 whitespace-pre">
            {suggestion}
          </span>
        </div>
      )}

      {/* 补全提示框 */}
      {suggestion && (
        <div
          className="absolute z-50 bg-white border border-purple-200 rounded-lg shadow-lg p-3 min-w-[300px] max-w-[500px]"
          style={{
            top: position.top + 24,
            left: position.left,
          }}
        >
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center">
              <Sparkles size={16} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-purple-600 mb-1">
                AI 续写建议
              </p>
              <p className="text-gray-800 text-sm leading-relaxed">
                {suggestion}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
            <div className="flex items-center gap-1 text-xs text-gray-400">
              <span className="px-1.5 py-0.5 bg-gray-100 rounded font-mono">
                Tab
              </span>
              <span>接受</span>
              <span className="mx-1">·</span>
              <span className="px-1.5 py-0.5 bg-gray-100 rounded font-mono">
                Esc
              </span>
              <span>忽略</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={acceptCompletion}
                className="p-1.5 text-green-600 hover:bg-green-50 rounded transition-colors"
                title="接受"
              >
                <Check size={16} />
              </button>
              <button
                onClick={rejectCompletion}
                className="p-1.5 text-gray-400 hover:bg-gray-100 rounded transition-colors"
                title="忽略"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 加载指示器 */}
      {isLoading && !suggestion && (
        <div
          className="absolute z-50 flex items-center gap-2 px-3 py-2 bg-white border border-purple-200 rounded-full shadow-md"
          style={{
            top: position.top + 24,
            left: position.left,
          }}
        >
          <Loader2 size={14} className="animate-spin text-purple-600" />
          <span className="text-xs text-gray-600">AI 思考中...</span>
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div
          className="absolute z-50 flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg shadow-md"
          style={{
            top: position.top + 24,
            left: position.left,
          }}
        >
          <AlertCircle size={14} className="text-red-500" />
          <span className="text-xs text-red-600">{error}</span>
        </div>
      )}
    </>
  );
}
