// internal/directory/watcher.go — fsnotify + Debouncer → WatchEvent 流
package directory

import (
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	pb "github.com/ai-media-agent/directory-service/generated/mediaagent"
	"github.com/fsnotify/fsnotify"
)

const debounceDuration = 200 * time.Millisecond

type Watcher struct{}

func NewWatcher() *Watcher { return &Watcher{} }

func (w *Watcher) Watch(
	paths []string,
	extSet map[string]bool,
	stream pb.DirectoryService_WatchDirectoryServer,
) error {
	fsw, err := fsnotify.NewWatcher()
	if err != nil {
		return fmt.Errorf("create watcher: %w", err)
	}
	defer fsw.Close()

	for _, p := range paths {
		if err := fsw.Add(p); err != nil {
			return fmt.Errorf("watch %s: %w", p, err)
		}
	}

	// Debouncer：按路径分组，防抖 200ms
	type pending struct {
		timer  *time.Timer
		opName pb.WatchEventType
	}
	var mu sync.Mutex
	pending_map := make(map[string]*pending)

	send := func(path string, evType pb.WatchEventType) {
		ev := &pb.WatchEvent{
			EventType: evType,
			Path:      path,
			Timestamp: time.Now().Format(time.RFC3339),
		}
		if evType != pb.WatchEventType_WATCH_EVENT_DELETE {
			if info, err := os.Stat(path); err == nil {
				ev.Entry = &pb.FileEntry{
					Path:       path,
					Name:       info.Name(),
					Extension:  strings.ToLower(strings.TrimPrefix(path[strings.LastIndex(path, "."):], ".")),
					SizeBytes:  info.Size(),
					ModifiedAt: info.ModTime().Format(time.RFC3339),
				}
			}
		}
		_ = stream.Send(ev) // 忽略发送错误（客户端断开时循环退出）
	}

	ctx := stream.Context()
	for {
		select {
		case <-ctx.Done():
			return nil
		case event, ok := <-fsw.Events:
			if !ok {
				return nil
			}
			path := event.Name
			ext := strings.ToLower(strings.TrimPrefix(path[strings.LastIndex(path, "."):], "."))
			if len(extSet) > 0 && !extSet["."+ext] {
				continue
			}

			var evType pb.WatchEventType
			switch {
			case event.Has(fsnotify.Create):
				evType = pb.WatchEventType_WATCH_EVENT_CREATE
			case event.Has(fsnotify.Write):
				evType = pb.WatchEventType_WATCH_EVENT_MODIFY
			case event.Has(fsnotify.Remove), event.Has(fsnotify.Rename):
				evType = pb.WatchEventType_WATCH_EVENT_DELETE
			default:
				continue
			}

			mu.Lock()
			if p, ok := pending_map[path]; ok {
				p.timer.Reset(debounceDuration)
				p.opName = evType
			} else {
				t := time.AfterFunc(debounceDuration, func() {
					mu.Lock()
					op := pending_map[path].opName
					delete(pending_map, path)
					mu.Unlock()
					send(path, op)
				})
				pending_map[path] = &pending{timer: t, opName: evType}
			}
			mu.Unlock()

		case err, ok := <-fsw.Errors:
			if !ok {
				return nil
			}
			_ = err // 忽略偶发性错误
		}
	}
}
