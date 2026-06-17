// cmd/server/main.go — 目录服务 gRPC 入口
package main

import (
	"fmt"
	"net"
	"os"
	"strconv"

	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"

	pb "github.com/ai-media-agent/directory-service/generated/mediaagent"
	"github.com/ai-media-agent/directory-service/internal/directory"
	"github.com/ai-media-agent/directory-service/internal/workflow"
)

func main() {
	port := envInt("DIRECTORY_PORT", 50053)
	addr := fmt.Sprintf("0.0.0.0:%d", port)

	lis, err := net.Listen("tcp", addr)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to listen on %s: %v\n", addr, err)
		os.Exit(1)
	}

	maxMsgMB := envInt("MAX_MESSAGE_MB", 50)
	srv := grpc.NewServer(
		grpc.MaxRecvMsgSize(maxMsgMB*1024*1024),
		grpc.MaxSendMsgSize(maxMsgMB*1024*1024),
	)

	pb.RegisterDirectoryServiceServer(srv, directory.NewService())

	// WorkflowScheduler: DAG 调度引擎
	// WORKFLOW_MAX_CONCURRENT 控制同时下发的最大并发步骤数（防止 LLM 过载）
	maxConcurrent := envInt("WORKFLOW_MAX_CONCURRENT", 8)
	pb.RegisterWorkflowSchedulerServiceServer(srv, workflow.NewService(maxConcurrent))

	if os.Getenv("GRPC_REFLECTION") != "0" {
		reflection.Register(srv)
	}

	fmt.Printf("Directory + WorkflowScheduler gRPC service listening on %s\n", addr)
	if err := srv.Serve(lis); err != nil {
		fmt.Fprintf(os.Stderr, "Serve error: %v\n", err)
		os.Exit(1)
	}
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}
