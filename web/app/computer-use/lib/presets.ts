export type Preset = { label: string; goal: string; quick?: boolean };

export const PRESETS: Preset[] = [
  {
    label: "查天气",
    goal: "在搜索框输入「深圳天气」并搜索，等结果出来后截图",
  },
  {
    label: "知乎热榜",
    goal: "打开知乎，找到热榜或热门内容区域并截图",
  },
  {
    label: "B 站首页",
    goal: "在哔哩哔哩首页截取一屏主要内容",
  },
  {
    label: "Google 搜索",
    goal: "在 Google 搜索「AI 最新进展」，等结果页加载后截图",
  },
  {
    label: "GitHub Trending",
    goal: "打开 GitHub Trending 页面，截取今日热门仓库列表",
  },
  {
    label: "微博热搜",
    goal: "打开微博，找到热搜榜区域并截图",
  },
];

export const QUICK_MODE_LABEL = "快速模式";
