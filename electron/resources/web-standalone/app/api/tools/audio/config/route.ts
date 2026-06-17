import { NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function GET() {
  try {
    const response = await fetch(`${BACKEND_URL}/tools/audio/config`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Backend error: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Audio config error:", error);
    // 返回默认配置
    return NextResponse.json({
      voices: [
        {
          id: "zh-CN-XiaoxiaoNeural",
          name: "晓晓",
          gender: "女",
          description: "温柔亲切",
        },
        {
          id: "zh-CN-YunxiNeural",
          name: "云希",
          gender: "男",
          description: "年轻活力",
        },
        {
          id: "zh-CN-YunjianNeural",
          name: "云健",
          gender: "男",
          description: "沉稳大气",
        },
        {
          id: "zh-CN-XiaoyiNeural",
          name: "晓伊",
          gender: "女",
          description: "知性优雅",
        },
        {
          id: "zh-CN-YunyangNeural",
          name: "云扬",
          gender: "男",
          description: "新闻播报",
        },
        {
          id: "zh-CN-XiaochenNeural",
          name: "晓辰",
          gender: "女",
          description: "甜美可爱",
        },
      ],
      styles: [
        {
          id: "informative",
          name: "专业解说",
          description: "适合知识科普、产品介绍",
        },
        {
          id: "emotional",
          name: "感性叙述",
          description: "适合故事讲述、情感表达",
        },
        {
          id: "energetic",
          name: "活力激情",
          description: "适合运动、活动类内容",
        },
        { id: "poetic", name: "诗意优雅", description: "适合风景、艺术类内容" },
      ],
      bgm_list: [
        {
          id: "gentle",
          name: "轻柔舒缓",
          path: "",
          description: "适合温馨、治愈类内容",
        },
        {
          id: "epic",
          name: "史诗壮阔",
          path: "",
          description: "适合震撼、大气类内容",
        },
        {
          id: "upbeat",
          name: "欢快活泼",
          path: "",
          description: "适合活力、运动类内容",
        },
        {
          id: "emotional",
          name: "感人深情",
          path: "",
          description: "适合情感、回忆类内容",
        },
        {
          id: "tech",
          name: "科技未来",
          path: "",
          description: "适合科技、创新类内容",
        },
      ],
      subtitle_styles: [
        { id: "default", name: "默认样式", fontsize: 24, fontcolor: "white" },
        { id: "modern", name: "现代简约", fontsize: 28, fontcolor: "white" },
        { id: "cinematic", name: "电影字幕", fontsize: 32, fontcolor: "white" },
        { id: "vibrant", name: "活力彩色", fontsize: 26, fontcolor: "yellow" },
        { id: "minimal", name: "极简风格", fontsize: 22, fontcolor: "white" },
      ],
    });
  }
}
