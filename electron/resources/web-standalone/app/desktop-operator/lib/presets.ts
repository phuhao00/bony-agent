export type DesktopPreset = {
  label: string;
  category: "dcc" | "launch" | "gui";
  app_id: string;
  mode?: string;
  params?: Record<string, unknown>;
  goal?: string;
};

export const DESKTOP_PRESETS: DesktopPreset[] = [
  {
    label: "Blender 批量渲染",
    category: "dcc",
    app_id: "blender",
    mode: "batch_render",
    params: { blend_file: "", output_dir: "" },
  },
  {
    label: "Blender Python 脚本",
    category: "dcc",
    app_id: "blender",
    mode: "batch_python",
    params: { blend_file: "", script_path: "" },
  },
  {
    label: "Photoshop JSX 脚本",
    category: "dcc",
    app_id: "photoshop",
    mode: "extendscript",
    params: { script_path: "" },
  },
  {
    label: "Unity Batch 构建",
    category: "dcc",
    app_id: "unity",
    mode: "batch_method",
    params: { project_path: "", execute_method: "" },
  },
  {
    label: "启动应用",
    category: "launch",
    app_id: "",
  },
  {
    label: "GUI 自动化（无 CLI）",
    category: "gui",
    app_id: "",
    goal: "在前台应用中完成指定操作",
  },
];

/** 与 backend/core/creative_software.py 校验规则对齐，提交前拦截缺失参数 */
export function validateDesktopPlanBody(body: Record<string, unknown>): string | null {
  const appId = String(body.app_id || "").toLowerCase();
  const mode = String(body.mode || "").toLowerCase();
  const blendFile = String(body.blend_file || "").trim();
  const scriptPath = String(body.script_path || "").trim();
  const projectPath = String(body.project_path || "").trim();
  const executeMethod = String(body.execute_method || "").trim();

  if (appId === "blender" && ["blender_batch_python", "batch_python", "python"].includes(mode)) {
    if (!blendFile || !scriptPath) {
      return "Blender Python 脚本需要填写 .blend 文件路径和脚本路径";
    }
  } else if (appId === "blender" && ["blender_batch_render", "batch_render", "render"].includes(mode)) {
    if (!blendFile) {
      return "Blender 批量渲染需要填写 .blend 文件路径";
    }
  } else if (appId === "unity" && ["unity_batch_method", "batch_method", "batch"].includes(mode)) {
    if (!projectPath || !executeMethod) {
      return "Unity Batch 构建需要填写项目路径和 ExecuteMethod";
    }
  } else if (appId === "photoshop" && ["photoshop_extendscript", "jsx", "extendscript"].includes(mode)) {
    if (!scriptPath) {
      return "Photoshop JSX 脚本需要填写脚本路径";
    }
  }

  return null;
}
