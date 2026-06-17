"use client";

import {
  OpsCard,
  OpsSectionTitle,
  StatusPill,
  useOpsToast,
} from "@/app/lark-cli/ops/ui";
import { useCallback, useEffect, useState } from "react";

type JobParam = {
  name: string;
  default?: string;
  choices?: string[];
};

type AllowedJob = {
  name: string;
  label: string;
  risk: "low" | "medium" | "high";
  parameters: JobParam[];
};

type JenkinsSettings = {
  enabled: boolean;
  url: string;
  url_effective: string;
  username: string;
  username_effective: string;
  token_configured: boolean;
  allowed_jobs: AllowedJob[];
  poll_timeout_sec: number;
  console_max_chars: number;
  health_ok?: boolean;
  health_error?: string;
};

type ConfigResponse = {
  ok?: boolean;
  error?: string;
  message?: string;
  jenkins?: JenkinsSettings;
  ops_auto_jenkins_build?: boolean;
  ops_auto_jenkins_require_admin?: boolean;
  ops_auto_jenkins_min_confidence?: number;
  ops_auto_jenkins_context_hours?: number;
  ops_auto_jenkins_cooldown_sec?: number;
  ops_admin_open_ids?: string[];
  config_path?: string;
};

const emptyJob = (): AllowedJob => ({
  name: "",
  label: "",
  risk: "high",
  parameters: [{ name: "BRANCH", default: "main", choices: ["main"] }],
});

const emptyParam = (): JobParam => ({ name: "", default: "", choices: [] });

export default function JenkinsJobSettings({
  onSaved,
}: {
  onSaved?: () => void;
}) {
  const { push, ToastStack } = useOpsToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [jenkins, setJenkins] = useState<JenkinsSettings | null>(null);
  const [jobs, setJobs] = useState<AllowedJob[]>([]);
  const [opsAuto, setOpsAuto] = useState(true);
  const [opsRequireAdmin, setOpsRequireAdmin] = useState(true);
  const [opsMinConf, setOpsMinConf] = useState(0.65);
  const [opsContextH, setOpsContextH] = useState(1);
  const [opsCooldown, setOpsCooldown] = useState(90);
  const [opsAdmins, setOpsAdmins] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/feishu/ops/jenkins/config", {
        cache: "no-store",
      });
      const d: ConfigResponse = await res.json();
      if (!d.ok || !d.jenkins) {
        push("error", d.error || "加载配置失败");
        return;
      }
      setJenkins(d.jenkins);
      setJobs(
        (d.jenkins.allowed_jobs || []).map((j) => ({
          name: j.name || "",
          label: j.label || j.name || "",
          risk: (j.risk as AllowedJob["risk"]) || "high",
          parameters: Array.isArray(j.parameters)
            ? j.parameters.map((p) => ({
                name: p.name || "",
                default: p.default || "",
                choices: Array.isArray(p.choices) ? [...p.choices] : [],
              }))
            : [],
        })),
      );
      setOpsAuto(Boolean(d.ops_auto_jenkins_build));
      setOpsRequireAdmin(Boolean(d.ops_auto_jenkins_require_admin));
      setOpsMinConf(Number(d.ops_auto_jenkins_min_confidence) || 0.65);
      setOpsContextH(Number(d.ops_auto_jenkins_context_hours) || 1);
      setOpsCooldown(Number(d.ops_auto_jenkins_cooldown_sec) || 90);
      setOpsAdmins((d.ops_admin_open_ids || []).join("\n"));
    } catch (e) {
      push("error", String(e));
    } finally {
      setLoading(false);
    }
  }, [push]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateJob = (index: number, patch: Partial<AllowedJob>) => {
    setJobs((prev) =>
      prev.map((j, i) => (i === index ? { ...j, ...patch } : j)),
    );
  };

  const updateParam = (
    jobIndex: number,
    paramIndex: number,
    patch: Partial<JobParam>,
  ) => {
    setJobs((prev) =>
      prev.map((j, i) => {
        if (i !== jobIndex) return j;
        const params = j.parameters.map((p, pi) =>
          pi === paramIndex ? { ...p, ...patch } : p,
        );
        return { ...j, parameters: params };
      }),
    );
  };

  const save = async () => {
    if (!jenkins) return;
    const trimmed = jobs.filter((j) => j.name.trim());
    for (const j of trimmed) {
      if (!j.label.trim()) j.label = j.name.trim();
    }
    setSaving(true);
    try {
      const res = await fetch("/api/feishu/ops/jenkins/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jenkins: {
            enabled: jenkins.enabled,
            url: jenkins.url,
            username: jenkins.username,
            allowed_jobs: trimmed.map((j) => ({
              name: j.name.trim(),
              label: j.label.trim(),
              risk: j.risk,
              parameters: j.parameters
                .filter((p) => p.name.trim())
                .map((p) => ({
                  name: p.name.trim(),
                  default: p.default?.trim() || undefined,
                  choices:
                    p.choices && p.choices.length > 0
                      ? p.choices
                      : undefined,
                })),
            })),
            poll_timeout_sec: jenkins.poll_timeout_sec,
            console_max_chars: jenkins.console_max_chars,
          },
          ops_auto_jenkins_build: opsAuto,
          ops_auto_jenkins_require_admin: opsRequireAdmin,
          ops_auto_jenkins_min_confidence: opsMinConf,
          ops_auto_jenkins_context_hours: opsContextH,
          ops_auto_jenkins_cooldown_sec: opsCooldown,
          ops_admin_open_ids: opsAdmins
            .split(/[\n,]+/)
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      const d: ConfigResponse = await res.json();
      if (d.ok) {
        push("ok", d.message || "已保存");
        await load();
        onSaved?.();
      } else {
        push("error", d.error || "保存失败");
      }
    } catch (e) {
      push("error", String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading && !jenkins) {
    return (
      <OpsCard>
        <p className="text-sm" style={{ color: "var(--label-secondary)" }}>
          加载配置…
        </p>
        <ToastStack />
      </OpsCard>
    );
  }

  if (!jenkins) {
    return (
      <OpsCard>
        <p className="text-sm text-rose-600">无法加载配置</p>
        <ToastStack />
      </OpsCard>
    );
  }

  return (
    <div className="space-y-4">
      <OpsCard>
        <OpsSectionTitle
          title="Jenkins 连接"
          hint="API Token 写在 backend/.env，此处可覆盖 URL / 用户名"
        />
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={jenkins.enabled}
              onChange={(e) =>
                setJenkins({ ...jenkins, enabled: e.target.checked })
              }
              className="rounded"
            />
            启用 Jenkins
          </label>
          {jenkins.health_ok ? (
            <StatusPill tone="ok">已连接</StatusPill>
          ) : (
            <StatusPill tone="warn">未连接</StatusPill>
          )}
          {jenkins.token_configured ? (
            <StatusPill tone="ok">Token 已配置</StatusPill>
          ) : (
            <StatusPill tone="error">缺少 JENKINS_API_TOKEN</StatusPill>
          )}
        </div>
        {jenkins.health_error && (
          <p className="text-xs mb-3 text-rose-700 dark:text-rose-300">
            {jenkins.health_error}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs">
            <span style={{ color: "var(--label-secondary)" }}>Jenkins URL（留空用 .env）</span>
            <input
              className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
              placeholder={jenkins.url_effective || "http://127.0.0.1:8080"}
              value={jenkins.url}
              onChange={(e) => setJenkins({ ...jenkins, url: e.target.value })}
            />
          </label>
          <label className="block text-xs">
            <span style={{ color: "var(--label-secondary)" }}>用户名（留空用 .env）</span>
            <input
              className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
              placeholder={jenkins.username_effective || "admin"}
              value={jenkins.username}
              onChange={(e) =>
                setJenkins({ ...jenkins, username: e.target.value })
              }
            />
          </label>
          <label className="block text-xs">
            <span style={{ color: "var(--label-secondary)" }}>队列轮询超时（秒）</span>
            <input
              type="number"
              min={30}
              max={600}
              className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
              value={jenkins.poll_timeout_sec}
              onChange={(e) =>
                setJenkins({
                  ...jenkins,
                  poll_timeout_sec: Number(e.target.value) || 120,
                })
              }
            />
          </label>
        </div>
      </OpsCard>

      <OpsCard>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <OpsSectionTitle
            title="白名单流水线"
            hint="与 Jenkins 中 Job 名称一致；飞书 @机器人 自然语言仅能触发此列表"
          />
          <button
            type="button"
            onClick={() => setJobs((prev) => [...prev, emptyJob()])}
            className="text-xs px-3 py-1.5 rounded-lg border border-black/10 dark:border-white/15 hover:bg-black/5"
          >
            + 新增流水线
          </button>
        </div>

        {jobs.length === 0 ? (
          <p className="text-sm py-6 text-center" style={{ color: "var(--label-secondary)" }}>
            暂无流水线，点击「新增流水线」添加第一个 Job
          </p>
        ) : (
          <div className="space-y-4">
            {jobs.map((job, ji) => (
              <div
                key={ji}
                className="rounded-xl border border-black/8 dark:border-white/10 p-4 space-y-3"
              >
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="text-xs font-medium" style={{ color: "var(--label-secondary)" }}>
                    流水线 #{ji + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => setJobs((prev) => prev.filter((_, i) => i !== ji))}
                    className="text-xs text-rose-600 hover:underline"
                  >
                    删除
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block text-xs sm:col-span-1">
                    <span style={{ color: "var(--label-secondary)" }}>Job 名称 *</span>
                    <input
                      className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-black/10 dark:border-white/10 bg-transparent font-mono"
                      placeholder="deploy-agent-backend"
                      value={job.name}
                      onChange={(e) => updateJob(ji, { name: e.target.value })}
                    />
                  </label>
                  <label className="block text-xs sm:col-span-1">
                    <span style={{ color: "var(--label-secondary)" }}>显示名称</span>
                    <input
                      className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
                      placeholder="部署 Agent 后端"
                      value={job.label}
                      onChange={(e) => updateJob(ji, { label: e.target.value })}
                    />
                  </label>
                  <label className="block text-xs sm:col-span-1">
                    <span style={{ color: "var(--label-secondary)" }}>风险等级</span>
                    <select
                      className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
                      value={job.risk}
                      onChange={(e) =>
                        updateJob(ji, {
                          risk: e.target.value as AllowedJob["risk"],
                        })
                      }
                    >
                      <option value="low">低</option>
                      <option value="medium">中</option>
                      <option value="high">高</option>
                    </select>
                  </label>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium" style={{ color: "var(--label-secondary)" }}>
                      构建参数（与 Jenkins Job 参数名一致）
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        updateJob(ji, {
                          parameters: [...job.parameters, emptyParam()],
                        })
                      }
                      className="text-[11px] text-[var(--accent)]"
                    >
                      + 参数
                    </button>
                  </div>
                  {job.parameters.map((p, pi) => (
                    <div
                      key={pi}
                      className="grid gap-2 sm:grid-cols-4 mb-2 items-end"
                    >
                      <label className="block text-[11px]">
                        参数名
                        <input
                          className="mt-0.5 w-full px-2 py-1.5 text-sm rounded-md border border-black/10 dark:border-white/10 bg-transparent font-mono"
                          value={p.name}
                          onChange={(e) =>
                            updateParam(ji, pi, { name: e.target.value })
                          }
                        />
                      </label>
                      <label className="block text-[11px]">
                        默认值
                        <input
                          className="mt-0.5 w-full px-2 py-1.5 text-sm rounded-md border border-black/10 dark:border-white/10 bg-transparent"
                          value={p.default || ""}
                          onChange={(e) =>
                            updateParam(ji, pi, { default: e.target.value })
                          }
                        />
                      </label>
                      <label className="block text-[11px] sm:col-span-2">
                        可选值（逗号分隔，留空为自由输入）
                        <input
                          className="mt-0.5 w-full px-2 py-1.5 text-sm rounded-md border border-black/10 dark:border-white/10 bg-transparent"
                          placeholder="main, develop"
                          value={(p.choices || []).join(", ")}
                          onChange={(e) =>
                            updateParam(ji, pi, {
                              choices: e.target.value
                                .split(",")
                                .map((s) => s.trim())
                                .filter(Boolean),
                            })
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="text-[11px] text-rose-600 pb-1.5 justify-self-start"
                        onClick={() =>
                          updateJob(ji, {
                            parameters: job.parameters.filter((_, i) => i !== pi),
                          })
                        }
                      >
                        删
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </OpsCard>

      <OpsCard>
        <OpsSectionTitle
          title="飞书自动构建"
          hint="群聊 @机器人 说「部署 main」等将直接触发上方白名单 Job"
        />
        <div className="space-y-3 text-sm">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={opsAuto}
              onChange={(e) => setOpsAuto(e.target.checked)}
            />
            启用自然语言自动构建
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={opsRequireAdmin}
              onChange={(e) => setOpsRequireAdmin(e.target.checked)}
            />
            仅 ops_admin_open_ids 可自动触发
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-xs">
              最低置信度
              <input
                type="number"
                step={0.05}
                min={0}
                max={1}
                className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
                value={opsMinConf}
                onChange={(e) => setOpsMinConf(Number(e.target.value))}
              />
            </label>
            <label className="block text-xs">
              群聊上下文（小时）
              <input
                type="number"
                step={0.5}
                min={0}
                max={24}
                className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
                value={opsContextH}
                onChange={(e) => setOpsContextH(Number(e.target.value))}
              />
            </label>
            <label className="block text-xs">
              同群冷却（秒）
              <input
                type="number"
                min={0}
                max={3600}
                className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-black/10 dark:border-white/10 bg-transparent"
                value={opsCooldown}
                onChange={(e) => setOpsCooldown(Number(e.target.value))}
              />
            </label>
          </div>
          <label className="block text-xs">
            <span style={{ color: "var(--label-secondary)" }}>
              运维管理员 open_id（每行一个或逗号分隔）
            </span>
            <textarea
              rows={3}
              className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-black/10 dark:border-white/10 bg-transparent font-mono"
              placeholder="ou_xxxxxxxx"
              value={opsAdmins}
              onChange={(e) => setOpsAdmins(e.target.value)}
            />
          </label>
        </div>
      </OpsCard>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="px-5 py-2.5 text-sm font-medium rounded-xl bg-[var(--accent)] text-white disabled:opacity-50"
        >
          {saving ? "保存中…" : "保存配置"}
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => void load()}
          className="px-4 py-2 text-sm rounded-xl border border-black/10 dark:border-white/15"
        >
          重新加载
        </button>
        <p className="text-[11px]" style={{ color: "var(--label-secondary)" }}>
          写入 storage/meal/feishu_config.json · 保存后发布流水线立即生效
        </p>
      </div>
      <ToastStack />
    </div>
  );
}
