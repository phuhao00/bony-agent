// internal/directory/service.go — DirectoryService gRPC 实现
package directory

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	pb "github.com/ai-media-agent/directory-service/generated/mediaagent"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type Service struct {
	pb.UnimplementedDirectoryServiceServer
	searcher *Searcher
	watcher  *Watcher
}

func NewService() *Service {
	return &Service{
		searcher: NewSearcher(),
		watcher:  NewWatcher(),
	}
}

// ── IndexDirectory（服务端流式）──────────────────────────────
func (s *Service) IndexDirectory(req *pb.IndexRequest, stream pb.DirectoryService_IndexDirectoryServer) error {
	if req.RootPath == "" {
		return status.Error(codes.InvalidArgument, "root_path is required")
	}
	if _, err := os.Stat(req.RootPath); err != nil {
		return status.Errorf(codes.NotFound, "path not found: %v", err)
	}

	maxDepth := int(req.MaxDepth)
	if maxDepth == 0 {
		maxDepth = 64
	}
	maxFiles := int(req.MaxFiles)
	if maxFiles == 0 {
		maxFiles = 100_000
	}

	extSet := makeExtSet(req.Extensions)
	indexed := 0
	found := 0

	err := filepath.WalkDir(req.RootPath, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil // 跳过无权限目录
		}

		// 深度限制
		rel, _ := filepath.Rel(req.RootPath, path)
		depth := strings.Count(rel, string(os.PathSeparator))
		if depth > maxDepth {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		if d.IsDir() {
			// 跳过隐藏目录
			if strings.HasPrefix(d.Name(), ".") && path != req.RootPath {
				return filepath.SkipDir
			}
			return nil
		}

		found++
		if maxFiles > 0 && indexed >= maxFiles {
			return filepath.SkipAll
		}

		ext := strings.ToLower(filepath.Ext(path))
		if len(extSet) > 0 && !extSet[ext] {
			return nil
		}

		// 发送进度
		progress := &pb.IndexProgress{
			RootPath:     req.RootPath,
			FilesFound:   int32(found),
			FilesIndexed: int32(indexed),
			CurrentFile:  path,
			Status:       pb.TaskStatus_TASK_STATUS_RUNNING,
		}

		if req.ExtractText {
			entry := buildFileEntry(path, d, req.ExtractText)
			progress.CurrentFile = path

			// 注册到搜索器
			s.searcher.Add(entry)

			_ = entry // 进度中包含 current_file 即可
		}

		indexed++

		if err := stream.Send(progress); err != nil {
			return fmt.Errorf("stream send: %w", err)
		}
		return nil
	})

	if err != nil && err != filepath.SkipAll {
		return status.Errorf(codes.Internal, "walk error: %v", err)
	}

	// 发送完成事件
	return stream.Send(&pb.IndexProgress{
		RootPath:     req.RootPath,
		FilesFound:   int32(found),
		FilesIndexed: int32(indexed),
		Status:       pb.TaskStatus_TASK_STATUS_COMPLETED,
		IsDone:       true,
	})
}

// ── SearchFiles ───────────────────────────────────────────
func (s *Service) SearchFiles(_ context.Context, req *pb.SearchRequest) (*pb.SearchResponse, error) {
	if req.Query == "" {
		return nil, status.Error(codes.InvalidArgument, "query is required")
	}
	t0 := time.Now()
	maxResults := int(req.MaxResults)
	if maxResults <= 0 {
		maxResults = 50
	}

	extSet := makeExtSet(req.Extensions)
	matches := s.searcher.Search(req.RootPath, req.Query, req.UseRegex, maxResults, extSet)

	return &pb.SearchResponse{
		Matches:   matches,
		Total:     int32(len(matches)),
		Truncated: len(matches) >= maxResults,
		LatencyMs: time.Since(t0).Milliseconds(),
	}, nil
}

// ── WatchDirectory（服务端流式，长连接）──────────────────────
func (s *Service) WatchDirectory(req *pb.WatchRequest, stream pb.DirectoryService_WatchDirectoryServer) error {
	if len(req.Paths) == 0 {
		return status.Error(codes.InvalidArgument, "at least one path required")
	}
	extSet := makeExtSet(req.Extensions)
	return s.watcher.Watch(req.Paths, extSet, stream)
}

// ── 辅助 ─────────────────────────────────────────────────
func makeExtSet(exts []string) map[string]bool {
	m := make(map[string]bool, len(exts))
	for _, e := range exts {
		if !strings.HasPrefix(e, ".") {
			e = "." + e
		}
		m[strings.ToLower(e)] = true
	}
	return m
}

func buildFileEntry(path string, d os.DirEntry, extractText bool) *pb.FileEntry {
	info, err := d.Info()
	var size int64
	var modAt string
	if err == nil {
		size = info.Size()
		modAt = info.ModTime().Format(time.RFC3339)
	}

	snippet := ""
	if extractText {
		snippet = readSnippet(path, 500)
	}

	return &pb.FileEntry{
		Path:       path,
		Name:       d.Name(),
		Extension:  strings.ToLower(filepath.Ext(path)),
		SizeBytes:  size,
		ModifiedAt: modAt,
		Snippet:    snippet,
		IsDir:      d.IsDir(),
	}
}

// readSnippet 读取文件前 n 个 rune 的文本
func readSnippet(path string, maxRunes int) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()

	buf := make([]byte, maxRunes*4) // UTF-8 最多 4 bytes/rune
	n, _ := f.Read(buf)
	buf = buf[:n]

	if !utf8.Valid(buf) {
		return "" // 二进制文件不提取
	}

	runes := []rune(string(buf))
	if len(runes) > maxRunes {
		runes = runes[:maxRunes]
	}
	return strings.TrimSpace(string(runes))
}
