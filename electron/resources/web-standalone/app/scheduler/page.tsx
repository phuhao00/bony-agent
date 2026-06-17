"use client";

import { useState, useEffect, useCallback } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────
interface SchedulerJob {
    id: string;
    name: string;
    content_type: "image" | "video" | "article";
    prompt: string;
    platforms: string[];
    schedule_type: "cron" | "interval";
    cron_expr: string;
    interval_hours: number;
    enabled: boolean;
    created_at: string;
    last_run: string | null;
    next_run: string | null;
    run_count: number;
    is_active: boolean;
}

interface JobLog {
    id: string;
    job_id: string;
    job_name: string;
    started_at: string;
    finished_at?: string;
    content_type: string;
    status: "running" | "success" | "error";
    result?: string;
    error?: string;
    published_to: { platform: string; success: boolean; url?: string }[];
}

// ─── Constants ────────────────────────────────────────────────────────────────
const CONTENT_TYPES = [
    { id: "image", label: "🎨 AI 图片", desc: "使用 AI 生成图片内容" },
    { id: "video", label: "🎬 AI 视频", desc: "使用 AI 生成视频内容" },
    { id: "article", label: "✍️ 软文", desc: "AI 生成图文软文" },
];

const PLATFORMS = [
    { id: "xiaohongshu", label: "📕 小红书" },
    { id: "douyin", label: "🎵 抖音" },
    { id: "bilibili", label: "📺 B站" },
    { id: "weibo", label: "🔥 微博" },
    { id: "youtube", label: "▶️ YouTube" },
];

const PRESETS = [
    { name: "每天早9点发图", content_type: "image", schedule_type: "cron", cron_expr: "0 9 * * *", interval_hours: 24 },
    { name: "每6小时发图", content_type: "image", schedule_type: "interval", cron_expr: "0 */6 * * *", interval_hours: 6 },
    { name: "每天发视频", content_type: "video", schedule_type: "cron", cron_expr: "0 18 * * *", interval_hours: 24 },
    { name: "每周一软文", content_type: "article", schedule_type: "cron", cron_expr: "0 10 * * 1", interval_hours: 168 },
];

const CRON_PRESETS = [
    { label: "每天 9:00", value: "0 9 * * *" },
    { label: "每天 18:00", value: "0 18 * * *" },
    { label: "每6小时", value: "0 */6 * * *" },
    { label: "每周一 10:00", value: "0 10 * * 1" },
    { label: "每月1日", value: "0 9 1 * *" },
];

// ─── Helper ───────────────────────────────────────────────────────────────────
function formatDate(iso: string | null) {
    if (!iso) return "—";
    try {
        return new Date(iso).toLocaleString("zh-CN", { hour12: false });
    } catch {
        return iso;
    }
}

function statusColor(status: string) {
    if (status === "success") return "text-emerald-600 bg-emerald-50";
    if (status === "error") return "text-red-600 bg-red-50";
    return "text-amber-600 bg-amber-50";
}

// ─── Create / Edit Modal ──────────────────────────────────────────────────────
function JobModal({
    initial,
    onSave,
    onClose,
}: {
    initial?: Partial<SchedulerJob>;
    onSave: (data: any) => Promise<void>;
    onClose: () => void;
}) {
    const [form, setForm] = useState({
        name: initial?.name || "",
        content_type: initial?.content_type || "image",
        prompt: initial?.prompt || "",
        platforms: initial?.platforms || [],
        schedule_type: initial?.schedule_type || "cron",
        cron_expr: initial?.cron_expr || "0 9 * * *",
        interval_hours: initial?.interval_hours || 6,
        enabled: initial?.enabled !== false,
    });
    const [saving, setSaving] = useState(false);

    const applyPreset = (preset: (typeof PRESETS)[0]) => {
        setForm((f) => ({
            ...f,
            name: preset.name,
            content_type: preset.content_type as any,
            schedule_type: preset.schedule_type as any,
            cron_expr: preset.cron_expr,
            interval_hours: preset.interval_hours,
        }));
    };

    const togglePlatform = (id: string) => {
        setForm((f) => ({
            ...f,
            platforms: f.platforms.includes(id)
                ? f.platforms.filter((p) => p !== id)
                : [...f.platforms, id],
        }));
    };

    const handleSave = async () => {
        if (!form.name.trim() || !form.prompt.trim()) {
            alert("请填写任务名称和生成提示词");
            return;
        }
        setSaving(true);
        try {
            await onSave(form);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b">
                    <h2 className="text-lg font-bold text-slate-800">
                        {initial?.id ? "编辑定时任务" : "创建定时任务"}
                    </h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">×</button>
                </div>

                <div className="p-6 space-y-5">
                    {/* Quick Presets */}
                    {!initial?.id && (
                        <div>
                            <p className="text-xs font-semibold text-slate-400 mb-2">快速预设</p>
                            <div className="grid grid-cols-2 gap-2">
                                {PRESETS.map((p) => (
                                    <button
                                        key={p.name}
                                        onClick={() => applyPreset(p)}
                                        className="text-xs px-3 py-2 bg-slate-50 hover:bg-purple-50 hover:border-purple-300 border border-slate-200 rounded-lg text-left transition-colors text-slate-800 font-medium"
                                    >
                                        {p.name}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Name */}
                    <div>
                        <label className="text-sm font-semibold text-slate-600 mb-1 block">任务名称</label>
                        <input
                            value={form.name}
                            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                            placeholder="例如: 每日科技赛博图"
                            className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                        />
                    </div>

                    {/* Content Type */}
                    <div>
                        <label className="text-sm font-semibold text-slate-600 mb-2 block">内容类型</label>
                        <div className="grid grid-cols-3 gap-2">
                            {CONTENT_TYPES.map((ct) => (
                                <button
                                    key={ct.id}
                                    onClick={() => setForm((f) => ({ ...f, content_type: ct.id as any }))}
                                    className={`p-3 rounded-xl border text-center text-xs font-medium transition-all ${form.content_type === ct.id
                                        ? "border-purple-400 bg-purple-50 text-purple-700"
                                        : "border-slate-200 text-slate-600 hover:border-purple-300"
                                        }`}
                                >
                                    <div className="text-lg mb-0.5">{ct.label.split(" ")[0]}</div>
                                    <div>{ct.label.split(" ").slice(1).join(" ")}</div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Prompt */}
                    <div>
                        <label className="text-sm font-semibold text-slate-600 mb-1 block">生成提示词</label>
                        <textarea
                            value={form.prompt}
                            onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
                            rows={3}
                            placeholder="描述要生成的内容，例如: 赛博朋克风格的未来城市夜景..."
                            className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none resize-none"
                        />
                    </div>

                    {/* Schedule Type */}
                    <div>
                        <label className="text-sm font-semibold text-slate-600 mb-2 block">调度方式</label>
                        <div className="flex gap-3 mb-3">
                            {[
                                { id: "cron", label: "📅 Cron 表达式" },
                                { id: "interval", label: "🔁 固定间隔" },
                            ].map((st) => (
                                <button
                                    key={st.id}
                                    onClick={() => setForm((f) => ({ ...f, schedule_type: st.id as any }))}
                                    className={`flex-1 py-2 rounded-xl border text-sm font-medium transition-all ${form.schedule_type === st.id
                                        ? "border-blue-400 bg-blue-50 text-blue-700"
                                        : "border-slate-200 text-slate-600 hover:border-blue-300"
                                        }`}
                                >
                                    {st.label}
                                </button>
                            ))}
                        </div>

                        {form.schedule_type === "cron" ? (
                            <div>
                                <div className="flex gap-2 mb-2 flex-wrap">
                                    {CRON_PRESETS.map((cp) => (
                                        <button
                                            key={cp.value}
                                            onClick={() => setForm((f) => ({ ...f, cron_expr: cp.value }))}
                                            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${form.cron_expr === cp.value
                                                ? "border-blue-400 bg-blue-50 text-blue-700"
                                                : "border-slate-200 text-slate-500 hover:border-blue-300"
                                                }`}
                                        >
                                            {cp.label}
                                        </button>
                                    ))}
                                </div>
                                <input
                                    value={form.cron_expr}
                                    onChange={(e) => setForm((f) => ({ ...f, cron_expr: e.target.value }))}
                                    placeholder="分 时 日 月 周 (e.g. 0 9 * * *)"
                                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none"
                                />
                                <p className="text-xs text-slate-400 mt-1">格式: 分 时 日 月 周 (0 9 * * * = 每天9点)</p>
                            </div>
                        ) : (
                            <div className="flex items-center gap-3">
                                <label className="text-sm text-slate-600">每隔</label>
                                <input
                                    type="number"
                                    min={1}
                                    max={168}
                                    value={form.interval_hours}
                                    onChange={(e) => setForm((f) => ({ ...f, interval_hours: parseInt(e.target.value) || 6 }))}
                                    className="w-24 px-3 py-2 border border-slate-200 rounded-xl text-sm text-center focus:ring-2 focus:ring-blue-500 outline-none"
                                />
                                <label className="text-sm text-slate-600">小时执行一次</label>
                            </div>
                        )}
                    </div>

                    {/* Platforms */}
                    <div>
                        <label className="text-sm font-semibold text-slate-600 mb-2 block">发布平台（可多选）</label>
                        <div className="flex flex-wrap gap-2">
                            {PLATFORMS.map((pl) => (
                                <button
                                    key={pl.id}
                                    onClick={() => togglePlatform(pl.id)}
                                    className={`px-3 py-1.5 rounded-full border text-sm transition-all ${form.platforms.includes(pl.id)
                                        ? "border-green-400 bg-green-50 text-green-700"
                                        : "border-slate-200 text-slate-500 hover:border-green-300"
                                        }`}
                                >
                                    {pl.label}
                                </button>
                            ))}
                        </div>
                        {form.platforms.length === 0 && (
                            <p className="text-xs text-amber-500 mt-1">未选择平台，内容将只生成不发布</p>
                        )}
                    </div>

                    {/* Enabled */}
                    <label className="flex items-center gap-3 cursor-pointer">
                        <div
                            onClick={() => setForm((f) => ({ ...f, enabled: !f.enabled }))}
                            className={`w-12 h-6 rounded-full transition-colors relative ${form.enabled ? "bg-purple-500" : "bg-slate-300"}`}
                        >
                            <div className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-all shadow ${form.enabled ? "left-6" : "left-0.5"}`} />
                        </div>
                        <span className="text-sm text-slate-700 font-medium">{form.enabled ? "创建后立即启用" : "暂不启用"}</span>
                    </label>
                </div>

                {/* Footer */}
                <div className="p-6 pt-0 flex gap-3">
                    <button onClick={onClose} className="flex-1 py-3 border border-slate-200 rounded-xl text-slate-600 font-medium hover:bg-slate-50 transition-colors">
                        取消
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex-1 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-xl font-semibold hover:from-purple-700 hover:to-indigo-700 transition-all disabled:opacity-60 shadow-lg shadow-purple-200"
                    >
                        {saving ? "⏳ 保存中..." : "✅ 保存任务"}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Job Card ─────────────────────────────────────────────────────────────────
function JobCard({
    job,
    onEdit,
    onDelete,
    onToggle,
    onRunNow,
    isRunning,
}: {
    job: SchedulerJob;
    onEdit: () => void;
    onDelete: () => void;
    onToggle: () => void;
    onRunNow: () => void;
    isRunning?: boolean;
}) {
    const typeIcon = { image: "🎨", video: "🎬", article: "✍️" }[job.content_type] || "📌";
    const typeColor = { image: "bg-purple-50 text-purple-700", video: "bg-blue-50 text-blue-700", article: "bg-green-50 text-green-700" }[job.content_type] || "";

    return (
        <div className={`bg-white rounded-2xl border shadow-sm hover:shadow-md transition-all p-5 ${!job.enabled ? "opacity-60" : ""}`}>
            <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                    <span className={`text-sm font-semibold px-2.5 py-1 rounded-full ${typeColor}`}>
                        {typeIcon} {job.content_type}
                    </span>
                    {job.enabled && job.is_active && (
                        <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            运行中
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1.5">
                    {/* Toggle */}
                    <button
                        onClick={onToggle}
                        className={`w-10 h-5 rounded-full transition-colors relative flex-shrink-0 ${job.enabled ? "bg-purple-500" : "bg-slate-200"}`}
                        title={job.enabled ? "禁用" : "启用"}
                    >
                        <div className={`w-4 h-4 bg-white rounded-full absolute top-0.5 transition-all shadow-sm ${job.enabled ? "left-5" : "left-0.5"}`} />
                    </button>
                </div>
            </div>

            <h3 className="font-bold text-slate-800 text-base mb-1">{job.name}</h3>
            <p className="text-xs text-slate-400 mb-3 line-clamp-2">{job.prompt}</p>

            <div className="space-y-1.5 text-xs text-slate-500 mb-4">
                <div className="flex items-center gap-1.5">
                    <span>📅</span>
                    <span className="font-mono">{job.schedule_type === "cron" ? job.cron_expr : `每 ${job.interval_hours} 小时`}</span>
                </div>
                {job.platforms.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <span>📡</span>
                        {job.platforms.map((p) => (
                            <span key={p} className="px-1.5 py-0.5 bg-slate-100 rounded-md">{p}</span>
                        ))}
                    </div>
                )}
                <div className="flex gap-4">
                    <span>🕐 上次: {formatDate(job.last_run)}</span>
                    <span>⏩ 下次: {formatDate(job.next_run)}</span>
                </div>
                <div className="text-slate-400">已执行 {job.run_count || 0} 次</div>
            </div>

            <div className="flex gap-2">
                <button
                    onClick={onRunNow}
                    disabled={isRunning}
                    className={`flex-1 py-2 text-xs font-semibold text-white rounded-xl transition-all flex items-center justify-center gap-1 ${isRunning
                        ? "bg-slate-300 cursor-not-allowed"
                        : "bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600"
                        }`}
                >
                    {isRunning ? <><span className="inline-block animate-spin">⏳</span> 执行中...</> : "▶ 立即执行"}
                </button>
                <button onClick={onEdit} className="px-3 py-2 text-xs font-medium text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">
                    ✏️
                    🗑
                </button>
            </div>
        </div>
    );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function SchedulerPage() {
    const [jobs, setJobs] = useState<SchedulerJob[]>([]);
    const [logs, setLogs] = useState<JobLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingJob, setEditingJob] = useState<SchedulerJob | null>(null);
    const [activeTab, setActiveTab] = useState<"jobs" | "logs">("jobs");
    const [runningJobId, setRunningJobId] = useState<string | null>(null);
    const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);

    const fetchJobs = useCallback(async () => {
        try {
            const res = await fetch("/api/scheduler");
            const data = await res.json();
            setJobs(data.jobs || []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, []);

    const fetchLogs = useCallback(async () => {
        try {
            const res = await fetch("/api/scheduler?logs=1");
            const data = await res.json();
            setLogs(data.logs || []);
        } catch (e) {
            console.error(e);
        }
    }, []);

    useEffect(() => {
        fetchJobs();
        fetchLogs();
        const interval = setInterval(() => {
            fetchJobs();
            fetchLogs();
        }, 15000);
        return () => clearInterval(interval);
    }, [fetchJobs, fetchLogs]);

    const handleSave = async (formData: any) => {
        if (editingJob) {
            await fetch(`/api/scheduler/${editingJob.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(formData),
            });
        } else {
            await fetch("/api/scheduler", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(formData),
            });
        }
        setShowModal(false);
        setEditingJob(null);
        await fetchJobs();
    };

    const handleDelete = async (id: string) => {
        if (!confirm("确定要删除这个定时任务吗？")) return;
        await fetch(`/api/scheduler/${id}`, { method: "DELETE" });
        await fetchJobs();
    };

    const handleToggle = async (job: SchedulerJob) => {
        await fetch(`/api/scheduler/${job.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: !job.enabled }),
        });
        await fetchJobs();
    };

    const handleRunNow = async (id: string) => {
        setRunningJobId(id);
        try {
            const res = await fetch(`/api/scheduler/${id}`, { method: "POST" });
            const data = await res.json();
            alert(data.success ? `✅ 执行成功！\n${data.log?.result || ""}` : `❌ 执行失败: ${data.error || data.log?.error}`);
            await fetchJobs();
            await fetchLogs();
        } catch (e: any) {
            alert(`❌ 请求失败: ${e.message}`);
        } finally {
            setRunningJobId(null);
        }
    };

    const handleDeleteLog = async (logId: string) => {
        if (!confirm("确定要删除这条执行日志吗？")) return;
        try {
            const res = await fetch(`/api/scheduler/logs/${logId}`, { method: "DELETE" });
            const data = await res.json();
            if (data.success || res.ok) {
                setLogs(prevLogs => prevLogs.filter(l => l.id !== logId));
                setSelectedLogIds(prev => prev.filter(id => id !== logId));
            } else {
                alert(`❌ 删除失败: ${data.detail || data.error || "未知错误"}`);
            }
        } catch (e: any) {
            alert(`❌ 请求失败: ${e.message}`);
        }
    };

    const handleBatchDelete = async () => {
        if (selectedLogIds.length === 0) return;
        if (!confirm(`确定要删除选中的 ${selectedLogIds.length} 条日志吗？`)) return;
        
        try {
            const res = await fetch("/api/scheduler/logs/batch", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ log_ids: selectedLogIds }),
            });
            const data = await res.json();
            if (data.success || res.ok) {
                setLogs(prevLogs => prevLogs.filter(l => !selectedLogIds.includes(l.id)));
                setSelectedLogIds([]);
            } else {
                alert(`❌ 批量删除失败: ${data.detail || data.error || "未知错误"}`);
            }
        } catch (e: any) {
            alert(`❌ 请求失败: ${e.message}`);
        }
    };

    const toggleSelectLog = (logId: string) => {
        setSelectedLogIds(prev => 
            prev.includes(logId) ? prev.filter(id => id !== logId) : [...prev, logId]
        );
    };

    const toggleSelectAll = () => {
        if (logs.length > 0 && selectedLogIds.length === logs.length) {
            setSelectedLogIds([]);
        } else {
            setSelectedLogIds(logs.map(l => l.id));
        }
    };

    return (
        <div className="h-full overflow-y-auto bg-gradient-to-br from-slate-50 to-purple-50/30">
            <div className="max-w-5xl mx-auto p-6">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-3xl font-black bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent">
                            ⏰ 定时发布
                        </h1>
                        <p className="text-slate-500 mt-1 text-sm">
                            自动生成内容并发布到多平台 · {jobs.filter((j) => j.enabled).length} 个任务运行中
                        </p>
                    </div>
                    <button
                        onClick={() => { setEditingJob(null); setShowModal(true); }}
                        className="px-5 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-semibold rounded-xl hover:from-purple-700 hover:to-indigo-700 transition-all shadow-lg shadow-purple-200 flex items-center gap-2"
                    >
                        <span>+</span> 新建任务
                    </button>
                </div>

                {/* Stats Bar */}
                <div className="grid grid-cols-3 gap-4 mb-8">
                    {[
                        { label: "全部任务", value: jobs.length, color: "text-slate-700", bg: "bg-white" },
                        { label: "运行中", value: jobs.filter((j) => j.enabled && j.is_active).length, color: "text-emerald-600", bg: "bg-emerald-50" },
                        { label: "总执行次数", value: jobs.reduce((s, j) => s + (j.run_count || 0), 0), color: "text-purple-600", bg: "bg-purple-50" },
                    ].map((stat) => (
                        <div key={stat.label} className={`${stat.bg} rounded-2xl p-5 border border-white/80 shadow-sm`}>
                            <div className={`text-3xl font-black ${stat.color}`}>{stat.value}</div>
                            <div className="text-sm text-slate-500 mt-1">{stat.label}</div>
                        </div>
                    ))}
                </div>

                {/* Tabs */}
                <div className="flex gap-1 mb-6 bg-slate-100 rounded-xl p-1 w-fit">
                    {[{ id: "jobs", label: "📋 任务列表" }, { id: "logs", label: "📜 执行日志" }].map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as any)}
                            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === tab.id ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
                                }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Jobs Tab */}
                {activeTab === "jobs" && (
                    <>
                        {loading ? (
                            <div className="flex items-center justify-center py-20 text-slate-400">
                                <div className="text-center">
                                    <div className="animate-spin text-4xl mb-4">⏳</div>
                                    <p>加载中...</p>
                                </div>
                            </div>
                        ) : jobs.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                                <div className="text-6xl mb-4">⏰</div>
                                <p className="text-lg font-semibold text-slate-600 mb-2">还没有定时任务</p>
                                <p className="text-sm mb-6">创建你的第一个自动化发布任务</p>
                                <button
                                    onClick={() => { setEditingJob(null); setShowModal(true); }}
                                    className="px-6 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-semibold rounded-xl hover:from-purple-700 hover:to-indigo-700 transition-all shadow-lg"
                                >
                                    + 创建第一个任务
                                </button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {jobs.map((job) => (
                                    <JobCard
                                        key={job.id}
                                        job={job}
                                        isRunning={runningJobId === job.id}
                                        onEdit={() => { setEditingJob(job); setShowModal(true); }}
                                        onDelete={() => handleDelete(job.id)}
                                        onToggle={() => handleToggle(job)}
                                        onRunNow={() => handleRunNow(job.id)}
                                    />
                                ))}
                            </div>
                        )}
                    </>
                )}

                {/* Logs Tab */}
                {activeTab === "logs" && (
                    <div className="space-y-3">
                        {logs.length > 0 && (
                            <div className="flex items-center justify-between px-2 mb-2">
                                <label className="flex items-center gap-2 cursor-pointer group">
                                    <div 
                                        onClick={toggleSelectAll}
                                        className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${
                                            selectedLogIds.length === logs.length && logs.length > 0
                                                ? "bg-purple-600 border-purple-600" 
                                                : "border-slate-300 bg-white group-hover:border-purple-400"
                                        }`}
                                    >
                                        {selectedLogIds.length === logs.length && logs.length > 0 && (
                                            <span className="text-white text-xs">✓</span>
                                        )}
                                    </div>
                                    <span className="text-sm font-medium text-slate-600">全选 ({logs.length})</span>
                                </label>
                                
                                {selectedLogIds.length > 0 && (
                                    <button
                                        onClick={handleBatchDelete}
                                        className="text-xs font-bold text-red-500 hover:text-red-600 flex items-center gap-1 px-3 py-1.5 bg-red-50 rounded-lg transition-colors border border-red-100"
                                    >
                                        🗑 批量删除 ({selectedLogIds.length})
                                    </button>
                                )}
                            </div>
                        )}
                        
                        {logs.length === 0 ? (
                            <div className="text-center py-20 text-slate-400">
                                <div className="text-4xl mb-3">📭</div>
                                <p>暂无执行日志</p>
                            </div>
                        ) : (
                            logs.map((log) => (
                                <div 
                                    key={log.id} 
                                    className={`bg-white rounded-xl border p-4 hover:shadow-sm transition-all flex items-start gap-4 ${
                                        selectedLogIds.includes(log.id) ? "border-purple-200 bg-purple-50/10" : "border-slate-100"
                                    }`}
                                >
                                    <div 
                                        onClick={() => toggleSelectLog(log.id)}
                                        className={`mt-1 w-5 h-5 rounded border flex-shrink-0 flex items-center justify-center cursor-pointer transition-all ${
                                            selectedLogIds.includes(log.id) 
                                                ? "bg-purple-600 border-purple-600" 
                                                : "border-slate-300 bg-white hover:border-purple-400"
                                        }`}
                                    >
                                        {selectedLogIds.includes(log.id) && (
                                            <span className="text-white text-xs">✓</span>
                                        )}
                                    </div>
                                    
                                    <div className="flex-1">
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-2">
                                                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${statusColor(log.status)}`}>
                                                    {log.status === "success" ? "✅ 成功" : log.status === "error" ? "❌ 失败" : "⏳ 运行中"}
                                                </span>
                                                <span className="font-semibold text-slate-700 text-sm">{log.job_name}</span>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className="text-xs text-slate-400">{formatDate(log.started_at)}</span>
                                                <button 
                                                    onClick={() => handleDeleteLog(log.id)}
                                                    className="text-slate-300 hover:text-red-500 transition-colors text-sm"
                                                    title="删除日志"
                                                >
                                                    🗑
                                                </button>
                                            </div>
                                        </div>
                                        {log.result && <p className="text-xs text-slate-500 mb-2 font-medium">{log.result}</p>}
                                        {log.error && <p className="text-xs text-red-500 mb-2">错误: {log.error}</p>}
                                        {log.published_to?.length > 0 && (
                                            <div className="flex flex-wrap gap-1.5">
                                                {log.published_to.map((p, i) => (
                                                    <span
                                                        key={i}
                                                        className={`text-xs px-2 py-0.5 rounded-full ${p.success ? "bg-green-50 text-green-600" : "bg-red-50 text-red-500"}`}
                                                    >
                                                        {p.platform} {p.success ? "✓" : "✗"}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>

            {/* Modal */}
            {showModal && (
                <JobModal
                    initial={editingJob || undefined}
                    onSave={handleSave}
                    onClose={() => { setShowModal(false); setEditingJob(null); }}
                />
            )}
        </div>
    );
}
