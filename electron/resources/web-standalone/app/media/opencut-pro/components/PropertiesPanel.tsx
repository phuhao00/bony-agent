"use client";

import { useState } from "react";
import type { Keyframe, TimelineElement } from "../lib/types";

interface PropertiesPanelProps {
  selectedElements: TimelineElement[];
  currentTime?: number;
  onUpdateElement?: (element: TimelineElement) => void;
}

export default function PropertiesPanel({
  selectedElements,
  currentTime = 0,
  onUpdateElement,
}: PropertiesPanelProps) {
  const [activeTab, setActiveTab] = useState<"transform" | "effect" | "animation" | "mask">("transform");

  if (selectedElements.length === 0) {
    return (
      <div className="flex h-full flex-col border-l border-[var(--separator)] bg-[var(--card-bg)]">
        <div className="flex h-12 items-center border-b border-[var(--separator)] px-4">
          <span className="font-medium text-[var(--foreground)]">属性</span>
        </div>
        <div className="flex flex-1 items-center justify-center p-4 text-sm text-[var(--label-secondary)]">
          在时间轴上选择片段以编辑属性
        </div>
      </div>
    );
  }

  const element = selectedElements[0];
  const placement = element.placement || {};
  const params = element.params || {};

  const updatePlacement = (patch: Partial<typeof placement>) => {
    onUpdateElement?.({ ...element, placement: { ...placement, ...patch } });
  };

  const updateParams = (patch: Record<string, any>) => {
    onUpdateElement?.({ ...element, params: { ...params, ...patch } });
  };

  return (
    <div className="flex h-full flex-col border-l border-[var(--separator)] bg-[var(--card-bg)]">
      <div className="flex h-12 items-center border-b border-[var(--separator)] px-4">
        <span className="font-medium text-[var(--foreground)]">属性</span>
      </div>
      <div className="flex border-b border-[var(--separator)]">
        {(["transform", "effect", "animation", "mask"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 text-xs font-medium ${
              activeTab === tab
                ? "border-b-2 border-blue-500 text-blue-500"
                : "text-[var(--label-secondary)] hover:text-[var(--foreground)]"
            }`}
          >
            {tab === "transform" && "变换"}
            {tab === "effect" && "特效"}
            {tab === "animation" && "动画"}
            {tab === "mask" && "遮罩"}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === "transform" && (
          <div className="space-y-4">
            <TextField label="名称" value={element.name} onChange={(v) => onUpdateElement?.({ ...element, name: v })} />
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="X" value={placement.x ?? 0} onChange={(v) => updatePlacement({ x: v })} />
              <NumberField label="Y" value={placement.y ?? 0} onChange={(v) => updatePlacement({ y: v })} />
              <NumberField label="宽度" value={placement.width ?? 1920} onChange={(v) => updatePlacement({ width: v })} />
              <NumberField label="高度" value={placement.height ?? 1080} onChange={(v) => updatePlacement({ height: v })} />
            </div>
            <SliderField label="缩放" min={0.1} max={3} step={0.05} value={placement.scaleX ?? 1} onChange={(v) => updatePlacement({ scaleX: v, scaleY: v })} />
            <SliderField label="旋转" min={-180} max={180} step={1} value={placement.rotation ?? 0} onChange={(v) => updatePlacement({ rotation: v })} />
            <SliderField label="不透明度" min={0} max={1} step={0.05} value={placement.opacity ?? 1} onChange={(v) => updatePlacement({ opacity: v })} />
          </div>
        )}

        {activeTab === "effect" && (
          <div className="space-y-4">
            <SliderField label="亮度" min={0} max={3} step={0.05} value={params.brightness ?? 1} onChange={(v) => updateParams({ brightness: v })} />
            <SliderField label="对比度" min={0} max={3} step={0.05} value={params.contrast ?? 1} onChange={(v) => updateParams({ contrast: v })} />
            <SliderField label="饱和度" min={0} max={3} step={0.05} value={params.saturation ?? 1} onChange={(v) => updateParams({ saturation: v })} />
            <SliderField label="模糊" min={0} max={20} step={0.5} value={params.blur ?? 0} onChange={(v) => updateParams({ blur: v })} />
            <SliderField label="棕褐色" min={0} max={1} step={0.05} value={params.sepia ?? 0} onChange={(v) => updateParams({ sepia: v })} />
            <SliderField label="灰度" min={0} max={1} step={0.05} value={params.grayscale ?? 0} onChange={(v) => updateParams({ grayscale: v })} />
          </div>
        )}

        {activeTab === "animation" && (
          <KeyframeEditor
            element={element}
            currentTime={currentTime}
            onUpdateElement={onUpdateElement}
          />
        )}

        {activeTab === "mask" && (
          <div className="space-y-4">
            <SelectField
              label="遮罩类型"
              value={params.maskType || "none"}
              options={[
                { value: "none", label: "无" },
                { value: "rectangle", label: "矩形" },
                { value: "ellipse", label: "椭圆" },
                { value: "cinematic-bars", label: "电影黑边" },
              ]}
              onChange={(v) => updateParams({ maskType: v })}
            />
            {params.maskType && params.maskType !== "none" && (
              <>
                <SliderField label="中心 X" min={0} max={1} step={0.01} value={params.maskCenterX ?? 0.5} onChange={(v) => updateParams({ maskCenterX: v })} />
                <SliderField label="中心 Y" min={0} max={1} step={0.01} value={params.maskCenterY ?? 0.5} onChange={(v) => updateParams({ maskCenterY: v })} />
                <SliderField label="宽度" min={0} max={1} step={0.01} value={params.maskWidth ?? 0.5} onChange={(v) => updateParams({ maskWidth: v })} />
                <SliderField label="高度" min={0} max={1} step={0.01} value={params.maskHeight ?? 0.5} onChange={(v) => updateParams({ maskHeight: v })} />
                <SliderField label="羽化" min={0} max={1} step={0.01} value={params.maskFeather ?? 0} onChange={(v) => updateParams({ maskFeather: v })} />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function KeyframeEditor({
  element,
  currentTime,
  onUpdateElement,
}: {
  element: TimelineElement;
  currentTime: number;
  onUpdateElement?: (el: TimelineElement) => void;
}) {
  const [channel, setChannel] = useState<"opacity" | "scale" | "x" | "y">("opacity");
  const keyframes = element.keyframes?.[channel] || [];

  const updateKeyframes = (newKeyframes: Keyframe[]) => {
    onUpdateElement?.({
      ...element,
      keyframes: { ...element.keyframes, [channel]: newKeyframes },
    });
  };

  const addKeyframe = () => {
    const valueMap: Record<string, number> = {
      opacity: element.placement?.opacity ?? 1,
      scale: element.placement?.scaleX ?? 1,
      x: element.placement?.x ?? 0,
      y: element.placement?.y ?? 0,
    };
    updateKeyframes([...keyframes, { time: currentTime, value: valueMap[channel] }].sort((a, b) => a.time - b.time));
  };

  const removeKeyframe = (idx: number) => {
    updateKeyframes(keyframes.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-3">
      <SelectField
        label="通道"
        value={channel}
        options={[
          { value: "opacity", label: "不透明度" },
          { value: "scale", label: "缩放" },
          { value: "x", label: "X" },
          { value: "y", label: "Y" },
        ]}
        onChange={(v) => setChannel(v as typeof channel)}
      />
      <button
        onClick={addKeyframe}
        className="w-full rounded-md bg-blue-600 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
      >
        在 {currentTime.toFixed(2)}s 添加关键帧
      </button>
      <div className="space-y-2">
        {keyframes.map((k, idx) => (
          <div key={idx} className="flex items-center gap-2 rounded-md border border-[var(--separator)] bg-[var(--shell-bg)] p-2">
            <NumberField label="时间" value={k.time} onChange={(v) => {
              const next = [...keyframes];
              next[idx].time = v;
              updateKeyframes(next.sort((a, b) => a.time - b.time));
            }} />
            <NumberField label="值" value={k.value} onChange={(v) => {
              const next = [...keyframes];
              next[idx].value = v;
              updateKeyframes(next);
            }} />
            <button
              onClick={() => removeKeyframe(idx)}
              className="mt-5 rounded p-1 text-xs text-red-400 hover:bg-red-500/10"
            >
              删除
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-xs text-[var(--label-secondary)]">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-[var(--separator)] bg-[var(--shell-bg)] px-2 py-1.5 text-sm text-[var(--foreground)] outline-none focus:border-blue-500"
      />
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="text-xs text-[var(--label-secondary)]">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-md border border-[var(--separator)] bg-[var(--shell-bg)] px-2 py-1.5 text-sm text-[var(--foreground)] outline-none focus:border-blue-500"
      />
    </div>
  );
}

function SliderField({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="text-xs text-[var(--label-secondary)]">{label}</label>
        <span className="text-xs text-[var(--foreground)]">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full"
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-xs text-[var(--label-secondary)]">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-[var(--separator)] bg-[var(--shell-bg)] px-2 py-1.5 text-sm text-[var(--foreground)] outline-none focus:border-blue-500"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
