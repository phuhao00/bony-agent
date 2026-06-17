"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Music,
  Sparkles,
  ChevronLeft,
  Headphones,
  Play,
  Pause,
  SlidersHorizontal,
  GripVertical,
  FileAudio,
} from "lucide-react";
import { useCanvas, type CanvasNode, type ChatMessage } from "@/hooks/useCanvas";
import { ChatPanel, type TodoInfo, type TimelineItem } from "@/app/components/canvas/ChatPanel";
import { CanvasViewport } from "@/app/components/canvas/CanvasViewport";
import { ProjectPanel } from "@/app/components/canvas/ProjectPanel";
import { CanvasWorkspace } from "@/app/components/canvas/CanvasWorkspace";
import { DraggablePanel } from "@/app/components/canvas/DraggablePanel";
import { useProjectAssets } from "@/hooks/useProjectAssets";
import type { Project, ProjectAsset } from "@/lib/project-store";

interface TaskResult {
  status: string;
  progress: number;
  message?: string;
  error?: string;
  result?: any;
}

const STYLE_OPTIONS = ["流行", "电子", "摇滚", "古典", "爵士", "民谣", "R&B", "嘻哈"];
const MOOD_OPTIONS = ["欢快", "抒情", "紧张", "治愈", "浪漫", "励志", "神秘", "慵懒"];
const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120];
const BPM_OPTIONS = [72, 88, 100, 120, 128, 140];
const RECIPE_MODES: Record<string, string> = {
  "文本生成音乐": "music.text_to_music",
  "歌词谱曲": "music.lyrics_to_music",
  "视频 BGM": "music.bgm_for_video",
};

function classNames(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}
function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export default function MusicCanvasPage() {
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
  } = useProjectAssets("music");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "你好，我是你的 AI 音乐制作人。请告诉我你想创作什么？例如：轻快明亮的 Vlog BGM，或粘贴一段歌词让我谱曲。",
      actions: [],
    },
  ]);
  const [input, setInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [leftDrawer, setLeftDrawer] = useState<"assets" | null>(null);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [showMinimap, setShowMinimap] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [mode, setMode] = useState("文本生成音乐");
  const [params, setParams] = useState({ style: "流行", mood: "欢快", duration: 30, bpm: 120, instrumental: true });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const savedId = typeof window !== "undefined" ? localStorage.getItem("ai-media-agent:last-project:music") : null;
      const saved = savedId ? await getProject(savedId) : null;
      if (cancelled) return;
      if (saved && saved.type === "music") {
        applyProject(saved);
      } else {
        const p = await createProject("music", "未命名音乐项目");
        applyProject(p);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const applyProject = (p: Project) => {
    setProject(p);
    if (p.nodes.length) setNodes(p.nodes);
    if (p.messages.length) setMessages(p.messages);
    if (p.brief?.mode) setMode(p.brief.mode);
    if (p.brief) setParams({ ...params, ...p.brief });
    if (typeof window !== "undefined") localStorage.setItem("ai-media-agent:last-project:music", p.id);
  };

  useEffect(() => {
    if (!project) return;
    saveProject({ ...project, nodes, messages, brief: { ...params, mode } }).catch((e) => console.error("save project failed", e));
  }, [nodes, messages, params, mode, project?.id]);

  const pollTask = useCallback((taskId: string, onComplete: (result: any) => void) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/backend/music/tasks/${encodeURIComponent(taskId)}`);
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
    async (recipeId: string, bodyParams: any, onComplete: (result: any) => void) => {
      const res = await fetch("/api/backend/music/run", {
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
      const briefNode: CanvasNode = {
        id: "brief-1",
        type: "brief",
        title: "创作意图",
        x: 0,
        y: 0,
        width: 640,
        height: 180,
        status: "approved",
        data: { text, mode },
      };
      addNode(briefNode);
      pushAssistant("收到！我为你准备了创作参数，确认后我就开始生成音乐。", [], "params-1");

      const paramsNode: CanvasNode = {
        id: "params-1",
        type: "params",
        title: "参数",
        x: 0,
        y: 0,
        width: 640,
        height: 280,
        status: "ready",
        data: { text, mode, ...params },
      };
      setNodes((ns) => relayout([...ns, paramsNode]));
      pushAssistant("请调整风格、情绪、时长等参数，或直接点「生成音乐」。", [{ id: "generate-music", label: "生成音乐", variant: "primary" }], "params-1");
      setChatLoading(false);
      return;
    }

    if (latestType === "brief" || latestType === "params") {
      pushAssistant("好的，我会结合你的描述生成音乐。", [], "result-1");
      await generateMusic(text);
      return;
    }

    if (latestType === "result" || latestType === "produce") {
      pushAssistant("收到反馈，我重新生成一版。", [], "result-1");
      await generateMusic(text);
      return;
    }

    pushAssistant("你可以说「生成音乐」「换一个风格」「延长到60秒」等。");
    setChatLoading(false);
  };

  const generateMusic = async (prompt: string) => {
    const recipeId = RECIPE_MODES[mode] || "music.text_to_music";
    let bodyParams: any = {};
    if (recipeId === "music.lyrics_to_music") {
      bodyParams = { lyrics: prompt, style: params.style, mood: params.mood, duration: params.duration };
    } else if (recipeId === "music.bgm_for_video") {
      bodyParams = { prompt, duration: params.duration, loop: true };
    } else {
      bodyParams = { prompt, style: params.style, mood: params.mood, duration: params.duration, instrumental: params.instrumental };
    }
    await runRecipe(recipeId, bodyParams, (result) => {
      const resultNode: CanvasNode = {
        id: "result-1",
        type: "result",
        title: "生成结果",
        x: 0,
        y: 0,
        width: 720,
        height: 380,
        status: "ready",
        data: result,
      };
      setNodes((ns) => relayout([...ns.filter((n) => n.type !== "result" && n.type !== "produce"), resultNode]));
      pushAssistant(
        "音乐已生成！你可以在结果节点试听。满意后点「确认成品」进入母带，或让我继续调整。",
        [
          { id: "confirm-master", label: "确认成品", variant: "primary" },
          { id: "regen-music", label: "重新生成", variant: "secondary" },
        ],
        "result-1"
      );
    });
  };

  const handleAction = async (actionId: string, nodeId?: string) => {
    setChatLoading(true);
    if (actionId === "generate-music") {
      const prompt = nodes.find((n) => n.type === "brief")?.data?.text || input || "未命名";
      await generateMusic(prompt);
      return;
    }
    if (actionId === "regen-music") {
      pushAssistant("好的，重新生成。");
      const prompt = nodes.find((n) => n.type === "brief")?.data?.text || input || "音乐";
      await generateMusic(prompt);
      return;
    }
    if (actionId === "confirm-master") {
      updateNode("result-1", { status: "approved" });
      const resultData = nodes.find((n) => n.type === "result")?.data || {};
      const produceNode: CanvasNode = {
        id: "produce-1",
        type: "produce",
        title: "母带成品",
        x: 0,
        y: 0,
        width: 720,
        height: 360,
        status: "ready",
        data: { ...resultData, ...params },
      };
      setNodes((ns) => relayout([...ns, produceNode]));
      pushAssistant("母带成品已生成。可以下载音频或作为其他内容的 BGM。", [{ id: "export", label: "下载音频", variant: "primary" }], "produce-1");
      setChatLoading(false);
      return;
    }
    if (actionId === "export") {
      pushAssistant("下载功能已触发（后续可接入真实下载链路）。", [], "produce-1");
    }
    setChatLoading(false);
  };

  const audioUrl = nodes.find((n) => n.type === "result")?.data?.audio_url || "";
  const togglePlay = () => {
    if (!audioRef.current || !audioUrl) return;
    if (isPlaying) audioRef.current.pause();
    else audioRef.current.play();
    setIsPlaying(!isPlaying);
  };

  const onNodeDrop = (e: React.DragEvent, node: CanvasNode) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const asset: ProjectAsset = JSON.parse(e.dataTransfer.getData("application/json"));
      if ((node.type === "result" || node.type === "produce") && asset.type === "audio") {
        const data = node.data || {};
        updateNode(node.id, { data: { ...data, audio_url: asset.url, audio_path: asset.path, provider: "asset" } });
      }
    } catch {
      /* ignore */
    }
  };

  const renderNode = (node: CanvasNode) => (
    <div onDrop={(e) => onNodeDrop(e, node)} onDragOver={(e) => e.preventDefault()}>
      <NodeHeader node={node} />
      <div className="p-4">
        {node.type === "brief" && <BriefNodeContent text={node.data?.text || ""} mode={node.data?.mode || mode} />}
        {node.type === "params" && (
          <ParamsNodeContent
            data={{ ...params, text: node.data?.text || "", mode: node.data?.mode || mode }}
            setParams={(p) => {
              setParams(p);
              updateNode(node.id, { data: { ...node.data, ...p } });
            }}
            setMode={(m) => {
              setMode(m);
              updateNode(node.id, { data: { ...node.data, mode: m } });
            }}
          />
        )}
        {node.type === "result" && <ResultNodeContent data={node.data} isPlaying={isPlaying} togglePlay={togglePlay} />}
        {node.type === "produce" && <ProduceNodeContent data={node.data} isPlaying={isPlaying} togglePlay={togglePlay} />}
      </div>
    </div>
  );

  const renderProperties = () => {
    if (!selectedNode) return null;
    if (selectedNode.type === "params") {
      return (
        <ParamsNodeContent
          data={{ ...params, text: selectedNode.data?.text || "", mode: selectedNode.data?.mode || mode }}
          setParams={(p) => {
            setParams(p);
            updateNode(selectedNode.id, { data: { ...selectedNode.data, ...p } });
          }}
          setMode={(m) => {
            setMode(m);
            updateNode(selectedNode.id, { data: { ...selectedNode.data, mode: m } });
          }}
        />
      );
    }
    return <div className="text-sm text-[color:var(--label-secondary)]">选择参数或结果节点可在画布中直接编辑。</div>;
  };

  const handleTidy = () => {
    setNodes((ns) => relayout([...ns]));
  };

  const handleNewChat = async () => {
    const p = await createProject("music", "未命名音乐项目");
    setNodes([]);
    setInput("");
    applyProject(p);
    setMessages([
      {
        role: "assistant",
        content: "你好，我是你的 AI 音乐制作人。请告诉我你想创作什么？例如：轻快明亮的 Vlog BGM，或粘贴一段歌词让我谱曲。",
        actions: [],
      },
    ]);
  };

  const handleSkillSelect = (id: string) => {
    const prompts: Record<string, string> = {
      "image-remix": "根据一张参考图创作配乐",
      "short-drama": "为短剧写一段背景音乐",
      "animal-podcast": "为动物播客制作开场音乐",
    };
    handleSend(prompts[id] || `开始一个 ${id} 项目`);
  };

  const projectPath = project?.name ? `/${project.name}` : "/music";

  const todo: TodoInfo = {
    done: [
      nodes.some((n) => n.type === "brief"),
      nodes.some((n) => n.type === "params"),
      nodes.some((n) => n.type === "result"),
      nodes.some((n) => n.type === "produce"),
    ].filter(Boolean).length,
    total: 4,
    items: [
      { label: "创作意图", done: nodes.some((n) => n.type === "brief") },
      { label: "参数设定", done: nodes.some((n) => n.type === "params") },
      { label: "音乐生成", done: nodes.some((n) => n.type === "result") },
      { label: "母带成品", done: nodes.some((n) => n.type === "produce") },
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
      projectAvatar={<div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-400 to-fuchsia-500 flex items-center justify-center text-white text-xs font-bold">M</div>}
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
            type="music"
            typeLabel="音乐"
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
          defaultSkill="AI 音乐"
        />
      }
    >
      {audioUrl && <audio ref={audioRef} src={audioUrl} onEnded={() => setIsPlaying(false)} />}
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
    params: <SlidersHorizontal className="w-4 h-4 text-[color:var(--accent)]" />,
    result: <Headphones className="w-4 h-4 text-[color:var(--accent)]" />,
    produce: <FileAudio className="w-4 h-4 text-[color:var(--accent)]" />,
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

function BriefNodeContent({ text, mode }: { text: string; mode: string }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-[color:var(--label-secondary)]">创作模式</p>
      <p className="text-sm font-medium">{mode}</p>
      <textarea value={text} readOnly rows={4} className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--input-bg)] text-sm resize-none" />
    </div>
  );
}

function ParamsNodeContent({
  data,
  setParams,
  setMode,
}: {
  data: any;
  setParams: (p: any) => void;
  setMode: (m: string) => void;
}) {
  return (
    <div className="space-y-3">
      <select value={data.mode} onChange={(e) => setMode(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--input-bg)] text-sm">
        {Object.keys(RECIPE_MODES).map((m) => <option key={m}>{m}</option>)}
      </select>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-[color:var(--label-secondary)]">风格</label>
          <select value={data.style} onChange={(e) => setParams({ ...data, style: e.target.value })} className="w-full mt-1 px-2 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--input-bg)] text-xs">
            {STYLE_OPTIONS.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-[color:var(--label-secondary)]">情绪</label>
          <select value={data.mood} onChange={(e) => setParams({ ...data, mood: e.target.value })} className="w-full mt-1 px-2 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--input-bg)] text-xs">
            {MOOD_OPTIONS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-[color:var(--label-secondary)]">时长</label>
          <select value={data.duration} onChange={(e) => setParams({ ...data, duration: Number(e.target.value) })} className="w-full mt-1 px-2 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--input-bg)] text-xs">
            {DURATION_OPTIONS.map((d) => <option key={d} value={d}>{d}s</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-[color:var(--label-secondary)]">BPM</label>
          <select value={data.bpm} onChange={(e) => setParams({ ...data, bpm: Number(e.target.value) })} className="w-full mt-1 px-2 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--input-bg)] text-xs">
            {BPM_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
      </div>
      {data.mode !== "歌词谱曲" && (
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={data.instrumental}
            onChange={(e) => setParams({ ...data, instrumental: e.target.checked })}
            className="rounded border-[var(--border-subtle)]"
          />
          纯音乐
        </label>
      )}
    </div>
  );
}

function ResultNodeContent({ data, isPlaying, togglePlay }: { data: any; isPlaying: boolean; togglePlay: () => void }) {
  return (
    <div className="space-y-3">
      <div className="aspect-[16/9] rounded-xl bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10 border border-[var(--border-subtle)] flex items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center gap-1">
          {[...Array(24)].map((_, i) => (
            <div
              key={i}
              className="w-1.5 rounded-full bg-[color:var(--accent)]/40"
              style={{ height: `${20 + Math.random() * 60}%`, opacity: 0.3 + Math.random() * 0.5 }}
            />
          ))}
        </div>
        <button
          onClick={togglePlay}
          disabled={!data?.audio_url}
          className="relative z-10 w-14 h-14 rounded-full bg-[color:var(--accent)] text-white flex items-center justify-center hover:opacity-90 disabled:opacity-40 shadow-lg"
        >
          {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-0.5" />}
        </button>
      </div>
      <div className="text-sm space-y-1">
        <p className="font-medium">{data?.prompt || "未命名"}</p>
        <p className="text-xs text-[color:var(--label-secondary)]">{data?.style} · {data?.mood} · {data?.duration}s · {data?.provider}</p>
      </div>
    </div>
  );
}

function ProduceNodeContent({ data, isPlaying, togglePlay }: { data: any; isPlaying: boolean; togglePlay: () => void }) {
  return (
    <div className="space-y-3">
      <div className="aspect-[16/9] rounded-xl bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10 flex items-center justify-center">
        <button
          onClick={togglePlay}
          disabled={!data?.audio_url}
          className="w-12 h-12 rounded-full bg-[color:var(--accent)] text-white flex items-center justify-center hover:opacity-90 disabled:opacity-40"
        >
          {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
        </button>
      </div>
      <div className="text-sm space-y-1">
        <p className="font-medium">{data?.title || data?.prompt || "成品"}</p>
        <p className="text-xs text-[color:var(--label-secondary)]">{data?.style} · {data?.mood} · {data?.duration}s</p>
      </div>
    </div>
  );
}
