import { NextRequest, NextResponse } from "next/server";

// 直接使用智谱 AI API
const ZHIPU_API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions";

export interface StoryboardScript {
  title: string;
  theme: string;
  frames: {
    id: string;
    prompt: string;
    description: string;
    duration: number;
  }[];
}

/**
 * 使用智谱 AI 直接生成故事板脚本
 * 输入一个主题，AI 会生成多个分镜画面的描述
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { topic, frameCount = 4, style = "电影感" } = body;

    if (!topic) {
      return NextResponse.json({ error: "缺少主题描述" }, { status: 400 });
    }

    // 获取 API Key (优先从环境变量获取)
    const apiKey = process.env.ZHIPUAI_API_KEY;

    if (!apiKey) {
      // 如果没有 API Key，生成默认分镜
      return NextResponse.json({
        script: generateDefaultScript(topic, frameCount, style),
        message: "使用默认模板（未配置 API Key）",
      });
    }

    // 构建提示词
    const systemPrompt = `你是一个专业的视频分镜脚本设计师。请根据用户的主题，生成一个完整的故事板分镜脚本。


⚠️ 核心要求（必须严格遵守）：
1. 将主题发展成一个有起承转合的故事，每帧对应故事弧中一个【完全不同的叙事节拍】：
   - 帧1（铺垫）：纯环境空景，无主角，建立时间/地点/氛围
   - 帧2（引入）：主角或核心主体出现，有具体的动作和位置
   - 帧3（发展）：故事推进，出现新的人物/物体/事件，与帧2主体明显不同
   - 帧4（高潮/结局）：情感或视觉的最强时刻，构图与前三帧截然不同
   （帧数更多时依此规律扩展）
2. 【严禁】所有帧描述相同的视觉主体，仅用"特写/全景"等镜头词区分——这会导致图像全部相同
3. 每帧的 prompt 必须忠实还原对应 description，描述同一个画面，不得另起炉灶
4. 视觉风格：${style}

严格按以下 JSON 格式返回，不要包含 Markdown 代码块：
{
  "title": "视频整体标题",
  "theme": "${style}",
  "frames": [
    {
      "id": "frame_1",
      "description": "傍晚的空旷码头，无人，橙红夕阳倒映在平静海面，渔船轻轻摇晃",
      "prompt": "Empty harbor dock at dusk, no people, orange-red sunset reflecting on calm sea, fishing boats gently rocking, wide establishing shot, warm golden light, ${style} style, high quality, 8k",
      "duration": 3
    },
    {
      "id": "frame_2",
      "description": "一个少年站在码头边缘背对镜头，凝视远方海平线，身影被夕阳拉出长影",
      "prompt": "A teenage boy standing at the edge of the dock, back to camera, gazing at the distant horizon, long shadow cast by setting sun, silhouette medium shot, ${style} style, high quality",
      "duration": 3
    }
  ]
}`;

    const userPrompt = `请围绕以下主题创作一个完整故事，拆解为 ${frameCount} 个分镜画面，每帧对应故事弧中不同的叙事节拍，风格为 ${style}。

主题：${topic}

强调：每帧的画面主体、动作、场景必须明显不同，不能只靠镜头语言词汇区分。`;

    // 调用智谱 AI
    const response = await fetch(ZHIPU_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "glm-4-plus",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("ZhipuAI API error:", errorText);
      // 返回默认分镜
      return NextResponse.json({
        script: generateDefaultScript(topic, frameCount, style),
        message: "AI 服务暂时不可用，使用默认模板",
      });
    }

    const data = await response.json();
    const aiContent = data.choices?.[0]?.message?.content || "";

    // 尝试解析 JSON
    let script: StoryboardScript | null = null;
    try {
      // 尝试提取 JSON 部分
      const jsonMatch = aiContent.match(/\{[\s\S]*"frames"[\s\S]*\}/);
      if (jsonMatch) {
        script = JSON.parse(jsonMatch[0]);
        // 验证并修复 frames
        if (script && script.frames) {
          script.frames = script.frames.map(
            (frame: StoryboardScript["frames"][0], index: number) => {
              const desc = frame.description || `场景 ${index + 1}`;
              // prompt 必须基于 description 生成，避免二者内容不一致
              const prompt =
                frame.prompt ||
                `${desc}, ${style} style, high quality, cinematic, 8k resolution`;
              return {
                id: frame.id || `frame_${index + 1}`,
                prompt,
                description: desc,
                duration: frame.duration || 3,
              };
            },
          );
        }
      }
    } catch (parseError) {
      console.error("Failed to parse AI response:", parseError);
    }

    // 如果解析失败，生成默认分镜
    if (!script || !script.frames || script.frames.length === 0) {
      script = generateDefaultScript(topic, frameCount, style);
    }

    return NextResponse.json({
      script,
      rawResult: aiContent,
    });
  } catch (error: any) {
    console.error("Storyboard script generation error:", error);
    const {
      topic,
      frameCount = 4,
      style = "电影感",
    } = await req
      .clone()
      .json()
      .catch(() => ({}));
    return NextResponse.json({
      script: generateDefaultScript(topic || "默认主题", frameCount, style),
      error: error.message,
      message: "生成过程出错，使用默认模板",
    });
  }
}

/**
 * 生成默认的故事板分镜
 */
function generateDefaultScript(
  topic: string,
  frameCount: number,
  style: string,
): StoryboardScript {
  const stylePrompts: Record<string, string> = {
    电影感: "cinematic lighting, dramatic composition, film grain, movie still",
    动漫风格:
      "anime style, vibrant colors, detailed illustration, Japanese animation",
    水彩画风: "watercolor painting, soft colors, artistic brushstrokes, dreamy",
    "3D渲染":
      "3D rendered, octane render, realistic lighting, detailed textures",
    写实摄影:
      "professional photography, natural lighting, DSLR, high resolution",
    复古胶片: "vintage film, retro colors, 35mm photography, nostalgic mood",
    赛博朋克: "cyberpunk style, neon lights, futuristic city, dark atmosphere",
    极简风格: "minimalist design, clean composition, simple colors, modern",
  };

  const styleKeywords = stylePrompts[style] || stylePrompts["电影感"];

  // 叙事节拍模板：每帧对应故事弧中不同的时刻，主体和场景各不相同
  const narrativeBeats = [
    {
      // 节拍1：环境空景，建立世界观，无主角
      getDesc: (t: string) =>
        `以「${t}」为背景的空旷场景，无人，环境建立开场氛围与时间地点`,
      getPrompt: (t: string, kw: string) =>
        `Empty environment establishing the world of "${t}", no people, wide angle, rich atmospheric details, ${kw}, high quality, 8k`,
    },
    {
      // 节拍2：主角/主体登场，有具体动作
      getDesc: (t: string) =>
        `故事主角在「${t}」的情境中登场，有明确的动作与情绪表达`,
      getPrompt: (t: string, kw: string) =>
        `Main character appears in a scene inspired by "${t}", engaged in a specific action, clear emotion, medium shot, ${kw}, cinematic, high quality`,
    },
    {
      // 节拍3：故事推进，出现新元素或转折
      getDesc: (t: string) =>
        `「${t}」故事的发展转折时刻，出现新的冲突或关键事件，场景与人物状态明显改变`,
      getPrompt: (t: string, kw: string) =>
        `Story turning point related to "${t}", new conflict or key event unfolds, changed scene and character state, dynamic composition, ${kw}, high quality`,
    },
    {
      // 节拍4：高潮/结局，情感最强时刻
      getDesc: (t: string) =>
        `「${t}」故事的高潮或结局，情感升华，画面构图与前几帧截然不同`,
      getPrompt: (t: string, kw: string) =>
        `Climax or resolution of "${t}" story, peak emotional moment, dramatically different composition, powerful visual impact, ${kw}, high quality, 8k`,
    },
    {
      // 节拍5：细节/象征物特写
      getDesc: (t: string) =>
        `「${t}」故事中最具象征意义的细节或物件特写，承载全片的情感重量`,
      getPrompt: (t: string, kw: string) =>
        `Symbolic close-up detail representing the essence of "${t}", rich texture, macro perspective, emotionally charged, ${kw}, high quality`,
    },
    {
      // 节拍6：俯瞰全局
      getDesc: (t: string) =>
        `俯瞰「${t}」的整个世界，宏观视野为故事带来新的情感层次与余韵`,
      getPrompt: (t: string, kw: string) =>
        `Aerial bird's eye view of the world of "${t}", expansive scale, contemplative mood, sweeping panorama, ${kw}, high quality, 8k`,
    },
  ];

  const frames = [];
  for (let i = 0; i < frameCount; i++) {
    const beat = narrativeBeats[i % narrativeBeats.length];
    frames.push({
      id: `frame_${i + 1}`,
      description: beat.getDesc(topic),
      prompt: beat.getPrompt(topic, styleKeywords),
      duration: 3,
    });
  }

  return {
    title: topic,
    theme: style,
    frames,
  };
}
