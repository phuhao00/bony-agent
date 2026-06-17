"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { ChevronDown, Check, Layout, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface Provider {
    id: string;
    name: string;
    has_key: boolean;
}

interface MediaModel {
    id: string;
    name: string;
    provider: string;
    model_id: string;
    available: boolean;
}

interface UnifiedMediaSelectorProps {
    modality: "image" | "video" | "image_edit";
}

const PROVIDER_NAMES: Record<string, string> = {
    alibaba: "阿里巴巴 / 通义",
    zhipu: "智谱 AI",
    openai: "OpenAI",
    google: "Google",
    openrouter: "OpenRouter",
    doubao: "豆包 / 火山",
    bytedance: "字节跳动",
    jimeng: "即梦",
    edge: "Edge (免费)",
    seedance: "SeaDance",
};

export default function UnifiedMediaSelector({ modality }: UnifiedMediaSelectorProps) {
    const [providers, setProviders] = useState<Provider[]>([]);
    const [allModels, setAllModels] = useState<MediaModel[]>([]);
    const [currentProviderId, setCurrentProviderId] = useState("");
    const [currentModelId, setCurrentModelId] = useState("");
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const fetchConfigs = useCallback(async () => {
        try {
            const mRes = await fetch("/api/config/media-models");
            const mData = await mRes.json();
            const models: MediaModel[] = mData[modality]?.models || [];
            const currentId: string = mData[modality]?.current || "";

            setAllModels(models);
            setCurrentModelId(currentId);

            const providerMap = new Map<string, Provider>();
            for (const m of models) {
                const existing = providerMap.get(m.provider);
                if (existing) {
                    existing.has_key = existing.has_key || m.available;
                } else {
                    providerMap.set(m.provider, {
                        id: m.provider,
                        name: PROVIDER_NAMES[m.provider] || m.provider,
                        has_key: m.available,
                    });
                }
            }
            const derivedProviders = Array.from(providerMap.values());
            setProviders(derivedProviders);

            const currentModel = models.find(m => m.id === currentId);
            const targetProvider = currentModel?.provider;
            if (targetProvider && providerMap.has(targetProvider)) {
                setCurrentProviderId(targetProvider);
            } else {
                const firstAvailable = derivedProviders.find(p => p.has_key);
                setCurrentProviderId(firstAvailable?.id || derivedProviders[0]?.id || "");
            }
        } catch (error) {
            console.error("Failed to fetch configs:", error);
        }
    }, [modality]);

    useEffect(() => {
        fetchConfigs();
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [fetchConfigs]);

    const handleProviderChange = async (providerId: string) => {
        if (providerId === currentProviderId) return;
        const providerModels = allModels.filter(m => m.provider === providerId && m.available);
        const firstModel = providerModels[0] || allModels.find(m => m.provider === providerId);
        if (firstModel) {
            setCurrentProviderId(providerId);
            await handleModelChange(firstModel.id);
        }
    };

    const handleModelChange = async (modelId: string) => {
        setLoading(true);
        try {
            const res = await fetch("/api/config/media-models", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ modality, model_id: modelId }),
            });
            if (res.ok) {
                setCurrentModelId(modelId);
            }
        } catch (error) {
            console.error("Failed to switch model:", error);
        } finally {
            setLoading(false);
            setIsOpen(false);
        }
    };

    const currentProvider = providers.find(p => p.id === currentProviderId);
    const currentModel = allModels.find(m => m.id === currentModelId);
    const filteredModels = useMemo(
        () => allModels.filter(m => m.provider === currentProviderId),
        [allModels, currentProviderId]
    );

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 px-4 py-2 bg-white/80 backdrop-blur-sm border border-slate-200 rounded-full hover:border-blue-400 hover:shadow-md transition-all group"
            >
                <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">
                        {currentProvider?.name || "选择供应商"}
                    </span>
                    <span className="text-slate-300">/</span>
                    <span className="text-xs font-bold text-blue-600 truncate max-w-[120px]">
                        {currentModel?.name || "选择模型"}
                    </span>
                </div>
                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? "rotate-180" : "group-hover:text-blue-500"}`} />
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 10 }}
                        className="absolute right-0 top-full mt-3 w-[420px] bg-white rounded-2xl shadow-2xl border border-slate-100 p-3 z-50 flex gap-3 overflow-hidden"
                    >
                        {/* Provider Column */}
                        <div className="w-1/2 border-r border-slate-100 pr-2">
                             <div className="flex items-center gap-1 text-[10px] font-bold text-slate-400 mb-2 px-2 uppercase tracking-wider">
                                <ChevronRight size={12} />
                                <span>模型供应商</span>
                             </div>
                             <div className="space-y-1">
                                {providers.map(p => (
                                    <button
                                        key={p.id}
                                        onClick={() => handleProviderChange(p.id)}
                                        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-all ${
                                            currentProviderId === p.id
                                            ? "bg-blue-50 text-blue-700 font-bold"
                                            : "hover:bg-slate-50 text-slate-600 font-medium"
                                        }`}
                                    >
                                        <div className="flex items-center gap-2">
                                            <div className={`w-1.5 h-1.5 rounded-full ${p.has_key ? 'bg-green-400' : 'bg-slate-300'}`} />
                                            <span className="text-xs">{p.name}</span>
                                        </div>
                                        {currentProviderId === p.id && <ChevronRight size={14} className="opacity-40" />}
                                    </button>
                                ))}
                             </div>
                        </div>

                        {/* Model Column */}
                        <div className="w-1/2">
                            <div className="flex items-center gap-1 text-[10px] font-bold text-slate-400 mb-2 px-2 uppercase tracking-wider">
                                <Layout size={12} />
                                <span>可用模型</span>
                             </div>
                             <div className="space-y-1 max-h-[300px] overflow-y-auto pr-1">
                                {filteredModels.length > 0 ? (
                                    filteredModels.map(m => (
                                        <button
                                            key={m.id}
                                            disabled={!m.available || loading}
                                            onClick={() => handleModelChange(m.id)}
                                            className={`w-full flex flex-col px-3 py-2.5 rounded-xl transition-all ${
                                                currentModelId === m.id
                                                ? "bg-blue-600 text-white shadow-lg shadow-blue-200"
                                                : m.available
                                                    ? "hover:bg-slate-50 text-slate-700"
                                                    : "opacity-40 grayscale pointer-events-none"
                                            }`}
                                        >
                                            <div className="flex items-center justify-between w-full">
                                                <span className={`text-[11px] font-bold ${currentModelId === m.id ? 'text-white' : 'text-slate-800'}`}>
                                                    {m.name}
                                                </span>
                                                {currentModelId === m.id && <Check size={12} />}
                                            </div>
                                            <span className={`text-[9px] mt-0.5 font-medium truncate ${currentModelId === m.id ? 'text-blue-100' : 'text-slate-400'}`}>
                                                {m.model_id}
                                            </span>
                                        </button>
                                    ))
                                ) : (
                                    <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                                        <div className="w-10 h-10 bg-slate-50 rounded-full flex items-center justify-center mb-2">
                                            <Layout className="text-slate-300" size={18} />
                                        </div>
                                        <p className="text-[10px] text-slate-400 font-medium leading-relaxed">该供应商暂无<br/>可用的{modality === "image" ? "图片" : modality === "video" ? "视频" : "图像编辑"}模型</p>
                                    </div>
                                )}
                             </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
