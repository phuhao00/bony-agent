"use client";

import { NODE_TYPE_REGISTRY, NodeRunStatus, NodeType } from "@/types/workflow";
import { Handle, NodeProps, Position } from "@xyflow/react";
import { memo } from "react";

export interface WorkflowNodeData extends Record<string, unknown> {
  label: string;
  node_type: NodeType;
  config: Record<string, unknown>;
  run_status?: NodeRunStatus;
  run_error?: string;
}

const CATEGORY_ACCENT: Record<string, string> = {
  trigger: "#00c37f",
  agent: "#a78bfa",
  tool: "#60a5fa",
  control: "#fbbf24",
  output: "#9ca3af",
};

export const BaseNode = memo(function BaseNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as WorkflowNodeData;
  const info = NODE_TYPE_REGISTRY[nodeData.node_type];
  if (!info) return null;

  const accent = CATEGORY_ACCENT[info.category] ?? "#9ca3af";
  const runStatus = nodeData.run_status;
  const isRunning = runStatus === "running";
  const isComplete = runStatus === "completed";
  const isFailed = runStatus === "failed";

  const borderColor = selected
    ? "#ff9500"
    : isRunning
      ? "#3b82f6"
      : isComplete
        ? "#00c37f"
        : isFailed
          ? "#ef4444"
          : "var(--separator-subtle)";

  const shadowClass = selected
    ? "wf-node-selected"
    : isRunning
      ? "wf-node-running-shadow"
      : isComplete
        ? "wf-node-complete"
        : isFailed
          ? "wf-node-failed"
          : "wf-node";

  const StatusBadge = () => {
    if (!runStatus || runStatus === "pending" || runStatus === "skipped")
      return null;
    const cfg =
      {
        running: {
          label: "运行中",
          bg: "rgba(59,130,246,0.15)",
          border: "rgba(59,130,246,0.3)",
          text: "#93c5fd",
          dot: "bg-blue-400 animate-pulse",
        },
        completed: {
          label: "✓ 完成",
          bg: "rgba(0,195,127,0.12)",
          border: "rgba(0,195,127,0.28)",
          text: "#6ee7b7",
          dot: "",
        },
        failed: {
          label: "✕ 失败",
          bg: "rgba(239,68,68,0.12)",
          border: "rgba(239,68,68,0.28)",
          text: "#fca5a5",
          dot: "",
        },
      }[runStatus] ?? null;
    if (!cfg) return null;
    return (
      <span
        style={{
          backgroundColor: cfg.bg,
          borderColor: cfg.border,
          color: cfg.text,
        }}
        className="flex items-center gap-1 text-[9px] font-semibold px-1.5 py-[2px] rounded-full border shrink-0"
      >
        {cfg.dot && <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />}
        {cfg.label}
      </span>
    );
  };

  return (
    <div
      style={{ borderColor, borderWidth: 1, borderStyle: "solid" }}
      className={`relative min-w-[152px] max-w-[196px] rounded-xl bg-[var(--card-bg)] transition-all duration-200 ${shadowClass} ${isRunning ? "workflow-node-running" : ""}`}
    >
      {/* Left accent stripe */}
      <div
        style={{ backgroundColor: accent }}
        className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl z-10 pointer-events-none"
      />

      {/* Input handles — hollow ring */}
      {info.inputs.map((port, i) => (
        <Handle
          key={`in-${port.id}`}
          type="target"
          position={Position.Left}
          id={port.id}
          style={{
            top: `${((i + 1) / (info.inputs.length + 1)) * 100}%`,
            left: -5,
            width: 10,
            height: 10,
            backgroundColor: "var(--card-bg)",
            border: `2px solid ${accent}`,
            borderRadius: "50%",
          }}
        />
      ))}

      {/* Content */}
      <div className="pl-[13px] pr-2.5 pt-2 pb-1.5">
        {/* Icon + title row */}
        <div className="flex items-start gap-2">
          <div
            style={{
              backgroundColor: `${accent}1a`,
              borderColor: `${accent}33`,
            }}
            className="w-[26px] h-[26px] flex items-center justify-center rounded-lg shrink-0 border text-[12px] mt-0.5"
          >
            {info.icon}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11.5px] font-semibold text-[var(--foreground)] truncate leading-snug">
              {nodeData.label || info.label}
            </p>
            <p className="text-[9px] text-[var(--label-secondary)] truncate mt-[1px]">
              {info.description}
            </p>
          </div>
        </div>

        {/* Footer row: category badge + status badge */}
        <div className="flex items-center gap-1.5 mt-1.5">
          <span
            style={{
              color: accent,
              borderColor: `${accent}2e`,
              backgroundColor: `${accent}12`,
            }}
            className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-[2px] rounded border"
          >
            {info.category}
          </span>
          <div className="ml-auto">
            <StatusBadge />
          </div>
        </div>

        {/* Error */}
        {isFailed && nodeData.run_error && (
          <div className="mt-1 text-[9px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-2 py-1 line-clamp-2">
            {nodeData.run_error}
          </div>
        )}
      </div>

      {/* Output handles — solid dot */}
      {info.outputs.map((port, i) => (
        <Handle
          key={`out-${port.id}`}
          type="source"
          position={Position.Right}
          id={port.id}
          style={{
            top: `${((i + 1) / (info.outputs.length + 1)) * 100}%`,
            right: -5,
            width: 10,
            height: 10,
            backgroundColor: accent,
            border: "2px solid var(--card-bg)",
            borderRadius: "50%",
          }}
        />
      ))}
    </div>
  );
});

export default BaseNode;
