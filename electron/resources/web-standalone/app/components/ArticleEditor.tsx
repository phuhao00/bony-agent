// @ts-nocheck
"use client";

import { useEditor, EditorContent, mergeAttributes, Node } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Color from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import Placeholder from '@tiptap/extension-placeholder';
import { useState, useCallback, useEffect, useRef } from 'react';
import AICompletion from './AICompletion';
import {
    Loader2, Image as ImageIcon, Film, Bold, Italic, Underline as UnderlineIcon,
    Strikethrough, Code, Quote, List, ListOrdered, AlignLeft, AlignCenter,
    AlignRight, AlignJustify, Link as LinkIcon, Type, Palette, Highlighter,
    Undo, Redo, Trash2, Maximize2, Minimize2, LayoutTemplate, Sparkles,
    Settings2, Eye, EyeOff, Download, Upload, Columns, MoreHorizontal,
    ChevronDown, X, Check, ImagePlus, Video, Heading1, Heading2, Heading3,
    SeparatorHorizontal, WrapText, AlignStartVertical, AlignEndVertical,
    Expand, Shrink, RotateCcw, Copy, Scissors, ClipboardPaste
} from 'lucide-react';

// Custom Video Extension for Tiptap
const CustomVideo = Node.create({
    name: 'video',
    group: 'block',
    selectable: true,
    draggable: true,

    addAttributes() {
        return {
            src: { default: null },
            controls: { default: true },
            width: { default: '100%' },
            align: { default: 'center' },
        };
    },

    parseHTML() {
        return [{ tag: 'video' }];
    },

    renderHTML({ HTMLAttributes }) {
        const { align, width, ...attrs } = HTMLAttributes;
        const style = `width: ${width}; display: block; margin: ${align === 'center' ? '0 auto' : align === 'left' ? '0 auto 0 0' : '0 0 0 auto'};`;
        return ['div', { style: 'margin: 1.5rem 0;' },
            ['video', mergeAttributes(attrs, { style, controls: 'true' }),
                ['source', { src: HTMLAttributes.src }]
            ]
        ];
    },

    addCommands() {
        return {
            setVideo: (options: { src: string; width?: string; align?: string }) => ({ commands }) => {
                return commands.insertContent({
                    type: this.name,
                    attrs: options,
                });
            },
        };
    },
});

// Custom Image Extension with alignment and sizing
const CustomImage = Image.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            width: { default: '100%' },
            align: { default: 'center' },
            borderRadius: { default: '0.5rem' },
            shadow: { default: 'md' },
            caption: { default: '' },
        };
    },
});

// Templates
const ARTICLE_TEMPLATES = [
    {
        id: 'blank',
        name: '空白文档',
        icon: '📄',
        content: '<p></p>',
    },
    {
        id: 'tech',
        name: '科技评测',
        icon: '🔬',
        content: `
            <h1>产品深度评测：XXX</h1>
            <p class="lead">在这篇文章中，我们将深入探讨这款产品的各个方面...</p>
            <h2>外观设计</h2>
            <p>首先让我们来看看产品的外观设计...</p>
            <h2>性能测试</h2>
            <p>在实际使用中，这款产品的表现如何？</p>
            <h2>总结</h2>
            <p>综合来看，这款产品...</p>
        `,
    },
    {
        id: 'tutorial',
        name: '教程指南',
        icon: '📚',
        content: `
            <h1>手把手教你：XXX</h1>
            <p class="lead">本教程将带你从零开始，一步步掌握...</p>
            <h2>准备工作</h2>
            <p>在开始之前，你需要准备以下内容：</p>
            <ul>
                <li>工具1</li>
                <li>工具2</li>
                <li>工具3</li>
            </ul>
            <h2>第一步</h2>
            <p>首先，我们需要...</p>
            <h2>常见问题</h2>
            <p>在实践过程中，你可能会遇到以下问题...</p>
        `,
    },
    {
        id: 'story',
        name: '故事散文',
        icon: '✍️',
        content: `
            <h1>标题：一段难忘的旅程</h1>
            <p class="lead">那是一个阳光明媚的早晨...</p>
            <p>故事正文从这里开始...</p>
            <blockquote>
                <p>"引用一句有深度的话..."</p>
            </blockquote>
            <p>继续你的故事...</p>
        `,
    },
    {
        id: 'news',
        name: '新闻资讯',
        icon: '📰',
        content: `
            <h1>重磅消息：XXX</h1>
            <p class="lead">今日，XXX 发布了重要消息...</p>
            <p>详细内容...</p>
            <h2>事件背景</h2>
            <p>回顾事件的发展脉络...</p>
            <h2>专家解读</h2>
            <p>对此，业内专家表示...</p>
        `,
    },
];

// Color palette
const COLORS = [
    '#000000', '#333333', '#666666', '#999999', '#CCCCCC', '#FFFFFF',
    '#FF6B6B', '#FF8E53', '#FECA57', '#48DBFB', '#0ABDE3', '#006BA6',
    '#1DD1A1', '#10AC84', '#00D2D3', '#54A0FF', '#5F27CD', '#341F97',
    '#FF9FF3', '#F368E0', '#EE5A6F', '#C44569', '#786FA6', '#303952',
];

interface ArticleEditorProps {
    onUpdate?: (text: string, html: string, editor: any) => void;
    llmProvider?: string;
    llmModel?: string;
}

export default function ArticleEditor({ onUpdate, llmProvider, llmModel }: ArticleEditorProps = {}) {
    const [isGeneratingImg, setIsGeneratingImg] = useState(false);
    const [isGeneratingVid, setIsGeneratingVid] = useState(false);
    const [isAiSuggesting, setIsAiSuggesting] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const [showTemplates, setShowTemplates] = useState(false);
    const [selectedImage, setSelectedImage] = useState<HTMLElement | null>(null);
    const [linkUrl, setLinkUrl] = useState('');
    const [showLinkInput, setShowLinkInput] = useState(false);
    const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
    const [currentTemplate, setCurrentTemplate] = useState('blank');
    const [aiCompletionEnabled, setAiCompletionEnabled] = useState(true);

    const editor = useEditor({
        immediatelyRender: false,
        extensions: [
            StarterKit.configure({
                heading: { levels: [1, 2, 3] },
            }),
            CustomImage.configure({
                inline: false,
                allowBase64: true,
            }),
            CustomVideo,
            Link.configure({
                openOnClick: false,
                HTMLAttributes: {
                    class: 'text-blue-600 underline hover:text-blue-800 transition-colors',
                },
            }),
            Underline,
            TextAlign.configure({
                types: ['heading', 'paragraph'],
            }),
            Highlight.configure({
                multicolor: true,
            }),
            TextStyle,
            Color.configure({
                types: ['textStyle'],
            }),
            Placeholder.configure({
                placeholder: '开始你的创作...',
            }),
        ],
        content: ARTICLE_TEMPLATES[0].content,
        onUpdate: ({ editor }) => {
            if (onUpdate) {
                onUpdate(editor.getText(), editor.getHTML(), editor);
            }
        },
        editorProps: {
            attributes: {
                class: 'prose prose-lg max-w-none focus:outline-none min-h-[500px]',
            },
            handleClick(view, pos, event) {
                const target = event.target as HTMLElement;
                if (target.tagName === 'IMG') {
                    setSelectedImage(target);
                } else {
                    setSelectedImage(null);
                }
                return false;
            },
        },
    });

    // Update image styling when selected
    useEffect(() => {
        if (selectedImage && editor) {
            const updateImageStyle = () => {
                if (selectedImage) {
                    selectedImage.style.outline = '3px solid #3b82f6';
                    selectedImage.style.outlineOffset = '4px';
                }
            };
            updateImageStyle();
        }

        // Cleanup previous selection styling
        return () => {
            if (selectedImage) {
                selectedImage.style.outline = '';
                selectedImage.style.outlineOffset = '';
            }
        };
    }, [selectedImage, editor]);

    const setLink = useCallback(() => {
        if (!editor) return;

        const previousUrl = editor.getAttributes('link').href;
        setLinkUrl(previousUrl || '');
        setShowLinkInput(true);
    }, [editor]);

    const confirmLink = useCallback(() => {
        if (!editor) return;

        if (linkUrl === '') {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
        } else {
            editor.chain().focus().extendMarkRange('link').setLink({ href: linkUrl }).run();
        }
        setShowLinkInput(false);
        setLinkUrl('');
    }, [editor, linkUrl]);

    const handleGenerateImage = async () => {
        const prompt = window.prompt("请输入图片描述:");
        if (!prompt) return;

        setIsGeneratingImg(true);
        try {
            const response = await fetch("/api/tools/image", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt }),
            });

            const data = await response.json();
            const localMatch = data.result?.match(/storage\/outputs\/([a-f0-9\-]+\.(jpg|png|jpeg|gif|webp))/i);

            let imageUrl = null;
            if (localMatch) {
                imageUrl = `/api/media/${localMatch[1]}`;
            } else {
                const urlMatch = data.result?.match(/https?:\/\/[^\s\n\]]+\.(jpg|png|jpeg|webp|gif)(\?[^\s\n\]]*)?/i);
                if (urlMatch) imageUrl = urlMatch[0];
            }

            if (imageUrl && editor) {
                editor.chain().focus().setImage({ src: imageUrl }).run();
            } else {
                alert("图片生成失败或未能提取到链接");
            }
        } catch (error) {
            console.error(error);
            alert("图片生成出错");
        } finally {
            setIsGeneratingImg(false);
        }
    };

    const handleGenerateVideo = async () => {
        const prompt = window.prompt("请输入视频描述:");
        if (!prompt) return;

        setIsGeneratingVid(true);
        try {
            const response = await fetch("/api/tools/video", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt }),
            });

            const data = await response.json();
            const localMatch = data.result?.match(/storage\/outputs\/([a-f0-9\-]+\.(mp4|webm|mov))/i);

            let videoUrl = null;
            if (localMatch) {
                videoUrl = `/api/media/${localMatch[1]}`;
            } else {
                const urlMatch = data.result?.match(/https?:\/\/[^\s\n\]]+\.(mp4|webm|mov)(\?[^\s\n\]]*)?/i);
                if (urlMatch) videoUrl = urlMatch[0];
            }

            if (videoUrl && editor) {
                editor.chain().focus().setVideo({ src: videoUrl }).run();
            } else {
                alert("视频生成失败或未能提取到链接");
            }
        } catch (error) {
            console.error(error);
            alert("视频生成出错");
        } finally {
            setIsGeneratingVid(false);
        }
    };

    const handleAiSuggestImages = async () => {
        if (!editor) return;

        const content = editor.getText();
        if (!content.trim()) {
            alert('请先输入一些文字内容');
            return;
        }

        setIsAiSuggesting(true);
        // 模拟 AI 分析文字并推荐配图提示词
        setTimeout(() => {
            const suggestions = [
                '科技感十足的蓝色渐变背景，未来风格',
                '暖色调温馨场景，人物互动',
                '简约商务风格，数据可视化元素',
                '自然风景，清新明亮色调',
            ];
            setAiSuggestions(suggestions);
            setIsAiSuggesting(false);
        }, 1500);
    };

    const applyTemplate = (template: typeof ARTICLE_TEMPLATES[0]) => {
        if (!editor) return;

        if (window.confirm('应用模板将替换当前内容，是否继续？')) {
            editor.commands.setContent(template.content);
            setCurrentTemplate(template.id);
            setShowTemplates(false);
        }
    };

    const exportHtml = () => {
        if (!editor) return;

        const html = editor.getHTML();
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `article-${Date.now()}.html`;
        a.click();
        URL.revokeObjectURL(url);
    };

    if (!editor) return null;

    return (
        <div className={`flex flex-col bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm transition-all duration-300 ${isFullscreen ? 'fixed inset-0 z-50 rounded-none' : ''}`}>
            {/* 顶部工具栏 - 主要操作 */}
            <div className="flex items-center justify-between p-3 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white flex-wrap gap-2">
                <div className="flex items-center gap-2">
                    {/* 模板选择 */}
                    <div className="relative">
                        <button
                            onClick={() => setShowTemplates(!showTemplates)}
                            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                        >
                            <LayoutTemplate size={16} />
                            模板
                            <ChevronDown size={14} className={`transition-transform ${showTemplates ? 'rotate-180' : ''}`} />
                        </button>

                        {showTemplates && (
                            <div className="absolute top-full left-0 mt-2 w-56 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden">
                                {ARTICLE_TEMPLATES.map(template => (
                                    <button
                                        key={template.id}
                                        onClick={() => applyTemplate(template)}
                                        className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors ${currentTemplate === template.id ? 'bg-blue-50 text-blue-700' : 'text-gray-700'}`}
                                    >
                                        <span className="text-xl">{template.icon}</span>
                                        <span className="font-medium">{template.name}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="w-px h-6 bg-gray-300 mx-1"></div>

                    {/* 撤销/重做 */}
                    <button
                        onClick={() => editor.chain().focus().undo().run()}
                        disabled={!editor.can().undo()}
                        className="p-2 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-gray-700"
                        title="撤销 (Ctrl+Z)"
                    >
                        <Undo size={18} />
                    </button>
                    <button
                        onClick={() => editor.chain().focus().redo().run()}
                        disabled={!editor.can().redo()}
                        className="p-2 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-gray-700"
                        title="重做 (Ctrl+Y)"
                    >
                        <Redo size={18} />
                    </button>
                </div>

                <div className="flex items-center gap-2">
                    {/* AI 智能配图 */}
                    <button
                        onClick={handleAiSuggestImages}
                        disabled={isAiSuggesting}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors disabled:opacity-50"
                    >
                        {isAiSuggesting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                        AI 智能配图
                    </button>

                    {/* AI 自动补全开关 */}
                    <button
                        onClick={() => setAiCompletionEnabled(!aiCompletionEnabled)}
                        className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${aiCompletionEnabled
                            ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                            : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                            }`}
                        title={aiCompletionEnabled ? 'AI 自动补全已开启' : 'AI 自动补全已关闭'}
                    >
                        {aiCompletionEnabled ? <Check size={16} /> : <X size={16} />}
                        AI 补全
                    </button>

                    <div className="w-px h-6 bg-gray-300 mx-1"></div>

                    {/* 预览开关 */}
                    <button
                        onClick={() => setShowPreview(!showPreview)}
                        className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${showPreview ? 'bg-blue-100 text-blue-700' : 'text-gray-700 hover:bg-gray-100'}`}
                    >
                        {showPreview ? <EyeOff size={16} /> : <Eye size={16} />}
                        {showPreview ? '隐藏预览' : '实时预览'}
                    </button>

                    {/* 导出 */}
                    <button
                        onClick={exportHtml}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                        title="导出 HTML"
                    >
                        <Download size={16} />
                    </button>

                    {/* 全屏 */}
                    <button
                        onClick={() => setIsFullscreen(!isFullscreen)}
                        className="p-2 rounded-lg hover:bg-gray-200 transition-colors text-gray-700"
                        title={isFullscreen ? '退出全屏' : '全屏编辑'}
                    >
                        {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                    </button>
                </div>
            </div>

            {/* 二级工具栏 - 格式控制 */}
            <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-100 bg-white flex-wrap">
                {/* 文字样式 */}
                <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
                    <button
                        onClick={() => editor.chain().focus().toggleBold().run()}
                        className={`p-1.5 rounded-md transition-colors ${editor.isActive('bold') ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                        title="加粗 (Ctrl+B)"
                    >
                        <Bold size={16} />
                    </button>
                    <button
                        onClick={() => editor.chain().focus().toggleItalic().run()}
                        className={`p-1.5 rounded-md transition-colors ${editor.isActive('italic') ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                        title="斜体 (Ctrl+I)"
                    >
                        <Italic size={16} />
                    </button>
                    <button
                        onClick={() => editor.chain().focus().toggleUnderline().run()}
                        className={`p-1.5 rounded-md transition-colors ${editor.isActive('underline') ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                        title="下划线 (Ctrl+U)"
                    >
                        <UnderlineIcon size={16} />
                    </button>
                    <button
                        onClick={() => editor.chain().focus().toggleStrike().run()}
                        className={`p-1.5 rounded-md transition-colors ${editor.isActive('strike') ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                        title="删除线"
                    >
                        <Strikethrough size={16} />
                    </button>
                </div>

                <div className="w-px h-6 bg-gray-200 mx-1"></div>

                {/* 标题 */}
                <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
                    <button
                        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                        className={`p-1.5 rounded-md transition-colors ${editor.isActive('heading', { level: 1 }) ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                        title="标题 1"
                    >
                        <Heading1 size={16} />
                    </button>
                    <button
                        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                        className={`p-1.5 rounded-md transition-colors ${editor.isActive('heading', { level: 2 }) ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                        title="标题 2"
                    >
                        <Heading2 size={16} />
                    </button>
                    <button
                        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
                        className={`p-1.5 rounded-md transition-colors ${editor.isActive('heading', { level: 3 }) ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                        title="标题 3"
                    >
                        <Heading3 size={16} />
                    </button>
                </div>

                <div className="w-px h-6 bg-gray-200 mx-1"></div>

                {/* 列表和引用 */}
                <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
                    <button
                        onClick={() => editor.chain().focus().toggleBulletList().run()}
                        className={`p-1.5 rounded-md transition-colors ${editor.isActive('bulletList') ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                        title="无序列表"
                    >
                        <List size={16} />
                    </button>
                    <button
                        onClick={() => editor.chain().focus().toggleOrderedList().run()}
                        className={`p-1.5 rounded-md transition-colors ${editor.isActive('orderedList') ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                        title="有序列表"
                    >
                        <ListOrdered size={16} />
                    </button>
                    <button
                        onClick={() => editor.chain().focus().toggleBlockquote().run()}
                        className={`p-1.5 rounded-md transition-colors ${editor.isActive('blockquote') ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                        title="引用"
                    >
                        <Quote size={16} />
                    </button>
                    <button
                        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
                        className={`p-1.5 rounded-md transition-colors ${editor.isActive('codeBlock') ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                        title="代码块"
                    >
                        <Code size={16} />
                    </button>
                </div>

                <div className="w-px h-6 bg-gray-200 mx-1"></div>

                {/* 对齐 */}
                <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
                    <button
                        onClick={() => editor.chain().focus().setTextAlign('left').run()}
                        className={`p-1.5 rounded-md transition-colors ${editor.isActive({ textAlign: 'left' }) ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                        title="左对齐"
                    >
                        <AlignLeft size={16} />
                    </button>
                    <button
                        onClick={() => editor.chain().focus().setTextAlign('center').run()}
                        className={`p-1.5 rounded-md transition-colors ${editor.isActive({ textAlign: 'center' }) ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                        title="居中"
                    >
                        <AlignCenter size={16} />
                    </button>
                    <button
                        onClick={() => editor.chain().focus().setTextAlign('right').run()}
                        className={`p-1.5 rounded-md transition-colors ${editor.isActive({ textAlign: 'right' }) ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                        title="右对齐"
                    >
                        <AlignRight size={16} />
                    </button>
                    <button
                        onClick={() => editor.chain().focus().setTextAlign('justify').run()}
                        className={`p-1.5 rounded-md transition-colors ${editor.isActive({ textAlign: 'justify' }) ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                        title="两端对齐"
                    >
                        <AlignJustify size={16} />
                    </button>
                </div>

                <div className="w-px h-6 bg-gray-200 mx-1"></div>

                {/* 颜色 */}
                <div className="flex items-center gap-0.5">
                    <input
                        type="color"
                        value={editor.getAttributes('textStyle').color || '#000000'}
                        onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
                        className="w-8 h-8 rounded-lg cursor-pointer border border-gray-200 p-0.5"
                        title="文字颜色"
                    />
                    <button
                        onClick={() => editor.chain().focus().toggleHighlight().run()}
                        className={`p-2 rounded-lg border border-gray-200 transition-colors ${editor.isActive('highlight') ? 'bg-yellow-100 border-yellow-300 text-yellow-700' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                        title="高亮"
                    >
                        <Highlighter size={16} />
                    </button>
                </div>

                <div className="w-px h-6 bg-gray-200 mx-1"></div>

                {/* 链接 */}
                <button
                    onClick={setLink}
                    className={`p-2 rounded-lg border border-gray-200 transition-colors ${editor.isActive('link') ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                    title="插入链接"
                >
                    <LinkIcon size={16} />
                </button>

                <div className="w-px h-6 bg-gray-200 mx-1"></div>

                {/* AI 生成按钮 */}
                <button
                    onClick={handleGenerateImage}
                    disabled={isGeneratingImg}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-gradient-to-r from-blue-600 to-blue-700 rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all disabled:opacity-50 shadow-sm"
                >
                    {isGeneratingImg ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                    AI 生图
                </button>
                <button
                    onClick={handleGenerateVideo}
                    disabled={isGeneratingVid}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-gradient-to-r from-purple-600 to-purple-700 rounded-lg hover:from-purple-700 hover:to-purple-800 transition-all disabled:opacity-50 shadow-sm"
                >
                    {isGeneratingVid ? <Loader2 size={14} className="animate-spin" /> : <Video size={14} />}
                    AI 生视频
                </button>
            </div>

            {/* 链接输入框 */}
            {showLinkInput && (
                <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 border-b border-blue-100">
                    <LinkIcon size={16} className="text-blue-600" />
                    <input
                        type="text"
                        value={linkUrl}
                        onChange={(e) => setLinkUrl(e.target.value)}
                        placeholder="输入链接地址..."
                        className="flex-1 px-3 py-1.5 text-sm border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        onKeyDown={(e) => e.key === 'Enter' && confirmLink()}
                        autoFocus
                    />
                    <button
                        onClick={confirmLink}
                        className="p-1.5 text-green-600 hover:bg-green-100 rounded-lg transition-colors"
                    >
                        <Check size={18} />
                    </button>
                    <button
                        onClick={() => { setShowLinkInput(false); setLinkUrl(''); }}
                        className="p-1.5 text-red-600 hover:bg-red-100 rounded-lg transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>
            )}

            {/* AI 配图建议 */}
            {aiSuggestions.length > 0 && (
                <div className="px-4 py-3 bg-purple-50 border-b border-purple-100">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-purple-800 flex items-center gap-2">
                            <Sparkles size={14} />
                            AI 推荐配图提示词
                        </span>
                        <button
                            onClick={() => setAiSuggestions([])}
                            className="p-1 text-purple-600 hover:bg-purple-100 rounded transition-colors"
                        >
                            <X size={14} />
                        </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {aiSuggestions.map((suggestion, index) => (
                            <button
                                key={index}
                                onClick={() => {
                                    // Clipboard API 在 http:// 下不可用, 使用 fallback
                                    try {
                                        const textarea = document.createElement('textarea');
                                        textarea.value = suggestion;
                                        textarea.style.position = 'fixed';
                                        textarea.style.opacity = '0';
                                        document.body.appendChild(textarea);
                                        textarea.select();
                                        document.execCommand('copy');
                                        document.body.removeChild(textarea);
                                    } catch (e) {
                                        console.warn('Copy failed:', e);
                                    }
                                    alert('提示词已复制，点击"AI 生图"使用');
                                }}
                                className="px-3 py-1.5 text-xs bg-white border border-purple-200 rounded-full text-purple-700 hover:bg-purple-100 hover:border-purple-300 transition-all"
                            >
                                {suggestion}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* 图片选中时的工具栏 */}
            {selectedImage && (
                <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 border-b border-blue-100">
                    <span className="text-sm font-medium text-blue-800">图片设置:</span>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => {
                                selectedImage.style.width = '50%';
                                selectedImage.style.margin = '0 auto';
                            }}
                            className="p-1.5 text-gray-600 hover:bg-white rounded transition-colors"
                            title="小尺寸"
                        >
                            <Shrink size={16} />
                        </button>
                        <button
                            onClick={() => {
                                selectedImage.style.width = '75%';
                                selectedImage.style.margin = '0 auto';
                            }}
                            className="p-1.5 text-gray-600 hover:bg-white rounded transition-colors"
                            title="中尺寸"
                        >
                            <Expand size={16} />
                        </button>
                        <button
                            onClick={() => {
                                selectedImage.style.width = '100%';
                                selectedImage.style.margin = '0';
                            }}
                            className="p-1.5 text-gray-600 hover:bg-white rounded transition-colors"
                            title="全宽"
                        >
                            <Maximize2 size={16} />
                        </button>
                    </div>
                    <div className="w-px h-5 bg-blue-200"></div>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => {
                                selectedImage.style.margin = '0 auto 0 0';
                            }}
                            className="p-1.5 text-gray-600 hover:bg-white rounded transition-colors"
                            title="左对齐"
                        >
                            <AlignLeft size={16} />
                        </button>
                        <button
                            onClick={() => {
                                selectedImage.style.margin = '0 auto';
                            }}
                            className="p-1.5 text-gray-600 hover:bg-white rounded transition-colors"
                            title="居中"
                        >
                            <AlignCenter size={16} />
                        </button>
                        <button
                            onClick={() => {
                                selectedImage.style.margin = '0 0 0 auto';
                            }}
                            className="p-1.5 text-gray-600 hover:bg-white rounded transition-colors"
                            title="右对齐"
                        >
                            <AlignRight size={16} />
                        </button>
                    </div>
                    <div className="w-px h-5 bg-blue-200"></div>
                    <button
                        onClick={() => {
                            selectedImage.remove();
                            setSelectedImage(null);
                        }}
                        className="p-1.5 text-red-600 hover:bg-red-100 rounded transition-colors"
                        title="删除图片"
                    >
                        <Trash2 size={16} />
                    </button>
                </div>
            )}

            {/* 主编辑区域 */}
            <div className={`flex-1 flex overflow-hidden ${showPreview ? 'flex-row' : 'flex-col'}`}>
                {/* 编辑器 */}
                <div className={`flex-1 overflow-y-auto ${showPreview ? 'w-1/2 border-r border-gray-200' : 'w-full'}`}>
                    <div className="p-8 max-w-4xl mx-auto relative">
                        <EditorContent editor={editor} className="min-h-[500px]" />

                        {/* AI 自动补全组件 */}
                        <AICompletion
                            editor={editor}
                            isEnabled={aiCompletionEnabled}
                            llmProvider={llmProvider}
                            llmModel={llmModel}
                        />
                    </div>
                </div>

                {/* 实时预览 */}
                {showPreview && (
                    <div className="w-1/2 overflow-y-auto bg-gray-100">
                        <div className="p-8">
                            <div className="bg-white rounded-xl shadow-lg p-10 min-h-[600px] border border-gray-100">
                                <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-8 pb-4 border-b border-gray-50 flex items-center gap-2">
                                    <Eye size={14} />
                                    预览效果
                                </h3>
                                <div
                                    className="prose prose-slate prose-lg max-w-none text-slate-900 leading-relaxed font-normal antialiased"
                                    dangerouslySetInnerHTML={{ __html: editor.getHTML() }}
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>



            {/* 底部状态栏 */}
            <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-t border-gray-200 text-xs text-gray-500">
                <div className="flex items-center gap-4">
                    <span>{editor.storage.characterCount?.characters?.() || editor.getText().length} 字符</span>
                    <span>{editor.getText().split(/\s+/).filter(Boolean).length} 词</span>
                    <span>最后保存: 刚刚</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-green-600 flex items-center gap-1">
                        <Check size={12} />
                        已自动保存
                    </span>
                </div>
            </div>

            {/* 自定义样式 */}
            <style dangerouslySetInnerHTML={{
                __html: `
                    .ProseMirror {
                        outline: none;
                    }
                    .ProseMirror p {
                        margin-bottom: 1em;
                        line-height: 1.8;
                        color: #374151;
                    }
                    .ProseMirror p.lead {
                        font-size: 1.25rem;
                        color: #6b7280;
                        font-weight: 300;
                    }
                    .ProseMirror h1 {
                        font-size: 2.25rem;
                        font-weight: 700;
                        margin-top: 1.5em;
                        margin-bottom: 0.5em;
                        color: #111827;
                        line-height: 1.3;
                    }
                    .ProseMirror h2 {
                        font-size: 1.75rem;
                        font-weight: 600;
                        margin-top: 1.5em;
                        margin-bottom: 0.5em;
                        color: #1f2937;
                        line-height: 1.4;
                    }
                    .ProseMirror h3 {
                        font-size: 1.375rem;
                        font-weight: 600;
                        margin-top: 1.25em;
                        margin-bottom: 0.5em;
                        color: #374151;
                    }
                    .ProseMirror ul, .ProseMirror ol {
                        margin: 1em 0;
                        padding-left: 1.5em;
                    }
                    .ProseMirror li {
                        margin: 0.5em 0;
                    }
                    .ProseMirror blockquote {
                        border-left: 4px solid #e5e7eb;
                        padding-left: 1em;
                        margin: 1.5em 0;
                        color: #6b7280;
                        font-style: italic;
                    }
                    .ProseMirror code {
                        background: #f3f4f6;
                        padding: 0.2em 0.4em;
                        border-radius: 0.25rem;
                        font-family: monospace;
                        font-size: 0.875em;
                    }
                    .ProseMirror pre {
                        background: #1f2937;
                        color: #f9fafb;
                        padding: 1em;
                        border-radius: 0.5rem;
                        overflow-x: auto;
                        margin: 1.5em 0;
                    }
                    .ProseMirror pre code {
                        background: none;
                        padding: 0;
                        color: inherit;
                    }
                    .ProseMirror img {
                        max-width: 100%;
                        height: auto;
                        border-radius: 0.5rem;
                        margin: 1.5rem 0;
                        display: block;
                        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
                        transition: all 0.2s;
                    }
                    .ProseMirror img:hover {
                        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
                    }
                    .ProseMirror video {
                        max-width: 100%;
                        height: auto;
                        border-radius: 0.5rem;
                        margin: 1.5rem 0;
                        display: block;
                        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
                    }
                    .ProseMirror img.ProseMirror-selectednode,
                    .ProseMirror video.ProseMirror-selectednode {
                        outline: 3px solid #3b82f6;
                        outline-offset: 4px;
                    }
                    .ProseMirror p.is-editor-empty:first-child::before {
                        content: attr(data-placeholder);
                        float: left;
                        color: #9ca3af;
                        pointer-events: none;
                        height: 0;
                    }
                    .ProseMirror mark {
                        background: #fef3c7;
                        padding: 0.1em 0.2em;
                        border-radius: 0.2rem;
                    }
                `
            }} />
        </div>
    );
}
