// internal/workflow/service.go — gRPC handler 实现
package workflow

import (
	"context"
	"time"

	"golang.org/x/time/rate"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	pb "github.com/ai-media-agent/directory-service/generated/mediaagent"
)

// Service 实现 WorkflowSchedulerServiceServer
type Service struct {
	pb.UnimplementedWorkflowSchedulerServiceServer
	scheduler *WorkflowScheduler
	limiter   *rate.Limiter // 限制并发 LLM 调用（令牌桶）
}

// NewService 创建 WorkflowScheduler gRPC 服务
// maxConcurrent: 同时最多下发多少个并发步骤（防止 LLM 过载）
func NewService(maxConcurrent int) *Service {
	return &Service{
		scheduler: NewWorkflowScheduler(),
		limiter:   rate.NewLimiter(rate.Limit(maxConcurrent), maxConcurrent),
	}
}

// ScheduleWorkflow 接收 DAG 定义，流式推送可执行步骤
func (s *Service) ScheduleWorkflow(
	req *pb.WorkflowRunRequest,
	stream pb.WorkflowSchedulerService_ScheduleWorkflowServer,
) error {
	ctx := stream.Context()

	_, initialAssignments, err := s.scheduler.NewRun(ctx, req)
	if err != nil {
		return status.Errorf(codes.InvalidArgument, "failed to initialize run: %v", err)
	}

	for _, a := range initialAssignments {
		if err := s.limiter.Wait(ctx); err != nil {
			return status.Errorf(codes.Canceled, "workflow cancelled before start: %v", err)
		}
		if err := stream.Send(a); err != nil {
			return status.Errorf(codes.Internal, "stream send error: %v", err)
		}
	}

	readyCh, runCtx, err := s.scheduler.GetReadyCh(req.RunId)
	if err != nil {
		return status.Errorf(codes.Internal, "get ready channel error: %v", err)
	}

	for {
		select {
		case assignment, ok := <-readyCh:
			if !ok {
				return nil
			}
			if err := s.limiter.Wait(ctx); err != nil {
				return status.Errorf(codes.Canceled, "rate limiter cancelled: %v", err)
			}
			if err := stream.Send(assignment); err != nil {
				return status.Errorf(codes.Internal, "stream send error: %v", err)
			}
		case <-ctx.Done():
			s.scheduler.Cancel(req.RunId)
			return status.Errorf(codes.Canceled, "client disconnected")
		case <-runCtx.Done():
			return status.Errorf(codes.Aborted, "workflow run aborted")
		}
	}
}

// ReportStepResult Python 上报节点执行结果
func (s *Service) ReportStepResult(
	ctx context.Context,
	req *pb.StepResultRequest,
) (*pb.StepResultAck, error) {
	if req.Status == pb.TaskStatus_TASK_STATUS_FAILED {
		if err := s.scheduler.MarkFailed(req.RunId, req.NodeId, req.Error); err != nil {
			return &pb.StepResultAck{Accepted: false, Message: err.Error()}, nil
		}
		s.scheduler.CloseReadyCh(req.RunId)
		return &pb.StepResultAck{Accepted: true, Message: "run aborted due to node failure"}, nil
	}

	newReady, finished, err := s.scheduler.MarkCompleted(req.RunId, req.NodeId, req.Outputs)
	if err != nil {
		return &pb.StepResultAck{Accepted: false, Message: err.Error()}, nil
	}

	s.scheduler.PushReady(req.RunId, newReady)

	if finished {
		s.scheduler.CloseReadyCh(req.RunId)
		runID := req.RunId
		go func() {
			time.Sleep(30 * time.Second)
			s.scheduler.Cleanup(runID)
		}()
	}

	return &pb.StepResultAck{Accepted: true, Message: "ok"}, nil
}

// CancelWorkflow 外部取消整个 run
func (s *Service) CancelWorkflow(
	ctx context.Context,
	req *pb.CancelWorkflowRequest,
) (*pb.CancelWorkflowAck, error) {
	if err := s.scheduler.Cancel(req.RunId); err != nil {
		return &pb.CancelWorkflowAck{Cancelled: false}, nil
	}
	s.scheduler.CloseReadyCh(req.RunId)
	return &pb.CancelWorkflowAck{Cancelled: true}, nil
}

// GetRunStatus 查询运行状态
func (s *Service) GetRunStatus(
	ctx context.Context,
	req *pb.RunStatusRequest,
) (*pb.WorkflowRunStatus, error) {
	resp, err := s.scheduler.GetStatus(req.RunId)
	if err != nil {
		return nil, status.Errorf(codes.NotFound, "run not found: %v", err)
	}
	return resp, nil
}
