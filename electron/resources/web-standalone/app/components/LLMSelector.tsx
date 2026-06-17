"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronDown, Check, Bot } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function LLMSelector({
    compact = false,
    menuPlacement = "above",
    fullWidth = false,
}: {
    compact?: boolean;
    menuPlacement?: "above" | "below";
    /** 侧栏内铺满宽度 */
    fullWidth?: boolean;
}) {
    const [config, setConfig] = useState<any>(null);
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        fetchConfig();
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const fetchConfig = async () => {
        try {
            const res = await fetch("/api/config/provider");
            const data = await res.json();
            setConfig(data);
            if (data.current?.id) {
                window.dispatchEvent(new CustomEvent("llm-provider-changed", { detail: data.current.id }));
            }
        } catch (error) {
            console.error("Failed to fetch provider config:", error);
        }
    };

    const handleSelectProvider = async (providerId: string) => {
        if (loading) return;
        setLoading(true);
        try {
            const res = await fetch("/api/config/provider", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ provider: providerId }),
            });
            const data = await res.json();
            if (data.success) {
                setConfig((prev: any) => ({
                    ...prev,
                    current: data.current,
                }));
                setIsOpen(false);
                window.dispatchEvent(new CustomEvent("llm-provider-changed", { detail: data.current.id }));
            }
        } catch (error) {
            console.error("Failed to set provider:", error);
        } finally {
            setLoading(false);
        }
    };

    if (!config) return null;

    const label = config._fallback ? "后端未连接" : (config.current?.name || "未选择");

    return (
        <div ref={containerRef} className={`relative ${compact ? "shrink-0" : ""} ${fullWidth ? "w-full" : ""}`}>
            <button
                type="button"
                title={`大脑 · ${label}`}
                onClick={() => setIsOpen(!isOpen)}
                className={
                    compact
                        ? `flex h-9 max-w-[9.5rem] items-center gap-1 rounded-lg border px-2 text-left text-xs transition-colors sm:max-w-[11rem] ${
                              isOpen
                                  ? "border-blue-200 bg-blue-50 text-blue-800"
                                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                          }`
                        : `
                    flex w-full ${fullWidth ? "max-w-none" : "max-w-[min(100%,11rem)] sm:max-w-[13rem]"} min-w-0 items-start gap-1.5 px-2.5 py-2 rounded-xl text-left
                    text-[11px] font-medium transition-all border
                    ${isOpen
                        ? "bg-blue-50 text-blue-600 ring-1 ring-blue-200 border-transparent"
                        : "text-slate-600 bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                    }
                `
                }
            >
                <Bot className={`h-3.5 w-3.5 shrink-0 ${isOpen ? "text-blue-600" : "text-slate-400"}`} />
                {compact ? (
                    <span className={`min-w-0 flex-1 truncate font-medium ${config._fallback ? "text-red-600" : ""}`}>
                        {config._fallback ? "未连接" : label}
                    </span>
                ) : (
                    <span className="min-w-0 flex-1 flex flex-col gap-0.5">
                        <span className={`text-[10px] font-medium leading-none ${isOpen ? "text-blue-600" : "text-slate-400"}`}>
                            大脑模型
                        </span>
                        <span className={`font-semibold leading-snug break-words whitespace-normal ${config._fallback ? "text-red-500" : (isOpen ? "text-blue-600" : "text-slate-600")}`}>
                            {config._fallback ? "🔴 后端未连接" : (config.current?.name || "未选择")}
                        </span>
                    </span>
                )}
                <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{
                            opacity: 0,
                            y: compact || menuPlacement === "below" ? -8 : 8,
                        }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{
                            opacity: 0,
                            y: compact || menuPlacement === "below" ? -8 : 8,
                        }}
                        transition={{ duration: 0.12 }}
                        className={`absolute left-0 z-[120] w-full min-w-[14rem] max-w-[min(100vw-2rem,16rem)] overflow-hidden rounded-xl border border-slate-100 bg-white shadow-2xl sm:max-w-none ${
                            compact || menuPlacement === "below"
                                ? "top-full mt-2"
                                : "bottom-full mb-2"
                        }`}
                    >
                        <div className="px-3 py-2 border-b border-slate-100 bg-blue-50">
                            <div className="flex items-center gap-1.5 text-xs font-bold text-blue-600">
                                <Bot className="w-3 h-3" />
                                <span>切换智能对话大脑供应商</span>
                            </div>
                        </div>

                        <div className="max-h-56 overflow-y-auto p-1.5">
                            {config.available?.map((provider: any) => {
                                const isCurrent = config.current?.id === provider.id;
                                const isAvailable = provider.has_key;
                                return (
                                    <button
                                        key={provider.id}
                                        type="button"
                                        disabled={!isAvailable || loading}
                                        onClick={() => handleSelectProvider(provider.id)}
                                        className={`
                                            w-full flex items-center justify-between px-2.5 py-2 rounded-lg
                                            text-left transition-all text-xs group
                                            ${isCurrent
                                                ? "bg-blue-50 text-blue-600"
                                                : isAvailable
                                                    ? "hover:bg-slate-50 text-slate-700"
                                                    : "text-slate-300 cursor-not-allowed opacity-50"
                                            }
                                        `}
                                    >
                                        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                            <span className={`font-medium truncate ${isCurrent ? "font-semibold" : ""}`}>
                                                {provider.name}
                                            </span>
                                            <span className="text-[10px] text-slate-400 truncate">
                                                {provider.default_model}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-1 ml-2 shrink-0">
                                            {!isAvailable && (
                                                <span className="text-[10px] text-red-400 bg-red-50 px-1.5 py-0.5 rounded">无Key</span>
                                            )}
                                            {isCurrent && <Check className="w-3.5 h-3.5 text-blue-600" />}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
