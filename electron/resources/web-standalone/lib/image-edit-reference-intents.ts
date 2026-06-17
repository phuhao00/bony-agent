import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  Focus,
  LayoutGrid,
  Layers,
  Palette,
  Replace,
} from "lucide-react";

export type ReferenceIntent =
  | "replace_material"
  | "preserve_shape"
  | "recompose_layout"
  | "style_transfer"
  | "partial_replace";

export type ReferenceImageRole = "material" | "style" | "background" | "subject";

export interface ReferenceIntentDefinition {
  id: ReferenceIntent;
  label: string;
  /** 卡片副标题，一句话说明 */
  tagline: string;
  hint: string;
  icon: LucideIcon;
  /** 是否在主界面展示（其余收进「更多方式」） */
  primary: boolean;
  lockLayout: boolean;
  lockShape: boolean;
  targetLabel: string;
  targetPlaceholder: string;
  promptPlaceholder: string;
  examples: { label: string; target: string; prompt: string }[];
}

export const REFERENCE_INTENTS: ReferenceIntentDefinition[] = [
  {
    id: "replace_material",
    label: "素材替换",
    tagline: "用参考图里的东西，换掉原图对应内容",
    hint: "保持原图形状、姿态与布局不变",
    icon: Replace,
    primary: true,
    lockLayout: true,
    lockShape: true,
    targetLabel: "要替换什么",
    targetPlaceholder: "例如：桌面上的花瓶、人物的服装…",
    promptPlaceholder: "补充细节，例如：用参考图里的红色连衣裙替换，边缘自然融合…",
    examples: [
      {
        label: "换花瓶",
        target: "桌面上的花瓶",
        prompt: "用参考图中的玻璃花瓶替换，位置和大小不变",
      },
      {
        label: "换服装",
        target: "人物的服装",
        prompt: "穿上参考图中的款式，姿态轮廓不变",
      },
    ],
  },
  {
    id: "style_transfer",
    label: "参考画风",
    tagline: "只借鉴色调与画风，主体不变",
    hint: "形状、内容与构图保持原样",
    icon: Palette,
    primary: true,
    lockLayout: true,
    lockShape: true,
    targetLabel: "应用范围（可选）",
    targetPlaceholder: "留空表示整张图，或填「背景」「人物」等",
    promptPlaceholder: "例如：参考图的暖色胶片感与柔焦氛围…",
    examples: [
      {
        label: "胶片感",
        target: "",
        prompt: "参考图的复古胶片色调，主体内容与构图完全一致",
      },
    ],
  },
  {
    id: "recompose_layout",
    label: "自由组合",
    tagline: "提取素材，重新排版构图",
    hint: "允许调整位置与画面布局",
    icon: LayoutGrid,
    primary: true,
    lockLayout: false,
    lockShape: false,
    targetLabel: "组合说明（可选）",
    targetPlaceholder: "例如：人物来自原图，场景来自参考图…",
    promptPlaceholder: "描述新构图，例如：主体居中，前景产品、背景虚化…",
    examples: [
      {
        label: "新构图",
        target: "原图主体 + 参考场景",
        prompt: "人物置于参考场景中央，前后景层次清晰",
      },
    ],
  },
  {
    id: "preserve_shape",
    label: "只换材质",
    tagline: "换表面质感，轮廓完全不动",
    hint: "适合产品换肤、改材质",
    icon: Layers,
    primary: false,
    lockLayout: true,
    lockShape: true,
    targetLabel: "要改的对象",
    targetPlaceholder: "例如：产品外壳、汽车车身…",
    promptPlaceholder: "例如：改为参考图的磨砂金属质感…",
    examples: [
      {
        label: "金属质感",
        target: "产品外壳",
        prompt: "参考图的磨砂金属表面，外形尺寸不变",
      },
    ],
  },
  {
    id: "partial_replace",
    label: "指定区域",
    tagline: "只改某一类内容，其余尽量保留",
    hint: "需说明要改的具体部分",
    icon: Focus,
    primary: false,
    lockLayout: true,
    lockShape: true,
    targetLabel: "要改哪里",
    targetPlaceholder: "必填，例如：背景、天空、左侧商品…",
    promptPlaceholder: "补充期望效果，例如：替换为参考图的海边日落…",
    examples: [
      {
        label: "换背景",
        target: "背景",
        prompt: "替换为参考图的海边场景，主体边缘自然",
      },
    ],
  },
];

export const REFERENCE_ROLES: {
  id: ReferenceImageRole;
  label: string;
}[] = [
  { id: "material", label: "素材" },
  { id: "style", label: "风格" },
  { id: "background", label: "背景" },
  { id: "subject", label: "主体" },
];

export function getReferenceIntent(id: ReferenceIntent): ReferenceIntentDefinition {
  return REFERENCE_INTENTS.find((i) => i.id === id) ?? REFERENCE_INTENTS[0];
}

export function primaryReferenceIntents(): ReferenceIntentDefinition[] {
  return REFERENCE_INTENTS.filter((i) => i.primary);
}

export function secondaryReferenceIntents(): ReferenceIntentDefinition[] {
  return REFERENCE_INTENTS.filter((i) => !i.primary);
}

export function defaultRoleForIntent(intent: ReferenceIntent): ReferenceImageRole {
  if (intent === "style_transfer") return "style";
  if (intent === "recompose_layout") return "material";
  return "material";
}

export function referenceWorkflowReady(input: {
  hasSource: boolean;
  refCount: number;
  intent: ReferenceIntent;
  target: string;
  prompt: string;
}): { ready: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!input.hasSource) missing.push("原图");
  if (input.refCount < 1) missing.push("参考素材");
  const needsTarget = input.intent === "partial_replace";
  const hasInstruction = Boolean(input.prompt.trim() || input.target.trim());
  if (needsTarget && !input.target.trim()) missing.push("替换目标");
  else if (!hasInstruction) missing.push("编辑描述");
  return { ready: missing.length === 0, missing };
}
