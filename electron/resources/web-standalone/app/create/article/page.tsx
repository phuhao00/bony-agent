"use client";

import dynamic from 'next/dynamic';
import { useState, useEffect, useRef, useCallback } from 'react';
import {
    Settings2, Palette, Type, Layout, Image as ImageIcon,
    Sparkles, Download, Share2, History, ChevronRight,
    PanelLeftClose, PanelLeft, Wand2, FileText, Eye,
    Maximize2, Copy, Check, Clock, Save, Zap, FileDown,
    Send, Newspaper, Bot, Cpu, ChevronDown
} from 'lucide-react';
import PublishModal from '../../components/PublishModal';
import ArticleHistory from '../../components/ArticleHistory';

// 编辑器 Props
interface ArticleEditorProps {
    onUpdate?: (text: string, html: string, editor: any) => void;
    llmProvider?: string;
    llmModel?: string;
}

// 使用 dynamic import 避免 Tiptap 在 SSR 时出现问题
const ArticleEditor = dynamic<ArticleEditorProps>(() => import('../../components/ArticleEditor'), {
    ssr: false,
    loading: () => (
        <div className="flex flex-col justify-center items-center h-full gap-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[color:var(--accent)]"></div>
            <p className="text-[color:var(--label-secondary)]">正在加载编辑器...</p>
        </div>
    ),
});

// 排版主题配置
const EDITOR_THEMES = [
    { id: 'default', name: '默认', font: 'system-ui', lineHeight: 1.8, fontSize: '1rem' },
    { id: 'elegant', name: '优雅', font: '"Georgia", "Times New Roman", serif', lineHeight: 2, fontSize: '1.05rem' },
    { id: 'modern', name: '现代', font: '"Inter", "SF Pro Display", -apple-system, sans-serif', lineHeight: 1.7, fontSize: '1rem' },
    { id: 'compact', name: '紧凑', font: 'system-ui', lineHeight: 1.6, fontSize: '0.95rem' },
];

// 配色方案
const COLOR_SCHEMES = [
    { id: 'default', name: '默认', primary: '#3b82f6', text: '#374151', bg: '#ffffff' },
    { id: 'warm', name: '暖色', primary: '#f97316', text: '#451a03', bg: '#fffbeb' },
    { id: 'cool', name: '冷色', primary: '#06b6d4', text: '#164e63', bg: '#ecfeff' },
    { id: 'dark', name: '暗黑', primary: '#a855f7', text: '#e5e7eb', bg: '#1f2937' },
];

export default function ArticleCreatorPage() {
    const [showSidebar, setShowSidebar] = useState(true);
    const [activeTab, setActiveTab] = useState<'style' | 'ai' | 'history'>('style');
    const [currentTheme, setCurrentTheme] = useState(EDITOR_THEMES[0]);
    const [currentColorScheme, setCurrentColorScheme] = useState(COLOR_SCHEMES[0]);
    const [articleTitle, setArticleTitle] = useState('');
    const [wordCount, setWordCount] = useState(0);
    const [readingTime, setReadingTime] = useState(0);
    const [isSaving, setIsSaving] = useState(false);
    const [lastSaved, setLastSaved] = useState<Date | null>(null);
    const [showPublishModal, setShowPublishModal] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [editorContent, setEditorContent] = useState('');
    const [editorHtml, setEditorHtml] = useState('');
    const [llmConfig, setLlmConfig] = useState<{
        providers: any[];
        currentProvider: string;
        currentModel: string;
        isFallback?: boolean;
    }>({
        providers: [],
        currentProvider: '',
        currentModel: '',
    });
    const [isConfigLoading, setIsConfigLoading] = useState(true);
    const editorRef = useRef<any>(null);

    // 获取 LLM 配置
    useEffect(() => {
        const fetchConfig = async () => {
            setIsConfigLoading(true);
            try {
                const res = await fetch('/api/config/provider');
                const data = await res.json();
                if (data.available) {
                    setLlmConfig({
                        providers: data.available,
                        currentProvider: data.current?.id || '',
                        currentModel: data.current?.model || '',
                        isFallback: data._fallback
                    });
                }
            } catch (error) {
                console.error('Failed to fetch LLM config:', error);
            } finally {
                setIsConfigLoading(false);
            }
        };
        fetchConfig();
    }, []);

    // 从 HTML 中提取媒体 URL
    const extractMediaUrls = useCallback((html: string) => {
        if (typeof window === 'undefined') return [];

        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const mediaUrls: string[] = [];

        // 提取图片
        doc.querySelectorAll('img').forEach(img => {
            const src = img.getAttribute('src');
            if (src && !src.startsWith('data:')) {
                mediaUrls.push(src);
            }
        });

        // 提取视频
        doc.querySelectorAll('video source, video').forEach(video => {
            const src = video.getAttribute('src');
            if (src) {
                mediaUrls.push(src);
            }
        });

        return mediaUrls;
    }, []);

    // 接收编辑器内容更新
    const handleEditorUpdate = useCallback((content: string, html: string, editor: any) => {
        setEditorContent(content);
        setEditorHtml(html);
        editorRef.current = editor;

        // 更新字数统计
        const text = content.replace(/<[^>]*>/g, '');
        setWordCount(text.length);
    }, []);

    // 计算阅读时间
    useEffect(() => {
        setReadingTime(Math.ceil(wordCount / 300));
    }, [wordCount]);

    // 自动保存模拟
    useEffect(() => {
        const saveInterval = setInterval(() => {
            setIsSaving(true);
            setTimeout(() => {
                setIsSaving(false);
                setLastSaved(new Date());
            }, 1000);
        }, 30000);
        return () => clearInterval(saveInterval);
    }, []);

    const applyTheme = (theme: typeof EDITOR_THEMES[0]) => {
        setCurrentTheme(theme);
        const style = document.createElement('style');
        style.id = 'custom-editor-theme';
        style.innerHTML = `
            .ProseMirror {
                font-family: ${theme.font} !important;
                line-height: ${theme.lineHeight} !important;
                font-size: ${theme.fontSize} !important;
            }
        `;
        const existing = document.getElementById('custom-editor-theme');
        if (existing) existing.remove();
        document.head.appendChild(style);
    };

    const applyColorScheme = (scheme: typeof COLOR_SCHEMES[0]) => {
        setCurrentColorScheme(scheme);
        const style = document.createElement('style');
        style.id = 'custom-color-scheme';
        style.innerHTML = `
            .ProseMirror {
                color: ${scheme.text} !important;
                background-color: ${scheme.bg} !important;
            }
            .ProseMirror h1, .ProseMirror h2, .ProseMirror h3 {
                color: ${scheme.id === 'dark' ? '#f9fafb' : '#111827'} !important;
            }
        `;
        const existing = document.getElementById('custom-color-scheme');
        if (existing) existing.remove();
        document.head.appendChild(style);
    };

    // AI 操作处理
    const handleAiAction = async (action: 'optimize' | 'continue' | 'image') => {
        if (!editorRef.current) return;

        const selection = editorRef.current.state.selection;
        const selectedText = editorRef.current.state.doc.textBetween(selection.from, selection.to, ' ');
        const fullContent = editorRef.current.getText();

        let prompt = '';
        if (action === 'optimize') {
            prompt = selectedText
                ? `优化以下段落，使其表达更专业、流畅：\n\n${selectedText}`
                : `优化文章的当前选定部分，使其表达更专业、流畅。`;
        } else if (action === 'continue') {
            prompt = `根据以下文章内容，自然地续写下一段话：\n\n${fullContent.slice(-500)}`;
        } else if (action === 'image') {
            prompt = `根据以下文章内容，为这篇文章生成一个高质量的 AI 绘图提示词（Prompt）：\n\n${fullContent.slice(0, 500)}`;
        }

        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [{ role: 'user', content: prompt }],
                    stream: false,
                    provider: llmConfig.currentProvider,
                    model: llmConfig.currentModel
                }),
            });
            const data = await res.json();
            if (data.content) {
                if (action === 'image') {
                    // 对于图片推荐，弹出对话框
                    alert(`AI 推荐提示词：\n\n${data.content}\n\n您可以复制该提示词到编辑器工具栏使用 AI 生图功能。`);
                } else {
                    // 对于文本，直接插入或补全
                    editorRef.current.chain().focus().insertContent(data.content).run();
                }
            }
        } catch (error) {
            console.error('AI Action failed:', error);
            alert('AI 操作执行失败，请检查模型配置。');
        }
    };

    // 导出 HTML
    const exportHtml = () => {
        const fullHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${articleTitle || '未命名文章'}</title>
    <style>
        body {
            max-width: 800px;
            margin: 0 auto;
            padding: 40px 20px;
            font-family: ${currentTheme.font};
            line-height: ${currentTheme.lineHeight};
            color: ${currentColorScheme.text};
            background-color: ${currentColorScheme.bg};
        }
        h1, h2, h3 { color: ${currentColorScheme.id === 'dark' ? '#f9fafb' : '#111827'}; }
        img { max-width: 100%; height: auto; border-radius: 8px; }
        blockquote { 
            border-left: 4px solid #e5e7eb; 
            padding-left: 1em; 
            margin: 1.5em 0; 
            color: #6b7280; 
            font-style: italic; 
        }
        pre { 
            background: #1f2937; 
            color: #f9fafb; 
            padding: 1em; 
            border-radius: 8px; 
            overflow-x: auto; 
        }
    </style>
</head>
<body>
    <h1>${articleTitle || '未命名文章'}</h1>
    ${editorHtml}
</body>
</html>`;

        const blob = new Blob([fullHtml], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${articleTitle || 'article'}-${Date.now()}.html`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // 导出 Markdown
    const exportMarkdown = () => {
        const turndownScript = document.createElement('script');
        turndownScript.src = 'https://unpkg.com/turndown/dist/turndown.js';
        turndownScript.onload = () => {
            const turndownService = new (window as any).TurndownService({
                headingStyle: 'atx',
                bulletListMarker: '-',
                codeBlockStyle: 'fenced',
            });
            const markdown = turndownService.turndown(editorHtml);
            const fullMarkdown = `# ${articleTitle || '未命名文章'}\n\n${markdown}`;

            const blob = new Blob([fullMarkdown], { type: 'text/markdown' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${articleTitle || 'article'}-${Date.now()}.md`;
            a.click();
            URL.revokeObjectURL(url);
        };
        document.head.appendChild(turndownScript);
    };

    // 导出 PDF
    const exportPDF = async () => {
        setIsExporting(true);
        try {
            const html2pdf = (await import('html2pdf.js')).default;

            const element = document.createElement('div');
            element.innerHTML = `
                <div style="
                    max-width: 800px; 
                    margin: 0 auto; 
                    padding: 40px; 
                    font-family: ${currentTheme.font}; 
                    line-height: ${currentTheme.lineHeight};
                    color: ${currentColorScheme.text};
                ">
                    <h1 style="font-size: 28px; margin-bottom: 20px;">${articleTitle || '未命名文章'}</h1>
                    <div style="margin-bottom: 20px; color: #666; font-size: 14px;">
                        字数: ${wordCount} | 阅读时间: ${readingTime} 分钟
                    </div>
                    ${editorHtml}
                </div>
            `;

            const opt = {
                margin: [15, 15] as [number, number],
                filename: `${articleTitle || 'article'}-${Date.now()}.pdf`,
                image: { type: 'jpeg' as const, quality: 0.98 },
                html2canvas: {
                    scale: 2,
                    useCORS: true,
                    letterRendering: true,
                },
                jsPDF: {
                    unit: 'mm' as const,
                    format: 'a4' as const,
                    orientation: 'portrait' as const,
                },
            };

            await html2pdf().set(opt).from(element).save();
        } catch (error) {
            console.error('PDF export error:', error);
            alert('PDF 导出失败，请重试');
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <div className="page-canvas flex h-full min-h-0 flex-col bg-[var(--shell-bg)]">
            {/* 顶部标题栏 */}
            <div className="chrome-bar px-6 py-4">
                <div className="flex items-center justify-between">
                    <div className="flex flex-1 items-center gap-4">
                        <div className="max-w-2xl flex-1">
                            <input
                                type="text"
                                value={articleTitle}
                                onChange={(e) => setArticleTitle(e.target.value)}
                                placeholder="输入文章标题..."
                                className="w-full border-none bg-transparent text-2xl font-bold text-[color:var(--foreground)] placeholder:text-[color:var(--label-secondary)] focus:outline-none focus:ring-0"
                            />
                            <div className="mt-1 flex items-center gap-4 text-sm text-[color:var(--label-secondary)]">
                                <span className="flex items-center gap-1">
                                    <FileText size={14} />
                                    {wordCount.toLocaleString()} 字
                                </span>
                                <span className="flex items-center gap-1">
                                    <Clock size={14} />
                                    阅读约 {readingTime} 分钟
                                </span>
                                {lastSaved && (
                                    <span className="flex items-center gap-1 text-emerald-500">
                                        <Save size={14} />
                                        {isSaving ? '保存中...' : `已保存 ${lastSaved.toLocaleTimeString()}`}
                                    </span>
                                )}
                                <span className="flex items-center gap-1 text-[color:var(--accent)]" title="输入时按 Tab 接受 AI 建议">
                                    <Sparkles size={14} />
                                    AI 自动补全已开启
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {/* 导出按钮组 */}
                        <div className="flex items-center gap-1 rounded-xl bg-[var(--chrome-rail-bg)] p-1 ring-1 ring-[color:var(--separator-subtle)]">
                            <button
                                onClick={exportHtml}
                                className="flex items-center gap-2 rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2 text-sm font-medium text-[color:var(--foreground)] transition-colors hover:bg-[var(--nav-active-fill)]"
                                title="导出 HTML"
                            >
                                <FileText size={16} />
                                HTML
                            </button>
                            <button
                                onClick={exportMarkdown}
                                className="flex items-center gap-2 rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2 text-sm font-medium text-[color:var(--foreground)] transition-colors hover:bg-[var(--nav-active-fill)]"
                                title="导出 Markdown"
                            >
                                <Newspaper size={16} />
                                MD
                            </button>
                            <button
                                onClick={exportPDF}
                                disabled={isExporting}
                                className="flex items-center gap-2 rounded-lg border border-red-400/40 bg-[var(--card-bg)] px-3 py-2 text-sm font-medium text-red-500 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                                title="导出 PDF"
                            >
                                {isExporting ? (
                                    <>
                                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-red-500 border-t-transparent" />
                                        导出中...
                                    </>
                                ) : (
                                    <>
                                        <FileDown size={16} />
                                        PDF
                                    </>
                                )}
                            </button>
                        </div>

                        <div className="mx-2 h-8 w-px bg-[var(--separator-subtle)]"></div>

                        {/* 发布按钮 */}
                        <button
                            onClick={() => setShowPublishModal(true)}
                            className="flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
                        >
                            <Send size={16} />
                            一键发布
                        </button>
                    </div>
                </div>
            </div>

            {/* 主内容区域 */}
            <div className="flex min-h-0 flex-1 overflow-hidden">
                {/* 编辑器区域 */}
                <div className="h-full flex-1 overflow-hidden p-4">
                    <ArticleEditor
                        onUpdate={handleEditorUpdate}
                        llmProvider={llmConfig.currentProvider}
                        llmModel={llmConfig.currentModel}
                    />
                </div>

                {/* 右侧边栏 */}
                <div className={`flex h-full flex-col border-l border-[color:var(--separator-subtle)] bg-[var(--card-bg)] shadow-[0_0_24px_rgba(0,0,0,0.08)] transition-all duration-300 dark:shadow-[0_0_28px_rgba(0,0,0,0.45)] ${showSidebar ? 'w-80 opacity-100' : 'w-0 overflow-hidden opacity-0'}`}>
                    {/* 侧边栏头部 */}
                    <div className="flex items-center justify-between border-b border-[color:var(--separator-subtle)] p-4">
                        <h2 className="font-semibold text-[color:var(--foreground)]">设置面板</h2>
                        <button
                            onClick={() => setShowSidebar(false)}
                            className="rounded-lg p-2 text-[color:var(--label-secondary)] transition-colors hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)]"
                        >
                            <PanelLeftClose size={18} />
                        </button>
                    </div>

                    {/* 标签切换 */}
                    <div className="flex items-center gap-1 border-b border-[color:var(--separator-subtle)] p-2">
                        <button
                            onClick={() => setActiveTab('style')}
                            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${activeTab === 'style' ? 'bg-[var(--nav-active-fill)] text-[color:var(--accent)] ring-1 ring-[color:color-mix(in_srgb,var(--accent)_30%,transparent)]' : 'text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)]'}`}
                        >
                            <Palette size={16} />
                            排版
                        </button>
                        <button
                            onClick={() => setActiveTab('ai')}
                            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${activeTab === 'ai' ? 'bg-[var(--nav-active-fill)] text-[color:var(--accent)] ring-1 ring-[color:color-mix(in_srgb,var(--accent)_30%,transparent)]' : 'text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)]'}`}
                        >
                            <Sparkles size={16} />
                            AI 助手
                        </button>
                        <button
                            onClick={() => setActiveTab('history')}
                            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${activeTab === 'history' ? 'bg-[var(--nav-active-fill)] text-[color:var(--foreground)] ring-1 ring-[color:var(--separator-subtle)]' : 'text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)]'}`}
                        >
                            <History size={16} />
                            历史
                        </button>
                    </div>

                    {/* 标签内容 */}
                    <div className="p-4 overflow-y-auto h-[calc(100%-8rem)]">
                        {activeTab === 'style' && (
                            <div className="space-y-6">
                                {/* 排版主题 */}
                                <div>
                                    <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                                        <Type size={16} />
                                        排版主题
                                    </h3>
                                    <div className="grid grid-cols-2 gap-2">
                                        {EDITOR_THEMES.map(theme => (
                                            <button
                                                key={theme.id}
                                                onClick={() => applyTheme(theme)}
                                                className={`p-3 text-left rounded-lg border transition-all ${currentTheme.id === theme.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}
                                            >
                                                <div className="font-medium text-gray-800 text-sm">{theme.name}</div>
                                                <div className="text-xs text-gray-500 mt-1">行高 {theme.lineHeight}</div>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* 配色方案 */}
                                <div>
                                    <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                                        <Palette size={16} />
                                        配色方案
                                    </h3>
                                    <div className="space-y-2">
                                        {COLOR_SCHEMES.map(scheme => (
                                            <button
                                                key={scheme.id}
                                                onClick={() => applyColorScheme(scheme)}
                                                className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all ${currentColorScheme.id === scheme.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}
                                            >
                                                <div
                                                    className="w-8 h-8 rounded-lg shadow-sm"
                                                    style={{ backgroundColor: scheme.primary }}
                                                />
                                                <div className="flex-1 text-left">
                                                    <div className="font-medium text-gray-800 text-sm">{scheme.name}</div>
                                                </div>
                                                {currentColorScheme.id === scheme.id && (
                                                    <Check size={16} className="text-blue-600" />
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* 页面设置 */}
                                <div>
                                    <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                                        <Layout size={16} />
                                        页面设置
                                    </h3>
                                    <div className="space-y-3">
                                        <label className="flex items-center justify-between">
                                            <span className="text-sm text-gray-600">显示行号</span>
                                            <input type="checkbox" className="rounded text-blue-600" />
                                        </label>
                                        <label className="flex items-center justify-between">
                                            <span className="text-sm text-gray-600">自动保存</span>
                                            <input type="checkbox" defaultChecked className="rounded text-blue-600" />
                                        </label>
                                        <label className="flex items-center justify-between">
                                            <span className="text-sm text-gray-600">拼写检查</span>
                                            <input type="checkbox" defaultChecked className="rounded text-blue-600" />
                                        </label>
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'ai' && (
                            <div className="space-y-6">
                                {/* LLM 配置区域 */}
                                <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
                                    <div className="flex items-center gap-2 mb-4">
                                        <Bot size={18} className="text-blue-600" />
                                        <h3 className="font-medium text-gray-800">AI 模型配置</h3>
                                    </div>

                                    <div className="space-y-4">
                                        {isConfigLoading ? (
                                            <div className="flex items-center gap-2 py-4 justify-center text-xs text-gray-400">
                                                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-500"></div>
                                                正在连接后端配置...
                                            </div>
                                        ) : llmConfig.isFallback ? (
                                            <div className="p-3 bg-red-50 rounded-lg border border-red-100 text-[11px] text-red-600">
                                                无法连接到后端服务。请确保后端窗口显示“✅ 后端已就绪”，且没有发生 Python 崩溃。
                                            </div>
                                        ) : (
                                            <>
                                                {/* 供应商选择 */}
                                                <div>
                                                    <label className="text-xs font-medium text-gray-500 mb-1.5 block">模型供应商</label>
                                                    <div className="relative">
                                                        <select
                                                            value={llmConfig.currentProvider}
                                                            onChange={(e) => {
                                                                const provider = llmConfig.providers.find(p => p.id === e.target.value);
                                                                setLlmConfig(prev => ({
                                                                    ...prev,
                                                                    currentProvider: e.target.value,
                                                                    currentModel: provider?.default_model || ''
                                                                }));
                                                            }}
                                                            className="w-full pl-3 pr-10 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                                                        >
                                                            {llmConfig.providers.map(p => (
                                                                <option key={p.id} value={p.id}>{p.name}</option>
                                                            ))}
                                                        </select>
                                                        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                                                    </div>
                                                </div>

                                                {/* 模型选择 */}
                                                <div>
                                                    <label className="text-xs font-medium text-gray-500 mb-1.5 block">具体模型</label>
                                                    <div className="relative">
                                                        <select
                                                            value={llmConfig.currentModel}
                                                            onChange={(e) => setLlmConfig(prev => ({ ...prev, currentModel: e.target.value }))}
                                                            className="w-full pl-3 pr-10 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                                                        >
                                                            {llmConfig.providers.find((p: any) => p.id === llmConfig.currentProvider)?.models.map((m: string) => (
                                                                <option key={m} value={m}>{m}</option>
                                                            ))}
                                                        </select>
                                                        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </div>

                                    <div className="mt-4 p-2 bg-blue-50 rounded-lg flex items-start gap-2">
                                        <Sparkles size={14} className="text-blue-600 mt-0.5 shrink-0" />
                                        <p className="text-[11px] text-blue-700 leading-relaxed">
                                            当前选定的模型将用于本页面的<b>自动续写</b>和<b>内容优化</b>，不会影响全局默认配置。
                                        </p>
                                    </div>
                                </div>

                                {/* AI 写作助手 */}
                                <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-xl p-4 border border-purple-100">
                                    <div className="flex items-center gap-2 mb-3">
                                        <Wand2 size={18} className="text-purple-600" />
                                        <h3 className="font-medium text-purple-900">AI 写作助手</h3>
                                    </div>
                                    <p className="text-sm text-purple-700 mb-3">
                                        让 AI 帮你优化文章、续写内容或生成配图。
                                    </p>
                                    <div className="space-y-2">
                                        <button
                                            onClick={() => handleAiAction('optimize')}
                                            className="w-full px-3 py-2 text-sm text-purple-700 bg-white border border-purple-200 rounded-lg hover:bg-purple-50 transition-colors text-left"
                                        >
                                            ✨ 优化当前段落
                                        </button>
                                        <button
                                            onClick={() => handleAiAction('continue')}
                                            className="w-full px-3 py-2 text-sm text-purple-700 bg-white border border-purple-200 rounded-lg hover:bg-purple-50 transition-colors text-left"
                                        >
                                            📝 续写内容
                                        </button>
                                        <button
                                            onClick={() => handleAiAction('image')}
                                            className="w-full px-3 py-2 text-sm text-purple-700 bg-white border border-purple-200 rounded-lg hover:bg-purple-50 transition-colors text-left"
                                        >
                                            🎨 智能配图建议
                                        </button>
                                    </div>
                                </div>

                                {/* 文章分析 */}
                                <div>
                                    <h3 className="text-sm font-medium text-gray-700 mb-3">文章分析</h3>
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                            <span className="text-sm text-gray-600">可读性评分</span>
                                            <span className="text-sm font-medium text-green-600">85/100</span>
                                        </div>
                                        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                            <span className="text-sm text-gray-600">关键词密度</span>
                                            <span className="text-sm font-medium text-blue-600">适中</span>
                                        </div>
                                        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                            <span className="text-sm text-gray-600">段落结构</span>
                                            <span className="text-sm font-medium text-green-600">良好</span>
                                        </div>
                                    </div>
                                </div>

                                {/* 生成建议 */}
                                <div>
                                    <h3 className="text-sm font-medium text-gray-700 mb-3">生成建议</h3>
                                    <div className="space-y-2">
                                        <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                                            <p className="text-sm text-yellow-800">
                                                💡 建议添加一张配图来增强文章视觉效果
                                            </p>
                                        </div>
                                        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                                            <p className="text-sm text-blue-800">
                                                💡 可以增加小标题来提升文章结构层次
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'history' && (
                            <ArticleHistory
                                currentTitle={articleTitle}
                                currentContent={editorContent}
                                currentHtml={editorHtml}
                                onRestore={(version) => {
                                    setArticleTitle(version.title);
                                    if (editorRef.current) {
                                        editorRef.current.commands.setContent(version.htmlContent);
                                    }
                                    // 切换到编辑器页面
                                    setActiveTab('style');
                                }}
                            />
                        )}
                    </div>
                </div>

                {/* 显示侧边栏按钮 */}
                {!showSidebar && (
                    <button
                        onClick={() => setShowSidebar(true)}
                        className="popover-vibrant fixed right-4 top-1/2 z-40 -translate-y-1/2 rounded-full p-3 transition-all hover:opacity-95"
                        title="打开设置面板"
                    >
                        <Settings2 size={20} className="text-[color:var(--foreground)]" />
                    </button>
                )}
            </div>

            {/* 发布模态框 */}
            <PublishModal
                isOpen={showPublishModal}
                onClose={() => setShowPublishModal(false)}
                title={articleTitle}
                content={editorContent}
                htmlContent={editorHtml}
                mediaUrls={extractMediaUrls(editorHtml)}
            />
        </div>
    );
}
