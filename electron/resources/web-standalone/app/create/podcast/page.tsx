"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Mic2,
  Sparkles,
  ChevronLeft,
  FileText,
  Headphones,
  ImageIcon,
  Share2,
  GripVertical,
  Video,
} from "lucide-react";
import { useCanvas, type CanvasNode, type ChatMessage } from "@/hooks/useCanvas";
import { ChatPanel, type TodoInfo, type TimelineItem } from "@/app/components/canvas/ChatPanel";
import { CanvasViewport } from "@/app/components/canvas/CanvasViewport";
import { ProjectPanel } from "@/app/components/canvas/ProjectPanel";
import { CanvasWorkspace } from "@/app/components/canvas/CanvasWorkspace";
import { NodeMarkdown } from "@/app/components/canvas/NodeMarkdown";
import { useProjectAssets } from "@/hooks/useProjectAssets";
import type { Project, ProjectAsset } from "@/lib/project-store";

interface TaskResult {
  status: string;
  progress: number;
  message?: string;
  error?: string;
  result?: any;
}

const FORMAT_OPTIONS = ["双人对话", "单人独白", "访谈", "叙事"];
const TONE_OPTIONS = ["轻松", "专业", "幽默", "治愈", "犀利", "温暖"];
const DURATION_OPTIONS = [10, 15, 20, 30, 45, 60];

function classNames(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}
function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export default function PodcastCanvasPage() {
  const router = useRouter();
  const {
    CANVAS_WIDTH,
    CANVAS_HEIGHT,
    layout,
    nodes,
    setNodes,
    viewport,
    setViewport,
    selectedNodeId,
    setSelectedNodeId,
    selectedNode,
    spacePressed,
    canvasRef,
    addNode,
    updateNode,
    relayout,
    bounds,
    fitView,
    focusNode,
    onWheel,
    onMouseDown,
    onNodeMouseDown,
    resetViewport,
  } = useCanvas({ layout: "horizontal" });

  const {
    project,
    projects,
    setProject,
    createProject,
    saveProject,
    deleteProject,
    renameProject,
    getProject,
    refresh,
    uploadAsset,
    addTextAsset,
  } = useProjectAssets("podcast");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "你好，我是你的 AI 播客制作人。请告诉我这期播客的主题？例如：AI 如何改变普通人的内容创作。",
      actions: [],
    },
  ]);
  const [input, setInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [leftDrawer, setLeftDrawer] = useState<"assets" | null>(null);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [showMinimap, setShowMinimap] = useState(false);
  const [topic, setTopicState] = useState("");
  const topicRef = useRef(topic);
  const setTopic = (v: string) => {
    topicRef.current = v;
    setTopicState(v);
  };
  const [params, setParams] = useState({ format: "双人对话", tone: "轻松", duration: 15, audience: "25-35 岁内容创作者" });

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const savedId = typeof window !== "undefined" ? localStorage.getItem("ai-media-agent:last-project:podcast") : null;
      const saved = savedId ? await getProject(savedId) : null;
      if (cancelled) return;
      if (saved && saved.type === "podcast") {
        applyProject(saved);
      } else {
        const p = await createProject("podcast", "未命名播客项目");
        applyProject(p);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const applyProject = (p: Project) => {
    setProject(p);
    if (p.nodes.length) {
      setNodes(relayout(p.nodes, { flowStartX: 120, gapX: 40 }));
    }
    if (p.messages.length) setMessages(p.messages);
    if (p.brief?.topic) setTopic(p.brief.topic);
    if (p.brief) setParams({ ...params, ...p.brief });
    if (typeof window !== "undefined") localStorage.setItem("ai-media-agent:last-project:podcast", p.id);
    setTimeout(() => {
      if (p.nodes.length) {
        const laid = relayout(p.nodes, { flowStartX: 120, gapX: 40 });
        focusNode(laid[laid.length - 1], undefined, undefined, selectedNodeId ? 256 : 0);
      } else {
        fitView(undefined, undefined, 80, selectedNodeId ? 256 : 0);
      }
    }, 50);
  };

  useEffect(() => {
    if (!project) return;
    saveProject({ ...project, nodes, messages, brief: { ...params, topic } }).catch((e) => console.error("save project failed", e));
  }, [nodes, messages, params, topic, project?.id]);

  useEffect(() => {
    if (nodes.length > 0) {
      resetViewport(nodes[nodes.length - 1]);
    }
  }, [nodes.length]);

  const pollTask = useCallback((taskId: string, onComplete: (result: any) => void) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/backend/podcast/tasks/${encodeURIComponent(taskId)}`);
        const data: TaskResult = await res.json();
        if (data.status === "completed") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          onComplete(data.result);
          setChatLoading(false);
        } else if (data.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setChatLoading(false);
          pushAssistant(`生成失败：${data.error || "未知错误"}`);
        }
      } catch {
        /* keep polling */
      }
    }, 2500);
  }, []);

  // Independent single-task poller (doesn't share the global pollRef)
  const pollSingle = useCallback((taskId: string, onComplete: (result: any) => void) => {
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`/api/backend/podcast/tasks/${encodeURIComponent(taskId)}`);
        const data: TaskResult = await res.json();
        if (data.status === "completed") {
          clearInterval(iv);
          onComplete(data.result);
        } else if (data.status === "failed") {
          clearInterval(iv);
        }
      } catch { /* keep polling */ }
    }, 2500);
  }, []);

  const generateCoverImage = useCallback(async (coverData: any) => {
    const prompt = coverData.english_prompt || coverData.chinese_prompt;
    if (!prompt) return;
    updateNode("cover-1", { status: "generating" });
    try {
      const res = await fetch("/api/backend/tools/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: `podcast cover art, ${prompt}`, size: "1024x1024" }),
      });
      const data = await res.json();
      const url = data.url || data.image_url || data.data?.[0]?.url;
      if (url) {
        updateNode("cover-1", { data: { ...coverData, image_url: url }, status: "ready" });
      } else if (data.task_id) {
        pollSingle(data.task_id, (r) => {
          const imgUrl = r.url || r.image_url || r.data?.[0]?.url;
          if (imgUrl) updateNode("cover-1", { data: { ...coverData, image_url: imgUrl }, status: "ready" });
          else updateNode("cover-1", { status: "ready" });
        });
      } else {
        updateNode("cover-1", { status: "ready" });
      }
    } catch {
      updateNode("cover-1", { status: "ready" });
    }
  }, [pollSingle, updateNode]);

  const generateVoicePreview = useCallback(async (voiceData: any, scriptText: string) => {
    updateNode("voiceover-1", { status: "generating" });
    const preview = (voiceData.segments || []).slice(0, 3).map((s: any) => s.text).join(" ") || scriptText.slice(0, 400);
    if (!preview) { updateNode("voiceover-1", { status: "ready" }); return; }
    try {
      const res = await fetch("/api/backend/tools/audio/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: preview, voice: "default" }),
      });
      const data = await res.json();
      const url = data.url || data.audio_url || data.file_path || data.output_path;
      if (url) {
        updateNode("voiceover-1", { data: { ...voiceData, audio_url: url }, status: "ready" });
      } else if (data.task_id) {
        pollSingle(data.task_id, (r) => {
          const audioUrl = r.url || r.audio_url || r.file_path || r.output_path;
          if (audioUrl) updateNode("voiceover-1", { data: { ...voiceData, audio_url: audioUrl }, status: "ready" });
          else updateNode("voiceover-1", { status: "ready" });
        });
      } else {
        updateNode("voiceover-1", { status: "ready" });
      }
    } catch {
      updateNode("voiceover-1", { status: "ready" });
    }
  }, [pollSingle, updateNode]);

  const runRecipe = useCallback(
    async (recipeId: string, bodyParams: any, onComplete: (result: any) => void) => {
      const res = await fetch("/api/backend/podcast/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipe_id: recipeId, params: bodyParams }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setChatLoading(false);
        pushAssistant(`任务提交失败：${data.error || data.detail || "未知错误"}`);
        return;
      }
      pollTask(data.task_id, onComplete);
    },
    [pollTask]
  );

  const pushUser = (content: string) => setMessages((m) => [...m, { role: "user", content }]);
  const pushAssistant = (content: string, actions?: ChatMessage["actions"], nodeId?: string) =>
    setMessages((m) => [...m, { role: "assistant", content, actions, nodeId }]);

  const handleSend = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || chatLoading) return;
    setInput("");
    pushUser(text);
    setChatLoading(true);

    const latest = nodes[nodes.length - 1];
    const latestType = latest?.type;

    if (nodes.length === 0) {
      setTopic(text);
      const briefNode: CanvasNode = {
        id: "brief-1",
        type: "brief",
        title: "主题",
        x: 0,
        y: 0,
        width: 360,
        height: 220,
        status: "approved",
        data: { text, ...params },
      };
      addNode(briefNode);
      pushAssistant("收到主题！我先为你策划一期节目大纲。", [], "plan-1");

      await runRecipe("podcast.plan", { ...params, topic: text }, (result) => {
        const planNode: CanvasNode = {
          id: "plan-1",
          type: "plan",
          title: "策划",
          x: 0,
          y: 0,
          width: 420,
          height: 360,
          status: "ready",
          data: result.plan || {},
        };
        setNodes((ns) => relayout([...ns, planNode], { flowStartX: 120, gapX: 40 }));
        setTimeout(() => fitView(undefined, undefined, 80, selectedNodeId ? 256 : 0), 50);
        const title = result.plan?.title || "未命名播客";
        pushAssistant(
          `节目《${title}》策划完成。你可以在画布上编辑定位、结构和话题。满意后点「生成脚本」。`,
          [{ id: "continue-to-script", label: "生成脚本", variant: "primary" }, { id: "regen-plan", label: "重新策划", variant: "secondary" }],
          "plan-1"
        );
      });
      return;
    }

    if (latestType === "brief" || latestType === "plan") {
      pushAssistant("我会根据你的反馈调整策划。", [], "plan-1");
      await runRecipe("podcast.plan", { ...params, topic: topicRef.current, feedback: text }, (result) => {
        updateNode("plan-1", { data: result.plan || {}, status: "ready" });
        pushAssistant("策划已更新。确认后生成脚本。", [
          { id: "continue-to-script", label: "生成脚本", variant: "primary" },
          { id: "regen-plan", label: "重新策划", variant: "secondary" },
        ]);
      });
      return;
    }

    if (latestType === "script") {
      pushAssistant("我会根据你的反馈调整脚本。", [], "script-1");
      await runRecipe("podcast.script", { ...params, topic: topicRef.current, feedback: text }, (result) => {
        updateNode("script-1", { data: result.script || {}, status: "ready" });
        pushAssistant("脚本已更新。满意后可以继续生成封面与发布文案。", [
          { id: "continue-to-publish", label: "生成封面与发布", variant: "primary" },
          { id: "regen-script", label: "重新生成脚本", variant: "secondary" },
        ]);
      });
      return;
    }

    if (latestType === "publish" || latestType === "cover" || latestType === "voiceover") {
      pushAssistant("我会根据你的反馈调整发布文案。", [], "publish-1");
      await generatePublish(text);
      return;
    }

    pushAssistant("你可以说「生成脚本」「重新策划」「生成发布文案」等。");
    setChatLoading(false);
  };

  const generateScript = async () => {
    updateNode("plan-1", { status: "approved" });
    pushAssistant("正在根据策划生成完整脚本...", [], "script-1");
    await runRecipe("podcast.script", { ...params, topic: topicRef.current }, (result) => {
      const scriptNode: CanvasNode = {
        id: "script-1",
        type: "script",
        title: "脚本",
        x: 0,
        y: 0,
        width: 440,
        height: 380,
        status: "ready",
        data: result.script || {},
      };
      setNodes((ns) => relayout([...ns.filter((n) => n.type !== "script" && n.type !== "cover" && n.type !== "voiceover" && n.type !== "publish"), scriptNode], { flowStartX: 120, gapX: 40 }));
      setTimeout(() => fitView(undefined, undefined, 80, selectedNodeId ? 256 : 0), 50);
      pushAssistant(
        "脚本已生成。你可以逐段编辑时间轴内容。满意后点「生成封面与发布」。",
        [
          { id: "continue-to-publish", label: "生成封面与发布", variant: "primary" },
          { id: "regen-script", label: "重新生成脚本", variant: "secondary" },
        ],
        "script-1"
      );
    });
  };

  const generatePublish = async (feedback?: string) => {
    updateNode("script-1", { status: "approved" });
    pushAssistant("正在生成封面设计与发布文案...", [], "publish-1");
    const title = nodes.find((n) => n.type === "script")?.data?.title || topicRef.current;
    const scriptText = (nodes.find((n) => n.type === "script")?.data?.segments || []).map((s: any) => s.content).join("\n\n");

    try {
      const [coverRes, voiceRes, publishRes] = await Promise.all([
        fetch("/api/backend/podcast/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipe_id: "podcast.cover", params: { title, topic: topicRef.current, style: "现代简约" } }),
        }),
        fetch("/api/backend/podcast/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipe_id: "podcast.voiceover", params: { script: scriptText, voice: "default", bgm_mood: params.tone } }),
        }),
        fetch("/api/backend/podcast/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipe_id: "podcast.publish", params: { title, script: scriptText, platform: "xiaoyuzhou", feedback } }),
        }),
      ]);

      const coverData = await coverRes.json();
      const voiceData = await voiceRes.json();
      const publishData = await publishRes.json();

      const coverNode: CanvasNode = {
        id: "cover-1",
        type: "cover",
        title: "封面",
        x: 0,
        y: 0,
        width: 280,
        height: 340,
        status: "ready",
        data: coverData.result?.cover || {},
      };
      const voiceNode: CanvasNode = {
        id: "voiceover-1",
        type: "voiceover",
        title: "配音",
        x: 0,
        y: 0,
        width: 280,
        height: 300,
        status: "ready",
        data: voiceData.result || {},
      };
      const publishNode: CanvasNode = {
        id: "publish-1",
        type: "publish",
        title: "发布文案",
        x: 0,
        y: 0,
        width: 440,
        height: 360,
        status: "ready",
        data: publishData.result?.publish || {},
      };
      setNodes((ns) => relayout([...ns.filter((n) => n.type !== "cover" && n.type !== "voiceover" && n.type !== "publish" && n.type !== "video"), coverNode, voiceNode, publishNode], { flowStartX: 120, gapX: 40 }));
      setTimeout(() => fitView(undefined, undefined, 80, selectedNodeId ? 256 : 0), 50);

      // Chain: cover recipe → image generation
      const onCoverRecipeDone = (r: any) => {
        updateNode("cover-1", { data: r.cover || {} });
        generateCoverImage(r.cover || {});
      };
      if (coverData.task_id) pollSingle(coverData.task_id, onCoverRecipeDone);
      else generateCoverImage(coverData.result?.cover || {});

      // Chain: voiceover recipe → TTS
      const onVoiceRecipeDone = (r: any) => {
        updateNode("voiceover-1", { data: r });
        generateVoicePreview(r, scriptText);
      };
      if (voiceData.task_id) pollSingle(voiceData.task_id, onVoiceRecipeDone);
      else generateVoicePreview(voiceData.result || {}, scriptText);

      if (publishData.task_id) pollSingle(publishData.task_id, (r) => updateNode("publish-1", { data: r.publish || {} }));

      pushAssistant(
        "封面图片、配音语音与发布文案正在生成，稍后即可在画布上看到结果。满意后可以合成播客视频。",
        [{ id: "generate-video", label: "合成播客视频", variant: "primary" }, { id: "export", label: "直接导出", variant: "secondary" }],
        "publish-1"
      );
      setChatLoading(false);
    } catch (err) {
      pushAssistant(`生成失败：${String(err)}`);
      setChatLoading(false);
    }
  };

  const generateVideo = useCallback(async () => {
    const coverNode = nodes.find((n) => n.type === "cover");
    const voiceNode = nodes.find((n) => n.type === "voiceover");
    const scriptTitle = nodes.find((n) => n.type === "script")?.data?.title || topicRef.current;

    const videoNode: CanvasNode = {
      id: "video-1",
      type: "video",
      title: "播客视频",
      x: 0,
      y: 0,
      width: 440,
      height: 320,
      status: "generating",
      data: { title: scriptTitle },
    };
    setNodes((ns) => relayout([...ns.filter((n) => n.type !== "video"), videoNode], { flowStartX: 120, gapX: 40 }));
    setTimeout(() => fitView(undefined, undefined, 80, selectedNodeId ? 256 : 0), 50);
    pushAssistant("正在合成播客视频，通常需要 1-3 分钟...", [], "video-1");

    try {
      const res = await fetch("/api/backend/tools/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "image_to_video",
          image_url: coverNode?.data?.image_url,
          audio_url: voiceNode?.data?.audio_url,
          title: scriptTitle,
          duration: params.duration,
        }),
      });
      const data = await res.json();
      const url = data.url || data.video_url || data.output_path;
      if (url) {
        updateNode("video-1", { data: { video_url: url, title: scriptTitle }, status: "ready" });
        pushAssistant("播客视频已生成！", [{ id: "export", label: "导出发布包", variant: "primary" }], "video-1");
      } else if (data.task_id) {
        pollSingle(data.task_id, (r) => {
          const videoUrl = r.url || r.video_url || r.output_path;
          if (videoUrl) {
            updateNode("video-1", { data: { video_url: videoUrl, title: scriptTitle }, status: "ready" });
            pushAssistant("播客视频已生成！", [{ id: "export", label: "导出发布包", variant: "primary" }], "video-1");
          } else {
            updateNode("video-1", { data: { error: "视频生成返回数据异常" }, status: "ready" });
          }
        });
      } else {
        updateNode("video-1", { data: { error: data.error || data.detail || "暂不支持，请检查 video API 配置" }, status: "ready" });
        pushAssistant("视频合成暂未完成，请检查后端视频 API 配置。");
      }
    } catch (err) {
      updateNode("video-1", { data: { error: String(err) }, status: "ready" });
      pushAssistant(`视频生成失败：${String(err)}`);
    }
    setChatLoading(false);
  }, [nodes, params, pollSingle, updateNode, setNodes, relayout, fitView, selectedNodeId, topicRef, pushAssistant]);

  const handleAction = async (actionId: string, nodeId?: string) => {
    setChatLoading(true);
    if (actionId === "continue-to-script" || actionId === "regen-plan") {
      if (actionId === "continue-to-script") await generateScript();
      else {
        pushAssistant("好的，重新策划。");
        setInput("重新策划一版");
        setTimeout(() => document.getElementById("send-btn")?.click(), 10);
      }
      return;
    }
    if (actionId === "continue-to-publish" || actionId === "regen-script") {
      if (actionId === "continue-to-publish") await generatePublish();
      else {
        pushAssistant("好的，重新生成脚本。");
        setInput("重新生成脚本");
        setTimeout(() => document.getElementById("send-btn")?.click(), 10);
      }
      return;
    }
    if (actionId === "generate-video") {
      await generateVideo();
      return;
    }
    if (actionId === "export") {
      pushAssistant("导出功能已触发（后续可接入封面下载与文案复制）。", [], "publish-1");
    }
    setChatLoading(false);
  };

  const onNodeDrop = (e: React.DragEvent, node: CanvasNode) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const asset: ProjectAsset = JSON.parse(e.dataTransfer.getData("application/json"));
      if (node.type === "cover" && asset.type === "image") {
        updateNode(node.id, { data: { ...node.data, image_url: asset.url, image_path: asset.path } });
      }
      if (node.type === "voiceover" && asset.type === "audio") {
        updateNode(node.id, { data: { ...node.data, sample_audio: asset.url } });
      }
    } catch {
      /* ignore */
    }
  };

  const renderNode = (node: CanvasNode) => (
    <div onDrop={(e) => onNodeDrop(e, node)} onDragOver={(e) => e.preventDefault()}>
      <NodeHeader node={node} />
      <div className="p-4">
        <NodeMarkdown node={node} topic={topic} params={params} />
      </div>
    </div>
  );


  const handleTidy = () => {
    setNodes((ns) => relayout([...ns], { flowStartX: 120, gapX: 40 }));
    setTimeout(() => fitView(undefined, undefined, 80, selectedNodeId ? 256 : 0), 50);
  };

  const handleNewChat = async () => {
    const p = await createProject("podcast", "未命名播客项目");
    setNodes([]);
    setTopic("");
    setParams({ format: "双人对话", tone: "轻松", duration: 15, audience: "25-35 岁内容创作者" });
    setInput("");
    applyProject(p);
    setMessages([
      {
        role: "assistant",
        content: "你好，我是你的 AI 播客制作人。请告诉我这期播客的主题？例如：AI 如何改变普通人的内容创作。",
        actions: [],
      },
    ]);
  };

  const handleSkillSelect = (id: string) => {
    const prompts: Record<string, string> = {
      "animal-podcast": "制作一期动物主题的播客",
      "audiobook": "把一期内容做成有声书风格",
      "short-drama": "帮我写一集短剧播客",
    };
    handleSend(prompts[id] || `开始一个 ${id} 项目`);
  };

  const projectPath = project?.name ? `/${project.name}` : "/podcast";

  const todo: TodoInfo = {
    done: [
      nodes.some((n) => n.type === "plan"),
      nodes.some((n) => n.type === "script"),
      nodes.some((n) => n.type === "cover"),
      nodes.some((n) => n.type === "voiceover"),
      nodes.some((n) => n.type === "publish"),
      nodes.some((n) => n.type === "video"),
    ].filter(Boolean).length,
    total: 6,
    items: [
      { label: "节目策划", done: nodes.some((n) => n.type === "plan") },
      { label: "脚本生成", done: nodes.some((n) => n.type === "script") },
      { label: "封面图片", done: nodes.some((n) => n.type === "cover" && !!n.data?.image_url) },
      { label: "配音语音", done: nodes.some((n) => n.type === "voiceover" && !!n.data?.audio_url) },
      { label: "发布文案", done: nodes.some((n) => n.type === "publish") },
      { label: "播客视频", done: nodes.some((n) => n.type === "video" && !!n.data?.video_url) },
    ],
  };

  const timeline: TimelineItem[] =
    messages.length > 1
      ? [{ id: "updated", text: `已更新画布 ${Math.max(1, messages.length - 1)} 次` }]
      : [];

  return (
    <CanvasWorkspace
      projectPath={projectPath}
      projectName={project?.name}
      projectAvatar={<div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white text-xs font-bold">P</div>}
      activeTool={activeTool}
      onToolChange={(tool) => {
        if (tool === "files") {
          const next = leftDrawer === "assets" ? null : "assets";
          setLeftDrawer(next);
          setActiveTool(next ? "files" : null);
        } else {
          setActiveTool(tool);
          if (tool === "home") router.push("/workbench");
        }
      }}
      viewport={viewport}
      setViewport={setViewport}
      resetViewport={resetViewport}
      nodes={nodes}
      bounds={bounds}
      layout={layout}
      showMinimap={showMinimap}
      onToggleMinimap={() => setShowMinimap((s) => !s)}
      onTidy={handleTidy}
      onFitView={() => fitView(undefined, undefined, 80, selectedNodeId ? 256 : 0)}
      onFocusNode={(node) => focusNode(node, undefined, undefined, selectedNodeId ? 256 : 0)}
      drawer={
        leftDrawer === "assets" ? (
          <ProjectPanel
            project={project}
            projects={projects}
            onChangeProject={applyProject}
            type="podcast"
            typeLabel="播客"
            createProject={createProject}
            saveProject={saveProject}
            deleteProject={deleteProject}
            renameProject={renameProject}
            getProject={getProject}
            uploadAsset={uploadAsset}
            addTextAsset={addTextAsset}
            refresh={refresh}
          />
        ) : undefined
      }
      rightPanel={
        <ChatPanel
          projectPath={projectPath}
          projectName={project?.name}
          todo={todo}
          timeline={timeline}
          messages={messages}
          input={input}
          setInput={setInput}
          loading={chatLoading}
          onSend={handleSend}
          onAction={handleAction}
          onNewChat={handleNewChat}
          onRenameProject={async (name) => {
            if (!project) return;
            await renameProject(project.id, name);
            refresh();
          }}
          params={params}
          onParamsChange={setParams}
          formatOptions={FORMAT_OPTIONS}
          toneOptions={TONE_OPTIONS}
          durationOptions={DURATION_OPTIONS}
          onSkillSelect={handleSkillSelect}
          defaultSkill="AI 播客"
        />
      }
    >
      <CanvasViewport
        canvasRef={canvasRef}
        viewport={viewport}
        nodes={nodes}
        selectedNodeId={selectedNodeId}
        CANVAS_WIDTH={CANVAS_WIDTH}
        CANVAS_HEIGHT={CANVAS_HEIGHT}
        layout={layout}
        spacePressed={spacePressed}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onNodeMouseDown={onNodeMouseDown}
        renderNode={renderNode}
      />

    </CanvasWorkspace>
  );
}

function NodeHeader({ node }: { node: CanvasNode }) {
  const icons: Record<string, React.ReactNode> = {
    brief: <Sparkles className="w-4 h-4 text-[color:var(--accent)]" />,
    plan: <Headphones className="w-4 h-4 text-[color:var(--accent)]" />,
    script: <FileText className="w-4 h-4 text-[color:var(--accent)]" />,
    cover: <ImageIcon className="w-4 h-4 text-[color:var(--accent)]" />,
    voiceover: <Mic2 className="w-4 h-4 text-[color:var(--accent)]" />,
    publish: <Share2 className="w-4 h-4 text-[color:var(--accent)]" />,
    video: <Video className="w-4 h-4 text-[color:var(--accent)]" />,
  };
  const statusColor =
    node.status === "approved" ? "bg-green-500" : node.status === "ready" ? "bg-[color:var(--accent)]" : node.status === "generating" ? "bg-amber-400" : "bg-[var(--border-subtle)]";
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-subtle)] cursor-grab active:cursor-grabbing">
      <GripVertical className="w-3 h-3 text-[color:var(--label-secondary)]" />
      {icons[node.type]}
      <span className="text-sm font-medium flex-1 truncate">{node.title}</span>
      <span className={classNames("w-2 h-2 rounded-full", statusColor)} />
    </div>
  );
}

function BriefNodeContent({ text, params }: { text: string; params: any }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-[color:var(--label-secondary)]">播客主题</p>
      <textarea value={text} readOnly rows={4} className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--input-bg)] text-sm resize-none" />
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="px-2 py-1 rounded-md bg-[var(--nav-active-fill)]">{params.format}</span>
        <span className="px-2 py-1 rounded-md bg-[var(--nav-active-fill)]">{params.tone}</span>
        <span className="px-2 py-1 rounded-md bg-[var(--nav-active-fill)]">{params.duration} min</span>
      </div>
    </div>
  );
}

function PlanNodeContent({ data, onChange }: { data: any; onChange: (d: any) => void }) {
  const plan = data || {};
  return (
    <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
      <input value={plan.title || ""} onChange={(e) => onChange({ ...plan, title: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--input-bg)] text-sm font-medium" />
      <textarea value={plan.positioning || ""} onChange={(e) => onChange({ ...plan, positioning: e.target.value })} rows={3} className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--input-bg)] text-sm resize-none" placeholder="节目定位" />
      <div>
        <p className="text-xs text-[color:var(--label-secondary)] mb-1">节目结构</p>
        <div className="space-y-1">
          {(plan.structure || []).map((seg: any, idx: number) => (
            <div key={idx} className="flex items-center gap-2 p-2 rounded-lg bg-[var(--nav-active-fill)] text-xs">
              <span className="font-medium">{seg.segment}</span>
              <span className="text-[color:var(--label-secondary)]">{seg.duration_min}min</span>
              <input
                value={seg.content || ""}
                onChange={(e) => {
                  const st = [...plan.structure];
                  st[idx] = { ...st[idx], content: e.target.value };
                  onChange({ ...plan, structure: st });
                }}
                className="flex-1 bg-transparent outline-none"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ScriptNodeContent({ data, onChange }: { data: any; onChange: (d: any) => void }) {
  const script = data || {};
  return (
    <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
      <input value={script.title || ""} onChange={(e) => onChange({ ...script, title: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--input-bg)] text-sm font-medium" />
      <div className="space-y-2">
        {(script.segments || []).map((seg: any, idx: number) => (
          <div key={idx} className="rounded-lg border border-[var(--border-subtle)] p-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="px-1.5 py-0.5 rounded bg-[var(--nav-active-fill)] text-[10px]">{seg.time}</span>
              <span className="text-[10px] text-[color:var(--label-secondary)]">{seg.type}</span>
            </div>
            <textarea
              value={seg.content || ""}
              onChange={(e) => {
                const segs = [...script.segments];
                segs[idx] = { ...segs[idx], content: e.target.value };
                onChange({ ...script, segments: segs });
              }}
              rows={2}
              className="w-full px-2 py-1 rounded bg-[var(--input-bg)] text-xs resize-none"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function CoverNodeContent({ data }: { data: any }) {
  return (
    <div className="space-y-2">
      <div className="aspect-square rounded-xl bg-[var(--nav-active-fill)] flex items-center justify-center text-center p-4">
        <p className="text-xs text-[color:var(--label-secondary)] line-clamp-4">{data?.english_prompt || data?.chinese_prompt || "封面提示词"}</p>
      </div>
      <p className="text-xs text-[color:var(--label-secondary)]">{data?.visual_concept}</p>
    </div>
  );
}

function VoiceoverNodeContent({ data }: { data: any }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-[color:var(--label-secondary)]">配音分段</p>
      <div className="space-y-1 max-h-[260px] overflow-y-auto">
        {(data?.segments || []).slice(0, 8).map((seg: any, idx: number) => (
          <div key={idx} className="p-2 rounded-lg bg-[var(--nav-active-fill)] text-xs">
            <span className="font-medium">{seg.speaker}</span>
            <p className="text-[color:var(--label-secondary)] truncate">{seg.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function PublishNodeContent({ data }: { data: any }) {
  return (
    <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
      <input value={data?.title || ""} readOnly className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--input-bg)] text-sm font-medium" />
      <p className="text-xs text-[color:var(--label-secondary)] line-clamp-3">{data?.short_description}</p>
      <div className="p-2 rounded-lg bg-[var(--nav-active-fill)] text-xs whitespace-pre-line max-h-[160px] overflow-y-auto">{data?.shownotes}</div>
      <div className="flex flex-wrap gap-1">
        {(data?.hashtags || []).map((h: string, i: number) => (
          <span key={i} className="px-2 py-0.5 rounded-full bg-[var(--nav-active-fill)] text-xs">{h}</span>
        ))}
      </div>
    </div>
  );
}
