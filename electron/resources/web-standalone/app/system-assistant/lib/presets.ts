export type SystemPreset = {
  label: string;
  recipe_id: string;
  params?: Record<string, unknown>;
  category: string;
};

export const SYSTEM_PRESETS: SystemPreset[] = [
  {
    label: "检查网络",
    recipe_id: "network.diagnose",
    category: "network",
  },
  {
    label: "刷新 DNS",
    recipe_id: "network.flush_dns",
    category: "network",
  },
  {
    label: "检查开发环境",
    recipe_id: "env.check_dev_tools",
    category: "env",
  },
  {
    label: "整理下载文件夹",
    recipe_id: "organize.preview",
    params: { root_path: "" },
    category: "organize",
  },
  {
    label: "整理图片（按格式）",
    recipe_id: "organize.images_preview",
    params: { root_path: "", mode: "by_format" },
    category: "organize",
  },
  {
    label: "按拍摄日期整理",
    recipe_id: "organize.images_preview",
    params: { root_path: "", mode: "by_exif_date" },
    category: "organize",
  },
  {
    label: "图片去重",
    recipe_id: "organize.dedupe_images",
    params: { root_path: "" },
    category: "organize",
  },
  {
    label: "批量压缩图片",
    recipe_id: "organize.compress_images",
    params: { root_path: "", quality: 80, max_width: 1920 },
    category: "organize",
  },
  {
    label: "图片制作视频",
    recipe_id: "organize.images_to_video",
    params: { root_path: "", duration_per_image: 3 },
    category: "organize",
  },
];
