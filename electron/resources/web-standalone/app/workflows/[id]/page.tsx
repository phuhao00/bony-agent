"use client";

import {
    Background,
    Controls,
    MiniMap,
    ReactFlow,
    ReactFlowProvider,
    addEdge,
    useEdgesState,
    useNodesState,
    type Connection,
    type Edge,
    type Node,
    type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { WorkflowNodeData } from "@/components/workflow/BaseNode";
import { applyWorkflowDisplayTitle } from "@/lib/sidebar-recents";
import { NodeConfigPanel } from "@/components/workflow/NodeConfigPanel";
import { NodePalette } from "@/components/workflow/NodePalette";
import { WORKFLOW_NODE_TYPES } from "@/components/workflow/NodeTypes";
import { RunPanel } from "@/components/workflow/RunPanel";
import {
    NODE_TYPE_REGISTRY,
    NodeRunStatus,
    NodeType,
    WorkflowDef,
} from "@/types/workflow";

let nodeIdCounter = 1;
function genId() {
  return `node_${Date.now()}_${nodeIdCounter++}`;
}

function buildInitialNodes(wf: WorkflowDef): Node[] {
  return wf.nodes.map((n) => ({
    id: n.node_id,
    type: n.node_type,
    position: n.position ?? { x: 200, y: 200 },
    data: {
      label: n.label,
      node_type: n.node_type,
      config: JSON.parse(n.config_json || "{}"),
    } as unknown as WorkflowNodeData,
  }));
}

function buildInitialEdges(wf: WorkflowDef): Edge[] {
  return wf.edges.map((e, i) => ({
    id: `edge_${i}`,
    source: e.source,
    target: e.target,
    sourceHandle: e.source_handle,
    targetHandle: e.target_handle,
    animated: false,
  }));
}

export default function WorkflowEditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const workflowId = params.id === "new" ? null : params.id;

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [workflowName, setWorkflowName] = useState("新工作流");
  const [savedId, setSavedId] = useState<string | null>(workflowId);
  const [saving, setSaving] = useState(false);
  const [showRunPanel, setShowRunPanel] = useState(false);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  // Load existing workflow
  useEffect(() => {
    if (!workflowId) return;
    fetch(`/api/workflows/${workflowId}`)
      .then((r) => r.json())
      .then(({ workflow }: { workflow: WorkflowDef }) => {
        if (!workflow) return;
        setWorkflowName(workflow.name);
        applyWorkflowDisplayTitle(workflow.id, workflow.name);
        setNodes(buildInitialNodes(workflow));
        setEdges(buildInitialEdges(workflow));
      })
      .catch(console.error);
  }, [workflowId]);

  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges((eds) => addEdge({ ...connection, animated: false }, eds)),
    [setEdges],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const nodeType = event.dataTransfer.getData(
        "application/workflow-node-type",
      ) as NodeType;
      if (!nodeType || !rfInstance || !reactFlowWrapper.current) return;
      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = rfInstance.screenToFlowPosition({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });
      const info = NODE_TYPE_REGISTRY[nodeType];
      const newNode: Node = {
        id: genId(),
        type: nodeType,
        position,
        data: {
          label: info.label,
          node_type: nodeType,
          config: { ...info.defaultConfig },
        } as unknown as WorkflowNodeData,
      };
      setNodes((nds) => [...nds, newNode]);
    },
    [rfInstance, setNodes],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
  }, []);

  const onPaneClick = useCallback(() => setSelectedNode(null), []);

  const pruneEdgesForRemovedNodes = useCallback(
    (removedIds: string[]) => {
      if (!removedIds.length) return;
      const ids = new Set(removedIds);
      setEdges((eds) =>
        eds.filter((e) => !ids.has(e.source) && !ids.has(e.target)),
      );
      setSelectedNode((prev) =>
        prev && ids.has(prev.id) ? null : prev,
      );
    },
    [setEdges],
  );

  const removeWorkflowNodesByIds = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      const idSet = new Set(ids);
      setNodes((nds) => nds.filter((n) => !idSet.has(n.id)));
      pruneEdgesForRemovedNodes(ids);
    },
    [setNodes, pruneEdgesForRemovedNodes],
  );

  const selectedDeleteIds = useMemo(
    () => nodes.filter((n) => n.selected).map((n) => n.id),
    [nodes],
  );

  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      pruneEdgesForRemovedNodes(deleted.map((n) => n.id));
    },
    [pruneEdgesForRemovedNodes],
  );

  const onNodeDataChange = useCallback(
    (nodeId: string, updates: Partial<WorkflowNodeData>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, ...updates } as typeof n.data }
            : n,
        ),
      );
      setSelectedNode((prev) =>
        prev?.id === nodeId
          ? { ...prev, data: { ...prev.data, ...updates } as typeof prev.data }
          : prev,
      );
    },
    [setNodes],
  );

  const onNodeRunStatusChange = useCallback(
    (nodeId: string, status: NodeRunStatus, error?: string) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                data: {
                  ...n.data,
                  run_status: status,
                  run_error: error,
                } as typeof n.data,
              }
            : n,
        ),
      );
    },
    [setNodes],
  );

  function clearRunStatus() {
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: {
          ...n.data,
          run_status: undefined,
          run_error: undefined,
        } as typeof n.data,
      })),
    );
  }

  async function saveWorkflow() {
    setSaving(true);
    const nodePayload = nodes.map((n) => {
      const d = n.data as unknown as WorkflowNodeData;
      return {
        node_id: n.id,
        node_type: d.node_type,
        label: d.label,
        config_json: JSON.stringify(d.config ?? {}),
        input_map: {},
        output_map: {},
        position: n.position,
      };
    });
    const edgePayload = edges.map((e) => ({
      source: e.source,
      target: e.target,
      source_handle: e.sourceHandle ?? "output",
      target_handle: e.targetHandle ?? "input",
    }));

    try {
      if (!savedId) {
        const resp = await fetch("/api/workflows", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: workflowName,
            nodes: nodePayload,
            edges: edgePayload,
          }),
        });
        if (!resp.ok) {
          let msg = `Server error ${resp.status}`;
          try {
            const b = await resp.json();
            msg = b?.error ?? b?.detail ?? msg;
          } catch {
            /* noop */
          }
          throw new Error(msg);
        }
        const { workflow } = await resp.json();
        setSavedId(workflow.id);
        applyWorkflowDisplayTitle(
          workflow.id,
          workflowName.trim() || workflow.name || "新工作流",
        );
        router.replace(`/workflows/${workflow.id}`);
      } else {
        const resp = await fetch(`/api/workflows/${savedId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: workflowName,
            nodes: nodePayload,
            edges: edgePayload,
          }),
        });
        if (!resp.ok) {
          let msg = `Server error ${resp.status}`;
          try {
            const b = await resp.json();
            msg = b?.error ?? b?.detail ?? msg;
          } catch {
            /* noop */
          }
          throw new Error(msg);
        }
        applyWorkflowDisplayTitle(savedId, workflowName.trim() || "新工作流");
      }
    } catch (err) {
      alert(`保存失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col h-screen bg-[var(--background)]">
      {/* ── Top bar ─────────────────────────────────────────────── */}
      <header className="chrome-bar flex items-center gap-3 px-4 py-2 shrink-0 z-10">
        <button
          onClick={() => router.push("/workflows")}
          className="w-7 h-7 flex items-center justify-center rounded-md text-[var(--label-secondary)] hover:text-[var(--foreground)] hover:bg-[var(--separator-subtle)] transition-all text-sm"
        >
          ←
        </button>

        {/* Divider */}
        <span className="w-px h-4 bg-[var(--separator)] shrink-0" />

        {/* Editable workflow name */}
        <div className="group relative flex items-center gap-1.5 min-w-0">
          <input
            value={workflowName}
            onChange={(e) => setWorkflowName(e.target.value)}
            onFocus={(e) => e.target.select()}
            className="text-[13px] font-semibold border-none outline-none bg-transparent
                       min-w-0 max-w-[280px] w-[180px]
                       border-b border-transparent group-hover:border-[var(--separator)]
                       focus:border-[var(--accent)] pb-px transition-colors"
            placeholder="工作流名称"
            style={{
              color: "var(--foreground)",
              WebkitTextFillColor: "var(--foreground)",
            }}
          />
          {/* Pencil icon — visible on group hover */}
          <svg
            className="w-3 h-3 text-[var(--label-secondary)] opacity-0 group-hover:opacity-60 transition-opacity shrink-0 pointer-events-none"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H8v-2.414a2 2 0 01.586-1.414z"
            />
          </svg>
        </div>

        {savedId && (
          <span className="text-[9px] font-mono text-[var(--foreground)] opacity-25 truncate max-w-[140px] hidden sm:block">
            {savedId.slice(0, 8)}…
          </span>
        )}

        <div className="flex-1" />

        <button
          type="button"
          disabled={selectedDeleteIds.length === 0}
          onClick={() => {
            const n = selectedDeleteIds.length;
            if (
              !confirm(`确定删除 ${n} 个选中节点？关联连线将一并移除。`)
            )
              return;
            removeWorkflowNodesByIds(selectedDeleteIds);
          }}
          className="flex items-center gap-1 text-[11px] font-semibold
                     border border-red-500/35 text-red-500 hover:bg-red-500/10
                     disabled:opacity-30 disabled:cursor-not-allowed
                     px-3 py-1.5 rounded-lg transition-colors shrink-0"
        >
          删除选中
        </button>

        {/* Run button */}
        <button
          onClick={() => {
            clearRunStatus();
            setShowRunPanel(true);
          }}
          disabled={!savedId}
          title={!savedId ? "请先保存工作流" : "运行工作流"}
          className="flex items-center gap-1.5 text-[11px] font-bold bg-[#00c37f] hover:bg-[#00a86b]
                     disabled:opacity-30 disabled:cursor-not-allowed
                     text-black px-3.5 py-1.5 rounded-lg transition-colors"
        >
          <span>▶</span> 运行
        </button>

        {/* Save button */}
        <button
          onClick={saveWorkflow}
          disabled={saving}
          className="flex items-center gap-1.5 text-[11px] font-semibold
                     bg-[#ff9500] hover:bg-[#e08600] disabled:opacity-50
                     text-black px-3.5 py-1.5 rounded-lg transition-colors"
        >
          {saving ? (
            <>
              <span className="w-3 h-3 rounded-full border-2 border-black/30 border-t-black animate-spin" />
              保存中
            </>
          ) : (
            "保存"
          )}
        </button>
      </header>

      {/* ── Main layout ─────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">
        <NodePalette onDragStart={() => {}} />

        {/* Canvas */}
        <div className="flex-1 flex flex-col min-w-0">
          <div ref={reactFlowWrapper} className="flex-1 min-h-0">
            <ReactFlowProvider>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={WORKFLOW_NODE_TYPES}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onInit={setRfInstance}
                onDrop={onDrop}
                onDragOver={onDragOver}
                onNodeClick={onNodeClick}
                onPaneClick={onPaneClick}
                fitView
                fitViewOptions={{ padding: 0.3, maxZoom: 0.85 }}
                minZoom={0.15}
                maxZoom={2.5}
                className="wf-canvas"
                style={{ backgroundColor: "var(--background)" }}
                deleteKeyCode={["Backspace", "Delete"]}
                selectionKeyCode="Shift"
                nodesDraggable
                nodesConnectable
                elementsSelectable
                onNodesDelete={onNodesDelete}
              >
                <Background
                  variant={
                    "dots" as Parameters<typeof Background>[0]["variant"]
                  }
                  gap={24}
                  size={1.2}
                  color="rgba(255,255,255,0.06)"
                />
                <Controls position="bottom-left" />
                <MiniMap
                  position="bottom-right"
                  nodeColor={(n) => {
                    const d = n.data as unknown as WorkflowNodeData;
                    const info = NODE_TYPE_REGISTRY[d?.node_type];
                    if (!info) return "#27272a";
                    const m: Record<string, string> = {
                      trigger: "#00c37f",
                      agent: "#a78bfa",
                      tool: "#60a5fa",
                      control: "#fbbf24",
                      output: "#71717a",
                    };
                    return m[info.category] ?? "#27272a";
                  }}
                  maskColor="rgba(0,0,0,0.5)"
                />
              </ReactFlow>
            </ReactFlowProvider>
          </div>

          {/* Run panel */}
          {showRunPanel && savedId && (
            <RunPanel
              workflowId={savedId}
              onNodeStatusChange={onNodeRunStatusChange}
              onClose={() => setShowRunPanel(false)}
            />
          )}
        </div>

        {/* Config panel */}
        <NodeConfigPanel
          node={selectedNode}
          onChange={onNodeDataChange}
          nodes={nodes}
          edges={edges}
          onDeleteNode={(id) => removeWorkflowNodesByIds([id])}
        />
      </div>
    </div>
  );
}
