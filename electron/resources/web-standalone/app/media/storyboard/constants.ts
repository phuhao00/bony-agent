export const WORKFLOW_STEPS = [
    { step: "input" as const, label: "1. 输入主题", icon: "📝" },
    { step: "edit" as const, label: "2. 编辑分镜", icon: "🖼️" },
    { step: "generate" as const, label: "3. 生成视频", icon: "🎬" },
];

export const STYLE_OPTIONS = [
    "电影感",
    "动漫风格",
    "水彩画风",
    "3D渲染",
    "写实摄影",
    "复古胶片",
    "赛博朋克",
    "极简风格",
];

export const TOPIC_PRESETS = [
    { name: "🌅 日落时分", topic: "一个关于日落黄昏的唯美故事，展现光影变化和自然美景" },
    { name: "🏙️ 城市漫步", topic: "都市人的一天，从清晨到夜晚的城市风景变化" },
    { name: "🌸 四季更迭", topic: "一棵大树在春夏秋冬四个季节的变化" },
    { name: "🚀 太空探险", topic: "宇航员的太空之旅，从地球出发探索宇宙" },
    { name: "🍳 美食制作", topic: "一道美食从原材料到成品的制作过程" },
    { name: "📖 童话故事", topic: "一个神奇的童话世界冒险故事" },
];

export const FRAME_COUNT_OPTIONS = [2, 3, 4, 5, 6, 8];
