"use client";

import { Loader2, Monitor, Play, Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { DesktopApp, DesktopEnvironment } from "../hooks/useDesktopOperatorRunner";
import { DESKTOP_PRESETS, type DesktopPreset } from "../lib/presets";
import { DesktopAppPicker } from "./DesktopAppPicker";

const CATEGORIES = [
  { id: "recommended", label: "快捷", icon: Sparkles },
  { id: "dcc", label: "DCC", icon: Monitor },
  { id: "launch", label: "启动", icon: Play },
  { id: "gui", label: "GUI", icon: Monitor },
  { id: "apps", label: "应用", icon: Search },
] as const;

const CATEGORY_META: Record<
  string,
  { title: string; desc: string }
> = {
  recommended: {
    title: "快捷预设",
    desc: "Blender / PS / Unity 等常见自动化",
  },
  dcc: {
    title: "DCC 批处理",
    desc: "CLI 脚本、批量渲染、构建",
  },
  launch: {
    title: "启动应用",
    desc: "打开本机已安装软件",
  },
  gui: {
    title: "GUI 自动化",
    desc: "无 CLI 时通过视觉闭环操作界面",
  },
  apps: {
    title: "应用搜索",
    desc: "浏览本机已扫描应用",
  },
};

const inputClass =
  "w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--page-canvas)] px-3 py-2 text-sm text-[color:var(--foreground)] outline-none transition-colors focus:border-[color:var(--accent)]";

export function DesktopOperatorActionPanel({
  category,
  onCategoryChange,
  apps,
  environment,
  loading,
  workingDir,
  onWorkingDirChange,
  onSearchApps,
  onRunPreset,
  onPlanAndRun,
  onLaunchApp,
  onRunGui,
  sidecarChecking = false,
  onEnsureSidecar,
}: {
  category: string;
  onCategoryChange: (id: string) => void;
  apps: DesktopApp[];
  environment: DesktopEnvironment | null;
  loading: boolean;
  workingDir: string;
  onWorkingDirChange: (v: string) => void;
  onSearchApps: (q: string) => void;
  onRunPreset: (preset: DesktopPreset) => void;
  onPlanAndRun: (body: Record<string, unknown>) => void;
  onLaunchApp: (appId: string) => void;
  onRunGui: (goal: string, appHint: string) => void;
  sidecarChecking?: boolean;
  onEnsureSidecar?: () => void | Promise<void>;
}) {
  const meta = CATEGORY_META[category] || CATEGORY_META.dcc;

  const [appId, setAppId] = useState("blender");
  const [mode, setMode] = useState("batch_render");
  const [blendFile, setBlendFile] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [scriptPath, setScriptPath] = useState("");
  const [executeMethod, setExecuteMethod] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [appSearchQuery, setAppSearchQuery] = useState("");
  const [selectedApp, setSelectedApp] = useState("");
  const [guiGoal, setGuiGoal] = useState("");
  const [guiAppHint, setGuiAppHint] = useState("");

  useEffect(() => {
    if (category === "gui" || category === "launch" || category === "apps") {
      onSearchApps("");
    }
  }, [category, onSearchApps]);

  const creativeInstalled = useMemo(() => {
    const creative = environment?.creative_apps || {};
    return Object.entries(creative)
      .filter(([, v]) => v?.installed)
      .map(([id]) => id);
  }, [environment]);

  const presetsForCategory = useMemo(() => {
    if (category === "recommended") return DESKTOP_PRESETS;
    if (category === "dcc") return DESKTOP_PRESETS.filter((p) => p.category === "dcc");
    if (category === "launch") return DESKTOP_PRESETS.filter((p) => p.category === "launch");
    if (category === "gui") return DESKTOP_PRESETS.filter((p) => p.category === "gui");
    return [];
  }, [category]);

  const defaultWorkingDir = environment?.allowed_roots?.[0] || workingDir || "";

  const applyPresetFields = (preset: DesktopPreset) => {
    if (preset.category === "dcc" && preset.app_id) {
      setAppId(preset.app_id);
      setMode(preset.mode || "");
      if (preset.params?.blend_file !== undefined) {
        setBlendFile(String(preset.params.blend_file || ""));
      }
      if (preset.params?.output_dir !== undefined) {
        setOutputDir(String(preset.params.output_dir || ""));
      }
      if (preset.params?.script_path !== undefined) {
        setScriptPath(String(preset.params.script_path || ""));
      }
      if (preset.params?.project_path !== undefined) {
        setProjectPath(String(preset.params.project_path || ""));
      }
      if (preset.params?.execute_method !== undefined) {
        setExecuteMethod(String(preset.params.execute_method || ""));
      }
    }
    if (preset.category === "gui" && preset.goal) {
      setGuiGoal(preset.goal);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onCategoryChange(id)}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors ${
              category === id
                ? "border-[color:var(--accent)] bg-[var(--nav-active-fill)] text-[color:var(--accent)]"
                : "border-[var(--border-subtle)] text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)]"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-[color:var(--foreground)]">{meta.title}</h3>
        <p className="mt-0.5 text-xs text-[color:var(--label-secondary)]">{meta.desc}</p>
      </div>

      {(category === "dcc" || category === "recommended") && (
        <div>
          <label className="mb-1 block text-xs font-medium text-[color:var(--label-secondary)]">
            工作目录（须在 My Computer 登记路径内）
          </label>
          <input
            type="text"
            value={workingDir || defaultWorkingDir}
            onChange={(e) => onWorkingDirChange(e.target.value)}
            placeholder="/Users/me/project"
            className={inputClass}
          />
        </div>
      )}

      {(category === "recommended" || category === "dcc" || category === "launch" || category === "gui") &&
        presetsForCategory.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {presetsForCategory.map((preset) => (
              <button
                key={preset.label}
                type="button"
                disabled={loading}
                onClick={() => {
                  applyPresetFields(preset);
                  onRunPreset(preset);
                }}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--page-canvas)] px-3 py-2.5 text-left text-xs font-medium text-[color:var(--foreground)] transition-colors hover:border-[color:color-mix(in_srgb,var(--accent)_35%,transparent)] hover:bg-[var(--nav-active-fill)] disabled:opacity-50"
              >
                {preset.label}
              </button>
            ))}
          </div>
        )}

      {category === "dcc" && (
        <div className="space-y-3 border-t border-[var(--border-subtle)] pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-[color:var(--label-secondary)]">应用 ID</label>
              <select value={appId} onChange={(e) => setAppId(e.target.value)} className={inputClass}>
                <option value="blender">blender</option>
                <option value="photoshop">photoshop</option>
                <option value="unity">unity</option>
                <option value="unreal">unreal</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-[color:var(--label-secondary)]">模式</label>
              <input
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                placeholder="batch_render / extendscript …"
                className={inputClass}
              />
            </div>
          </div>
          {(appId === "blender" || mode.includes("blend")) && (
            <>
              <input
                value={blendFile}
                onChange={(e) => setBlendFile(e.target.value)}
                placeholder=".blend 文件路径"
                className={inputClass}
              />
              <input
                value={outputDir}
                onChange={(e) => setOutputDir(e.target.value)}
                placeholder="输出目录（可选）"
                className={inputClass}
              />
            </>
          )}
          {(appId === "photoshop" || mode.includes("script")) && (
            <input
              value={scriptPath}
              onChange={(e) => setScriptPath(e.target.value)}
              placeholder="脚本路径 (.jsx / .py)"
              className={inputClass}
            />
          )}
          {appId === "unity" && (
            <>
              <input
                value={projectPath}
                onChange={(e) => setProjectPath(e.target.value)}
                placeholder="Unity 项目路径"
                className={inputClass}
              />
              <input
                value={executeMethod}
                onChange={(e) => setExecuteMethod(e.target.value)}
                placeholder="ExecuteMethod（可选）"
                className={inputClass}
              />
            </>
          )}
          <button
            type="button"
            disabled={loading || !(workingDir || defaultWorkingDir).trim()}
            onClick={() =>
              onPlanAndRun({
                app_id: appId,
                mode,
                blend_file: blendFile,
                project_path: projectPath,
                script_path: scriptPath,
                execute_method: executeMethod,
                output_dir: outputDir,
              })
            }
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            规划并执行
          </button>
        </div>
      )}

      {category === "launch" && (
        <div className="space-y-3 border-t border-[var(--border-subtle)] pt-4">
          <DesktopAppPicker
            apps={apps}
            query={appSearchQuery}
            onQueryChange={setAppSearchQuery}
            onSearch={onSearchApps}
            selectedId={selectedApp}
            loading={loading}
            label="选择要启动的应用"
            placeholder="搜索本机应用，如 Claude / 微信 / VS Code"
            onSelect={(app) => {
              setSelectedApp(app.id);
              setAppSearchQuery(app.name);
            }}
          />
          {creativeInstalled.length > 0 && (
            <p className="text-xs text-[color:var(--label-secondary)]">
              已探测 DCC：{creativeInstalled.join(", ")}
            </p>
          )}
          <button
            type="button"
            disabled={loading || !selectedApp}
            onClick={() => onLaunchApp(selectedApp)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            启动应用
          </button>
        </div>
      )}

      {category === "gui" && (
        <div className="space-y-3 border-t border-[var(--border-subtle)] pt-4">
          {!environment?.sidecar_available && (
            <div className="rounded-xl border border-[color:var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-2 text-xs leading-relaxed text-[color:var(--status-warning-text)]">
              <p>
                Sidecar 是本地原生自动化 HTTP 服务（截屏、键鼠、窗口聚焦）。开发态需由{" "}
                <code className="rounded bg-[var(--nav-active-fill)] px-1 py-0.5">start_local.sh</code>、{" "}
                <code className="rounded bg-[var(--nav-active-fill)] px-1 py-0.5">start_with_tunnel.sh</code>{" "}
                或 Backend 自动拉起；未就绪时将回退到 Python 桥（AppleScript / pyautogui）。
              </p>
              {environment?.sidecar_reason ? (
                <p className="mt-1 opacity-90">状态：{environment.sidecar_reason}</p>
              ) : null}
              {onEnsureSidecar ? (
                <button
                  type="button"
                  disabled={sidecarChecking}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void onEnsureSidecar();
                  }}
                  className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[color:var(--status-warning-border)] bg-[var(--page-canvas)] px-2.5 py-1.5 text-[11px] font-medium text-[color:var(--status-warning-text)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sidecarChecking ? (
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                  ) : null}
                  {sidecarChecking ? "正在启动 Sidecar…" : "重新检测 Sidecar"}
                </button>
              ) : null}
            </div>
          )}
          {environment?.sidecar_available ? (
            <p className="text-xs text-[color:var(--label-secondary)]">
              Sidecar 已就绪
              {environment.sidecar_port ? ` · 127.0.0.1:${environment.sidecar_port}` : ""}
              {environment.active_bridge ? ` · 桥接：${environment.active_bridge}` : ""}
            </p>
          ) : null}
          <DesktopAppPicker
            apps={apps}
            query={appSearchQuery}
            onQueryChange={(value) => {
              setAppSearchQuery(value);
              setGuiAppHint(value);
            }}
            onSearch={onSearchApps}
            selectedId={selectedApp}
            loading={loading}
            label="目标应用（可选）"
            placeholder="搜索本机应用，如 Photoshop / 微信 / Claude"
            onSelect={(app) => {
              setSelectedApp(app.id);
              setGuiAppHint(app.name);
              setAppSearchQuery(app.name);
            }}
          />
          <textarea
            value={guiGoal}
            onChange={(e) => setGuiGoal(e.target.value)}
            rows={4}
            placeholder="描述要在前台应用中完成的操作…"
            className={`${inputClass} resize-y`}
          />
          <button
            type="button"
            disabled={loading || !guiGoal.trim()}
            onClick={() => onRunGui(guiGoal.trim(), guiAppHint.trim())}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            开始 GUI 自动化
          </button>
        </div>
      )}

      {category === "apps" && (
        <div className="space-y-3 border-t border-[var(--border-subtle)] pt-4">
          <DesktopAppPicker
            apps={apps}
            query={appSearchQuery}
            onQueryChange={setAppSearchQuery}
            onSearch={onSearchApps}
            selectedId={selectedApp}
            loading={loading}
            label="浏览本机已安装应用"
            placeholder="输入关键词模糊搜索全部应用"
            onSelect={(app) => {
              setSelectedApp(app.id);
              setAppSearchQuery(app.name);
            }}
          />
          {selectedApp && (
            <button
              type="button"
              disabled={loading}
              onClick={() => onLaunchApp(selectedApp)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              启动 {selectedApp}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
