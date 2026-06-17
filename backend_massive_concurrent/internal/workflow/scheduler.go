// internal/workflow/scheduler.go — DAG 执行状态机
// 负责 Kahn 算法 in-degree 管理、节点状态追踪、ready 节点通知
package workflow

import (
	"context"
	"fmt"
	"sync"
	"time"

	pb "github.com/ai-media-agent/directory-service/generated/mediaagent"
)

// NodeState 单个节点的运行状态
type NodeState struct {
	NodeID    string
	NodeType  string
	Config    string
	InputMap  map[string]string
	OutputMap map[string]string
	Status    pb.TaskStatus
	Outputs   map[string]string
	Error     string
	StartedAt time.Time
	DoneAt    time.Time
}

// RunState 一次工作流运行的完整状态
type RunState struct {
	mu          sync.Mutex
	RunID       string
	WorkflowID  string
	Status      pb.TaskStatus
	Nodes       map[string]*NodeState
	InDegree    map[string]int          // 当前剩余依赖数
	Successors  map[string][]string     // node → 后继节点列表
	Variables   map[string]string       // run 级变量: "$nodeId.outputKey" → value
	ReadyCh     chan *pb.StepAssignment // Go 推送给 Python 的通道
	ctx         context.Context
	cancel      context.CancelFunc
	StartedAt   time.Time
	FinishedAt  time.Time
}

// WorkflowScheduler 管理所有活跃的工作流运行
type WorkflowScheduler struct {
	runs sync.Map // run_id → *RunState
}

func NewWorkflowScheduler() *WorkflowScheduler {
	return &WorkflowScheduler{}
}

// NewRun 从 WorkflowRunRequest 初始化 RunState，返回 ready 节点列表
func (s *WorkflowScheduler) NewRun(
	ctx context.Context,
	req *pb.WorkflowRunRequest,
) (*RunState, []*pb.StepAssignment, error) {
	ctx, cancel := context.WithCancel(ctx)

	state := &RunState{
		RunID:      req.RunId,
		WorkflowID: req.WorkflowId,
		Status:     pb.TaskStatus_TASK_STATUS_RUNNING,
		Nodes:      make(map[string]*NodeState),
		InDegree:   make(map[string]int),
		Successors: make(map[string][]string),
		Variables:  make(map[string]string),
		ReadyCh:    make(chan *pb.StepAssignment, 64),
		ctx:        ctx,
		cancel:     cancel,
		StartedAt:  time.Now(),
	}

	// 注入初始变量
	for k, v := range req.InitialVariables {
		state.Variables[k] = v
	}

	// 注册所有节点
	for _, n := range req.Nodes {
		state.Nodes[n.NodeId] = &NodeState{
			NodeID:   n.NodeId,
			NodeType: n.NodeType,
			Config:   n.ConfigJson,
			InputMap: n.InputMap,
			Status:   pb.TaskStatus_TASK_STATUS_PENDING,
		}
		state.InDegree[n.NodeId] = 0
		state.Successors[n.NodeId] = []string{}
	}

	// 计算 in-degree 和后继
	for _, e := range req.Edges {
		state.InDegree[e.Target]++
		state.Successors[e.Source] = append(state.Successors[e.Source], e.Target)
	}

	s.runs.Store(req.RunId, state)

	// 收集初始 ready 节点（in-degree = 0）
	assignments := state.collectReadyNodes()

	return state, assignments, nil
}

// collectReadyNodes 返回所有 in-degree=0 且 PENDING 的节点的 StepAssignment
// 调用者必须持有 state.mu 或在初始化阶段（单线程）调用
func (state *RunState) collectReadyNodes() []*pb.StepAssignment {
	var assignments []*pb.StepAssignment
	for nodeID, deg := range state.InDegree {
		n := state.Nodes[nodeID]
		if deg == 0 && n.Status == pb.TaskStatus_TASK_STATUS_PENDING {
			n.Status = pb.TaskStatus_TASK_STATUS_RUNNING
			n.StartedAt = time.Now()
			resolved := state.resolveInputs(n.InputMap)
			assignments = append(assignments, &pb.StepAssignment{
				RunId:          state.RunID,
				NodeId:         nodeID,
				NodeType:       n.NodeType,
				ConfigJson:     n.Config,
				ResolvedInputs: resolved,
			})
		}
	}
	return assignments
}

// resolveInputs 展开 "$nodeId.outputKey" 引用
func (state *RunState) resolveInputs(inputMap map[string]string) map[string]string {
	resolved := make(map[string]string, len(inputMap))
	for param, ref := range inputMap {
		if val, ok := state.Variables[ref]; ok {
			resolved[param] = val
		} else {
			// literal value (no $ prefix or not found in variables)
			resolved[param] = ref
		}
	}
	return resolved
}

// MarkCompleted 标记节点完成，返回新解锁的 ready 节点
func (s *WorkflowScheduler) MarkCompleted(
	runID, nodeID string,
	outputs map[string]string,
) ([]*pb.StepAssignment, bool, error) {
	val, ok := s.runs.Load(runID)
	if !ok {
		return nil, false, fmt.Errorf("run %s not found", runID)
	}
	state := val.(*RunState)

	state.mu.Lock()
	defer state.mu.Unlock()

	n, ok := state.Nodes[nodeID]
	if !ok {
		return nil, false, fmt.Errorf("node %s not found in run %s", nodeID, runID)
	}

	n.Status = pb.TaskStatus_TASK_STATUS_COMPLETED
	n.Outputs = outputs
	n.DoneAt = time.Now()

	// 写入 run 级变量: "$nodeId.outputKey"
	for k, v := range outputs {
		state.Variables["$"+nodeID+"."+k] = v
	}

	// 减少后继节点的 in-degree
	for _, succ := range state.Successors[nodeID] {
		state.InDegree[succ]--
	}

	// 收集新 ready 节点
	newReady := state.collectReadyNodes()

	// 检查是否全部完成
	finished := s.isFinished(state)
	if finished {
		state.Status = pb.TaskStatus_TASK_STATUS_COMPLETED
		state.FinishedAt = time.Now()
	}

	return newReady, finished, nil
}

// MarkFailed 标记节点失败（fail-fast: cancel context）
func (s *WorkflowScheduler) MarkFailed(runID, nodeID, errMsg string) error {
	val, ok := s.runs.Load(runID)
	if !ok {
		return fmt.Errorf("run %s not found", runID)
	}
	state := val.(*RunState)

	state.mu.Lock()
	defer state.mu.Unlock()

	if n, ok := state.Nodes[nodeID]; ok {
		n.Status = pb.TaskStatus_TASK_STATUS_FAILED
		n.Error = errMsg
		n.DoneAt = time.Now()
	}
	state.Status = pb.TaskStatus_TASK_STATUS_FAILED
	state.FinishedAt = time.Now()
	state.cancel() // 取消整个 run 的 context
	return nil
}

// Cancel 外部取消整个 run
func (s *WorkflowScheduler) Cancel(runID string) error {
	val, ok := s.runs.Load(runID)
	if !ok {
		return fmt.Errorf("run %s not found", runID)
	}
	state := val.(*RunState)
	state.mu.Lock()
	state.Status = pb.TaskStatus_TASK_STATUS_FAILED
	state.FinishedAt = time.Now()
	state.mu.Unlock()
	state.cancel()
	return nil
}

// GetStatus 返回当前运行状态快照
func (s *WorkflowScheduler) GetStatus(runID string) (*pb.WorkflowRunStatus, error) {
	val, ok := s.runs.Load(runID)
	if !ok {
		return nil, fmt.Errorf("run %s not found", runID)
	}
	state := val.(*RunState)

	state.mu.Lock()
	defer state.mu.Unlock()

	var nodeStatuses []*pb.NodeRunStatus
	for _, n := range state.Nodes {
		ns := &pb.NodeRunStatus{
			NodeId: n.NodeID,
			Status: n.Status,
			Error:  n.Error,
		}
		if !n.StartedAt.IsZero() {
			ns.StartedAtMs = n.StartedAt.UnixMilli()
		}
		if !n.DoneAt.IsZero() {
			ns.FinishedAtMs = n.DoneAt.UnixMilli()
		}
		nodeStatuses = append(nodeStatuses, ns)
	}

	resp := &pb.WorkflowRunStatus{
		RunId:       state.RunID,
		WorkflowId:  state.WorkflowID,
		Status:      state.Status,
		NodeStatuses: nodeStatuses,
		StartedAtMs: state.StartedAt.UnixMilli(),
	}
	if !state.FinishedAt.IsZero() {
		resp.FinishedAtMs = state.FinishedAt.UnixMilli()
	}
	return resp, nil
}

// GetReadyCh 返回此 run 的 ready channel（用于 ScheduleWorkflow 流式推送）
func (s *WorkflowScheduler) GetReadyCh(runID string) (chan *pb.StepAssignment, context.Context, error) {
	val, ok := s.runs.Load(runID)
	if !ok {
		return nil, nil, fmt.Errorf("run %s not found", runID)
	}
	state := val.(*RunState)
	return state.ReadyCh, state.ctx, nil
}

// PushReady 将新 ready 的步骤推入 channel（由 MarkCompleted 结果调用）
func (s *WorkflowScheduler) PushReady(runID string, assignments []*pb.StepAssignment) {
	val, ok := s.runs.Load(runID)
	if !ok {
		return
	}
	state := val.(*RunState)
	for _, a := range assignments {
		select {
		case state.ReadyCh <- a:
		case <-state.ctx.Done():
			return
		}
	}
}

// CloseReadyCh 关闭 ready channel（run 结束时调用）
func (s *WorkflowScheduler) CloseReadyCh(runID string) {
	val, ok := s.runs.Load(runID)
	if !ok {
		return
	}
	state := val.(*RunState)
	// 关闭只执行一次（recover panic 防止 double-close）
	func() {
		defer func() { recover() }() //nolint:errcheck
		close(state.ReadyCh)
	}()
}

// isFinished 检查所有节点是否完成（必须在 mu 锁下调用）
func (s *WorkflowScheduler) isFinished(state *RunState) bool {
	for _, n := range state.Nodes {
		if n.Status == pb.TaskStatus_TASK_STATUS_PENDING ||
			n.Status == pb.TaskStatus_TASK_STATUS_RUNNING {
			return false
		}
	}
	return true
}

// Cleanup 清理已完成的 run（可选，防止内存泄漏）
func (s *WorkflowScheduler) Cleanup(runID string) {
	s.runs.Delete(runID)
}
