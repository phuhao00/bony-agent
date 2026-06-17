"use client";

import Link from "next/link";
import {
  Download,
  FolderTree,
  Loader2,
  Search,
  Trash2,
  Wrench,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  computerRootLabel,
  computerRootPath,
  type ComputerRootEntry,
} from "@/lib/computer-roots";
import type { EnvironmentProfile } from "../hooks/useSystemAssistantRunner";

type Recipe = {
  id: string;
  name: string;
  category: string;
  description: string;
  requires_approval?: boolean;
};

type AppEntry = {
  id: string;
  name: string;
  category: string;
  packages?: Record<string, string>;
};

type ComputerRoot = ComputerRootEntry;

const CATEGORY_META: Record<
  string,
  { title: string; desc: string; icon: typeof Download }
> = {
  install: {
    title: "安装软件",
    desc: "从应用目录选择并通过包管理器安装",
    icon: Download,
  },
  uninstall: {
    title: "卸载软件",
    desc: "安全卸载已安装的应用",
    icon: Trash2,
  },
  repair: {
    title: "修复软件",
    desc: "重装或清理应用缓存",
    icon: Wrench,
  },
  network: {
    title: "网络修复",
    desc: "诊断连通性、DNS 与代理",
    icon: Wrench,
  },
  env: {
    title: "环境配置",
    desc: "检查 node / python / git 等开发工具",
    icon: Wrench,
  },
  organize: {
    title: "整理文件",
    desc: "分类整理、图片压缩/编辑、合成幻灯片视频",
    icon: FolderTree,
  },
};

const ORGANIZE_MODES = [
  { id: "general", label: "通用整理", recipe: "organize.preview" },
  { id: "images", label: "图片分类", recipe: "organize.images_preview" },
  { id: "dedupe", label: "图片去重", recipe: "organize.dedupe_images" },
  { id: "compress", label: "压缩图片", recipe: "organize.compress_images" },
  { id: "edit", label: "编辑图片", recipe: "organize.edit_images" },
  { id: "video", label: "制作视频", recipe: "organize.images_to_video" },
] as const;

const IMAGE_SORT_MODES = [
  { id: "by_format", label: "按格式" },
  { id: "by_exif_date", label: "按 EXIF 拍摄日期" },
  { id: "by_date", label: "按修改日期" },
  { id: "by_size", label: "按大小" },
];

export function SystemAssistantActionPanel({
  category,
  apps,
  recipes,
  environment,
  selectedApp,
  onSelectApp,
  organizePath,
  onOrganizePathChange,
  computerRoots,
  loading,
  onInstall,
  onUninstall,
  onOrganizePreview,
  onRunOrganizeAction,
  onRunRecipe,
}: {
  category: string;
  apps: AppEntry[];
  recipes: Recipe[];
  environment: EnvironmentProfile | null;
  selectedApp: string;
  onSelectApp: (id: string) => void;
  organizePath: string;
  onOrganizePathChange: (v: string) => void;
  computerRoots: ComputerRoot[];
  loading: boolean;
  onInstall: () => void;
  onUninstall: () => void;
  onOrganizePreview: () => void;
  onRunOrganizeAction: (recipeId: string, params: Record<string, unknown>) => void;
  onRunRecipe: (recipeId: string) => void;
}) {
  const [appQuery, setAppQuery] = useState("");
  const [organizeMode, setOrganizeMode] = useState<(typeof ORGANIZE_MODES)[number]["id"]>("general");
  const [imageSortMode, setImageSortMode] = useState("by_format");
  const [compressQuality, setCompressQuality] = useState(80);
  const [compressMaxWidth, setCompressMaxWidth] = useState(1920);
  const [editRotate, setEditRotate] = useState(0);
  const [editMaxWidth, setEditMaxWidth] = useState(0);
  const [editFormat, setEditFormat] = useState("");
  const [editAutoOrient, setEditAutoOrient] = useState(true);
  const [watermarkText, setWatermarkText] = useState("");
  const [videoDuration, setVideoDuration] = useState(3);
  const [videoSortBy, setVideoSortBy] = useState("exif_date");
  const [videoBgmPath, setVideoBgmPath] = useState("");
  const meta = CATEGORY_META[category] || CATEGORY_META.install;
  const Icon = meta.icon;

  const serverPlatform = environment?.server_platform || "darwin";
  const pkgKey = serverPlatform === "darwin" ? "darwin" : "win32";
  const canInstall = environment?.capabilities?.install !== false;
  const installCmdPrefix = environment?.ui_labels?.install_cmd || "brew install --cask";
  const uninstallCmdPrefix = environment?.ui_labels?.uninstall_cmd || "brew uninstall --cask";
  const downloadsPlaceholder =
    environment?.default_paths?.downloads_path ||
    environment?.ui_labels?.downloads_path ||
    "/Users/you/Downloads";

  const filteredApps = useMemo(() => {
    const q = appQuery.trim().toLowerCase();
    if (!q) return apps;
    return apps.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q),
    );
  }, [apps, appQuery]);

  const selected = apps.find((a) => a.id === selectedApp);
  const pkgName = selected?.packages?.[pkgKey] || selected?.id;

  const installPreview =
    installCmdPrefix.includes("winget") || installCmdPrefix.includes("--id")
      ? `${installCmdPrefix} ${pkgName}`
      : `${installCmdPrefix} ${pkgName}`;
  const uninstallPreview = `${uninstallCmdPrefix} ${pkgName}`;

  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--card-bg)]">
      <div className="border-b border-[var(--border-subtle)] px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--nav-active-fill)] text-[color:var(--accent)]">
            <Icon className="h-5 w-5" strokeWidth={2} />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[color:var(--foreground)]">{meta.title}</h2>
            <p className="mt-0.5 text-xs text-[color:var(--label-secondary)]">{meta.desc}</p>
          </div>
        </div>
      </div>

      <div className="p-5">
        {(category === "install" || category === "uninstall") && (
          <div className="space-y-4">
            {!canInstall && (
              <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                当前后端环境未检测到可用包管理器，安装/卸载不可用
              </p>
            )}
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--label-secondary)]" />
              <input
                type="search"
                value={appQuery}
                onChange={(e) => setAppQuery(e.target.value)}
                placeholder="搜索应用名称或 ID…"
                className="w-full rounded-xl border border-[var(--border-subtle)] bg-transparent py-2.5 pl-10 pr-3 text-sm outline-none focus:border-[color:var(--accent)]"
              />
            </div>

            <div className="grid max-h-[280px] grid-cols-2 gap-2 overflow-auto sm:grid-cols-3">
              {filteredApps.map((app) => {
                const active = selectedApp === app.id;
                return (
                  <button
                    key={app.id}
                    type="button"
                    onClick={() => onSelectApp(app.id)}
                    className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                      active
                        ? "border-[color:var(--accent)] bg-[color:color-mix(in_srgb,var(--accent)_12%,transparent)]"
                        : "border-[var(--border-subtle)] bg-[var(--nav-active-fill)]/30 hover:border-[color:color-mix(in_srgb,var(--accent)_35%,transparent)]"
                    }`}
                  >
                    <div className="truncate text-sm font-medium text-[color:var(--foreground)]">
                      {app.name}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-[color:var(--label-secondary)]">
                      {app.category} · {app.id}
                    </div>
                  </button>
                );
              })}
            </div>

            {selected && (
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--nav-active-fill)]/40 px-4 py-3">
                <p className="text-xs text-[color:var(--label-secondary)]">将执行命令</p>
                <p className="mt-1 font-mono text-sm text-[color:var(--foreground)]">
                  {category === "install" ? installPreview : uninstallPreview}
                </p>
              </div>
            )}

            <button
              type="button"
              disabled={loading || !selectedApp || !canInstall}
              onClick={category === "install" ? onInstall : onUninstall}
              className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50 ${
                category === "install" ? "bg-[var(--accent)]" : "bg-red-600 hover:bg-red-700"
              }`}
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {category === "install" ? "开始安装" : "开始卸载"}
            </button>
          </div>
        )}

        {category === "organize" && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {ORGANIZE_MODES.map((m) => {
                const disabled = m.id === "video" && environment?.capabilities?.media_organize === false;
                return (
                  <button
                    key={m.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => setOrganizeMode(m.id)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      organizeMode === m.id
                        ? "bg-[var(--foreground)] text-[var(--background)]"
                        : "bg-[var(--nav-active-fill)] text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)] disabled:opacity-40"
                    }`}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
            {environment?.capabilities?.media_organize === false && organizeMode === "video" && (
              <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                后端未检测到 FFmpeg，图片转视频不可用
              </p>
            )}
            {computerRoots.length > 0 ? (
              <label className="block">
                <span className="text-sm font-medium text-[color:var(--foreground)]">已登记目录</span>
                <select
                  className="mt-2 w-full rounded-xl border border-[var(--border-subtle)] bg-transparent px-3 py-2.5 text-sm outline-none focus:border-[color:var(--accent)]"
                  value={organizePath}
                  onChange={(e) => onOrganizePathChange(e.target.value)}
                >
                  <option value="">选择目录…</option>
                  {computerRoots.map((root, i) => {
                    const p = computerRootPath(root);
                    return (
                      <option key={`${p}-${i}`} value={p}>
                        {computerRootLabel(root)}
                      </option>
                    );
                  })}
                </select>
              </label>
            ) : (
              <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                尚未登记 My Computer 目录。请先在{" "}
                <Link href="/settings/my-computer" className="underline">
                  设置 → My Computer
                </Link>{" "}
                添加文件夹。
              </p>
            )}
            <label className="block">
              <span className="text-sm font-medium text-[color:var(--foreground)]">目标目录</span>
              <input
                className="mt-2 w-full rounded-xl border border-[var(--border-subtle)] bg-transparent px-3 py-2.5 text-sm outline-none focus:border-[color:var(--accent)]"
                value={organizePath}
                onChange={(e) => onOrganizePathChange(e.target.value)}
                placeholder={downloadsPlaceholder}
              />
            </label>
            <p className="text-xs text-[color:var(--label-secondary)]">
              路径须在{" "}
              <Link href="/settings/my-computer" className="text-[color:var(--accent)] underline">
                My Computer
              </Link>{" "}
              已登记文件夹内
            </p>
            {organizeMode === "images" && (
              <label className="block">
                <span className="text-sm font-medium text-[color:var(--foreground)]">分类方式</span>
                <select
                  className="mt-2 w-full rounded-xl border border-[var(--border-subtle)] bg-transparent px-3 py-2.5 text-sm outline-none focus:border-[color:var(--accent)]"
                  value={imageSortMode}
                  onChange={(e) => setImageSortMode(e.target.value)}
                >
                  {IMAGE_SORT_MODES.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {organizeMode === "compress" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-[color:var(--foreground)]">JPEG 质量</span>
                  <input
                    type="number"
                    min={10}
                    max={95}
                    className="mt-2 w-full rounded-xl border border-[var(--border-subtle)] bg-transparent px-3 py-2.5 text-sm outline-none focus:border-[color:var(--accent)]"
                    value={compressQuality}
                    onChange={(e) => setCompressQuality(Number(e.target.value))}
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-[color:var(--foreground)]">最大宽度 (px)</span>
                  <input
                    type="number"
                    min={320}
                    max={4096}
                    className="mt-2 w-full rounded-xl border border-[var(--border-subtle)] bg-transparent px-3 py-2.5 text-sm outline-none focus:border-[color:var(--accent)]"
                    value={compressMaxWidth}
                    onChange={(e) => setCompressMaxWidth(Number(e.target.value))}
                  />
                </label>
              </div>
            )}

            {organizeMode === "edit" && (
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="text-sm font-medium text-[color:var(--foreground)]">旋转</span>
                  <select
                    className="mt-2 w-full rounded-xl border border-[var(--border-subtle)] bg-transparent px-3 py-2.5 text-sm outline-none"
                    value={editRotate}
                    onChange={(e) => setEditRotate(Number(e.target.value))}
                  >
                    <option value={0}>不旋转</option>
                    <option value={90}>90°</option>
                    <option value={180}>180°</option>
                    <option value={270}>270°</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-[color:var(--foreground)]">最大宽度</span>
                  <input
                    type="number"
                    min={0}
                    className="mt-2 w-full rounded-xl border border-[var(--border-subtle)] bg-transparent px-3 py-2.5 text-sm outline-none"
                    value={editMaxWidth}
                    onChange={(e) => setEditMaxWidth(Number(e.target.value))}
                    placeholder="0 = 不缩放"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-[color:var(--foreground)]">输出格式</span>
                  <select
                    className="mt-2 w-full rounded-xl border border-[var(--border-subtle)] bg-transparent px-3 py-2.5 text-sm outline-none"
                    value={editFormat}
                    onChange={(e) => setEditFormat(e.target.value)}
                  >
                    <option value="">保持原格式</option>
                    <option value="jpg">JPEG</option>
                    <option value="png">PNG</option>
                    <option value="webp">WebP</option>
                  </select>
                </label>
              </div>
            )}

            {organizeMode === "edit" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex items-center gap-2 text-sm text-[color:var(--foreground)]">
                  <input
                    type="checkbox"
                    checked={editAutoOrient}
                    onChange={(e) => setEditAutoOrient(e.target.checked)}
                    className="rounded border-[var(--border-subtle)]"
                  />
                  按 EXIF 自动旋转
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-sm font-medium text-[color:var(--foreground)]">水印文字（可选）</span>
                  <input
                    className="mt-2 w-full rounded-xl border border-[var(--border-subtle)] bg-transparent px-3 py-2.5 text-sm outline-none focus:border-[color:var(--accent)]"
                    value={watermarkText}
                    onChange={(e) => setWatermarkText(e.target.value)}
                    placeholder="例如 © 我的名字"
                  />
                </label>
              </div>
            )}

            {organizeMode === "video" && (
              <div className="space-y-3">
                <label className="block">
                  <span className="text-sm font-medium text-[color:var(--foreground)]">每张图片时长 (秒)</span>
                  <input
                    type="number"
                    min={0.5}
                    max={30}
                    step={0.5}
                    className="mt-2 w-full rounded-xl border border-[var(--border-subtle)] bg-transparent px-3 py-2.5 text-sm outline-none focus:border-[color:var(--accent)]"
                    value={videoDuration}
                    onChange={(e) => setVideoDuration(Number(e.target.value))}
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-[color:var(--foreground)]">图片排序</span>
                  <select
                    className="mt-2 w-full rounded-xl border border-[var(--border-subtle)] bg-transparent px-3 py-2.5 text-sm outline-none"
                    value={videoSortBy}
                    onChange={(e) => setVideoSortBy(e.target.value)}
                  >
                    <option value="exif_date">按 EXIF 拍摄时间</option>
                    <option value="name">按文件名</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-[color:var(--foreground)]">背景音乐路径（可选）</span>
                  <input
                    className="mt-2 w-full rounded-xl border border-[var(--border-subtle)] bg-transparent px-3 py-2.5 text-sm outline-none focus:border-[color:var(--accent)]"
                    value={videoBgmPath}
                    onChange={(e) => setVideoBgmPath(e.target.value)}
                    placeholder="/Users/you/Music/bgm.mp3"
                  />
                </label>
              </div>
            )}

            <button
              type="button"
              disabled={
                loading ||
                !organizePath.trim() ||
                (organizeMode === "video" && environment?.capabilities?.media_organize === false)
              }
              onClick={() => {
                const root = organizePath.trim();
                if (organizeMode === "general") {
                  onOrganizePreview();
                  return;
                }
                const modeDef = ORGANIZE_MODES.find((m) => m.id === organizeMode);
                if (!modeDef) return;
                const params: Record<string, unknown> = { root_path: root };
                if (organizeMode === "images") params.mode = imageSortMode;
                if (organizeMode === "compress") {
                  params.quality = compressQuality;
                  params.max_width = compressMaxWidth;
                }
                if (organizeMode === "edit") {
                  params.rotate = editRotate;
                  params.max_width = editMaxWidth;
                  params.output_format = editFormat;
                  params.auto_orient = editAutoOrient;
                  if (watermarkText.trim()) params.watermark_text = watermarkText.trim();
                }
                if (organizeMode === "video") {
                  params.duration_per_image = videoDuration;
                  params.sort_by = videoSortBy;
                  if (videoBgmPath.trim()) params.audio_path = videoBgmPath.trim();
                }
                onRunOrganizeAction(modeDef.recipe, params);
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--foreground)] px-5 py-2.5 text-sm font-medium text-[var(--background)] disabled:opacity-50"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {organizeMode === "general" || organizeMode === "images"
                ? "预览整理计划"
                : organizeMode === "dedupe"
                  ? "扫描重复图片"
                  : organizeMode === "video"
                    ? "制作幻灯片视频"
                    : "开始处理"}
            </button>
            {(organizeMode === "compress" ||
              organizeMode === "edit" ||
              organizeMode === "video" ||
              organizeMode === "dedupe") && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                此操作将写入新文件，执行前需审批确认
              </p>
            )}
          </div>
        )}

        {!["install", "uninstall", "organize"].includes(category) && (
          <div className="grid gap-3 sm:grid-cols-2">
            {recipes.map((recipe) => (
              <div
                key={recipe.id}
                className="flex flex-col justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--nav-active-fill)]/30 p-4"
              >
                <div>
                  <div className="font-medium text-[color:var(--foreground)]">{recipe.name}</div>
                  <p className="mt-1 text-xs leading-relaxed text-[color:var(--label-secondary)]">
                    {recipe.description}
                  </p>
                  {recipe.requires_approval && (
                    <span className="mt-2 inline-block rounded-md bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-400">
                      需审批
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => onRunRecipe(recipe.id)}
                  className="mt-4 w-full rounded-lg bg-[var(--card-bg)] py-2 text-sm font-medium text-[color:var(--foreground)] ring-1 ring-[var(--border-subtle)] hover:bg-[var(--nav-active-fill)] disabled:opacity-50"
                >
                  运行
                </button>
              </div>
            ))}
            {recipes.length === 0 && (
              <p className="col-span-full text-sm text-[color:var(--label-secondary)]">
                当前平台暂无可用工作流
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
