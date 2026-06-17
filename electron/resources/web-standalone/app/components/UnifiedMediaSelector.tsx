"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronDown, Check, Globe, Layout, ChevronRight } from "lucide-react";
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

export default function UnifiedMediaSelector({ modality }: UnifiedMediaSelectorProps) {
    const [providers, setProviders] = useState<Provider[]>([]);
    const [allModels, setAllModels] = useState<MediaModel[]>([]);
    const [currentProviderId, setCurrentProviderId] = useState("");
    const [currentModelId, setCurrentModelId] = useState("");
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        fetchConfigs();
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const fetchConfigs = async () => {
        try {
            // Fetch Providers
            const pRes = await fetch("/api/config/provider");
            const pData = await pRes.json();
            setProviders(pData.available);
            setCurrentProviderId(pData.current.id);

            // Fetch Models
            const mRes = await fetch("/api/config/media-models");
            const mData = await mRes.json();
            setAllModels(mData[modality]?.models || []);
            setCurrentModelId(mData[modality]?.current || "");
        } catch (error) {
            console.error("Failed to fetch configs:", error);
        }
    };

    const handleProviderChange = async (providerId: string) => {
        if (providerId === currentProviderId) return;
        setLoading(true);
        try {
            const res = await fetch("/api/config/provider", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ provider: providerId }),
            });
            const data = await res.json();
            if (data.success) {
                setCurrentProviderId(data.current.id);
                // After provider change, find the first available model for this provider
                const providerModels = allModels.filter(m => m.provider === providerId && m.available);
                if (providerModels.length > 0) {
                    await handleModelChange(providerModels[0].id);
                }
            }
        } catch (error) {
            console.error("Failed to switch provider:", error);
        } finally {
            setLoading(false);
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
    const filteredModels = allModels.filter(m => m.provider === currentProviderId);

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
                                <Globe size={12} />
                                <span>LLM 供应商</span>
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
                                        <p className="text-[10px] text-slate-400 font-medium leading-relaxed">该供应商暂无<br/>可用的{modality === "image" ? "图片" : "视频"}模型</p>
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
