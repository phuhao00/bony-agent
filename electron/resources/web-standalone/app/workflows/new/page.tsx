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
import { useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { WorkflowNodeData } from "@/components/workflow/BaseNode";
import { NodeConfigPanel } from "@/components/workflow/NodeConfigPanel";
import { NodePalette } from "@/components/workflow/NodePalette";
import { WORKFLOW_NODE_TYPES } from "@/components/workflow/NodeTypes";
import { applyWorkflowDisplayTitle } from "@/lib/sidebar-recents";
import { NODE_TYPE_REGISTRY, NodeType } from "@/types/workflow";

let counter = 1;
const genId = () => `node_${Date.now()}_${counter++}`;

function NewWorkflowEditor() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nameHint = searchParams.get("name")?.trim() ?? "";

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [workflowName, setWorkflowName] = useState("新工作流");

  useEffect(() => {
    if (!nameHint) return;
    try {
      setWorkflowName(decodeURIComponent(nameHint));
    } catch {
      setWorkflowName(nameHint);
    }
  }, [nameHint]);
  const [saving, setSaving] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  const onConnect = useCallback(
    (c: Connection) =>
      setEdges((eds) => addEdge({ ...c, animated: false }, eds)),
    [setEdges],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const nodeType = e.dataTransfer.getData(
        "application/workflow-node-type",
      ) as NodeType;
      if (!nodeType || !rfInstance || !wrapper.current) return;
      const bounds = wrapper.current.getBoundingClientRect();
      const position = rfInstance.screenToFlowPosition({
        x: e.clientX - bounds.left,
        y: e.clientY - bounds.top,
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

  async function save() {
    setSaving(true);
    try {
      const resp = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: workflowName,
          nodes: nodes.map((n) => {
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
          }),
          edges: edges.map((e) => ({
            source: e.source,
            target: e.target,
            source_handle: e.sourceHandle ?? "output",
            target_handle: e.targetHandle ?? "input",
          })),
        }),
      });
      if (!resp.ok) {
        let msg = `Server error ${resp.status}`;
        try {
          const body = await resp.json();
          msg = body?.error ?? body?.detail ?? JSON.stringify(body);
        } catch {
          /* non-JSON body */
        }
        throw new Error(msg);
      }
      const { workflow } = await resp.json();
      applyWorkflowDisplayTitle(
        workflow.id,
        workflowName.trim() || workflow.name || "新工作流",
      );
      router.replace(`/workflows/${workflow.id}`);
    } catch (err) {
      alert(`保存失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col h-screen bg-[var(--background)]">
      <header className="chrome-bar flex items-center gap-3 px-4 py-2 shrink-0 z-10">
        <button
          onClick={() => router.push("/workflows")}
          className="w-7 h-7 flex items-center justify-center rounded-md text-[var(--label-secondary)] hover:text-[var(--foreground)] hover:bg-[var(--separator-subtle)] transition-all text-sm"
        >
          ←
        </button>

        <span className="w-px h-4 bg-[var(--separator)] shrink-0" />

        {/* Editable workflow name */}
        <div className="group relative flex items-center gap-1.5 min-w-0">
          <input
            autoFocus={!nameHint}
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

        <button
          onClick={save}
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
      <div className="flex flex-1 min-h-0">
        <NodePalette onDragStart={() => {}} />
        <div ref={wrapper} className="flex-1 min-h-0">
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
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
              }}
              onNodeClick={(_, n) => setSelectedNode(n)}
              onPaneClick={() => setSelectedNode(null)}
              onNodesDelete={onNodesDelete}
              deleteKeyCode={["Backspace", "Delete"]}
              selectionKeyCode="Shift"
              nodesDraggable
              nodesConnectable
              elementsSelectable
              fitView
              fitViewOptions={{ padding: 0.3, maxZoom: 0.85 }}
              minZoom={0.15}
              maxZoom={2.5}
              defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
              style={{ backgroundColor: "var(--background)" }}
              className="wf-canvas"
            >
              <Background gap={20} size={1} color="#e5e7eb" />
              <Controls />
              <MiniMap className="!bg-white !border !border-gray-200 !rounded-xl" />
            </ReactFlow>
          </ReactFlowProvider>
        </div>
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

export default function NewWorkflowPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col h-screen bg-[var(--background)] items-center justify-center gap-3 text-[var(--label-secondary)] text-[13px]">
          <span className="w-6 h-6 rounded-full border-2 border-[var(--separator-subtle)] border-t-[var(--accent)] animate-spin" />
          加载编辑器…
        </div>
      }
    >
      <NewWorkflowEditor />
    </Suspense>
  );
}
