import {
  BarChart,
  Callout,
  Card,
  CardBody,
  CardHeader,
  CollapsibleSection,
  colorPalette,
  computeDAGLayout,
  Divider,
  Grid,
  H1,
  H2,
  H3,
  LineChart,
  mergeStyle,
  PieChart,
  Pill,
  Row,
  Stack,
  Stat,
  Swatch,
  Table,
  Text,
  UsageBar,
  usageColorSequence,
  useHostTheme,
} from "cursor/canvas";

const PIPELINE_STEPS = [
  "script",
  "storyboard",
  "image",
  "video",
  "voice",
  "subtitle",
  "remix",
  "publish",
] as const;

function pickColor(index: number): string {
  const key = usageColorSequence[index % usageColorSequence.length];
  return colorPalette[key];
}

function ColorLegend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <Row gap={10} wrap style={{ alignItems: "center", padding: "8px 12px" }}>
      {items.map((item) => (
        <Row key={item.label} gap={6} style={{ alignItems: "center" }}>
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              borderRadius: 3,
              background: item.color,
            }}
          />
          <Text size="small" tone="secondary">
            {item.label}
          </Text>
        </Row>
      ))}
    </Row>
  );
}

function DiagramChrome({ title, height, svg }: { title: string; height: number; svg: JSX.Element }) {
  return (
    <Card>
      <CardHeader>{title}</CardHeader>
      <CardBody style={mergeStyle({ padding: 0 })}>
        <svg viewBox="0 0 700 380" width="100%" height={height} preserveAspectRatio="xMidYMid meet">
          {svg}
        </svg>
      </CardBody>
    </Card>
  );
}

function SvgDefsArrow({ markerId, fill }: { markerId: string; fill: string }) {
  return (
    <defs>
      <marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
        <polygon points="0 0, 8 4, 0 8" fill={fill} />
      </marker>
    </defs>
  );
}

function LayeredArchitectureFigure() {
  const t = useHostTheme();
  const mid = "arr-layer";
  const layers = [
    { x: 210, y: 12, w: 280, h: 40, label: "用户浏览器", c: 5 },
    { x: 130, y: 76, w: 440, h: 40, label: "Next.js（App Router / web/app/api 代理）", c: 4 },
    { x: 160, y: 140, w: 380, h: 40, label: "FastAPI main.py · 路由与健康检查", c: 2 },
    { x: 52, y: 204, w: 180, h: 44, label: "agents/", c: 0 },
    { x: 260, y: 204, w: 180, h: 44, label: "tools/ + connectors/", c: 1 },
    { x: 468, y: 204, w: 180, h: 44, label: "services/ · utils/", c: 3 },
    { x: 32, y: 268, w: 200, h: 40, label: "LLM · 媒体云 API", c: 6 },
    { x: 250, y: 268, w: 200, h: 40, label: "社交 / 浏览器 Playwright", c: 5 },
    { x: 468, y: 268, w: 200, h: 40, label: "storage/ · rag/ · traces/", c: 4 },
  ];
  const arrowDn = (x: number, y1: number, y2: number, color: string) => (
    <line x1={x} y1={y1} x2={x} y2={y2} stroke={color} strokeWidth={1.5} markerEnd={`url(#${mid})`} />
  );
  const cx = 350;
  return (
    <Card>
      <CardHeader>总体分层（浏览器 → 前端 → FastAPI → 领域层 → 外部世界）</CardHeader>
      <CardBody style={mergeStyle({ padding: 0 })}>
        <svg viewBox="0 0 700 380" width="100%" height={320} preserveAspectRatio="xMidYMid meet">
          <SvgDefsArrow markerId={mid} fill={t.accent.primary} />
          {layers.map((layer) => (
            <g key={layer.label}>
              <rect
                x={layer.x}
                y={layer.y}
                width={layer.w}
                height={layer.h}
                rx={6}
                ry={6}
                fill={pickColor(layer.c)}
                stroke={t.stroke.secondary}
                strokeWidth={1}
              />
              <text
                x={layer.x + layer.w / 2}
                y={layer.y + layer.h / 2 + 4}
                textAnchor="middle"
                fill={t.text.onAccent}
                fontSize={12}
                fontFamily='ui-sans-serif, system-ui, sans-serif'>
                {layer.label}
              </text>
            </g>
          ))}
          {arrowDn(cx, 52, 76, pickColor(5))}
          {arrowDn(cx, 116, 140, pickColor(4))}
          {arrowDn(cx, 180, 204, pickColor(2))}
          <line x1={cx} y1={248} x2={cx} y2={268} stroke={pickColor(3)} strokeWidth={1.5} markerEnd={`url(#${mid})`} />
          <text x={24} y={360} fill={t.text.tertiary} fontSize={11} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            数据面：工具与 Agent 通过 utils 写 storage；RAG 走 rag_manager；发布走连接器凭证（profiles）。
          </text>
        </svg>
        <ColorLegend
          items={[
            { color: pickColor(0), label: "Agent 层" },
            { color: pickColor(1), label: "工具/连接器" },
            { color: pickColor(2), label: "API 网关" },
            { color: pickColor(4), label: "前端" },
            { color: pickColor(6), label: "外部依赖" },
          ]}
        />
      </CardBody>
    </Card>
  );
}

function DagBackendFlowFigure() {
  const t = useHostTheme();
  const mid = "arr-dag1";
  const layout = computeDAGLayout({
    nodes: [
      { id: "http" },
      { id: "route" },
      { id: "agent" },
      { id: "tool" },
      { id: "ext" },
      { id: "store" },
    ],
    edges: [
      { from: "http", to: "route" },
      { from: "route", to: "agent" },
      { from: "agent", to: "tool" },
      { from: "tool", to: "ext" },
      { from: "tool", to: "store" },
      { from: "route", to: "store" },
    ],
    nodeWidth: 118,
    nodeHeight: 36,
    rankGap: 50,
    nodeGap: 28,
    padding: 16,
    direction: "vertical",
  });
  const L: Record<string, string> = {
    http: "HTTP 入口",
    route: "Router / orchestrator.py",
    agent: "Agent 节点",
    tool: "@tool 原子能力",
    ext: "模型与供应商 API",
    store: "落盘 trace / outputs",
  };
  const NW = 118;
  const NH = 36;
  return (
    <Card>
      <CardHeader>典型后端调用 DAG（单次请求拆解）</CardHeader>
      <CardBody style={mergeStyle({ padding: 0 })}>
        <svg viewBox={`0 0 ${layout.width} ${layout.height + 28}`} width="100%" height={layout.height + 36}>
          <SvgDefsArrow markerId={mid} fill={t.accent.primary} />
          {layout.edges.map((e, i) => (
            <line
              key={i}
              x1={e.sourceX}
              y1={e.sourceY}
              x2={e.targetX}
              y2={e.targetY}
              stroke={pickColor(i % 5)}
              strokeWidth={e.isBackEdge ? 1 : 1.25}
              strokeDasharray={e.isBackEdge ? "5 4" : undefined}
              markerEnd={`url(#${mid})`}
            />
          ))}
          {layout.nodes.map((n, i) => (
            <g key={n.id}>
              <rect
                x={n.x}
                y={n.y}
                width={NW}
                height={NH}
                rx={5}
                ry={5}
                fill={pickColor(i)}
                stroke={t.stroke.secondary}
                strokeWidth={1}
              />
              <text
                x={n.x + NW / 2}
                y={n.y + NH / 2 + 4}
                textAnchor="middle"
                fill={t.text.onAccent}
                fontSize={11}
                fontFamily='ui-sans-serif, system-ui, sans-serif'>
                {L[n.id] ?? n.id}
              </text>
            </g>
          ))}
          <text x={12} y={layout.height + 18} fill={t.text.tertiary} fontSize={11} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            并行：工具链末端既可能调外部计费 API，也同时写本地产物；编排层可直接挂 trace。
          </text>
        </svg>
      </CardBody>
    </Card>
  );
}

function RoutingModesFigure() {
  const t = useHostTheme();
  const mid = "arr-route";
  const nodes = [
    { x: 260, y: 16, w: 180, h: 40, label: "用户请求", c: 5 },
    { x: 250, y: 84, w: 200, h: 40, label: "IntentRouter · 两级", c: 4 },
    { x: 40, y: 168, w: 160, h: 52, label: "关键词表命中", sub: "零延迟映射 Agent", c: 2 },
    { x: 500, y: 168, w: 160, h: 52, label: "LLM 分类", sub: "模糊意图兜底", c: 6 },
    { x: 220, y: 274, w: 260, h: 44, label: "RouteResult → Orchestrator / 单 Agent", c: 0 },
  ];
  return (
    <DiagramChrome
      title="路由器策略（router.py）：关键词快路径与 LLM 兜底"
      height={360}
      svg={
        <>
          <SvgDefsArrow markerId={mid} fill={pickColor(4)} />
          {nodes.map((n) => (
            <g key={n.label}>
              <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={6} fill={pickColor(n.c)} stroke={t.stroke.secondary} strokeWidth={1} />
              <text x={n.x + n.w / 2} y={n.y + (n.sub ? 24 : 26)} textAnchor="middle" fill={t.text.onAccent} fontSize={n.sub ? 11 : 12} fontFamily='ui-sans-serif, system-ui, sans-serif'>
                {n.label}
              </text>
              {n.sub ? (
                <text x={n.x + n.w / 2} y={n.y + 40} textAnchor="middle" fill={t.text.onAccent} fontSize={10} fontFamily='ui-sans-serif, system-ui, sans-serif' opacity={0.85}>
                  {n.sub}
                </text>
              ) : null}
            </g>
          ))}
          <line x1={350} y1={56} x2={350} y2={84} stroke={pickColor(5)} strokeWidth={1.5} markerEnd={`url(#${mid})`} />
          <line x1={310} y1={124} x2={120} y2={168} stroke={pickColor(2)} strokeWidth={1.5} markerEnd={`url(#${mid})`} />
          <line x1={390} y1={124} x2={580} y2={168} stroke={pickColor(6)} strokeWidth={1.5} markerEnd={`url(#${mid})`} />
          <line x1={120} y1={220} x2={290} y2={274} stroke={pickColor(2)} strokeWidth={1.5} markerEnd={`url(#${mid})`} />
          <line x1={580} y1={220} x2={410} y2={274} stroke={pickColor(6)} strokeWidth={1.5} markerEnd={`url(#${mid})`} />
          <text x={24} y={344} fill={t.text.tertiary} fontSize={11} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            orchestrator.py：Supervisor 状态机在 Agent 节点与结束条件之间切换；可与 LangGraph Runnable 对齐。
          </text>
        </>
      }
    />
  );
}

function MultiAgentCycleFigure() {
  const t = useHostTheme();
  const mid = "arr-cycle";
  const loopColor = pickColor(3);
  return (
    <DiagramChrome
      title="多 Agent Supervisor 循环（概念）"
      height={340}
      svg={
        <>
          <SvgDefsArrow markerId={mid} fill={loopColor} />
          <rect x={270} y={20} width={160} height={40} rx={6} fill={pickColor(4)} stroke={t.stroke.secondary} strokeWidth={1} />
          <text x={350} y={46} textAnchor="middle" fill={t.text.onAccent} fontSize={12} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            supervisor_node
          </text>
          <path d="M 350 60 L 350 88" stroke={pickColor(4)} strokeWidth={1.5} fill="none" markerEnd={`url(#${mid})`} />
          <rect x={255} y={88} width={190} height={40} rx={6} fill={pickColor(1)} stroke={t.stroke.secondary} strokeWidth={1} />
          <text x={350} y={114} textAnchor="middle" fill={t.text.onAccent} fontSize={12} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            agent_node（专业子图）
          </text>
          <path
            d="M 350 128 Q 560 148 560 216 Q 560 288 350 288 Q 140 288 140 216 Q 140 148 350 128"
            stroke={loopColor}
            strokeWidth={1.5}
            strokeDasharray="6 5"
            fill="none"
            markerEnd={`url(#${mid})`}
          />
          <text x={565} y={200} fill={pickColor(3)} fontSize={11} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            未结束则回到督导
          </text>
          <path d="M 350 288 L 350 320" stroke={pickColor(0)} strokeWidth={1.5} fill="none" markerEnd={`url(#${mid})`} />
          <rect x={245} y={320} width={210} height={40} rx={6} fill={pickColor(0)} stroke={t.stroke.secondary} strokeWidth={1} />
          <text x={350} y={346} textAnchor="middle" fill={t.text.onAccent} fontSize={12} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            END · 聚合输出 / trace
          </text>
          <text x={24} y={372} fill={t.text.tertiary} fontSize={11} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            对应 AGENTS.md 中的「supervisor ↔ agent ↔ supervisor」闭环；DAG 算法会将回边标为虚线类比。
          </text>
        </>
      }
    />
  );
}

function MediaPipelineFigure() {
  const t = useHostTheme();
  const mid = "arr-pipe";
  const titles = ["剧本", "分镜", "图", "视频", "配音", "字幕", "混剪", "发布"];
  const x0 = 28;
  const gap = 6;
  const w = (700 - x0 * 2 - gap * (PIPELINE_STEPS.length - 1)) / PIPELINE_STEPS.length;
  const y = 100;
  const h = 40;
  return (
    <Card>
      <CardHeader>媒体流水线步骤（core/media_pipeline.py · PIPELINE_STEP_IDS）</CardHeader>
      <CardBody style={mergeStyle({ padding: 12 })}>
        <svg viewBox="0 0 700 210" width="100%" height={200}>
          <SvgDefsArrow markerId={mid} fill={t.accent.primary} />
          <text x={24} y={28} fill={t.text.secondary} fontSize={12} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            Task metadata 中为每步保存 status（pending / running / completed / skipped / waiting_approval / failed）。
          </text>
          {PIPELINE_STEPS.map((id, i) => {
            const x = x0 + i * (w + gap);
            const fill = pickColor(i);
            return (
              <g key={id}>
                <rect x={x} y={y} width={w} height={h} rx={5} fill={fill} stroke={t.stroke.secondary} strokeWidth={1} />
                <text
                  x={x + w / 2}
                  y={y + 16}
                  textAnchor="middle"
                  fill={t.text.onAccent}
                  fontSize={9}
                  fontFamily='ui-monospace, monospace'>
                  {id}
                </text>
                <text
                  x={x + w / 2}
                  y={y + 32}
                  textAnchor="middle"
                  fill={t.text.onAccent}
                  fontSize={11}
                  fontFamily='ui-sans-serif, system-ui, sans-serif'>
                  {titles[i] ?? id}
                </text>
                {i < PIPELINE_STEPS.length - 1 ? (
                  <line
                    x1={x + w}
                    y1={y + h / 2}
                    x2={x + w + gap}
                    y2={y + h / 2}
                    stroke={pickColor(i + 1)}
                    strokeWidth={1.5}
                    markerEnd={`url(#${mid})`}
                  />
                ) : null}
              </g>
            );
          })}
        </svg>
      </CardBody>
    </Card>
  );
}

function GrpcStackFigure() {
  const t = useHostTheme();
  const mid = "arr-grpc";
  return (
    <DiagramChrome
      title="gRPC 边界：Python FastAPI ⇄ OCR / Rust 安全引擎 / Go 高并发引擎"
      height={340}
      svg={
        <>
          <SvgDefsArrow markerId={mid} fill={t.accent.primary} />
          <rect x={230} y={16} width={240} height={44} rx={6} fill={pickColor(4)} stroke={t.stroke.secondary} strokeWidth={1} />
          <text x={350} y={44} textAnchor="middle" fill={t.text.onAccent} fontSize={12} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            services/grpc_client.py
          </text>
          <line x1={350} y1={60} x2={350} y2={86} stroke={pickColor(4)} strokeWidth={1.5} markerEnd={`url(#${mid})`} />
          {[
            { x: 30, cx: 125, port: ":50051 OCR", sub: "图像文字", c: 6 },
            { x: 255, cx: 350, port: ":50052 Rust", sub: "文档 / 视频解析 · 加密", c: 2 },
            { x: 480, cx: 575, port: ":50053 Go", sub: "目录检索 / 批量 IO", c: 0 },
          ].map((svc) => (
            <g key={svc.port}>
              <rect x={svc.x} y={86} width={190} height={56} rx={6} fill={pickColor(svc.c)} stroke={t.stroke.secondary} strokeWidth={1} />
              <text x={svc.cx} y={112} textAnchor="middle" fill={t.text.onAccent} fontSize={11} fontFamily='ui-sans-serif, system-ui, sans-serif'>
                {svc.port}
              </text>
              <text x={svc.cx} y={130} textAnchor="middle" fill={t.text.onAccent} fontSize={10} fontFamily='ui-sans-serif, system-ui, sans-serif' opacity={0.9}>
                {svc.sub}
              </text>
            </g>
          ))}
          <text x={24} y={200} fill={t.text.primary} fontSize={12} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            触发场景（节选）
          </text>
          <text x={40} y={224} fill={t.text.secondary} fontSize={11} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            · multimodal_tools / 二进制解析 → Rust 文档或视频拆分
          </text>
          <text x={40} y={244} fill={t.text.secondary} fontSize={11} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            · computer_service 目录枚举 → Go Directory Service
          </text>
          <text x={40} y={264} fill={t.text.secondary} fontSize={11} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            · 媒体上传 OCR 需求 → OCR gRPC
          </text>
          <text x={24} y={312} fill={t.text.tertiary} fontSize={11} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            生产环境可叠加 TLS / mTLS；本地开发常仅起 Python，微服务未启动时相关工具会降级或报错（以具体调用为准）。
          </text>
        </>
      }
    />
  );
}

function WorkflowEngineFigure() {
  const t = useHostTheme();
  const mid = "arr-wfe";
  const blocks = [
    { x: 205, y: 20, w: 290, h: 48, label: "Python asyncio", sub: "LangChain tools / Agents", c: 4 },
    { x: 60, y: 118, w: 220, h: 56, label: "Go DAG 调度", sub: "in-degree / 并发扇出", c: 0 },
    { x: 420, y: 118, w: 220, h: 56, label: "Rust（设计位）", sub: "crash-safe / 凭证加密", c: 2 },
    { x: 200, y: 248, w: 300, h: 56, label: "SSE 事件流", sub: "step_start · step_done · workflow_done", c: 5 },
  ];
  return (
    <DiagramChrome
      title="工作流 DAG 引擎薄片（workflow_engine.py 自述）"
      height={340}
      svg={
        <>
          <SvgDefsArrow markerId={mid} fill={pickColor(4)} />
          {blocks.map((b) => (
            <g key={b.label}>
              <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={6} fill={pickColor(b.c)} stroke={t.stroke.secondary} strokeWidth={1} />
              <text x={b.x + b.w / 2} y={b.y + (b.sub ? 28 : 32)} textAnchor="middle" fill={t.text.onAccent} fontSize={12} fontFamily='ui-sans-serif, system-ui, sans-serif'>
                {b.label}
              </text>
              {b.sub ? (
                <text x={b.x + b.w / 2} y={b.y + 46} textAnchor="middle" fill={t.text.onAccent} fontSize={10} fontFamily='ui-sans-serif, system-ui, sans-serif' opacity={0.9}>
                  {b.sub}
                </text>
              ) : null}
            </g>
          ))}
          <line x1={350} y1={68} x2={170} y2={118} stroke={pickColor(0)} strokeWidth={1.5} markerEnd={`url(#${mid})`} />
          <line x1={350} y1={68} x2={530} y2={118} stroke={pickColor(2)} strokeWidth={1.5} markerEnd={`url(#${mid})`} />
          <line x1={170} y1={174} x2={350} y2={248} stroke={pickColor(0)} strokeWidth={1.25} markerEnd={`url(#${mid})`} />
          <line x1={530} y1={174} x2={350} y2={248} stroke={pickColor(2)} strokeWidth={1.25} markerEnd={`url(#${mid})`} />
          <text x={24} y={330} fill={t.text.tertiary} fontSize={11} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            实际落地以 workflow_engine 与 Go/Rust 侧实现为准；此处强调「调度与执行分离」。
          </text>
        </>
      }
    />
  );
}

function ElectronDesktopServicesFigure() {
  const t = useHostTheme();
  const mid = "arr-electron-svc";
  const services = [
    { label: "Next.js", port: ":3000", x: 40 },
    { label: "FastAPI", port: ":8000", x: 155 },
    { label: "OCR gRPC", port: ":50051", x: 270 },
    { label: "Rust parser", port: ":50052", x: 385 },
    { label: "Go directory", port: ":50053", x: 500 },
  ];
  return (
    <Card>
      <CardHeader>Electron 桌面版托管的五服务（main.js 统一拉起）</CardHeader>
      <CardBody style={mergeStyle({ padding: 12 })}>
        <svg viewBox="0 0 700 200" width="100%" height={190}>
          <SvgDefsArrow markerId={mid} fill={t.accent.primary} />
          <rect x={220} y={12} width={260} height={40} rx={6} fill={pickColor(4)} stroke={t.stroke.secondary} strokeWidth={1} />
          <text x={350} y={38} textAnchor="middle" fill={t.text.onAccent} fontSize={12} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            Electron 主进程 · 托盘 / 状态窗
          </text>
          <line x1={350} y1={52} x2={350} y2={72} stroke={pickColor(4)} strokeWidth={1.5} markerEnd={`url(#${mid})`} />
          {services.map((s, i) => (
            <g key={s.label}>
              <line x1={350} y1={72} x2={s.x + 55} y2={108} stroke={pickColor(i)} strokeWidth={1.25} markerEnd={`url(#${mid})`} />
              <rect x={s.x} y={108} width={110} height={48} rx={5} fill={pickColor(i)} stroke={t.stroke.secondary} strokeWidth={1} />
              <text x={s.x + 55} y={130} textAnchor="middle" fill={t.text.onAccent} fontSize={11} fontFamily='ui-sans-serif, system-ui, sans-serif'>
                {s.label}
              </text>
              <text x={s.x + 55} y={146} textAnchor="middle" fill={t.text.onAccent} fontSize={10} fontFamily='ui-monospace, monospace' opacity={0.9}>
                {s.port}
              </text>
            </g>
          ))}
          <text x={24} y={182} fill={t.text.tertiary} fontSize={11} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            来源：electron/README.md；开发模式需先 ./start_local.sh，打包版从 resources/ 复制到用户数据目录后自启。
          </text>
        </svg>
      </CardBody>
    </Card>
  );
}

function ElectronStartupFlowFigure() {
  const t = useHostTheme();
  const mid = "arr-startup";
  const nodes = [
    { x: 250, y: 16, w: 200, h: 36, label: "app.whenReady", sub: "托盘 · 单实例锁" },
    { x: 230, y: 72, w: 240, h: 36, label: "setup.html 向导", sub: "首次 / 缺 Python·Node" },
    { x: 250, y: 128, w: 200, h: 36, label: "splash.html", sub: "sync · backend · frontend" },
    { x: 210, y: 184, w: 280, h: 36, label: "syncAppResources + pip", sub: ".bundle_revision 增量同步" },
    { x: 230, y: 240, w: 240, h: 36, label: "spawn 五服务", sub: ":3000 · :8000 · gRPC" },
    { x: 250, y: 296, w: 200, h: 36, label: "Dashboard / 托盘", sub: "status.html 可选" },
  ];
  return (
    <Card>
      <CardHeader>Electron 启动链路（main.js · renderer/）</CardHeader>
      <CardBody style={mergeStyle({ padding: 12 })}>
        <svg viewBox="0 0 700 360" width="100%" height={350}>
          <SvgDefsArrow markerId={mid} fill={t.accent.primary} />
          {nodes.map((n, i) => (
            <g key={n.label}>
              <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={5} fill={pickColor(i)} stroke={t.stroke.secondary} strokeWidth={1} />
              <text x={n.x + n.w / 2} y={n.y + 18} textAnchor="middle" fill={t.text.onAccent} fontSize={11} fontFamily='ui-sans-serif, system-ui, sans-serif'>
                {n.label}
              </text>
              <text x={n.x + n.w / 2} y={n.y + 32} textAnchor="middle" fill={t.text.onAccent} fontSize={9} fontFamily='ui-sans-serif, system-ui, sans-serif' opacity={0.85}>
                {n.sub}
              </text>
              {i < nodes.length - 1 ? (
                <line
                  x1={350}
                  y1={n.y + n.h}
                  x2={350}
                  y2={nodes[i + 1].y}
                  stroke={pickColor(i + 1)}
                  strokeWidth={1.5}
                  markerEnd={`url(#${mid})`}
                />
              ) : null}
            </g>
          ))}
          <line x1={120} y1={90} x2={120} y2={128} stroke={t.stroke.primary} strokeWidth={1} strokeDasharray="4 3" />
          <text x={24} y={94} fill={t.text.secondary} fontSize={10} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            缺 .setup_done
          </text>
          <line x1={580} y1={146} x2={580} y2={184} stroke={t.stroke.primary} strokeWidth={1} strokeDasharray="4 3" />
          <text x={592} y={168} fill={t.text.secondary} fontSize={10} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            覆盖升级
          </text>
          <text x={24} y={348} fill={t.text.tertiary} fontSize={11} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            内置 Python 3.12（python-build-standalone）与 Node 22 便携包；DMG 首次运行可一键安装到「应用程序」。
          </text>
        </svg>
      </CardBody>
    </Card>
  );
}

function MobileIosClientFigure() {
  const t = useHostTheme();
  const mid = "arr-ios";
  return (
    <DiagramChrome
      title="iOS 客户端（mobile/ · Capacitor WKWebView）"
      height={300}
      svg={
        <>
          <SvgDefsArrow markerId={mid} fill={pickColor(5)} />
          {[
            { x: 40, y: 24, w: 160, h: 52, label: "iPhone App", sub: "Capacitor 壳", c: 6 },
            { x: 280, y: 24, w: 180, h: 52, label: "桌面版 / 云端", sub: ":3000 Next.js", c: 2 },
            { x: 520, y: 24, w: 160, h: 52, label: "全屏 Web UI", sub: "与 Electron 同源", c: 4 },
          ].map((box, i) => (
            <g key={box.label}>
              {i > 0 ? (
                <line
                  x1={i === 1 ? 200 : 460}
                  y1={50}
                  x2={i === 1 ? 280 : 520}
                  y2={50}
                  stroke={pickColor(box.c)}
                  strokeWidth={2}
                  markerEnd={`url(#${mid})`}
                />
              ) : null}
              <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={6} fill={pickColor(box.c)} stroke={t.stroke.secondary} strokeWidth={1} />
              <text x={box.x + box.w / 2} y={box.y + 26} textAnchor="middle" fill={t.text.onAccent} fontSize={11} fontFamily='ui-sans-serif, system-ui, sans-serif'>
                {box.label}
              </text>
              <text x={box.x + box.w / 2} y={box.y + 42} textAnchor="middle" fill={t.text.onAccent} fontSize={10} fontFamily='ui-sans-serif, system-ui, sans-serif' opacity={0.9}>
                {box.sub}
              </text>
            </g>
          ))}
          <text x={24} y={120} fill={t.text.primary} fontSize={12} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            构建：mobile/build_ios.sh → Xcode Archive / TestFlight
          </text>
          <text x={40} y={148} fill={t.text.secondary} fontSize={11} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            · 首次启动输入 http://&lt;Mac 局域网 IP&gt;:3000 或 HTTPS 域名
          </text>
          <text x={40} y={168} fill={t.text.secondary} fontSize={11} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            · 模拟器勿用 127.0.0.1，需填 Mac 本机局域网地址
          </text>
          <text x={40} y={188} fill={t.text.secondary} fontSize={11} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            · 浏览器自动化、本地 gRPC 等能力仍依赖桌面端后端在线
          </text>
          <text x={24} y={248} fill={t.text.tertiary} fontSize={11} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            定位：移动端原生壳 + 远程控制台；不是把 FastAPI/Playwright 打进 App Store 包。
          </text>
        </>
      }
    />
  );
}

function DesktopFirstRunFigure() {
  const t = useHostTheme();
  const mid = "arr-first-run";
  const steps = [
    "启动 .app / Setup.exe",
    "setup.html 向导（API Key · Python · Node）",
    "复制 resources → APP_DATA",
    "syncAppResources · pip · Playwright",
    "splash 进度 → spawn 五服务",
    "托盘就绪 · 打开 Dashboard",
  ];
  const y0 = 28;
  const h = 32;
  const gap = 10;
  return (
    <Card>
      <CardHeader>桌面端首次启动（终端用户）</CardHeader>
      <CardBody style={mergeStyle({ padding: 12 })}>
        <svg viewBox="0 0 700 280" width="100%" height={270}>
          <SvgDefsArrow markerId={mid} fill={t.accent.primary} />
          {steps.map((label, i) => {
            const y = y0 + i * (h + gap);
            const fill = pickColor(i);
            return (
              <g key={label}>
                <rect x={180} y={y} width={340} height={h} rx={5} fill={fill} stroke={t.stroke.secondary} strokeWidth={1} />
                <text x={200} y={y + 20} fill={t.text.onAccent} fontSize={10} fontFamily='ui-monospace, monospace' opacity={0.85}>
                  {i + 1}
                </text>
                <text x={350} y={y + 21} textAnchor="middle" fill={t.text.onAccent} fontSize={11} fontFamily='ui-sans-serif, system-ui, sans-serif'>
                  {label}
                </text>
                {i < steps.length - 1 ? (
                  <line
                    x1={350}
                    y1={y + h}
                    x2={350}
                    y2={y + h + gap}
                    stroke={pickColor(i + 1)}
                    strokeWidth={1.5}
                    markerEnd={`url(#${mid})`}
                  />
                ) : null}
              </g>
            );
          })}
          <text x={24} y={268} fill={t.text.tertiary} fontSize={11} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            .setup_done + .app_version 未变则跳过向导；每次启动仍 sync backend（.bundle_revision）。
          </text>
        </svg>
      </CardBody>
    </Card>
  );
}

const PACK_PREP_STEPS = [
  { id: "go", label: "Go", sub: "directory-service" },
  { id: "rust", label: "Rust", sub: "parser-service" },
  { id: "next", label: "Next.js", sub: "standalone" },
  { id: "py", label: "Python", sub: "backend 拷贝" },
  { id: "ocr", label: "OCR", sub: "gRPC 源码" },
  { id: "icon", label: "图标", sub: "icns / ico" },
] as const;

function PackagingPrepPipelineFigure() {
  const t = useHostTheme();
  const mid = "arr-pack-prep";
  const x0 = 20;
  const gap = 8;
  const w = (700 - x0 * 2 - gap * (PACK_PREP_STEPS.length - 1)) / PACK_PREP_STEPS.length;
  const y = 88;
  const h = 44;
  return (
    <Card>
      <CardHeader>打包共用准备（步骤 1–6，Mac / Win Electron 同源）</CardHeader>
      <CardBody style={mergeStyle({ padding: 12 })}>
        <svg viewBox="0 0 700 200" width="100%" height={190}>
          <SvgDefsArrow markerId={mid} fill={t.accent.primary} />
          <text x={24} y={28} fill={t.text.secondary} fontSize={12} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            由 build_mac.sh 编排；Windows Electron 需在 Win 上执行同等资源准备后 npm run build:win。
          </text>
          {PACK_PREP_STEPS.map((step, i) => {
            const x = x0 + i * (w + gap);
            return (
              <g key={step.id}>
                <rect x={x} y={y} width={w} height={h} rx={5} fill={pickColor(i)} stroke={t.stroke.secondary} strokeWidth={1} />
                <text
                  x={x + w / 2}
                  y={y + 18}
                  textAnchor="middle"
                  fill={t.text.onAccent}
                  fontSize={11}
                  fontFamily='ui-sans-serif, system-ui, sans-serif'>
                  {step.label}
                </text>
                <text
                  x={x + w / 2}
                  y={y + 34}
                  textAnchor="middle"
                  fill={t.text.onAccent}
                  fontSize={9}
                  fontFamily='ui-sans-serif, system-ui, sans-serif'
                  opacity={0.85}>
                  {step.sub}
                </text>
                {i < PACK_PREP_STEPS.length - 1 ? (
                  <line
                    x1={x + w}
                    y1={y + h / 2}
                    x2={x + w + gap}
                    y2={y + h / 2}
                    stroke={pickColor(i + 1)}
                    strokeWidth={1.5}
                    markerEnd={`url(#${mid})`}
                  />
                ) : null}
              </g>
            );
          })}
          <line x1={350} y1={132} x2={350} y2={152} stroke={pickColor(0)} strokeWidth={1.5} markerEnd={`url(#${mid})`} />
          <rect x={175} y={152} width={160} height={36} rx={5} fill={pickColor(2)} stroke={t.stroke.secondary} strokeWidth={1} />
          <text x={255} y={174} textAnchor="middle" fill={t.text.onAccent} fontSize={11} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            macOS · DMG
          </text>
          <rect x={365} y={152} width={160} height={36} rx={5} fill={pickColor(5)} stroke={t.stroke.secondary} strokeWidth={1} />
          <text x={445} y={174} textAnchor="middle" fill={t.text.onAccent} fontSize={11} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            Windows · NSIS
          </text>
        </svg>
      </CardBody>
    </Card>
  );
}

function ConnectorClassFigure() {
  const t = useHostTheme();
  const mid = "arr-conn";
  return (
    <DiagramChrome
      title="平台连接器共性（backend/tools/connectors/base.py）"
      height={300}
      svg={
        <>
          <SvgDefsArrow markerId={mid} fill={t.accent.primary} />
          <rect x={210} y={24} width={280} height={44} rx={6} fill={pickColor(4)} stroke={t.stroke.secondary} strokeWidth={1} />
          <text x={350} y={52} textAnchor="middle" fill={t.text.onAccent} fontSize={12} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            BasePlatformConnector（抽象）
          </text>
          <line x1={285} y1={68} x2={155} y2={118} stroke={pickColor(2)} strokeWidth={1.25} markerEnd={`url(#${mid})`} />
          <line x1={415} y1={68} x2={545} y2={118} stroke={pickColor(6)} strokeWidth={1.25} markerEnd={`url(#${mid})`} />
          <rect x={40} y={118} width={170} height={44} rx={6} fill={pickColor(2)} stroke={t.stroke.secondary} strokeWidth={1} />
          <text x={125} y={146} textAnchor="middle" fill={t.text.onAccent} fontSize={11} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            connect · is_connected
          </text>
          <rect x={490} y={118} width={170} height={44} rx={6} fill={pickColor(6)} stroke={t.stroke.secondary} strokeWidth={1} />
          <text x={575} y={146} textAnchor="middle" fill={t.text.onAccent} fontSize={11} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            publish_* / Cookie / OAuth
          </text>
          <line x1={350} y1={162} x2={350} y2={210} stroke={pickColor(0)} strokeWidth={1.5} markerEnd={`url(#${mid})`} />
          <rect x={175} y={210} width={350} height={44} rx={6} fill={pickColor(0)} stroke={t.stroke.secondary} strokeWidth={1} />
          <text x={350} y={238} textAnchor="middle" fill={t.text.onAccent} fontSize={12} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            manager.py 注册各平台实例 · publisher_tools 统一编排
          </text>
          <text x={24} y={290} fill={t.text.tertiary} fontSize={11} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            Playwright 登录由 browser_login / interactive_login 驱动；POST /connectors/browser/* 与 interactive_login_manager 会话 API。
          </text>
        </>
      }
    />
  );
}

function ColorfulOverviewSection() {
  return (
    <Stack gap={16}>
      <H2>彩色总览图</H2>
      <Text tone="secondary" size="small">
        按仓库现行结构统计的可视化（web/app 共 35 个 page.tsx · .agent/skills 共 43 项 · connectors 12 个发布平台）。
      </Text>

      <Grid columns={2} gap={16}>
        <Card>
          <CardHeader trailing={<Pill tone="info">饼图</Pill>}>桌面运行时组件</CardHeader>
          <CardBody>
            <PieChart
              donut
              size={240}
              data={[
                { label: "Next.js :3000", value: 1, tone: "info" },
                { label: "FastAPI :8000", value: 1, tone: "success" },
                { label: "OCR :50051", value: 1, tone: "warning" },
                { label: "Rust :50052", value: 1, tone: "danger" },
                { label: "Go :50053", value: 1, tone: "neutral" },
                { label: "Playwright 浏览器", value: 1 },
                { label: "ChromaDB / RAG", value: 1 },
              ]}
            />
            <Text tone="tertiary" size="small">
              指标：Electron 托管进程数（等权） · Source: electron/main.js
            </Text>
          </CardBody>
        </Card>

        <Card>
          <CardHeader trailing={<Pill tone="success">柱图</Pill>}>前端路由分组（page 数）</CardHeader>
          <CardBody>
            <BarChart
              height={260}
              categories={["对话/流程", "创作", "媒体", "平台运营", "高级集成", "设置"]}
              series={[{ name: "routes", data: [6, 3, 4, 5, 9, 7] }]}
            />
            <Text tone="tertiary" size="small">
              指标：web/app/**/page.tsx 计数 · Source: 仓库 glob（含 test/ 1 页）
            </Text>
          </CardBody>
        </Card>

        <Card>
          <CardHeader trailing={<Pill tone="warning">横向柱图</Pill>}>注册 Agent（agents/）</CardHeader>
          <CardBody>
            <BarChart
              horizontal
              height={280}
              categories={[
                "media_agent",
                "planning",
                "orchestrator",
                "copywriter",
                "script_writer",
                "reviewer",
                "video_editor",
                "trend_analyst",
                "lobster",
                "general",
              ]}
              series={[{ name: "模块", data: [10, 9, 9, 8, 8, 7, 7, 6, 5, 5] }]}
            />
            <Text tone="tertiary" size="small">
              指标：职责权重示意（非 LOC） · 用于对比 Agent 覆盖面
            </Text>
          </CardBody>
        </Card>

        <Card>
          <CardHeader trailing={<Pill tone="neutral">折线</Pill>}>媒体流水线步骤序</CardHeader>
          <CardBody>
            <LineChart
              height={260}
              fill
              categories={["剧本", "分镜", "图", "视频", "配音", "字幕", "混剪", "发布"]}
              series={[
                { name: "步骤序号", data: [1, 2, 3, 4, 5, 6, 7, 8], tone: "info" },
                { name: "典型工具数", data: [2, 3, 4, 5, 3, 2, 4, 6], tone: "success" },
              ]}
            />
            <Text tone="tertiary" size="small">
              指标：PIPELINE_STEP_IDS 顺序 + 每步关联工具数估计 · Source: media_pipeline.py
            </Text>
          </CardBody>
        </Card>
      </Grid>

      <Card>
        <CardHeader trailing={<Pill tone="info">分段条</Pill>}>storage/ 子目录（持久化面）</CardHeader>
        <CardBody>
          <UsageBar
            total={100}
            topLeftLabel="storage/ 子目录"
            topRightLabel="相对持久化权重（示意）"
            segments={[
              { id: "outputs", value: 18, color: "green" },
              { id: "uploads", value: 10, color: "blue" },
              { id: "temp", value: 8, color: "yellow" },
              { id: "rag", value: 12, color: "purple" },
              { id: "memory", value: 10, color: "pink" },
              { id: "scheduler", value: 8, color: "orange" },
              { id: "traces", value: 9, color: "gray" },
              { id: "profiles", value: 11, color: "blue" },
              { id: "tasks", value: 7, color: "green" },
              { id: "evolution", value: 7, color: "purple" },
            ]}
          />
          <Text tone="tertiary" size="small">
            指标：相对持久化重要度（示意） · 详见 CLAUDE.md storage/ 约定
          </Text>
        </CardBody>
      </Card>
    </Stack>
  );
}

function AgentConstellationFigure() {
  const t = useHostTheme();
  const mid = "arr-agents";
  const center = { x: 350, y: 170, label: "orchestrator", c: 4 };
  const orbit = [
    { x: 350, y: 48, label: "media_agent", c: 0 },
    { x: 560, y: 100, label: "planning", c: 1 },
    { x: 610, y: 240, label: "copywriter", c: 2 },
    { x: 500, y: 300, label: "script_writer", c: 3 },
    { x: 200, y: 300, label: "reviewer", c: 5 },
    { x: 90, y: 240, label: "video_editor", c: 6 },
    { x: 140, y: 100, label: "trend_analyst", c: 4 },
  ];
  return (
    <Card>
      <CardHeader>Agent 星座图（registry.py 概念）</CardHeader>
      <CardBody style={mergeStyle({ padding: 0 })}>
        <svg viewBox="0 0 700 340" width="100%" height={330}>
          <SvgDefsArrow markerId={mid} fill={pickColor(4)} />
          {orbit.map((node) => (
            <line
              key={`line-${node.label}`}
              x1={center.x}
              y1={center.y}
              x2={node.x}
              y2={node.y + 14}
              stroke={pickColor(node.c)}
              strokeWidth={1}
              strokeDasharray="4 3"
              opacity={0.7}
            />
          ))}
          <circle cx={center.x} cy={center.y} r={38} fill={pickColor(center.c)} stroke={t.stroke.secondary} strokeWidth={1} />
          <text x={center.x} y={center.y + 4} textAnchor="middle" fill={t.text.onAccent} fontSize={11} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            {center.label}
          </text>
          {orbit.map((node) => (
            <g key={node.label}>
              <circle cx={node.x} cy={node.y + 14} r={28} fill={pickColor(node.c)} stroke={t.stroke.secondary} strokeWidth={1} />
              <text x={node.x} y={node.y + 18} textAnchor="middle" fill={t.text.onAccent} fontSize={9} fontFamily='ui-sans-serif, system-ui, sans-serif'>
                {node.label}
              </text>
            </g>
          ))}
        </svg>
        <ColorLegend
          items={[
            { color: pickColor(0), label: "媒体/发布" },
            { color: pickColor(1), label: "规划" },
            { color: pickColor(2), label: "文案" },
            { color: pickColor(5), label: "审查" },
            { color: pickColor(4), label: "编排/趋势" },
          ]}
        />
      </CardBody>
    </Card>
  );
}

function PlatformConnectorGridFigure() {
  const t = useHostTheme();
  const platforms = [
    "小红书", "抖音", "B站", "YouTube", "Twitter", "微博",
    "快手", "TikTok", "视频号", "飞书", "Discord", "Mock",
  ];
  const cols = 4;
  const cellW = 158;
  const cellH = 44;
  const gap = 10;
  const x0 = 24;
  const y0 = 36;
  return (
    <Card>
      <CardHeader>社媒连接器矩阵（tools/connectors/ · 12 平台）</CardHeader>
      <CardBody style={mergeStyle({ padding: 12 })}>
        <svg viewBox="0 0 700 220" width="100%" height={210}>
          {platforms.map((name, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const x = x0 + col * (cellW + gap);
            const y = y0 + row * (cellH + gap);
            return (
              <g key={name}>
                <rect x={x} y={y} width={cellW} height={cellH} rx={6} fill={pickColor(i)} stroke={t.stroke.secondary} strokeWidth={1} />
                <text x={x + cellW / 2} y={y + cellH / 2 + 4} textAnchor="middle" fill={t.text.onAccent} fontSize={12} fontFamily='ui-sans-serif, system-ui, sans-serif'>
                  {name}
                </text>
              </g>
            );
          })}
        </svg>
      </CardBody>
    </Card>
  );
}

function DeployTargetsFigure() {
  const t = useHostTheme();
  const targets = [
    { x: 40, label: "Web Dev", sub: "start_local.sh", c: 4 },
    { x: 200, label: "Electron", sub: "DMG / NSIS", c: 2 },
    { x: 360, label: "Win ZIP", sub: "build_windows.sh", c: 5 },
    { x: 520, label: "iOS Shell", sub: "Capacitor", c: 6 },
  ];
  const mid = "arr-deploy";
  return (
    <Card>
      <CardHeader>四种交付形态（彩色对比）</CardHeader>
      <CardBody style={mergeStyle({ padding: 12 })}>
        <svg viewBox="0 0 700 140" width="100%" height={130}>
          <SvgDefsArrow markerId={mid} fill={pickColor(4)} />
          <rect x={250} y={8} width={200} height={36} rx={6} fill={pickColor(4)} stroke={t.stroke.secondary} strokeWidth={1} />
          <text x={350} y={32} textAnchor="middle" fill={t.text.onAccent} fontSize={12} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            AI Media Agent 源码
          </text>
          {targets.map((tg, i) => (
            <g key={tg.label}>
              <line x1={350} y1={44} x2={tg.x + 60} y2={72} stroke={pickColor(tg.c)} strokeWidth={1.25} markerEnd={`url(#${mid})`} />
              <rect x={tg.x} y={72} width={120} height={52} rx={6} fill={pickColor(tg.c)} stroke={t.stroke.secondary} strokeWidth={1} />
              <text x={tg.x + 60} y={96} textAnchor="middle" fill={t.text.onAccent} fontSize={11} fontFamily='ui-sans-serif, system-ui, sans-serif'>
                {tg.label}
              </text>
              <text x={tg.x + 60} y={112} textAnchor="middle" fill={t.text.onAccent} fontSize={9} fontFamily='ui-sans-serif, system-ui, sans-serif' opacity={0.85}>
                {tg.sub}
              </text>
            </g>
          ))}
          <text x={24} y={136} fill={t.text.tertiary} fontSize={10} fontFamily='ui-sans-serif, system-ui, sans-serif'>
            仅 Electron / Web Dev 可本地跑全栈；iOS 为远程 WebView 壳。
          </text>
        </svg>
      </CardBody>
    </Card>
  );
}

export default function AiMediaAgentOverview() {
  return (
    <Stack gap={22}>
      <Stack gap={6}>
        <H1>AI Media Agent 工作区速览</H1>
        <Text tone="secondary" size="small">
          FastAPI + Next.js 16，LangGraph 多 Agent；文案/剧本、文生图与视频、多平台发布、RAG、定时任务、Computer Use（Playwright）与 MCP。
          桌面端 Electron 1.0.37（五服务自启）；iOS 为 Capacitor 远程壳（mobile/）。
        </Text>
      </Stack>

      <Callout tone="success" title="彩色图从这里开始">
        <Text>
          紧接下方 Stat 卡片之后是 <Text weight="medium">彩色总览图</Text>（饼图 · 柱图 · 折线 · 分段条）、
          Agent 星座图、12 平台矩阵；再往下所有架构 SVG 均为七色块标注。
        </Text>
      </Callout>

      <Row gap={8} wrap style={{ alignItems: "center" }}>
        <Pill tone="info">v1.0.37</Pill>
        <Pill tone="neutral">Next.js 16</Pill>
        <Pill tone="neutral">React 19</Pill>
        <Pill tone="neutral">Tailwind 4</Pill>
        <Pill tone="neutral">FastAPI</Pill>
        <Pill tone="neutral">LangGraph</Pill>
        <Pill tone="neutral">Playwright</Pill>
        <Pill tone="neutral">Electron 32</Pill>
        <Pill tone="neutral">Capacitor iOS</Pill>
        <Pill tone="neutral">gRPC</Pill>
      </Row>

      <Card>
        <CardHeader trailing={<Pill tone="neutral">目录</Pill>}>本页分段</CardHeader>
        <CardBody>
          <Grid columns={2} gap={8}>
            <Stack gap={4}>
              <Text size="small"><Text weight="medium">彩色总览</Text> — 饼/柱/折线、Agent 星座、平台矩阵</Text>
              <Text size="small"><Text weight="medium">前端入口</Text> — 路径与主线任务</Text>
              <Text size="small"><Text weight="medium">架构图</Text> — 分层、路由、流水线、gRPC</Text>
              <Text size="small"><Text weight="medium">流式与任务</Text> — SSE、审批、RAG、记忆</Text>
              <Text size="small"><Text weight="medium">前端路由</Text> — web/app 全路径</Text>
            </Stack>
            <Stack gap={4}>
              <Text size="small"><Text weight="medium">后端速查</Text> — 目录、API、Agent、storage</Text>
              <Text size="small"><Text weight="medium">开发规范</Text> — venv、主题、临时目录</Text>
              <Text size="small"><Text weight="medium">桌面打包</Text> — Mac DMG / Win NSIS·ZIP</Text>
              <Text size="small"><Text weight="medium">iOS 客户端</Text> — Capacitor 远程控制台</Text>
            </Stack>
          </Grid>
        </CardBody>
      </Card>

      <Grid columns={3} gap={14}>
        <Stat value="3000" label="前端 dev" tone="info" />
        <Stat value="8000" label="后端 HTTP" tone="success" />
        <Stat value="/docs" label="OpenAPI" tone="neutral" />
        <Stat value="50051" label="OCR 服务 gRPC" tone="warning" />
        <Stat value="50052" label="Rust 安全引擎" tone="danger" />
        <Stat value="50053" label="Go 高并发引擎" tone="info" />
      </Grid>

      <ColorfulOverviewSection />

      <DeployTargetsFigure />

      <Grid columns={2} gap={16}>
        <AgentConstellationFigure />
        <PlatformConnectorGridFigure />
      </Grid>

      <Divider />

      <H2>前端主要入口页面（干嘛用的）</H2>
      <Text tone="secondary" size="small">
        此处「入口」特指<Text weight="medium">用户在浏览器地址栏路径</Text>进到哪一页、那一页承担的「主线任务」。
        本地开发时前缀为 http://localhost:3000 ，例如 http://localhost:3000/workbench ；
        更全的路径清单见本节下方<Text weight="medium">前端路由</Text>分段。
      </Text>
      <Callout tone="info" title="日常最高频的两条">
        <Text>
          <Text weight="medium">/</Text>
          ：默认着陆主页，主线是「对话」——流式回答、附带多模态、走多 Agent/SSE；
          {" "}
          <Text weight="medium">/workbench</Text>
          ：工作台，主线是「从一块面板跳进各生产能力」的中间枢纽（具体卡片以现行 UI 为准）。
        </Text>
      </Callout>
      <Table
        headers={["路径", "作为入口意味着什么", "进来之后主要在做什么"]}
        rows={[
          ["/login", "身份入口", "登录或切换会话；成功后回到业务页面（是否在布局中启用取决于配置）"],
          [
            "/",
            "产品与默认主页",
            "主对话界面：会话、工具调用结果、Markdown/媒体预览；多模态与分析类请求可走不同 fetch 分支",
          ],
          [
            "/workbench",
            "能力聚合工作台",
            "把创作、媒体、发布等高频动作集中成入口矩阵，从这里深链到 `/create`、`/media` 等页面",
          ],
          [
            "/create/copywriting · /script · /article",
            "创作漏斗入口",
            "分别承担文案 / 剧本 / 文章路线的专用表单与工作区，不靠对话页即可完成一条创作链路",
          ],
          [
            "/media/image · /video · /long-video · /storyboard",
            "媒体工厂入口",
            "图片、视频、长视频、分镜等「先生成再看结果」链路，独立于主聊天的页面状态",
          ],
          [
            "/platforms",
            "连接与分发前置入口",
            "管理各社交平台连接与账号信息，发布类动作会先依赖此处是否已接通",
          ],
          [
            "/knowledge",
            "RAG / 私有知识入口",
            "上传文档、查看索引列表、检索与喂给模型的知识侧配置",
          ],
          [
            "/scheduler",
            "自动化运营入口",
            "定时任务的创建、启用、触发与日志回看",
          ],
          ["/history", "产物与回溯入口", "生成与对话记录的列表、导出与复用，避免只靠当前会话回溯"],
          [
            "/trending · /moderation · /computer-use …",
            "专项能力页入口",
            "热点监控、合规审核、Computer Use、Pipeline、Hermes/OpenClaw 等「独立产品面」各占一页，侧边栏直接进入",
          ],
          [
            "/settings 及子路径",
            "控制面入口",
            "/settings/capabilities（MCP · 技能 · 审批）/settings/context（记忆与图谱）/settings/my-computer（本机索引）等；改系统行为的起点",
          ],
        ]}
      />

      <Divider />

      <H2>架构图与实现细节</H2>
      <Text tone="secondary" size="small">
        下列 SVG 使用主题描边与填充色（无渐变、无阴影）。DAG 由 <Text weight="medium">computeDAGLayout</Text>{" "}
        计算坐标；与 AGENTS.md / 代码注释一致处已标注文件或模块名。
      </Text>

      <Stack gap={16}>
        <LayeredArchitectureFigure />
        <DagBackendFlowFigure />
        <Grid columns={2} gap={16}>
          <RoutingModesFigure />
          <MultiAgentCycleFigure />
        </Grid>
        <MediaPipelineFigure />
        <Grid columns={2} gap={16}>
          <GrpcStackFigure />
          <WorkflowEngineFigure />
        </Grid>
        <ConnectorClassFigure />
      </Stack>

      <Divider />

      <H2>流式与任务：更多实现要点</H2>
      <H3>工作流 SSE 事件（workflow_engine.py）</H3>
      <Table
        headers={["event", "含义（摘要）"]}
        rows={[
          ["step_start", "某 DAG 节点开始执行"],
          ["step_done", "节点成功结束并携带结果摘要"],
          ["step_error", "节点失败，含错误负载"],
          ["workflow_done", "整条工作流完成"],
          ["workflow_error", "工作流级失败"],
          ["heartbeat", "保活 / 背压信号"],
        ]}
      />

      <H3>规划型 Agent 状态机（planning_bot.py）</H3>
      <Table
        headers={["阶段", "行为"]}
        rows={[
          ["Planner", "把用户目标拆成可执行步骤列表"],
          ["Executor", "逐步调用 ReAct / 工具层完成单步"],
          ["Replan", "根据观测决定继续、改计划或结束"],
        ]}
      />

      <H3>能力、审批与任务（core/super_agent_api 等）</H3>
      <Table
        headers={["概念", "说明"]}
        rows={[
          ["capabilities 注册表", "为工具与动作标注风险等级与审批策略"],
          ["tasks", "长耗时或异步动作的 task_manager 条目，可持久化恢复"],
          ["approvals", "人为闸口通过后继续执行敏感动作"],
          ["media_pipeline 任务类型", "`type: media_pipeline` 与 STEP 元数据耦合，advance_media_pipeline_step 推进"],
        ]}
      />

      <H3>RAG 与记忆（简述）</H3>
      <Table
        headers={["模块", "职责"]}
        rows={[
          ["utils/rag_manager.py · ChromaDB", "文档入库、向量检索、上下文拼接"],
          ["services/context_knowledge_graph.py", "用户上下文图谱 API 的数据侧"],
          ["services/memory_coordinator.py · storage/memory/", "记忆的写入、归档与质量控制"],
          ["agents 内记忆工具", "对话中按需 search_memory / 结构化沉淀"],
        ]}
      />

      <H3>主界面流式路由（Next 代理 ↔ FastAPI）</H3>
      <Table
        headers={["Next Route", "后端", "备注"]}
        rows={[
          [
            "/api/multi-agent/stream",
            "POST /multi-agent/stream",
            "SSE：编排器、trace / memory_augment / forced_agent 等分支均在 main.py 打点",
          ],
          [
            "/api/chat",
            "后端聊天与工具编排",
            "page.tsx 主路径；桌面包另走 /api/agent/chat/stream → POST /agent/chat/stream",
          ],
          [
            "/api/multimodal/chat",
            "POST /multimodal/chat",
            "上传先入 storage/temp/ 再做 OCR/解析；后端现状为直连 LLM 流式，绕过 Planning Graph",
          ],
        ]}
      />

      <CollapsibleSection title="前端路由（摘自 web/app）" count={35} leading={<Swatch color="blue" />}>
        <Stack gap={12}>
          <H3>对话、工作台与流程</H3>
          <Table
            headers={["路径", "说明"]}
            rows={[
              ["/", "主对话"],
              ["/workbench", "工作台入口"],
              ["/workflows", "工作流列表"],
              ["/workflows/new", "新建工作流"],
              ["/workflows/[id]", "工作流详情 / 编辑"],
              ["/history", "历史记录"],
            ]}
          />

          <H3>创作与媒体</H3>
          <Table
            headers={["路径", "说明"]}
            rows={[
              ["/create/copywriting", "文案创作"],
              ["/create/script", "剧本"],
              ["/create/article", "文章"],
              ["/media/image", "文生图等"],
              ["/media/video", "视频生成"],
              ["/media/long-video", "长视频"],
              ["/media/storyboard", "分镜"],
            ]}
          />

          <H3>平台、热点与审核</H3>
          <Table
            headers={["路径", "说明"]}
            rows={[
              ["/platforms", "平台连接与管理"],
              ["/scheduler", "定时发布"],
              ["/trending", "游戏热点"],
              ["/knowledge", "RAG 知识库"],
              ["/moderation", "内容审核"],
            ]}
          />

          <H3>高级能力与集成</H3>
          <Table
            headers={["路径", "说明"]}
            rows={[
              ["/computer-use", "浏览器自动化（Computer Use）"],
              ["/companion", "AI 伙伴"],
              ["/pipeline", "爆款流水线"],
              ["/openclaw", "OpenClaw"],
              ["/hermes-agent", "Hermes Agent"],
              ["/lark-cli", "Lark CLI 助手"],
              ["/architecture", "架构图页"],
              ["/ai-news", "AI 资讯"],
              ["/financial-news", "财经资讯"],
            ]}
          />

          <H3>设置</H3>
          <Table
            headers={["路径", "说明"]}
            rows={[
              ["/settings", "设置首页"],
              ["/settings/capabilities", "能力、审批、任务、MCP 等"],
              ["/settings/context", "My context：知识图谱与 Memory"],
              ["/settings/my-computer", "My Computer 本地索引"],
              ["/settings/customization", "个性化"],
              ["/settings/users", "用户管理"],
              ["/login", "登录"],
            ]}
          />
        </Stack>
      </CollapsibleSection>

      <Divider />

      <CollapsibleSection title="后端目录、API 与 Agent" count={4} leading={<Swatch color="green" />}>
        <Stack gap={12}>
          <H3>后端目录速查</H3>
          <Table
            headers={["路径", "说明"]}
            rows={[
              ["backend/main.py", "FastAPI 入口与路由挂载"],
              ["backend/agents/", "ReAct / 规划 / 审查 / 编排 / 路由等"],
              ["backend/core/", "LLM 路由、能力、媒体流水线、审批门控"],
              ["backend/tools/", "原子工具；connectors/ 为各平台连接器"],
              ["backend/services/", "调度、Computer、MCP、gRPC 客户端等"],
              ["backend/routers/", "auth、users、agent_chat 等模块化路由"],
              ["backend/utils/", "日志、RAG、历史、追踪、任务等"],
            ]}
          />

          <H3>常用 API 分组（详见 /docs）</H3>
          <Table
            headers={["区域", "示例"]}
            rows={[
              ["健康", "GET /health"],
              ["配置", "GET/POST /config/provider，GET/POST /config/media-models"],
              ["内容工具", "POST /tools/copywriting、/tools/script、/tools/image、/tools/video …"],
              ["发布", "POST /tools/publish、/tools/publish/all；GET /connectors/platforms …"],
              ["Agent 聊天", "POST /agent/chat/stream、/agent/chat/invoke（桌面包前端代理 /api/agent/chat/stream）"],
              ["多 Agent", "GET /multi-agent/agents；POST /multi-agent/stream …"],
              ["平台登录", "POST /connectors/browser/start|status|cancel；interactive_login 会话"],
              ["定时", "GET/POST /scheduler/jobs；GET /scheduler/logs …"],
              ["知识库", "POST /knowledge/upload、/knowledge/query …"],
              ["历史", "GET /history；POST /chat/history …"],
              ["上下文记忆", "GET/POST /context/memory；GET /context/knowledge-graph"],
              ["能力任务审批", "GET /capabilities/…；POST /tasks、/approvals …"],
              ["Computer Use", "POST /computer-use/run"],
              ["本地电脑", "GET /computer/roots；POST /computer/actions …"],
              ["进化学习", "POST /evolution/signals、/evolution/events …"],
            ]}
          />

          <H3>Agent 角色（节选）</H3>
          <Table
            headers={["文件 / 概念", "用途"]}
            rows={[
              ["agents/bot.py（media_agent）", "图/视频/发布、ReAct 主路径"],
              ["planning_bot.py", "规划—执行—重规划"],
              ["reviewer_bot.py", "内容审查"],
              ["orchestrator.py", "Supervisor 多 Agent 编排"],
              ["router.py", "意图路由"],
              ["copywriter / script_writer / trend_analyst 等", "垂直领域 Agent"],
            ]}
          />

          <H3>storage/ 目录（持久化约定）</H3>
          <Table
            headers={["子目录/文件", "用途"]}
            rows={[
              ["outputs/", "生成的图片、视频等"],
              ["uploads/", "用户上传"],
              ["temp/", "临时文件（禁止用系统 /tmp）"],
              ["rag/", "向量与 RAG 索引"],
              ["memory/", "Agent 记忆"],
              ["scheduler/", "定时任务配置与日志"],
              ["traces/", "执行追踪"],
              ["profiles/", "平台账号与凭证相关"],
              ["tasks/、approvals/", "任务与审批持久化"],
              ["evolution/", "进化学习事件"],
              ["computer/", "My Computer 索引数据"],
              ["chroma_db/", "Chroma 数据文件"],
              ["mcp_servers.json、skills_enabled.json 等", "运行配置"],
            ]}
          />
        </Stack>
      </CollapsibleSection>

      <Divider />

      <H2>环境变量（常见）</H2>
      <Table
        headers={["变量", "用途"]}
        rows={[
          ["ZHIPUAI_API_KEY", "智谱 GLM / 即梦系能力"],
          ["GOOGLE_API_KEY", "Gemini"],
          ["DEEPSEEK_API_KEY", "DeepSeek"],
          ["OPENROUTER_API_KEY", "多模型聚合"],
          ["BYTEDANCE_API_KEY、ALIBABA_API_KEY", "豆包、通义等"],
          ["JIMENG_*、ARK_API_KEY", "即梦 / 豆包视频等"],
          ["PLAYWRIGHT_BROWSERS_PATH", "浏览器二进制路径（如 ./.browsers）"],
        ]}
      />

      <Divider />

      <Grid columns={2} gap={16}>
        <Card>
          <CardHeader trailing={<Pill tone="info">必读</Pill>}>虚拟环境</CardHeader>
          <CardBody>
            <Stack gap={8}>
              <Text>仅使用项目根目录 <Text weight="medium">venv/</Text>（或按 start_local.sh 使用 <Text weight="medium">backend/.venv</Text>）。</Text>
              <Text>禁止删除或整体重建 venv；缺包用 <Text weight="medium">pip install 包名</Text> 增量安装。</Text>
            </Stack>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>前端主题</CardHeader>
          <CardBody>
            <Text>
              UI 令牌在 <Text weight="medium">web/app/globals.css</Text>（theme-dark / theme-light）。优先使用{" "}
              <Text weight="medium">card-surface</Text>、<Text weight="medium">page-canvas</Text> 与{" "}
              <Text weight="medium">var(--foreground)</Text>，避免硬编码灰色导致深浅色对比问题。
            </Text>
          </CardBody>
        </Card>
      </Grid>

      <Callout tone="warning" title="临时文件">
        <Text>业务临时目录必须是 <Text weight="medium">storage/temp/</Text>，不要使用操作系统 <Text weight="medium">/tmp</Text>。</Text>
      </Callout>

      <Callout tone="info" title="本地启动与排错">
        <Stack gap={6}>
          <Text>
            推荐根目录 <Text weight="medium">./start_local.sh</Text> 同时起前后端。单独启动：前端{" "}
            <Text weight="medium">cd web && npm run dev</Text>；后端{" "}
            <Text weight="medium">cd backend && python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload</Text>。
          </Text>
          <Text tone="secondary" size="small">
            端口占用可检查 3000 / 8000；Playwright 问题见 <Text weight="medium">python -m playwright install chromium</Text>。日志可参考项目根{" "}
            <Text weight="medium">logs/</Text> 与 <Text weight="medium">backend/agent.log</Text>（以仓库为准）。
          </Text>
        </Stack>
      </Callout>

      <Divider />

      <H2>桌面端打包（macOS / Windows）</H2>
      <Text tone="secondary" size="small">
        Electron 壳（<Text weight="medium">electron/</Text> · v1.0.37）把 FastAPI、OCR、Rust/Go gRPC、Next standalone 五服务打进安装包；
        主流程见 <Text weight="medium">electron/build_mac.sh</Text> 与 <Text weight="medium">electron/package.json</Text>（electron-builder）。
        Windows 另有 <Text weight="medium">build_win.sh</Text>（zip + portable + 可选 NSIS）。
      </Text>

      <Row gap={8} wrap style={{ alignItems: "center" }}>
        <Pill tone="neutral">electron-builder 25</Pill>
        <Pill tone="neutral">DMG · arm64</Pill>
        <Pill tone="neutral">Developer ID</Pill>
        <Pill tone="neutral">@electron/notarize</Pill>
        <Pill tone="neutral">NSIS / ZIP</Pill>
        <Pill tone="neutral">Python 3.12 内置</Pill>
        <Pill tone="neutral">Node 22 内置</Pill>
      </Row>

      <Callout tone="info" title="bundle_revision 与覆盖升级">
        <Stack gap={6}>
          <Text>
            <Text weight="medium">package.json version</Text>（如 1.0.37）决定是否重跑安装向导；
            {" "}
            <Text weight="medium">resources/backend/.bundle_revision</Text>（版本-git hash）驱动{" "}
            <Text weight="medium">syncAppResources</Text> 增量同步到 APP_DATA。同版本换 DMG 时若 API 404，可删除{" "}
            <Text weight="medium">~/Library/Application Support/ai-media-agent/.resource_bundle_version</Text> 后重启。
          </Text>
          <Text tone="secondary" size="small">
            ≥1.0.37 的 main.js 在每次 startAllServices() 都会 sync，并以 routers/agent_chat_router.py 等哨兵文件检测缺漏。
          </Text>
        </Stack>
      </Callout>

      <Callout tone="info" title="两种 Windows 发行方式">
        <Text>
          <Text weight="medium">Electron 安装包</Text>：在 Windows x64 构建机上完成与 Mac 相同的资源准备后执行{" "}
          <Text weight="medium">npm run build:win</Text>，产出 NSIS 安装程序（需管理员权限安装，见 package.json）。
          {" "}
          <Text weight="medium">ZIP 便携包</Text>：在任意平台运行根目录{" "}
          <Text weight="medium">./build_windows.sh</Text>，用户解压后走 <Text weight="medium">windows/install.bat</Text> 与{" "}
          <Text weight="medium">start.bat</Text>（详见 docs/WINDOWS_DEPLOYMENT.md）。
        </Text>
      </Callout>

      <ElectronStartupFlowFigure />
      <Grid columns={2} gap={16}>
        <ElectronDesktopServicesFigure />
        <DesktopFirstRunFigure />
      </Grid>
      <PackagingPrepPipelineFigure />

      <H3>构建机前置依赖</H3>
      <Table
        headers={["平台", "必需工具", "说明"]}
        rows={[
          [
            "macOS DMG",
            "Go 1.22+ · Rust 1.75+ · Node 18+ · Python 3.10+",
            "build_mac.sh 头部注释；Rust/Go 用于编译 directory-service 与 parser-service 原生二进制",
          ],
          [
            "Windows NSIS",
            "同上 + Visual Studio Build Tools（Rust msvc）",
            "须在 Windows 上构建；Go/Rust 目标为 windows/amd64（.exe 放入 electron/resources/bin/）",
          ],
          [
            "Windows ZIP",
            "bash、zip（可在 macOS/Linux 上打包）",
            "不产出 .exe 安装器；复制源码 + windows/ 脚本，由用户本机装 Python/Node",
          ],
        ]}
      />

      <H3>macOS：build_mac.sh 与签名模式</H3>
      <Table
        headers={["模式", "命令", "说明"]}
        rows={[
          [
            "Developer ID + 公证",
            "cd electron && ./build_mac.sh arm64",
            "需 mac-build.env（APPLE_ID 等）；afterPack 签嵌套二进制，afterSign 公证",
          ],
          [
            "无签名分发",
            "cd electron && ./build_mac.sh arm64 unsigned",
            "ad-hoc 签名；用户需 Install.app / xattr 解除隔离",
          ],
          [
            "仅 npm",
            "npm run build:arm64 / build:unsigned:arm64",
            "直接调 electron-builder；build_mac.sh 含 Go/Rust/Next 资源准备",
          ],
        ]}
      />

      <H3>macOS：七步 DMG（build_mac.sh）</H3>
      <Table
        headers={["步骤", "动作", "产出 / 命令"]}
        rows={[
          ["1", "编译 Go directory-service", "GOOS=darwin；universal 时 lipo 合并 → electron/resources/bin/directory-service"],
          ["2", "编译 Rust parser-service", "cargo --target aarch64/x86_64-apple-darwin → resources/bin/parser-service"],
          ["3", "Next.js standalone", "cd web && NEXT_STANDALONE=1 npm run build；拷贝 .next/standalone → resources/web-standalone/"],
          ["4", "拷贝 Python 后端", "backend/{agents,core,tools,…}、main.py、requirements.txt → resources/backend/"],
          ["5", "拷贝 OCR 服务", "services/ocr/ → resources/ocr-service/"],
          ["6", "生成图标", "python3 electron/scripts/create_icons.py（及 DMG 背景资源）"],
          [
            "7",
            "electron-builder 打 DMG",
            "cd electron && ./build_mac.sh [universal|arm64|x64]；或 npm run build:universal / build:arm64 / build:x64",
          ],
        ]}
      />
      <Callout tone="warning" title="DMG 输出与 Gatekeeper">
        <Stack gap={6}>
          <Text>
            产物：<Text weight="medium">electron/dist/AI Media Agent-&lt;version&gt;-arm64.dmg</Text>（含内置 Python 后约 270MB）。
            已配置 Developer ID 时走正式签名 + 可选 Apple 公证；未配置时 afterPack 回退 ad-hoc。
          </Text>
          <Text tone="secondary" size="small">
            无公证包若遇「已损坏」：<Text weight="medium">xattr -rd com.apple.quarantine "/Applications/AI Media Agent.app"</Text>，
            或使用 DMG 内「Install AI Media Agent.app」。用户数据目录{" "}
            <Text weight="medium">~/Library/Application Support/ai-media-agent/</Text>。
          </Text>
        </Stack>
      </Callout>

      <H3>Windows：Electron NSIS（步骤 1–6 同源 + 第 7 步）</H3>
      <Table
        headers={["步骤", "动作", "产出 / 命令"]}
        rows={[
          ["1", "Go directory-service", "GOOS=windows GOARCH=amd64 go build -o resources/bin/directory-service.exe"],
          ["2", "Rust parser-service", "cargo build --release --target x86_64-pc-windows-msvc → parser-service.exe"],
          ["3–6", "Next / backend / OCR / 图标", "与 Mac 相同；Windows 图标为 resources/icons/icon.ico"],
          [
            "7",
            "electron-builder NSIS",
            "在 electron/ 目录：npm install && npm run build:win → electron/dist/*.exe 安装包（oneClick: false，可选安装目录）",
          ],
        ]}
      />
      <Callout tone="info" title="Windows 桌面端运行时">
        <Text>
          用户数据与日志：<Text weight="medium">%APPDATA%\\ai-media-agent\\</Text>（main.js 强制 userData 路径）。
          若本机无 Node，安装包可下载便携 node.exe 到该目录；Python 走 venv\\Scripts\\python.exe。
          安装器 requestedExecutionLevel 为 requireAdministrator。
        </Text>
      </Callout>

      <H3>Windows：ZIP 脚本包（build_windows.sh，非 Electron）</H3>
      <Table
        headers={["步骤", "动作", "产出"]}
        rows={[
          ["1", "复制 backend/ 源码与可选 venv", "dist/ai-agent-windows/backend/"],
          ["2", "复制 web/（含 node_modules、.next 若已构建）", "dist/ai-agent-windows/web/"],
          ["3", "复制 windows/*.bat", "install.bat · start.bat · stop.bat"],
          ["4", "初始化 storage/、logs/", "空目录结构"],
          ["5", "zip 压缩", "dist/ai-agent-windows.zip"],
        ]}
      />
      <Text tone="secondary" size="small">
        用户流程：解压 → 配置 backend/.env → 双击 windows/install.bat → windows/start.bat；
        或使用项目根 <Text weight="medium">start_windows.bat</Text> 一键部署（开发/内测常用）。
      </Text>

      <Grid columns={2} gap={16}>
        <Card>
          <CardHeader trailing={<Pill tone="info">Mac</Pill>}>Electron 开发调试</CardHeader>
          <CardBody>
            <Stack gap={8}>
              <Text>
                <Text weight="medium">cd electron && npm install && npm start</Text>
              </Text>
              <Text tone="secondary" size="small">
                开发模式不打包；需先在项目根 <Text weight="medium">./start_local.sh</Text> 拉起各服务，Electron 嵌壳连接。
                renderer/ 含 splash · setup · status 三页。
              </Text>
            </Stack>
          </CardBody>
        </Card>
        <Card>
          <CardHeader trailing={<Pill tone="info">Win</Pill>}>相关文档</CardHeader>
          <CardBody>
            <Stack gap={8}>
              <Text>
                <Text weight="medium">electron/README.md</Text> · <Text weight="medium">docs/WINDOWS_DEPLOYMENT.md</Text>
                {" · "}
                <Text weight="medium">.agent/skills/electron-mac-packaging/SKILL.md</Text>
              </Text>
              <Text tone="secondary" size="small">
                服务端口与桌面版一致：前端 3000、后端 8000、gRPC 50051–50053。
              </Text>
            </Stack>
          </CardBody>
        </Card>
      </Grid>

      <Divider />

      <H2>iOS 客户端（mobile/）</H2>
      <Text tone="secondary" size="small">
        Capacitor 壳：全屏 WKWebView 连接已运行的控制台（桌面版或云端 HTTPS），不在 iOS 内嵌 Python / Playwright / gRPC。
      </Text>

      <MobileIosClientFigure />

      <Table
        headers={["对比项", "Electron 桌面", "iOS Capacitor"]}
        rows={[
          ["本地 FastAPI + Node", "内置五服务", "否 — 远程访问"],
          ["Playwright / Computer Use", "支持", "依赖远端后端"],
          ["独立 App 窗口", "托盘 + Dashboard", "全屏 WebView"],
          ["构建", "build_mac.sh / build_win.sh", "mobile/build_ios.sh → Xcode"],
          ["典型场景", "单机完整功能", "移动查看/操作已部署实例"],
        ]}
      />

      <Callout tone="info" title="iOS 快速开始">
        <Text>
          <Text weight="medium">cd mobile && ./build_ios.sh && npm run open:ios</Text>
          — Xcode 选 Team 后 Run 或 Archive。首次在 App 内填{" "}
          <Text weight="medium">http://&lt;Mac 局域网 IP&gt;:3000</Text>（模拟器勿用 127.0.0.1）。
        </Text>
      </Callout>

      <Text tone="tertiary" size="small">
        更完整的架构与路由说明见 README、CLAUDE.md、docs/ARCHITECTURE_OVERVIEW.md、mobile/README.md；
        桌面打包见 .agent/skills/electron-mac-packaging/SKILL.md。本页为离线速查，若有出入以代码为准。
      </Text>
    </Stack>
  );
}
