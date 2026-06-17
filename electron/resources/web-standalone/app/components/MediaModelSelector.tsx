"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronDown, Check, ImageIcon, VideoIcon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface MediaModel {
    id: string;
    name: string;
    provider: string;
    model_id: string;
    api_type: string;
    description?: string;
    available: boolean;
}

interface ModalityConfig {
    models: MediaModel[];
    current: string;
}

interface MediaModelsConfig {
    image: ModalityConfig;
    video: ModalityConfig;
}

type Modality = "image" | "video";

const MODALITY_META: Record<Modality, { icon: React.ReactNode; label: string; bgActive: string; bgHover: string; text: string; ring: string }> = {
    image: {
        icon: <ImageIcon className="w-3 h-3" />,
        label: "图片模型",
        bgActive: "bg-[var(--nav-active-fill)]",
        bgHover: "hover:bg-[var(--chrome-rail-bg)]",
        text: "text-[color:var(--accent)]",
        ring: "ring-[color:var(--separator-subtle)]",
    },
    video: {
        icon: <VideoIcon className="w-3 h-3" />,
        label: "视频模型",
        bgActive: "bg-[var(--nav-active-fill)]",
        bgHover: "hover:bg-[var(--chrome-rail-bg)]",
        text: "text-[color:var(--accent)]",
        ring: "ring-[color:var(--separator-subtle)]",
    },
};

export default function MediaModelSelector({
    modality: propModality = "all",
    compact = false,
    panelLayout = false,
}: {
    modality?: "image" | "video" | "all";
    compact?: boolean;
    /** 侧栏纵向排列 + 下拉向下展开 */
    panelLayout?: boolean;
}) {
    const [config, setConfig] = useState<MediaModelsConfig | null>(null);
    const [openModality, setOpenModality] = useState<Modality | null>(null);
    const [loading, setLoading] = useState(false);
    const [activeProvider, setActiveProvider] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        fetchModels();

        const handleProviderChanged = (e: any) => setActiveProvider(e.detail);
        window.addEventListener("llm-provider-changed", handleProviderChanged);

        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setOpenModality(null);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            window.removeEventListener("llm-provider-changed", handleProviderChanged);
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, []);

    useEffect(() => {
        if (!config || !activeProvider) return;

        (["image", "video"] as Modality[]).forEach(modality => {
            const mod = config[modality];
            if (!mod) return;
            const providerModels = (mod.models || []).filter(m => m.provider === activeProvider);

            // If the currently selected model is not in this provider's list
            if (mod.current && !providerModels.some(m => m.id === mod.current)) {
                const firstAvailable = providerModels.find(m => m.available);
                if (firstAvailable) {
                    // Auto-select the first available model for this provider
                    handleSelectModel(modality, firstAvailable.id);
                } else if (providerModels.length === 0) {
                    // Clear it if there are no models
                    setConfig(prev => prev ? { ...prev, [modality]: { ...prev[modality], current: "" } } : null);
                }
            }
        });
    }, [activeProvider]);

    const fetchModels = async () => {
        try {
            const res = await fetch("/api/config/media-models");
            const data = await res.json();
            if (!data._fallback) {
                setConfig(data);
            }
        } catch (error) {
            console.error("Failed to fetch media models:", error);
        }
    };

    const handleSelectModel = async (modality: Modality, modelId: string) => {
        if (loading) return;
        setLoading(true);
        try {
            const res = await fetch("/api/config/media-models", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ modality, model_id: modelId }),
            });
            const data = await res.json();
            if (data.status === "ok") {
                setConfig(prev => {
                    if (!prev) return prev;
                    return {
                        ...prev,
                        [modality]: { ...prev[modality], current: modelId },
                    };
                });
                setOpenModality(null);
            }
        } catch (error) {
            console.error("Failed to set media model:", error);
        } finally {
            setLoading(false);
        }
    };

    const getCurrentModelName = (modality: Modality): string => {
        if (!config) return "...";
        const mod = config[modality];
        const allModels = mod.models || [];
        const providerModels = activeProvider ? allModels.filter(m => m.provider === activeProvider) : allModels;

        const currentModel = providerModels.find(m => m.id === mod.current);
        if (currentModel) {
            return currentModel.name;
        }

        if (providerModels.length > 0) {
            return "未选中";
        }
        return "暂无模型";
    };

    if (!config) return null;

    const displayedModalities = (["image", "video"] as Modality[]).filter(m => propModality === "all" || m === propModality);

    const menuBelow = compact || panelLayout;

    return (
        <div
            ref={containerRef}
            className={`relative flex ${panelLayout ? "w-full flex-col gap-3" : compact ? "flex-nowrap items-center gap-1.5 shrink-0" : "flex-wrap items-start gap-2"}`}
        >
            {displayedModalities.map(modality => {
                const meta = MODALITY_META[modality];
                const isOpen = openModality === modality;
                const allModels = config[modality]?.models || [];
                const models = activeProvider
                    ? allModels.filter(m => m.provider === activeProvider)
                    : allModels;

                return (
                    <div
                        key={modality}
                        className={`relative min-w-0 shrink-0 ${
                            panelLayout
                                ? "w-full max-w-none"
                                : compact
                                  ? "max-w-[8.5rem] sm:max-w-[10rem]"
                                  : "max-w-[min(100%,11rem)] sm:max-w-[13rem]"
                        }`}
                    >
                        <button
                            type="button"
                            title={`${meta.label} · ${getCurrentModelName(modality)}`}
                            onClick={() => setOpenModality(isOpen ? null : modality)}
                        className={
                            compact
                                ? `flex h-9 w-full items-center gap-1 rounded-lg border px-1.5 text-left text-xs transition-colors ${
                                          isOpen
                                              ? `${meta.bgActive} ${meta.text} border-transparent`
                                              : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                                      }`
                                : panelLayout
                                  ? `
                                flex w-full items-start gap-1.5 px-2.5 py-2 rounded-xl text-left min-w-0
                                text-[11px] font-medium transition-colors border
                                ${isOpen
                                    ? `${meta.bgActive} ${meta.text} ring-1 ${meta.ring} border-transparent`
                                    : `text-[color:var(--foreground)] bg-[var(--card-bg)] border-[color:var(--separator-subtle)] hover:bg-[var(--chrome-rail-bg)]`
                                }
                            `
                                  : `
                                flex w-full items-start gap-1.5 px-2.5 py-2 rounded-xl text-left min-w-0
                                text-[11px] font-medium transition-all border
                                ${isOpen
                                    ? `${meta.bgActive} ${meta.text} ring-1 ${meta.ring} border-transparent`
                                    : `text-slate-600 bg-white border-slate-200 hover:border-slate-300 ${meta.bgHover}`
                                }
                            `
                        }
                        >
                            <span className={`shrink-0 ${isOpen ? meta.text : "text-slate-400"} ${compact ? "" : "mt-0.5"}`}>{meta.icon}</span>
                            {compact ? (
                                <span className={`min-w-0 flex-1 truncate font-medium ${isOpen ? meta.text : "text-slate-700"}`}>
                                    {getCurrentModelName(modality)}
                                </span>
                            ) : (
                                <span className="min-w-0 flex-1 flex flex-col gap-0.5">
                                    <span className={`text-[10px] font-medium leading-none ${isOpen ? meta.text : "text-slate-400"}`}>
                                        {meta.label}
                                    </span>
                                    <span className={`font-semibold leading-snug break-words whitespace-normal ${isOpen ? meta.text : "text-slate-600"}`}>
                                        {getCurrentModelName(modality)}
                                    </span>
                                </span>
                            )}
                            <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${compact ? "" : "mt-0.5"} ${isOpen ? "rotate-180" : ""}`} />
                        </button>

                        {/* 向上弹出的下拉菜单 */}
                        <AnimatePresence>
                            {isOpen && (
                                <motion.div
                                    initial={{ opacity: 0, y: menuBelow ? -8 : 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: menuBelow ? -8 : 8 }}
                                    transition={{ duration: 0.12 }}
                                    className={`absolute left-0 z-[120] w-72 overflow-hidden rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] shadow-lg sm:w-[min(20rem,calc(100vw-2rem))] ${
                                        menuBelow ? "top-full mt-2" : "bottom-full mb-2"
                                    }`}
                                >
                                    {/* 标题栏 */}
                                    <div className={`border-b border-[color:var(--separator-subtle)] px-3 py-2 bg-[var(--chrome-rail-bg)]`}>
                                        <div className={`flex items-center gap-1.5 text-xs font-bold ${meta.text}`}>
                                            {meta.icon}
                                            <span>选择{meta.label}</span>
                                        </div>
                                    </div>

                                    {/* 模型列表 */}
                                    <div className="max-h-56 overflow-y-auto p-1.5">
                                        {models.length === 0 ? (
                                            <div className="text-xs text-slate-400 px-3 py-4 text-center">暂无可用模型</div>
                                        ) : (
                                            models.map(model => {
                                                const isCurrent = config[modality].current === model.id;
                                                const isAvailable = model.available;
                                                return (
                                                    <button
                                                        key={model.id}
                                                        type="button"
                                                        disabled={!isAvailable || loading}
                                                        onClick={() => handleSelectModel(modality, model.id)}
                                                        className={`
                                                            w-full flex items-center justify-between px-2.5 py-2 rounded-lg
                                                            text-left transition-all text-xs group
                                                            ${isCurrent
                                                                ? `${meta.bgActive} ${meta.text}`
                                                                : isAvailable
                                                                    ? "hover:bg-slate-50 text-slate-700"
                                                                    : "text-slate-300 cursor-not-allowed opacity-50"
                                                            }
                                                        `}
                                                    >
                                                        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                                            <span className={`font-medium truncate ${isCurrent ? "font-semibold" : ""}`}>
                                                                {model.name}
                                                            </span>
                                                            <span className="text-[10px] text-slate-400 truncate">
                                                                {model.provider} · {model.model_id}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-1 ml-2 shrink-0">
                                                            {!isAvailable && (
                                                                <span className="text-[10px] text-red-400 bg-red-50 px-1.5 py-0.5 rounded">无Key</span>
                                                            )}
                                                            {isCurrent && <Check className={`w-3.5 h-3.5 ${meta.text}`} />}
                                                        </div>
                                                    </button>
                                                );
                                            })
                                        )}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                );
            })}
        </div>
    );
}
