import type { LucideIcon } from "lucide-react";
import {
  Droplets,
  Expand,
  Eraser,
  ImageUp,
  Images,
  Paintbrush,
  Palette,
  Pencil,
  Play,
  Sparkles,
  Trash2,
  Type,
  Wand2,
} from "lucide-react";

export type EditCanvasMode =
  | "instruction"
  | "inpaint"
  | "remove"
  | "outpaint"
  | "style_global"
  | "style_local"
  | "watermark"
  | "upscale"
  | "colorize"
  | "sketch"
  | "cartoon"
  | "reference"
  | "logoMotion";

export type EditModeCategory = "content" | "style" | "enhance" | "repair" | "motion";

export interface EditModeDefinition {
  id: EditCanvasMode;
  label: string;
  hint: string;
  icon: LucideIcon;
  category: EditModeCategory;
  needsMask: boolean;
  needsPrompt: boolean;
  promptOptional?: boolean;
  supportsStrength?: boolean;
  supportsUpscale?: boolean;
  supportsSketchFlag?: boolean;
  needsReferenceImages?: boolean;
  maxReferenceImages?: number;
  presets: { label: string; prompt: string }[];
}

export const EDIT_MODE_CATEGORIES: {
  id: EditModeCategory;
  label: string;
}[] = [
  { id: "content", label: "内容编辑" },
  { id: "style", label: "风格增强" },
  { id: "enhance", label: "尺寸优化" },
  { id: "repair", label: "修复工具" },
  { id: "motion", label: "动效" },
];

export const EDIT_MODES: EditModeDefinition[] = [
  {
    id: "instruction",
    label: "指令编辑",
    hint: "整图按文字描述修改，无需涂抹",
    icon: Type,
    category: "content",
    needsMask: false,
    needsPrompt: true,
    supportsStrength: true,
    presets: [
      { label: "换背景", prompt: "把背景改成海边日落，暖色调，保持人物不变" },
      { label: "改风格", prompt: "改成日系动漫插画风格，色彩明亮" },
      { label: "加元素", prompt: "在画面中加入飘落的樱花花瓣" },
      { label: "调色", prompt: "整体色调改为冷色电影感，提高对比度" },
    ],
  },
  {
    id: "reference",
    label: "参考图编辑",
    hint: "上传素材参考图，按操作方式替换内容、保形换肤或重组布局",
    icon: Images,
    category: "content",
    needsMask: false,
    needsPrompt: true,
    needsReferenceImages: true,
    maxReferenceImages: 2,
    presets: [],
  },
  {
    id: "inpaint",
    label: "局部重绘",
    hint: "涂抹选区：AI 文字生成，或上传参考图局部替换",
    icon: Paintbrush,
    category: "content",
    needsMask: true,
    needsPrompt: true,
    presets: [
      { label: "换服装", prompt: "换成红色连帽卫衣" },
      { label: "换发型", prompt: "换成金色长卷发" },
      { label: "加配饰", prompt: "戴一副黑色墨镜" },
      { label: "改表情", prompt: "改成微笑表情" },
    ],
  },
  {
    id: "remove",
    label: "物体移除",
    hint: "涂抹要去除的区域，自动填充背景",
    icon: Trash2,
    category: "content",
    needsMask: true,
    needsPrompt: false,
    presets: [],
  },
  {
    id: "style_global",
    label: "全局风格化",
    hint: "将整张图片转换为指定艺术风格",
    icon: Palette,
    category: "style",
    needsMask: false,
    needsPrompt: true,
    supportsStrength: true,
    presets: [
      { label: "绘本风", prompt: "转换成法国绘本风格" },
      { label: "水彩", prompt: "转换成水彩插画风格，柔和笔触" },
      { label: "赛博朋克", prompt: "转换成赛博朋克霓虹风格" },
      { label: "像素风", prompt: "转换成 16-bit 像素游戏风格" },
    ],
  },
  {
    id: "style_local",
    label: "局部风格化",
    hint: "按描述对指定物体/区域改变风格",
    icon: Wand2,
    category: "style",
    needsMask: false,
    needsPrompt: true,
    presets: [
      { label: "木质感", prompt: "把房子变成木板风格" },
      { label: "金属感", prompt: "把汽车变成金属/chrome 质感" },
      { label: "毛绒感", prompt: "把玩偶变成毛绒材质" },
    ],
  },
  {
    id: "colorize",
    label: "图像上色",
    hint: "黑白或灰度图像转为彩色",
    icon: Droplets,
    category: "style",
    needsMask: false,
    needsPrompt: true,
    presets: [
      { label: "自然色", prompt: "自然真实的色彩，保持光影一致" },
      { label: "复古", prompt: "复古胶片色调，偏暖黄" },
      { label: "指定色", prompt: "蓝色背景，黄色的叶子" },
    ],
  },
  {
    id: "sketch",
    label: "线稿生图",
    hint: "从线稿或照片提取线稿后生成完整图像",
    icon: Pencil,
    category: "style",
    needsMask: false,
    needsPrompt: true,
    supportsSketchFlag: true,
    presets: [
      { label: "北欧客厅", prompt: "北欧极简风格的客厅，自然光" },
      { label: "动漫角色", prompt: "日系动漫角色立绘，精细上色" },
      { label: "产品渲染", prompt: "产品级 3D 渲染，白底商业摄影" },
    ],
  },
  {
    id: "cartoon",
    label: "卡通形象",
    hint: "参考卡通形象生成新场景",
    icon: Sparkles,
    category: "style",
    needsMask: false,
    needsPrompt: true,
    presets: [
      { label: "探险", prompt: "卡通形象小心翼翼地探出头，窥视着房间内的蓝色宝石" },
      { label: "户外", prompt: "卡通形象在草地上奔跑，阳光明媚" },
    ],
  },
  {
    id: "outpaint",
    label: "扩图",
    hint: "向四周扩展画布并 AI 补全",
    icon: Expand,
    category: "enhance",
    needsMask: false,
    needsPrompt: true,
    presets: [
      { label: "加天空", prompt: "扩展区域补全更多蓝天白云" },
      { label: "加场景", prompt: "向四周扩展，补全完整的室内场景" },
      { label: "宽屏", prompt: "扩展为电影宽银幕构图，保持主体居中" },
    ],
  },
  {
    id: "upscale",
    label: "高清超分",
    hint: "模糊图像高清放大，增强细节",
    icon: ImageUp,
    category: "enhance",
    needsMask: false,
    needsPrompt: false,
    promptOptional: true,
    supportsUpscale: true,
    presets: [],
  },
  {
    id: "watermark",
    label: "去水印",
    hint: "智能全图 / 涂抹指定区域 / 输入指定文字",
    icon: Eraser,
    category: "repair",
    needsMask: false,
    needsPrompt: false,
    promptOptional: true,
    presets: [],
  },
  {
    id: "logoMotion",
    label: "Logo 动画",
    hint: "将 Logo/图标转为带 CSS 动画的独立 HTML",
    icon: Play,
    category: "motion",
    needsMask: false,
    needsPrompt: true,
    presets: [
      { label: "优雅淡入", prompt: "让 Logo 优雅地淡入并带有轻微的向上浮动感" },
      { label: "线条描绘", prompt: "用科技感线条依次描绘 Logo 轮廓" },
      { label: "活泼弹跳", prompt: "Logo 元素活泼地弹入画面" },
    ],
  },
];

export function getEditMode(id: EditCanvasMode): EditModeDefinition {
  return EDIT_MODES.find((m) => m.id === id) ?? EDIT_MODES[0];
}

export function modesForCategory(category: EditModeCategory): EditModeDefinition[] {
  return EDIT_MODES.filter((m) => m.category === category);
}
