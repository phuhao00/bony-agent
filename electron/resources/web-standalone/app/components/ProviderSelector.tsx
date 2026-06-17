"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronDown, Check, Settings, Key, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface ModelConfig {
    id: string;
    name: string;
    default_model: string;
    models: string[];
    env_var: string;
    has_key: boolean;
    extra_keys?: { env_var: string; has_key: boolean }[];
}

interface ProviderConfig {
    current: {
        id: string;
        model: string;
        has_key: boolean;
    };
    available: ModelConfig[];
}

export default function ProviderSelector() {
    const [config, setConfig] = useState<ProviderConfig | null>(null);
    const [isOpen, setIsOpen] = useState(false);
    const [showKeyInput, setShowKeyInput] = useState<string | null>(null); // Provider ID to show key input for
    const [tempKey, setTempKey] = useState("");
    const [loading, setLoading] = useState(false);

    const dropdownRef = useRef<HTMLDivElement>(null);

    // Fetch config on mount
    useEffect(() => {
        fetchConfig();

        // Close dropdown when clicking outside
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
                setShowKeyInput(null);
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
        } catch (error) {
            console.error("Failed to fetch provider config:", error);
        }
    };

    const handleProviderChange = async (providerId: string) => {
        // If switching to a provider that needs a key and doesn't have one, show input
        const targetProvider = config?.available.find(p => p.id === providerId);
        if (targetProvider && !targetProvider.has_key && targetProvider.id !== "zhipu") { // Zhipu might be default without key check?
            // Optional: enforce key check here if strict
        }

        setLoading(true);
        try {
            const res = await fetch("/api/config/provider", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ provider: providerId }),
            });
            const data = await res.json();
            if (data.success) {
                setConfig(prev => prev ? { ...prev, current: data.current } : null);
                setIsOpen(false);
            }
        } catch (error) {
            console.error("Failed to switch provider:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleModelChange = async (model: string) => {
        setLoading(true);
        try {
            const res = await fetch("/api/config/provider", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ model }),
            });
            const data = await res.json();
            if (data.success) {
                setConfig(prev => prev ? { ...prev, current: data.current } : null);
            }
        } catch (error) {
            console.error("Failed to switch model:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleSaveKey = async (providerId: string, envVar: string) => {
        if (!tempKey.trim()) return;

        setLoading(true);
        try {
            const res = await fetch("/api/config/provider", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    provider: providerId,
                    api_keys: { [envVar]: tempKey }
                }),
            });
            const data = await res.json();
            if (data.success) {
                // Update local state to reflect key is present
                const updatedAvailable = config?.available.map(p =>
                    p.id === providerId ? { ...p, has_key: true } : p
                ) || [];

                setConfig(prev => prev ? {
                    ...prev,
                    current: data.current,
                    available: updatedAvailable
                } : null);

                setShowKeyInput(null);
                setTempKey("");
            }
        } catch (error) {
            console.error("Failed to save key:", error);
        } finally {
            setLoading(false);
        }
    };

    if (!config) return <div className="animate-pulse bg-gray-200 h-8 w-32 rounded-md"></div>;

    const currentProvider = config.available.find(p => p.id === config.current.id);
    const isKeyMissing = !config.current.has_key;

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all text-sm font-medium ${isKeyMissing
                    ? "bg-red-50 border-red-200 text-red-600 hover:bg-red-100"
                    : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-blue-300"
                    }`}
            >
                {isKeyMissing && <AlertCircle className="w-4 h-4" />}
                <span>{currentProvider?.name || config.current.id}</span>
                <span className="text-gray-400">/</span>
                <span className="text-gray-600">{config.current.model}</span>
                <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`} />
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 5 }}
                        className="absolute right-0 top-full mt-2 w-72 bg-white rounded-xl shadow-xl border border-gray-100 p-2 z-50 overflow-hidden"
                    >
                        <div className="max-h-[80vh] overflow-y-auto">
                            {config.available.map((provider) => (
                                <div key={provider.id} className="mb-2 last:mb-0">
                                    <div
                                        className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors ${config.current.id === provider.id
                                            ? "bg-blue-50 text-blue-700"
                                            : "hover:bg-gray-50 text-gray-700"
                                            }`}
                                        onClick={() => {
                                            if (config.current.id !== provider.id) {
                                                handleProviderChange(provider.id);
                                            }
                                        }}
                                    >
                                        <div className="flex items-center gap-2">
                                            <div className={`w-2 h-2 rounded-full ${provider.has_key ? 'bg-green-400' : 'bg-gray-300'}`} />
                                            <span className="font-medium">{provider.name}</span>
                                        </div>
                                        {config.current.id === provider.id && <Check className="w-4 h-4" />}
                                    </div>

                                    {/* Model List (only for current provider) */}
                                    {config.current.id === provider.id && (
                                        <div className="pl-6 pr-2 py-1 space-y-1">
                                            {provider.models.map(model => (
                                                <button
                                                    key={model}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleModelChange(model);
                                                    }}
                                                    className={`w-full text-left text-xs px-2 py-1.5 rounded-md transition-colors ${config.current.model === model
                                                        ? "bg-blue-100 text-blue-800 font-medium"
                                                        : "text-gray-500 hover:bg-gray-100"
                                                        }`}
                                                >
                                                    {model}
                                                </button>
                                            ))}

                                            {/* API Key Config */}
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setShowKeyInput(showKeyInput === provider.id ? null : provider.id);
                                                }}
                                                className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-blue-500 mt-2 px-2 py-1 transition-colors w-full"
                                            >
                                                <Key className="w-3 h-3" />
                                                {provider.has_key ? "Update API Key" : "Set API Key"}
                                            </button>

                                            {showKeyInput === provider.id && (
                                                <div className="mt-2 p-2 bg-gray-50 rounded-md border border-gray-200" onClick={e => e.stopPropagation()}>
                                                    <input
                                                        type="password"
                                                        placeholder={`Enter ${provider.name} Key`}
                                                        className="w-full text-xs p-1.5 border border-gray-300 rounded mb-2 focus:ring-1 focus:ring-blue-500 outline-none"
                                                        value={tempKey}
                                                        onChange={e => setTempKey(e.target.value)}
                                                    />
                                                    <div className="flex gap-2">
                                                        <button
                                                            onClick={() => handleSaveKey(provider.id, provider.env_var)}
                                                            disabled={!tempKey.trim() || loading}
                                                            className="flex-1 bg-blue-600 text-white text-xs py-1 rounded hover:bg-blue-700 disabled:opacity-50"
                                                        >
                                                            Save
                                                        </button>
                                                        <button
                                                            onClick={() => setShowKeyInput(null)}
                                                            className="px-2 bg-gray-200 text-gray-600 text-xs py-1 rounded hover:bg-gray-300"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>

                        <div className="border-t border-gray-100 mt-2 pt-2 px-2">
                            <a href="/settings/capabilities" className="flex items-center gap-2 text-xs text-gray-500 hover:text-blue-600 py-1">
                                <Settings className="w-3 h-3" />
                                Manage All Providers
                            </a>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
