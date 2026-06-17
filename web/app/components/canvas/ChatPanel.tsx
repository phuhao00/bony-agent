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
} from "lucide-react";
import type { ChatAction, ChatMessage } from "@/hooks/useCanvas";

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
  skills?: SkillOption[];
  onSkillSelect?: (id: string) => void;
  defaultSkill?: string;
}

function classNames(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

const FALLBACK_MODELS = ["GLM-4", "Gemini 1.5 Pro", "DeepSeek-V3", "OpenRouter"];
const FALLBACK_SKILLS = ["Default", "Creative Boost", "SEO Writer", "Code Review"];
const AUTO_MODES = ["Auto", "Orchestrator", "Planning", "Lobster", "Chat", "Claude Code"];

const DEFAULT_SKILLS: SkillOption[] = [
  { id: "animal-podcast", label: "Animal Podcast" },
  { id: "audiobook", label: "Audiobook" },
  { id: "image-remix", label: "Image Remix" },
  { id: "short-drama", label: "Short Drama" },
  { id: "skill-creator", label: "Skill Creator" },
  { id: "skill-reviewer", label: "Skill Reviewer" },
];

export function ChatPanel({
  projectPath,
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
  skills = DEFAULT_SKILLS,
  onSkillSelect,
  defaultSkill,
}: ChatPanelProps) {
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [todoOpen, setTodoOpen] = useState(false);
  const [model, setModel] = useState("GLM-4");
  const [skill, setSkill] = useState("Default");
  const [autoMode, setAutoMode] = useState("Auto");
  const [openMenu, setOpenMenu] = useState<"model" | "skill" | "auto" | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [models, setModels] = useState<string[]>(FALLBACK_MODELS);
  const [skillsOptions, setSkillsOptions] = useState<string[]>(FALLBACK_SKILLS);

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
          <span className="text-sm font-semibold truncate">{isNewChat ? title || "New Chat" : projectPath || title || "Chat"}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[color:var(--label-secondary)]">
          <button onClick={onNewChat} className="w-8 h-8 rounded-lg bg-[var(--nav-active-fill)] hover:bg-[var(--border-subtle)] flex items-center justify-center transition-colors" title="New chat">
            <Plus className="w-4 h-4" />
          </button>
          <button className="w-8 h-8 rounded-lg bg-[var(--nav-active-fill)] hover:bg-[var(--border-subtle)] flex items-center justify-center transition-colors" title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button className="w-8 h-8 rounded-lg bg-[var(--nav-active-fill)] hover:bg-[var(--border-subtle)] flex items-center justify-center transition-colors" title="Expand">
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
            {/* Todo list */}
            {todo && (
              <div className="border-b border-[var(--border-subtle)]">
                <button
                  onClick={() => setTodoOpen((s) => !s)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-[var(--nav-active-fill)] transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Todo List</span>
                    <span className="text-xs text-[color:var(--label-secondary)]">
                      {todo.done}/{todo.total} tasks done
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
            placeholder="Type a message..."
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
                label="Models"
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
                label="Skills"
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
          <h2 className="text-2xl font-semibold mb-2">👋 Hi, ready to create?</h2>
          <p className="text-sm text-[color:var(--label-secondary)]">Or try one of these skills</p>
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
          <span>You can also drag in a .md file to import your own skill</span>
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
