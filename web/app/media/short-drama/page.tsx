"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Clapperboard,
  Sparkles,
  ChevronLeft,
  Film,
  FileText,
  LayoutTemplate,
  ImageIcon,
  Play,
  GripVertical,
  Clock,
} from "lucide-react";
import { useCanvas, type CanvasNode, type ChatMessage } from "@/hooks/useCanvas";
import { ChatPanel, type TodoInfo, type TimelineItem } from "@/app/components/canvas/ChatPanel";
import { CanvasViewport } from "@/app/components/canvas/CanvasViewport";
import { ProjectPanel } from "@/app/components/canvas/ProjectPanel";
import { CanvasWorkspace } from "@/app/components/canvas/CanvasWorkspace";
import { DraggablePanel } from "@/app/components/canvas/DraggablePanel";
import { useProjectAssets } from "@/hooks/useProjectAssets";
import type { Project, ProjectAsset } from "@/lib/project-store";

interface SceneData {
  scene_id: number;
  duration_sec: number;
  shot_type?: string;
  shot?: string;
  camera_movement?: string;
  description: string;
  image_prompt?: string;
  dialogue?: string;
  subtitle?: string;
  emotion?: string;
  bgm?: string;
  image_result?: string;
  local_image_path?: string;
}

interface ScriptData {
  title: string;
  hook: string;
  synopsis: string;
  characters: any[];
  scenes: SceneData[];
  cta?: string;
  tags?: string[];
}

interface TaskResult {
  status: string;
  progress: number;
  message?: string;
  error?: string;
  result?: any;
}

const STYLE_OPTIONS = ["甜宠", "悬疑", "喜剧", "古风", "逆袭", "虐恋"];
const PLATFORM_OPTIONS = [
  { id: "douyin", name: "抖音", ratio: "9:16" },
  { id: "kuaishou", name: "快手", ratio: "9:16" },
  { id: "xiaohongshu", name: "小红书", ratio: "3:4" },
  { id: "youtube_shorts", name: "YouTube Shorts", ratio: "9:16" },
];
const DURATION_OPTIONS = [15, 30, 60, 90];

function classNames(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}
function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export default function ShortDramaCanvasPage() {
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
  } = useCanvas();

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
  } = useProjectAssets("short-drama");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "你好，我是你的 AI 短剧导演。请告诉我你想拍一部什么样的短剧？可以是一句话创意，也可以描述风格、时长和平台。",
      actions: [],
    },
  ]);
  const [input, setInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [leftDrawer, setLeftDrawer] = useState<"assets" | null>(null);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [showMinimap, setShowMinimap] = useState(false);
  const [brief, setBrief] = useState({ text: "", style: "甜宠", platform: "douyin", duration: 60 });

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load or create project
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const savedId = typeof window !== "undefined" ? localStorage.getItem("ai-media-agent:last-project:short-drama") : null;
      const saved = savedId ? await getProject(savedId) : null;
      if (cancelled) return;
      if (saved && saved.type === "short-drama") {
        applyProject(saved);
      } else {
        const p = await createProject("short-drama", "未命名短剧项目");
        applyProject(p);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const applyProject = (p: Project) => {
    setProject(p);
    if (p.nodes.length) setNodes(p.nodes);
    if (p.messages.length) setMessages(p.messages);
    if (p.brief) setBrief(p.brief);
    if (typeof window !== "undefined") localStorage.setItem("ai-media-agent:last-project:short-drama", p.id);
  };

  // Save project when state changes
  useEffect(() => {
    if (!project) return;
    const updated: Project = { ...project, nodes, messages, brief };
    saveProject(updated).catch((e) => console.error("save project failed", e));
  }, [nodes, messages, brief, project?.id]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const pollTask = useCallback((taskId: string, onComplete: (result: any) => void) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/backend/short-drama/tasks/${encodeURIComponent(taskId)}`);
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

  const runRecipe = useCallback(
    async (recipeId: string, params: any, onComplete: (result: any) => void) => {
      const res = await fetch("/api/backend/short-drama/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipe_id: recipeId, params }),
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
      setBrief((b) => ({ ...b, text }));
      const briefNode: CanvasNode = {
        id: "brief-1",
        type: "brief",
        title: "创意",
        x: 0,
        y: 0,
        width: 640,
        height: 180,
        status: "approved",
        data: { ...brief, text },
      };
      addNode(briefNode);
      pushAssistant("收到！我先根据你的创意生成一版剧本草案。", [], "script-1");

      await runRecipe(
        "short_drama.script",
        { brief: text, platform: brief.platform, duration: brief.duration, style: brief.style },
        (result) => {
          const script: ScriptData = result.script || { title: "未命名短剧", hook: "", synopsis: "", characters: [], scenes: [] };
          const scriptNode: CanvasNode = {
            id: "script-1",
            type: "script",
            title: "剧本",
            x: 0,
            y: 0,
            width: 720,
            height: 460,
            status: "ready",
            data: script,
          };
          setNodes((ns) => relayout([...ns, scriptNode]));
          pushAssistant(
            `剧本《${script.title}》已生成。你可以点击画布上的剧本节点直接编辑，或告诉我如何修改。满意后点「继续」进入分镜。`,
            [
              { id: "continue-to-storyboard", label: "继续生成分镜", variant: "primary" },
              { id: "regen-script", label: "重新生成", variant: "secondary" },
            ],
            "script-1"
          );
        }
      );
      return;
    }

    if (latestType === "script" || latestType === "brief") {
      pushAssistant("好的，我会根据你的反馈调整剧本。", [], "script-1");
      await runRecipe(
        "short_drama.script",
        { brief: `${brief.text}\n\n用户反馈：${text}`, platform: brief.platform, duration: brief.duration, style: brief.style },
        (result) => {
          const script: ScriptData = result.script || { title: "未命名短剧", hook: "", synopsis: "", characters: [], scenes: [] };
          updateNode("script-1", { data: script, status: "ready" });
          pushAssistant("剧本已更新。确认后继续生成分镜。", [
            { id: "continue-to-storyboard", label: "继续生成分镜", variant: "primary" },
            { id: "regen-script", label: "再改一版", variant: "secondary" },
          ]);
        }
      );
      return;
    }

    if (latestType === "storyboard" || latestType === "scene") {
      pushAssistant("我会根据你的反馈调整分镜。", [], "storyboard-1");
      await runRecipe(
        "short_drama.storyboard",
        { brief: `${brief.text}\n\n用户反馈：${text}`, platform: brief.platform, duration: brief.duration, style: brief.style, scenes: 8 },
        (result) => buildStoryboardNodes(result)
      );
      return;
    }

    pushAssistant("我不太确定你现在的意图。可以点击上方的节点查看，或直接告诉我「生成分镜」「生成成片」。");
    setChatLoading(false);
  };

  const buildStoryboardNodes = (result: any) => {
    const storyboard = result.storyboard || { title: "分镜", hook: "", scenes: [] };
    const storyNode: CanvasNode = {
      id: "storyboard-1",
      type: "storyboard",
      title: "分镜",
      x: 0,
      y: 0,
      width: 720,
      height: 360,
      status: "ready",
      data: storyboard,
    };
    const scenes: CanvasNode[] = (storyboard.scenes || []).map((s: SceneData) => ({
      id: `scene-${s.scene_id}`,
      type: "scene",
      title: `场景 ${s.scene_id}`,
      x: 0,
      y: 0,
      width: 360,
      height: 380,
      status: "ready",
      data: s,
    }));
    setNodes((ns) => relayout([...ns.filter((n) => n.type !== "scene"), storyNode, ...scenes], { gridCols: 3, sceneWidth: 360, sceneGap: 60 }));
    pushAssistant(
      "分镜已生成。每个场景卡片都可以在画布上点击编辑。满意后告诉我「生成成片」。",
      [
        { id: "continue-to-produce", label: "生成成片", variant: "primary" },
        { id: "regen-storyboard", label: "重新生成分镜", variant: "secondary" },
      ],
      "storyboard-1"
    );
  };

  const handleAction = async (actionId: string, nodeId?: string) => {
    setChatLoading(true);
    if (actionId === "continue-to-storyboard" || actionId === "regen-storyboard") {
      if (actionId === "continue-to-storyboard") updateNode("script-1", { status: "approved" });
      pushAssistant("正在根据剧本生成分镜...", [], "storyboard-1");
      await runRecipe(
        "short_drama.storyboard",
        { brief: brief.text, platform: brief.platform, duration: brief.duration, style: brief.style, scenes: 8 },
        buildStoryboardNodes
      );
      return;
    }
    if (actionId === "continue-to-produce") {
      updateNode("storyboard-1", { status: "approved" });
      pushAssistant("正在生成成片（场景图 + 配音/字幕建议）...", [], "produce-1");
      await runRecipe(
        "short_drama.produce",
        { brief: brief.text, platform: brief.platform, duration: brief.duration, style: brief.style, generate_images: true, voiceover: false },
        (result) => {
          const produceNode: CanvasNode = {
            id: "produce-1",
            type: "produce",
            title: "成片",
            x: 0,
            y: 0,
            width: 720,
            height: 440,
            status: "ready",
            data: result,
          };
          setNodes((ns) => relayout([...ns, produceNode]));
          pushAssistant("成片方案已生成。你可以导出脚本、下载场景图，或继续让我调整。", [{ id: "export", label: "导出成片包", variant: "primary" }], "produce-1");
        }
      );
      return;
    }
    if (actionId === "regen-script") {
      pushAssistant("好的，重新生成剧本。");
      setInput("重新生成一版剧本");
      setTimeout(() => document.getElementById("send-btn")?.click(), 10);
      return;
    }
    if (actionId === "export") {
      pushAssistant("导出功能已触发（后续可接入视频合成与打包）。", [], "produce-1");
    }
    setChatLoading(false);
  };

  // Drop asset onto node
  const onNodeDrop = (e: React.DragEvent, node: CanvasNode) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const asset: ProjectAsset = JSON.parse(e.dataTransfer.getData("application/json"));
      if (node.type === "scene" && asset.type === "image") {
        const scene: SceneData = node.data || { scene_id: 0, duration_sec: 5, description: "" };
        updateNode(node.id, { data: { ...scene, local_image_path: asset.path || asset.url, image_result: asset.url } });
      } else if (node.type === "scene" && asset.type === "audio") {
        const scene: SceneData = node.data || { scene_id: 0, duration_sec: 5, description: "" };
        updateNode(node.id, { data: { ...scene, bgm: asset.name } });
      }
    } catch {
      /* ignore */
    }
  };

  const renderNode = (node: CanvasNode) => (
    <div onDrop={(e) => onNodeDrop(e, node)} onDragOver={(e) => e.preventDefault()}>
      <NodeHeader node={node} />
      <div className="p-4">
        {node.type === "brief" && <BriefNodeContent node={node} brief={brief} setBrief={setBrief} />}
        {node.type === "script" && <ScriptNodeContent node={node} onChange={(data) => updateNode(node.id, { data })} />}
        {node.type === "storyboard" && <StoryboardNodeContent node={node} />}
        {node.type === "scene" && <SceneNodeContent node={node} onChange={(data) => updateNode(node.id, { data })} />}
        {node.type === "produce" && <ProduceNodeContent node={node} />}
      </div>
    </div>
  );

  const renderProperties = () => {
    if (!selectedNode) return null;
    if (selectedNode.type === "scene") {
      const scene: SceneData = selectedNode.data || { scene_id: 0, duration_sec: 5, description: "" };
      return (
        <div className="space-y-3 text-sm">
          {[
            { label: "景别", key: "shot_type", value: scene.shot_type || scene.shot || "" },
            { label: "运镜", key: "camera_movement", value: scene.camera_movement || "" },
            { label: "情绪", key: "emotion", value: scene.emotion || "" },
            { label: "BGM", key: "bgm", value: scene.bgm || "" },
          ].map((f) => (
            <div key={f.key}>
              <label className="text-xs text-[color:var(--label-secondary)]">{f.label}</label>
              <input
                value={f.value}
                onChange={(e) => updateNode(selectedNode.id, { data: { ...scene, [f.key]: e.target.value } })}
                className="w-full mt-1 px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--input-bg)] text-sm"
              />
            </div>
          ))}
          <div>
            <label className="text-xs text-[color:var(--label-secondary)]">时长（秒）</label>
            <input
              type="number"
              value={scene.duration_sec}
              onChange={(e) => updateNode(selectedNode.id, { data: { ...scene, duration_sec: Number(e.target.value) } })}
              className="w-full mt-1 px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--input-bg)] text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-[color:var(--label-secondary)]">画面描述</label>
            <textarea
              value={scene.description}
              onChange={(e) => updateNode(selectedNode.id, { data: { ...scene, description: e.target.value } })}
              rows={3}
              className="w-full mt-1 px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--input-bg)] text-sm resize-none"
            />
          </div>
          <div>
            <label className="text-xs text-[color:var(--label-secondary)]">台词</label>
            <textarea
              value={scene.dialogue || ""}
              onChange={(e) => updateNode(selectedNode.id, { data: { ...scene, dialogue: e.target.value } })}
              rows={3}
              className="w-full mt-1 px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--input-bg)] text-sm resize-none"
            />
          </div>
        </div>
      );
    }
    return <div className="text-sm text-[color:var(--label-secondary)]">选择剧本或场景节点可编辑内容。</div>;
  };

  const handleTidy = () => {
    setNodes((ns) => relayout([...ns]));
  };

  const handleNewChat = async () => {
    const p = await createProject("short-drama", "未命名短剧项目");
    setNodes([]);
    setBrief({ text: "", style: "甜宠", platform: "douyin", duration: 60 });
    setInput("");
    applyProject(p);
    setMessages([
      {
        role: "assistant",
        content: "你好，我是你的 AI 短剧导演。请告诉我你想拍一部什么样的短剧？可以是一句话创意，也可以描述风格、时长和平台。",
        actions: [],
      },
    ]);
  };

  const handleSkillSelect = (id: string) => {
    const prompts: Record<string, string> = {
      "short-drama": "创作一部爆款短剧",
      "animal-podcast": "把动物故事改编成短剧",
      "image-remix": "根据参考图创作短剧分镜",
    };
    handleSend(prompts[id] || `开始一个 ${id} 项目`);
  };

  const projectPath = project?.name ? `/${project.name}` : "/short-drama";

  const todo: TodoInfo = {
    done: [
      nodes.some((n) => n.type === "brief"),
      nodes.some((n) => n.type === "script"),
      nodes.some((n) => n.type === "storyboard"),
      nodes.some((n) => n.type === "scene"),
      nodes.some((n) => n.type === "produce"),
    ].filter(Boolean).length,
    total: 5,
    items: [
      { label: "创意确认", done: nodes.some((n) => n.type === "brief") },
      { label: "剧本生成", done: nodes.some((n) => n.type === "script") },
      { label: "分镜规划", done: nodes.some((n) => n.type === "storyboard") },
      { label: "场景设计", done: nodes.some((n) => n.type === "scene") },
      { label: "成片导出", done: nodes.some((n) => n.type === "produce") },
    ],
  };

  const timeline: TimelineItem[] =
    messages.length > 1
      ? [{ id: "updated", text: `Updated canvas ${Math.max(1, messages.length - 1)} times` }]
      : [];

  return (
    <CanvasWorkspace
      projectPath={projectPath}
      projectName={project?.name}
      projectAvatar={<div className="w-7 h-7 rounded-lg bg-gradient-to-br from-rose-400 to-orange-500 flex items-center justify-center text-white text-xs font-bold">S</div>}
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
            type="short-drama"
            typeLabel="短剧"
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
          todo={todo}
          timeline={timeline}
          messages={messages}
          input={input}
          setInput={setInput}
          loading={chatLoading}
          onSend={handleSend}
          onAction={handleAction}
          onNewChat={handleNewChat}
          onSkillSelect={handleSkillSelect}
          defaultSkill="AI 短剧"
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
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onNodeMouseDown={onNodeMouseDown}
        renderNode={renderNode}
      />

      {selectedNode && (
        <DraggablePanel title="属性" onClose={() => setSelectedNodeId(null)}>
          {renderProperties()}
        </DraggablePanel>
      )}
    </CanvasWorkspace>
  );
}

function NodeHeader({ node }: { node: CanvasNode }) {
  const icons: Record<string, React.ReactNode> = {
    brief: <Sparkles className="w-4 h-4 text-[color:var(--accent)]" />,
    script: <FileText className="w-4 h-4 text-[color:var(--accent)]" />,
    storyboard: <LayoutTemplate className="w-4 h-4 text-[color:var(--accent)]" />,
    produce: <Film className="w-4 h-4 text-[color:var(--accent)]" />,
    scene: <ImageIcon className="w-4 h-4 text-[color:var(--accent)]" />,
  };
  const statusColor =
    node.status === "approved"
      ? "bg-green-500"
      : node.status === "ready"
      ? "bg-[color:var(--accent)]"
      : node.status === "generating"
      ? "bg-amber-400"
      : "bg-[var(--border-subtle)]";
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-subtle)] cursor-grab active:cursor-grabbing">
      <GripVertical className="w-3 h-3 text-[color:var(--label-secondary)]" />
      {icons[node.type]}
      <span className="text-sm font-medium flex-1 truncate">{node.title}</span>
      <span className={classNames("w-2 h-2 rounded-full", statusColor)} />
    </div>
  );
}

function BriefNodeContent({
  node,
  brief,
  setBrief,
}: {
  node: CanvasNode;
  brief: { text: string; style: string; platform: string; duration: number };
  setBrief: React.Dispatch<React.SetStateAction<{ text: string; style: string; platform: string; duration: number }>>;
}) {
  return (
    <div className="space-y-3 pointer-events-auto">
      <textarea
        value={brief.text || node.data?.text || ""}
        onChange={(e) => setBrief((b) => ({ ...b, text: e.target.value }))}
        rows={3}
        className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--input-bg)] text-sm resize-none"
      />
      <div className="grid grid-cols-2 gap-2">
        <select value={brief.style} onChange={(e) => setBrief((b) => ({ ...b, style: e.target.value }))} className="px-2 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--input-bg)] text-xs">
          {STYLE_OPTIONS.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={brief.platform} onChange={(e) => setBrief((b) => ({ ...b, platform: e.target.value }))} className="px-2 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--input-bg)] text-xs">
          {PLATFORM_OPTIONS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <Clock className="w-3.5 h-3.5 text-[color:var(--label-secondary)]" />
        <select value={brief.duration} onChange={(e) => setBrief((b) => ({ ...b, duration: Number(e.target.value) }))} className="px-2 py-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--input-bg)] text-xs">
          {DURATION_OPTIONS.map((d) => <option key={d} value={d}>{d}s</option>)}
        </select>
      </div>
    </div>
  );
}

function ScriptNodeContent({ node, onChange }: { node: CanvasNode; onChange: (data: any) => void }) {
  const script: ScriptData = node.data || { title: "", hook: "", synopsis: "", characters: [], scenes: [] };
  return (
    <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1 pointer-events-auto">
      <input
        value={script.title}
        onChange={(e) => onChange({ ...script, title: e.target.value })}
        className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--input-bg)] text-sm font-medium"
      />
      <textarea
        value={script.hook}
        onChange={(e) => onChange({ ...script, hook: e.target.value })}
        rows={2}
        placeholder="开场钩子"
        className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--input-bg)] text-sm resize-none"
      />
      <textarea
        value={script.synopsis}
        onChange={(e) => onChange({ ...script, synopsis: e.target.value })}
        rows={3}
        placeholder="剧情简介"
        className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--input-bg)] text-sm resize-none"
      />
      <div className="space-y-2">
        {(script.characters || []).map((char: any, idx: number) => (
          <div key={idx} className="flex gap-2">
            <input
              value={char.name}
              onChange={(e) => {
                const chars = [...script.characters];
                chars[idx] = { ...chars[idx], name: e.target.value };
                onChange({ ...script, characters: chars });
              }}
              className="flex-1 px-2 py-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--input-bg)] text-xs"
            />
            <input
              value={char.traits}
              onChange={(e) => {
                const chars = [...script.characters];
                chars[idx] = { ...chars[idx], traits: e.target.value };
                onChange({ ...script, characters: chars });
              }}
              className="flex-1 px-2 py-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--input-bg)] text-xs"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function StoryboardNodeContent({ node }: { node: CanvasNode }) {
  const storyboard = node.data || { title: "", hook: "", scenes: [] };
  return (
    <div className="space-y-2 pointer-events-auto">
      <p className="text-sm font-medium">{storyboard.title}</p>
      <p className="text-xs text-[color:var(--label-secondary)] line-clamp-2">{storyboard.hook}</p>
      <div className="grid grid-cols-4 gap-2 mt-2">
        {(storyboard.scenes || []).slice(0, 8).map((s: SceneData, i: number) => (
          <div key={i} className="aspect-[9/16] rounded-lg bg-[var(--nav-active-fill)] flex items-center justify-center text-[10px] text-center p-1 text-[color:var(--label-secondary)]">
            {s.scene_id}
          </div>
        ))}
      </div>
      <p className="text-xs text-[color:var(--label-secondary)] mt-1">共 {storyboard.scenes?.length || 0} 个场景</p>
    </div>
  );
}

function SceneNodeContent({ node, onChange }: { node: CanvasNode; onChange: (data: any) => void }) {
  const scene: SceneData = node.data || { scene_id: 0, duration_sec: 5, description: "" };
  return (
    <div className="space-y-2 pointer-events-auto">
      <div className="aspect-[9/16] rounded-xl bg-[var(--nav-active-fill)] relative overflow-hidden mb-2">
        {scene.local_image_path ? (
          <img src={scene.local_image_path.replace("./storage", "/storage")} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center text-[color:var(--label-secondary)]">
            <ImageIcon className="w-8 h-8 mb-1 opacity-40" />
            <p className="text-[10px] line-clamp-3">{scene.image_prompt || scene.description}</p>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="px-2 py-0.5 rounded-md bg-[var(--nav-active-fill)] font-medium">{scene.shot_type || scene.shot || "镜头"}</span>
        <span className="text-[color:var(--label-secondary)]">{scene.duration_sec}s</span>
      </div>
      <textarea
        value={scene.description}
        onChange={(e) => onChange({ ...scene, description: e.target.value })}
        rows={3}
        className="w-full px-2 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--input-bg)] text-xs resize-none"
      />
    </div>
  );
}

function ProduceNodeContent({ node }: { node: CanvasNode }) {
  const result = node.data || {};
  return (
    <div className="space-y-3 pointer-events-auto">
      <div className="aspect-video rounded-xl bg-black flex items-center justify-center text-white">
        <Play className="w-10 h-10 opacity-60" />
      </div>
      <div className="text-sm space-y-1">
        <p className="font-medium">{result.title}</p>
        <p className="text-xs text-[color:var(--label-secondary)]">{result.hook}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <span className="px-2 py-1 rounded-full bg-[var(--nav-active-fill)] text-xs">{result.scenes?.length || 0} 场景</span>
        <span className="px-2 py-1 rounded-full bg-[var(--nav-active-fill)] text-xs">{result.style}</span>
        <span className="px-2 py-1 rounded-full bg-[var(--nav-active-fill)] text-xs">{result.platform}</span>
      </div>
    </div>
  );
}
