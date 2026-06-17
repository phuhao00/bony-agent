import type { EditCanvasMode } from "@/lib/image-edit-modes";

export type ImageEditIntentInput = {
  prompt: string;
  selectedMode: EditCanvasMode;
  hasMask: boolean;
  hasReferenceImages: boolean;
  inpaintMethod?: "generate" | "replace";
  hasInpaintReference?: boolean;
  watermarkMethod?: "auto" | "area" | "text";
  hasWatermarkText?: boolean;
};

export type ImageEditPlan = {
  submitMode: EditCanvasMode;
  needsMask: boolean;
  needsReference: boolean;
  missingRequirement?: "prompt" | "mask" | "reference" | "watermarkText";
  reason: string;
  label: string;
  warning?: string;
  bodyPatch?: Record<string, unknown>;
};

const ADD_OR_GENERAL_TERMS = [
  "加",
  "加入",
  "添加",
  "放",
  "放置",
  "生成",
  "变成",
  "改成",
  "换成",
  "调整",
  "调色",
  "增强",
  "add",
  "put",
  "place",
  "insert",
  "make",
  "change",
  "turn",
];

const REMOVE_TERMS = ["去掉", "移除", "删除", "擦掉", "remove", "delete", "erase"];
const WATERMARK_TERMS = ["水印", "logo", "标识", "watermark"];
const UPSCALE_TERMS = ["高清", "超清", "放大", "清晰", "upscale", "enhance"];
const ADD_SUBJECT_TERMS = ["加一", "加个", "加上", "加到", "添加", "放一", "放个", "插入", "新增", "add a", "add an", "insert"];

function hasAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

export function resolveImageEditPlan(input: ImageEditIntentInput): ImageEditPlan {
  const prompt = input.prompt.trim();
  const text = prompt.toLowerCase();
  const selectedMode = input.selectedMode;

  if (!prompt && selectedMode !== "upscale" && selectedMode !== "watermark") {
    return {
      submitMode: selectedMode,
      needsMask: false,
      needsReference: false,
      missingRequirement: "prompt",
      reason: "missing_prompt",
      label: "需要编辑指令",
    };
  }

  if (selectedMode === "watermark" || hasAny(text, WATERMARK_TERMS)) {
    if (input.watermarkMethod === "area") {
      return input.hasMask
        ? {
            submitMode: "watermark",
            needsMask: true,
            needsReference: false,
            reason: "watermark_area_with_mask",
            label: "区域去水印",
          }
        : prompt
          ? {
              submitMode: "instruction",
              needsMask: false,
              needsReference: false,
              reason: "watermark_area_missing_mask_fallback_instruction",
              label: "自由指令编辑",
              warning: "未涂抹水印区域，Agent 将按自由指令尽量去除水印。",
            }
          : {
              submitMode: "watermark",
              needsMask: true,
              needsReference: false,
              missingRequirement: "mask",
              reason: "watermark_area_missing_mask",
              label: "需要涂抹区域",
            };
    }
    if (input.watermarkMethod === "text" && !input.hasWatermarkText && !prompt) {
      return {
        submitMode: "watermark",
        needsMask: false,
        needsReference: false,
        missingRequirement: "watermarkText",
        reason: "watermark_text_missing_target",
        label: "需要水印文字",
      };
    }
    return {
      submitMode: "watermark",
      needsMask: false,
      needsReference: false,
      reason: "watermark_auto_or_text",
      label: "去水印",
    };
  }

  if (input.hasMask && selectedMode === "remove" && hasAny(text, REMOVE_TERMS)) {
    return {
      submitMode: "remove",
      needsMask: true,
      needsReference: false,
      reason: "remove_with_mask",
      label: "物体移除",
    };
  }

  if (input.hasMask && selectedMode === "inpaint") {
    if (input.inpaintMethod === "replace") {
      return input.hasInpaintReference
        ? {
            submitMode: "inpaint",
            needsMask: true,
            needsReference: true,
            reason: "inpaint_replace_with_mask_and_reference",
            label: "参考图局部替换",
          }
        : {
            submitMode: "instruction",
            needsMask: false,
            needsReference: false,
            reason: "inpaint_replace_missing_reference_fallback_instruction",
            label: "自由指令编辑",
            warning: "未上传替换素材图，Agent 将按文字指令执行局部编辑。",
          };
    }
    return {
      submitMode: "inpaint",
      needsMask: true,
      needsReference: false,
      reason: "inpaint_generate_with_mask",
      label: "选区重绘",
    };
  }

  if (selectedMode === "reference") {
    return input.hasReferenceImages
      ? {
          submitMode: "reference",
          needsMask: false,
          needsReference: true,
          reason: "reference_images_available",
          label: "参考图编辑",
        }
      : {
          submitMode: "instruction",
          needsMask: false,
          needsReference: false,
          reason: "reference_missing_images_fallback_instruction",
          label: "自由指令编辑",
          warning: "未上传参考图，Agent 将按自由指令编辑原图。",
        };
  }

  if (selectedMode === "outpaint") {
    return {
      submitMode: "outpaint",
      needsMask: false,
      needsReference: false,
      reason: "explicit_outpaint",
      label: "扩图",
    };
  }

  if (selectedMode === "logoMotion") {
    return {
      submitMode: "logoMotion",
      needsMask: false,
      needsReference: false,
      reason: "explicit_logo_motion",
      label: "Logo 动画",
      bodyPatch: { mode: "logoMotion" },
    };
  }

  if (selectedMode === "upscale" || hasAny(text, UPSCALE_TERMS)) {
    return {
      submitMode: selectedMode === "upscale" ? "upscale" : "instruction",
      needsMask: false,
      needsReference: false,
      reason: selectedMode === "upscale" ? "explicit_upscale" : "natural_language_enhance",
      label: selectedMode === "upscale" ? "高清超分" : "自由指令编辑",
    };
  }

  if (hasAny(text, ADD_SUBJECT_TERMS)) {
    return {
      submitMode: "instruction",
      needsMask: false,
      needsReference: false,
      reason: "add_subject_instruction",
      label: "新增主体",
      warning: "新增具体角色/物体属于大幅编辑；指定位置或涂抹区域会更稳定。",
      bodyPatch: { strength: 0.86 },
    };
  }

  if (hasAny(text, ADD_OR_GENERAL_TERMS) || prompt) {
    return {
      submitMode: "instruction",
      needsMask: false,
      needsReference: false,
      reason: selectedMode === "instruction" ? "freeform_instruction" : "freeform_prompt_fallback_instruction",
      label: "自由指令编辑",
      warning:
        selectedMode === "instruction"
          ? undefined
          : "当前高级模式缺少必要素材，Agent 将按自由指令编辑。",
    };
  }

  return {
    submitMode: "instruction",
    needsMask: false,
    needsReference: false,
    reason: "default_instruction",
    label: "自由指令编辑",
  };
}

export const IMAGE_EDIT_INTENT_CASES = [
  {
    name: "freeform add cat",
    input: { prompt: "加一只小猫", selectedMode: "instruction", hasMask: false, hasReferenceImages: false },
    expectedMode: "instruction",
  },
  {
    name: "reference tab without reference falls back",
    input: { prompt: "换成红色夹克", selectedMode: "reference", hasMask: false, hasReferenceImages: false },
    expectedMode: "instruction",
  },
  {
    name: "mask inpaint",
    input: { prompt: "把这里换成猫", selectedMode: "inpaint", hasMask: true, hasReferenceImages: false },
    expectedMode: "inpaint",
  },
  {
    name: "watermark text",
    input: {
      prompt: "去掉右上角水印",
      selectedMode: "watermark",
      hasMask: false,
      hasReferenceImages: false,
      watermarkMethod: "text",
      hasWatermarkText: true,
    },
    expectedMode: "watermark",
  },
] satisfies Array<{
  name: string;
  input: ImageEditIntentInput;
  expectedMode: EditCanvasMode;
}>;

