import { useEffect, useRef, useState } from "react";
import {
  Plus,
  Send,
  ChevronRight,
  RefreshCw,
  ArrowUpRight,
  Bot,
  User,
  Loader2,
  CheckCircle2,
  Circle,
  Check,
  FileText,
  SlidersHorizontal,
} from "lucide-react";
import type { ChatAction, ChatMessage } from "@/hooks/useCanvas";

export interface PodcastParams {
  format: string;
  tone: string;
  duration: number;
  audience: string;
}

export interface TodoInfo {
  done: number;
  total: number;
  items?: { label: string; done: boolean }[];
}

export interface TimelineItem {
  id: string;
  text: string;
  time?: string;
}

export interface SkillOption {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

interface ChatPanelProps {
  projectPath?: string;
  projectName?: string;
  title?: string;
  todo?: TodoInfo;
  timeline?: TimelineItem[];
  messages: ChatMessage[];
  input: string;
  setInput: (v: string) => void;
  loading: boolean;
  onSend: () => void;
  onAction: (actionId: string, nodeId?: string) => void;
  onNewChat?: () => void;
  onRenameProject?: (name: string) => void;
  params?: PodcastParams;
  onParamsChange?: (p: PodcastParams) => void;
  formatOptions?: string[];
  toneOptions?: string[];
  durationOptions?: number[];
  skills?: SkillOption[];
  onSkillSelect?: (id: string) => void;
  defaultSkill?: string;
}

function classNames(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

const FALLBACK_MODELS = ["GLM-4", "Gemini 1.5 Pro", "DeepSeek-V3", "OpenRouter"];
const FALLBACK_SKILLS = ["默认", "创意加强", "SEO 写作", "代码审查"];
const AUTO_MODES = ["自动", "编排器", "规划", "Lobster", "对话", "Claude Code"];

const DEFAULT_SKILLS: SkillOption[] = [
  { id: "animal-podcast", label: "动物播客" },
  { id: "audiobook", label: "有声书" },
  { id: "image-remix", label: "图片混剪" },
  { id: "short-drama", label: "短剧" },
  { id: "skill-creator", label: "技能创建" },
  { id: "skill-reviewer", label: "技能审查" },
];

export function ChatPanel({
  projectPath,
  projectName,
  title,
  todo,
  timeline,
  messages,
  input,
  setInput,
  loading,
  onSend,
  onAction,
  onNewChat,
  onRenameProject,
  params,
  onParamsChange,
  formatOptions = [],
  toneOptions = [],
  durationOptions = [],
  skills = DEFAULT_SKILLS,
  onSkillSelect,
  defaultSkill,
}: ChatPanelProps) {
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [todoOpen, setTodoOpen] = useState(false);
  const [paramsOpen, setParamsOpen] = useState(false);
  const [model, setModel] = useState("GLM-4");
  const [skill, setSkill] = useState("Default");
  const [autoMode, setAutoMode] = useState("Auto");
  const [openMenu, setOpenMenu] = useState<"model" | "skill" | "auto" | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [models, setModels] = useState<string[]>(FALLBACK_MODELS);
  const [skillsOptions, setSkillsOptions] = useState<string[]>(FALLBACK_SKILLS);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  const startRename = () => {
    if (!onRenameProject) return;
    setRenameValue(projectName || "");
    setRenaming(true);
    setTimeout(() => {
      renameInputRef.current?.select();
    }, 30);
  };

  const commitRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed && onRenameProject) onRenameProject(trimmed);
    setRenaming(false);
  };

  const isNewChat = messages.length <= 1 && messages[0]?.role === "assistant";

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    fetch("/api/backend/config/provider")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        const excluded = [
          "imagen", "flux", "dall-e", "stable-diffusion", "midjourney", "sora",
          "video", "gen-3", "ray-2", "luma", "kling", "wan", "cogvideo", "piper",
          "tts", "whisper", "audio", "music", "voice", "embedding", "embed",
        ];
        const isChatModel = (m: string) => !excluded.some((k) => m.toLowerCase().includes(k));
        const allModels: string[] = [];
        if (data.current?.model && isChatModel(data.current.model)) allModels.push(data.current.model);
        (data.available || []).forEach((p: any) => {
          (p.models || []).forEach((m: string) => {
            if (isChatModel(m) && !allModels.includes(m)) allModels.push(m);
          });
        });
        if (allModels.length) {
          setModels(allModels);
          setModel((prev) => (allModels.includes(prev) ? prev : allModels[0]));
        }
      })
      .catch(() => {});

    fetch("/api/backend/agent/assistant-catalog")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const list: string[] = (data?.assistants || [])
          .map((a: any) => a.display_name)
          .filter(Boolean);
        if (list.length) {
          setSkillsOptions(list);
          const target = defaultSkill && list.includes(defaultSkill) ? defaultSkill : list[0];
          setSkill((prev) => (list.includes(prev) ? prev : target));
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className="w-full h-full flex flex-col bg-[var(--card-bg)]">
      {/* Header */}
      <div className="h-14 shrink-0 border-b border-[var(--border-subtle)] flex items-center justify-between px-4">
        <div className="flex items-center gap-2 min-w-0">
          {renaming ? (
            <input
              ref={renameInputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setRenaming(false);
              }}
              className="text-sm font-semibold bg-transparent border-b border-[color:var(--accent)] outline-none w-40 truncate"
              autoFocus
            />
          ) : (
            <button
              onClick={startRename}
              disabled={!onRenameProject}
              title={onRenameProject ? "点击重命名" : undefined}
              className={classNames(
                "text-sm font-semibold truncate max-w-[160px] text-left",
                onRenameProject && "hover:text-[color:var(--accent)] transition-colors cursor-text"
              )}
            >
              {isNewChat ? title || "新对话" : projectName || projectPath || title || "对话"}
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[color:var(--label-secondary)]">
          <button onClick={onNewChat} className="w-8 h-8 rounded-lg bg-[var(--nav-active-fill)] hover:bg-[var(--border-subtle)] flex items-center justify-center transition-colors" title="新对话">
            <Plus className="w-4 h-4" />
          </button>
          <button className="w-8 h-8 rounded-lg bg-[var(--nav-active-fill)] hover:bg-[var(--border-subtle)] flex items-center justify-center transition-colors" title="刷新">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button className="w-8 h-8 rounded-lg bg-[var(--nav-active-fill)] hover:bg-[var(--border-subtle)] flex items-center justify-center transition-colors" title="展开">
            <ArrowUpRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {isNewChat ? (
          <NewChatWelcome skills={skills} onSkillSelect={onSkillSelect} />
        ) : (
          <>
            {/* Params bar */}
            {params && onParamsChange && (
              <div className="border-b border-[var(--border-subtle)]">
                <button
                  onClick={() => setParamsOpen((s) => !s)}
                  className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-[var(--nav-active-fill)] transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-[color:var(--label-secondary)]" />
                    <span className="text-xs font-medium text-[color:var(--label-secondary)]">参数</span>
                    <span className="text-xs text-[color:var(--label-secondary)]/60">
                      {params.format} · {params.tone} · {params.duration}min
                    </span>
                  </div>
                  <ChevronRight className={classNames("w-3.5 h-3.5 text-[color:var(--label-secondary)] transition-transform", paramsOpen && "rotate-90")} />
                </button>
                {paramsOpen && (
                  <div className="px-4 pb-3 grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-[color:var(--label-secondary)] mb-1 block">形式</label>
                      <select
                        value={params.format}
                        onChange={(e) => onParamsChange({ ...params, format: e.target.value })}
                        className="w-full px-2 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--input-bg)] text-xs"
                      >
                        {formatOptions.map((f) => <option key={f}>{f}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-[color:var(--label-secondary)] mb-1 block">语气</label>
                      <select
                        value={params.tone}
                        onChange={(e) => onParamsChange({ ...params, tone: e.target.value })}
                        className="w-full px-2 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--input-bg)] text-xs"
                      >
                        {toneOptions.map((t) => <option key={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-[color:var(--label-secondary)] mb-1 block">时长（分钟）</label>
                      <select
                        value={params.duration}
                        onChange={(e) => onParamsChange({ ...params, duration: Number(e.target.value) })}
                        className="w-full px-2 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--input-bg)] text-xs"
                      >
                        {durationOptions.map((d) => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-[color:var(--label-secondary)] mb-1 block">目标听众</label>
                      <input
                        value={params.audience}
                        onChange={(e) => onParamsChange({ ...params, audience: e.target.value })}
                        className="w-full px-2 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--input-bg)] text-xs"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
            {/* Todo list */}
            {todo && (
              <div className="border-b border-[var(--border-subtle)]">
                <button
                  onClick={() => setTodoOpen((s) => !s)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-[var(--nav-active-fill)] transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">待办清单</span>
                    <span className="text-xs text-[color:var(--label-secondary)]">
                      {todo.done}/{todo.total} 项已完成
                    </span>
                  </div>
                  <ChevronRight className={classNames("w-4 h-4 text-[color:var(--label-secondary)] transition-transform", todoOpen && "rotate-90")} />
                </button>
                {todoOpen && todo.items && (
                  <div className="px-4 pb-3 space-y-2">
                    {todo.items.map((item, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-sm">
                        {item.done ? (
                          <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                        ) : (
                          <Circle className="w-4 h-4 text-[color:var(--label-secondary)] shrink-0" />
                        )}
                        <span className={classNames(item.done && "line-through text-[color:var(--label-secondary)]")}>{item.label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Timeline */}
            {timeline && timeline.length > 0 && (
              <div className="px-4 py-3 border-b border-[var(--border-subtle)] space-y-3">
                {timeline.map((item) => (
                  <div key={item.id} className="flex items-start gap-3">
                    <div className="w-2 h-2 rounded-full bg-[color:var(--accent)] mt-1.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-[color:var(--label-secondary)]">{item.text}</p>
                      {item.time && <p className="text-[10px] text-[color:var(--label-secondary)]/60 mt-0.5">{item.time}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Messages */}
            <div className="p-4 space-y-5">
              {messages.map((msg, idx) => (
                <MessageItem key={idx} msg={msg} loading={loading} onAction={onAction} />
              ))}
              {loading && (
                <div className="flex items-start gap-2.5">
                  <div className="w-6 h-6 rounded-full bg-[var(--nav-active-fill)] flex items-center justify-center shrink-0">
                    <Bot className="w-3.5 h-3.5 text-[color:var(--accent)]" />
                  </div>
                  <div className="bg-[var(--nav-active-fill)] rounded-2xl rounded-tl-none px-3 py-2 flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span className="text-xs">AI 思考中...</span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          </>
        )}
      </div>

      {/* Input area */}
      <div className="p-4 border-t border-[var(--border-subtle)] shrink-0">
        <div className="flex flex-col gap-2 bg-[var(--card-bg)] border border-[var(--border-subtle)] rounded-2xl px-4 py-3 focus-within:border-[color:var(--accent)]/50 focus-within:ring-1 focus-within:ring-[color:var(--accent)]/20 transition-all">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder="输入消息..."
            rows={1}
            className="w-full bg-transparent text-sm outline-none resize-none min-h-[24px] max-h-[120px] py-1 text-[color:var(--label-primary)] placeholder:text-[color:var(--label-secondary)]/60"
          />
          <div ref={menuRef} className="flex items-center justify-between relative">
            <div className="flex items-center gap-1 text-[color:var(--label-secondary)]">
              <button className="p-1.5 rounded-lg hover:bg-[var(--nav-active-fill)] shrink-0">
                <Plus className="w-4 h-4" />
              </button>
              <div className="w-px h-4 bg-[var(--border-subtle)] mx-1" />
              <InlineSelect
                label="模型"
                value={model}
                options={models}
                open={openMenu === "model"}
                onToggle={() => setOpenMenu((m) => (m === "model" ? null : "model"))}
                onSelect={(v) => {
                  setModel(v);
                  setOpenMenu(null);
                }}
              />
              <div className="w-px h-4 bg-[var(--border-subtle)] mx-1" />
              <InlineSelect
                label="技能"
                value={skill}
                options={skillsOptions}
                open={openMenu === "skill"}
                onToggle={() => setOpenMenu((m) => (m === "skill" ? null : "skill"))}
                onSelect={(v) => {
                  setSkill(v);
                  setOpenMenu(null);
                }}
              />
            </div>
            <div className="flex items-center gap-2">
              <InlineSelect
                label={autoMode}
                value={autoMode}
                options={AUTO_MODES}
                open={openMenu === "auto"}
                showValue={false}
                onToggle={() => setOpenMenu((m) => (m === "auto" ? null : "auto"))}
                onSelect={(v) => {
                  setAutoMode(v);
                  setOpenMenu(null);
                }}
              />
              <button
                onClick={onSend}
                disabled={!input.trim() || loading}
                className="w-9 h-9 rounded-xl bg-[var(--foreground)] text-white hover:opacity-90 disabled:opacity-40 shrink-0 flex items-center justify-center transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function NewChatWelcome({
  skills,
  onSkillSelect,
}: {
  skills: SkillOption[];
  onSkillSelect?: (id: string) => void;
}) {
  return (
    <div className="h-full flex flex-col justify-end px-5 pb-6">
      <div className="space-y-5">
        <div>
          <h2 className="text-2xl font-semibold mb-2">👋 嗨，准备好创作了吗？</h2>
          <p className="text-sm text-[color:var(--label-secondary)]">或者试试以下技能</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {skills.map((s) => (
            <button
              key={s.id}
              onClick={() => onSkillSelect?.(s.id)}
              className="px-3 py-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--card-bg)] hover:bg-[var(--nav-active-fill)] text-sm transition-colors text-center"
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-[color:var(--label-secondary)]">
          <FileText className="w-3.5 h-3.5" />
          <span>也可以拖入 .md 文件来导入自定义技能</span>
        </div>
      </div>
    </div>
  );
}

function InlineSelect({
  label,
  value,
  options,
  open,
  showValue = true,
  onToggle,
  onSelect,
}: {
  label: string;
  value: string;
  options: string[];
  open: boolean;
  showValue?: boolean;
  onToggle: () => void;
  onSelect: (v: string) => void;
}) {
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className={classNames(
          "px-2 py-1 rounded-lg text-xs flex items-center gap-1 transition-colors",
          open ? "bg-[var(--nav-active-fill)] text-[color:var(--accent)]" : "hover:bg-[var(--nav-active-fill)] text-[color:var(--label-secondary)]"
        )}
      >
        {showValue ? label : value} <ChevronRight className={classNames("w-3 h-3 transition-transform", open ? "rotate-180" : "-rotate-90")} />
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-1.5 w-40 bg-[var(--card-bg)] border border-[var(--border-subtle)] rounded-xl shadow-lg overflow-hidden z-50">
          {options.map((opt) => (
            <button
              key={opt}
              onClick={() => onSelect(opt)}
              className={classNames(
                "w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-[var(--nav-active-fill)] transition-colors",
                opt === value && "text-[color:var(--accent)]"
              )}
            >
              {opt}
              {opt === value && <Check className="w-3 h-3" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MessageItem({
  msg,
  loading,
  onAction,
}: {
  msg: ChatMessage;
  loading: boolean;
  onAction: (actionId: string, nodeId?: string) => void;
}) {
  const isUser = msg.role === "user";
  return (
    <div className={classNames("flex items-start gap-2.5", isUser && "flex-row-reverse")}>
      <div
        className={classNames(
          "w-6 h-6 rounded-full flex items-center justify-center shrink-0",
          isUser ? "bg-[var(--nav-active-fill)]" : "bg-[color:var(--accent)]/10"
        )}
      >
        {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5 text-[color:var(--accent)]" />}
      </div>
      <div className={classNames("flex-1 min-w-0", isUser && "text-right")}>
        <div
          className={classNames(
            "inline-block text-left text-sm leading-relaxed",
            isUser ? "bg-[color:var(--accent)] text-white rounded-2xl px-3.5 py-2.5 rounded-tr-none" : "px-1 py-0.5"
          )}
        >
          <SimpleContent text={msg.content} />
        </div>
        {msg.actions && msg.actions.length > 0 && (
          <div className={classNames("flex flex-wrap gap-2 mt-2", isUser && "justify-end")}>
            {msg.actions.map((a) => (
              <button
                key={a.id}
                onClick={() => onAction(a.id, msg.nodeId)}
                disabled={loading}
                className={classNames(
                  "px-3 py-1.5 rounded-lg text-xs font-medium transition-opacity",
                  a.variant === "primary"
                    ? "bg-[color:var(--accent)] text-white"
                    : "bg-[var(--card-bg)] border border-[var(--border-subtle)]"
                )}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SimpleContent({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    elements.push(
      <ul key={`list-${elements.length}`} className="list-disc pl-4 my-1.5 space-y-0.5">
        {listItems.map((item, i) => (
          <li key={i} className="pl-1">
            <span className={classNames(isFileLike(item) && "underline decoration-[color:var(--accent)]/50 underline-offset-2")}>{item}</span>
          </li>
        ))}
      </ul>
    );
    listItems = [];
  };

  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) return;
    const bulletMatch = line.match(/^[\-\•]\s+(.*)/);
    if (bulletMatch) {
      listItems.push(bulletMatch[1]);
      return;
    }
    flushList();
    elements.push(
      <p key={`p-${idx}`} className="my-1.5">
        {line}
      </p>
    );
  });
  flushList();

  return <>{elements}</>;
}

function isFileLike(line: string) {
  return /\.[a-zA-Z0-9]{2,6}(\s|$)/.test(line) || (line.includes("_") && line.length > 20);
}
