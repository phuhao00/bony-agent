import { NextRequest, NextResponse } from "next/server";

const ZHIPU_API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions";

/**
 * 根据中文场景描述生成对应的英文图片生成提示词
 * 确保 prompt 和 description 描述完全相同的画面内容
 */
export async function POST(req: NextRequest) {
  try {
    const { description } = await req.json();
    if (!description?.trim()) {
      return NextResponse.json({ error: "缺少场景描述" }, { status: 400 });
    }

    const apiKey = process.env.ZHIPUAI_API_KEY;
    if (!apiKey) {
      // 无 API Key 时做简单英文透传
      const fallback = `${description}, high quality, cinematic lighting, 8k resolution`;
      return NextResponse.json({ prompt: fallback });
    }

    const res = await fetch(ZHIPU_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "glm-4-flash",
        messages: [
          {
            role: "system",
            content:
              "你是专业的 AI 图像提示词工程师。用户会提供中文场景描述，你需要将其转换为详细的英文图像生成提示词。" +
              "要求：1) 忠实还原中文描述的画面内容，不要添加无关元素；2) 补充构图、光线、摄影机角度等细节；" +
              "3) 只输出英文提示词，不要解释，不要 Markdown。",
          },
          {
            role: "user",
            content: `中文场景描述：${description.trim()}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 300,
      }),
    });

    if (!res.ok) {
      const fallback = `${description}, high quality, cinematic lighting, 8k resolution`;
      return NextResponse.json({ prompt: fallback });
    }

    const data = await res.json();
    const prompt = (data.choices?.[0]?.message?.content || "").trim();
    if (!prompt) {
      return NextResponse.json({
        prompt: `${description}, high quality, cinematic lighting, 8k resolution`,
      });
    }

    return NextResponse.json({ prompt });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
