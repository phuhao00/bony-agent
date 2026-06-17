export type CreativeAppId = "figma" | "blender" | "photoshop" | "unity" | "unreal";

export interface CreativeAppConfig {
  id: CreativeAppId;
  name: string;
  logo: string;
  categoryKey: string;
  category: string;
  agentId: string;
  docUrl: string;
  downloadUrl: string;
  accent: string;
  placeholderKey: string;
  placeholder: string;
  quickPrompts: { key: string; text: string }[];
  contextIntro: string;
}

export const CREATIVE_APP_ORDER: CreativeAppId[] = [
  "figma",
  "blender",
  "photoshop",
  "unity",
  "unreal",
];

export const CREATIVE_APP_CONFIGS: Record<CreativeAppId, CreativeAppConfig> = {
  figma: {
    id: "figma",
    name: "Figma",
    logo: "/logos/figma.svg",
    categoryKey: "design_tool",
    category: "design_tool",
    agentId: "creative_desktop_agent",
    docUrl: "https://developers.figma.com/docs/code-connect/quickstart-guide/",
    downloadUrl: "https://www.figma.com/downloads",
    accent: "#F24E1E",
    placeholderKey: "figma",
    placeholder: "例如：帮我设计一个网站首页…",
    quickPrompts: [
      { key: "designWebsite", text: "帮我设计一个网站首页" },
      { key: "createMobileApp", text: "帮我做一个 App 登录页" },
      { key: "publishCodeConnect", text: "发布当前项目的 Code Connect" },
      { key: "exportAssets", text: "导出所有图片资源为 PNG" },
      { key: "renameLayers", text: "按规则重命名图层" },
      { key: "createDesignSystem", text: "创建一套基础设计系统" },
    ],
    contextIntro: `你是 Figma 智能助手。你的第一原则是：用户一句话，你就开始执行；不要抛出技术概念让小白做判断。

## 执行原则
1. 先启动 Figma 桌面端（launch_app Figma）。如果已经打开，直接继续。
2. 优先用 GUI 自动化完成视觉设计任务（新建文件、创建 Frame、插入图形/文本、排版）。
3. 只有用户明确提到「Code Connect」「代码映射」「发布组件」时才走 CLI。
4. 缺省信息一律使用合理默认值，不要反问用户。例如：
   - 没指定画布尺寸 → 用 Desktop 1440×900
   - 没指定文件名称 → 用「未命名设计」或根据任务命名，如「网站首页」
   - 没指定颜色风格 → 用简洁白底黑字 + 品牌色点缀
5. 最多只问 1 个关键问题，且只有在没有该信息就无法继续时才问。否则先执行，执行中再确认。
6. 每完成一个可见步骤，向用户简要汇报当前状态和下一步。

## 视觉设计任务的标准流程
当用户说「设计一个网站/App/页面/组件」时：
1. 启动 Figma。
2. 新建文件（Cmd/Ctrl + N 或菜单）。
3. 在 Figma 中打开 AI Media Agent Figma Bridge 插件（Development → Import plugin from manifest → web/figma-plugin/build/manifest.json）。
4. 命名文件为与任务相关的名字，例如「网站首页」。
5. 优先通过插件桥接直接创建图层：Frame、Rectangle、Text、Auto Layout。
6. 插件未连接时，再 fallback 到 GUI 自动化或手动步骤。
7. 保存并提示用户下一步可以调整的细节。

## Code Connect CLI（仅用于设计系统代码映射）
如果用户明确要求发布/取消发布/解析 Code Connect：
- 安装：npm install -g @figma/code-connect@latest
- 发布：npx figma connect publish --token=$FIGMA_ACCESS_TOKEN [--config=figma.config.json] [--dir=./src] [--label=React]
- 取消发布：npx figma connect unpublish --node=NODE_URL --label=LABEL
- 解析/预览/迁移/创建：npx figma connect parse|preview|migrate|create
- Token 优先从 FIGMA_ACCESS_TOKEN 环境变量读取；如未设置，先尝试读取 ~/.figma/token 等常见位置，最后再问一次。

## 环境检查（内部执行，不向用户展示细节）
- 检查 Figma 是否已安装。
- 检查当前工作目录是否包含 figma.config.json（用于 Code Connect）。
- 检查 FIGMA_ACCESS_TOKEN 环境变量。
- 所有路径必须在 My Computer 登记的允许目录内。`,
  },
  blender: {
    id: "blender",
    name: "Blender",
    logo: "/logos/blender.svg",
    categoryKey: "3d_dcc",
    category: "3d_dcc",
    agentId: "desktop_operator_agent",
    docUrl: "https://docs.blender.org/api/current/",
    downloadUrl: "https://www.blender.org/download/",
    accent: "#E87D0D",
    placeholderKey: "blender",
    placeholder: "例如：批量渲染 outputs 目录下的 .blend 文件…",
    quickPrompts: [
      { key: "batchRender", text: "批量渲染当前目录的 .blend 文件" },
      { key: "exportFbx", text: "导出选中模型为 FBX" },
      { key: "createMaterial", text: "创建 PBR 材质并应用" },
      { key: "pythonScript", text: "写一个 Blender Python 脚本" },
    ],
    contextIntro:
      "你正在使用 Blender（3D 数字内容创作软件）。请优先通过 Python API 或命令行无头模式帮助用户完成建模、渲染与批量处理任务。",
  },
  photoshop: {
    id: "photoshop",
    name: "Photoshop",
    logo: "/logos/photoshop.svg",
    categoryKey: "2d_dcc",
    category: "2d_dcc",
    agentId: "desktop_operator_agent",
    docUrl: "https://developer.adobe.com/photoshop/uxp/2022/",
    downloadUrl: "https://www.adobe.com/products/photoshop.html",
    accent: "#31A8FF",
    placeholderKey: "photoshop",
    placeholder: "例如：批量将 PSD 图层导出为 PNG…",
    quickPrompts: [
      { key: "exportLayers", text: "批量导出 PSD 图层为 PNG" },
      { key: "resizeBatch", text: "批量调整图片尺寸" },
      { key: "applyAction", text: "对文件夹应用默认动作" },
      { key: "uxpScript", text: "写一个 Photoshop UXP 脚本" },
    ],
    contextIntro:
      "你正在使用 Photoshop（2D 数字内容创作软件）。请优先通过 UXP JavaScript、ExtendScript 或批处理帮助用户完成图像编辑与自动化任务。",
  },
  unity: {
    id: "unity",
    name: "Unity",
    logo: "/logos/unity.svg",
    categoryKey: "game_engine",
    category: "game_engine",
    agentId: "desktop_operator_agent",
    docUrl: "https://docs.unity3d.com/Manual/CommandLineArguments.html",
    downloadUrl: "https://unity.com/download",
    accent: "#FFFFFF",
    placeholderKey: "unity",
    placeholder: "例如：以批处理模式打开项目并执行 Build…",
    quickPrompts: [
      { key: "headlessBuild", text: "命令行执行项目 Build" },
      { key: "importAssets", text: "批量导入指定目录资源" },
      { key: "runTests", text: "运行 PlayMode 测试" },
      { key: "editorScript", text: "写一个 Editor 工具脚本" },
    ],
    contextIntro:
      "你正在使用 Unity（游戏引擎）。请优先通过 Editor 脚本、命令行批处理模式或 executeMethod 帮助用户完成项目构建与资源处理任务。",
  },
  unreal: {
    id: "unreal",
    name: "Unreal Engine",
    logo: "/logos/unreal.svg",
    categoryKey: "game_engine",
    category: "game_engine",
    agentId: "desktop_operator_agent",
    docUrl: "https://docs.unrealengine.com/5.0/en-US/PythonScripting/",
    downloadUrl: "https://www.unrealengine.com/en-US/download",
    accent: "#FFFFFF",
    placeholderKey: "unreal",
    placeholder: "例如：用 Python 批量导入 FBX 到 Content 目录…",
    quickPrompts: [
      { key: "importFbx", text: "批量导入 FBX 到 Content" },
      { key: "buildLighting", text: "构建指定关卡的灯光" },
      { key: "cookProject", text: "Cook 项目资源" },
      { key: "pythonScript", text: "写一个 Unreal Python 脚本" },
    ],
    contextIntro:
      "你正在使用 Unreal Engine（游戏引擎）。请优先通过 Python 脚本、Editor Utility 或命令行无头模式帮助用户完成关卡、资源与渲染任务。",
  },
};

export function getCreativeAppConfig(appId: string): CreativeAppConfig | undefined {
  return CREATIVE_APP_CONFIGS[appId as CreativeAppId];
}

export function isCreativeAppId(appId: string): appId is CreativeAppId {
  return CREATIVE_APP_ORDER.includes(appId as CreativeAppId);
}
