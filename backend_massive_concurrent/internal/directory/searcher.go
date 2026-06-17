// internal/directory/searcher.go — 内存文件索引 + 简单全文搜索
package directory

import (
	"regexp"
	"strings"
	"sync"

	pb "github.com/ai-media-agent/directory-service/generated/mediaagent"
)

type Searcher struct {
	mu      sync.RWMutex
	entries map[string]*pb.FileEntry // path → entry
}

func NewSearcher() *Searcher {
	return &Searcher{entries: make(map[string]*pb.FileEntry)}
}

func (s *Searcher) Add(entry *pb.FileEntry) {
	s.mu.Lock()
	s.entries[entry.Path] = entry
	s.mu.Unlock()
}

func (s *Searcher) Search(
	rootPath, query string,
	useRegex bool,
	maxResults int,
	extSet map[string]bool,
) []*pb.SearchMatch {
	s.mu.RLock()
	snapshot := make([]*pb.FileEntry, 0, len(s.entries))
	for _, e := range s.entries {
		if rootPath == "" || strings.HasPrefix(e.Path, rootPath) {
			snapshot = append(snapshot, e)
		}
	}
	s.mu.RUnlock()

	var matcher func(s string) (string, bool)
	if useRegex {
		re, err := regexp.Compile("(?i)" + query)
		if err != nil {
			// 编译失败退回字符串匹配
			lq := strings.ToLower(query)
			matcher = func(s string) (string, bool) {
				ls := strings.ToLower(s)
				if idx := strings.Index(ls, lq); idx >= 0 {
					start := max(0, idx-40)
					end := min(len(s), idx+len(lq)+40)
					return s[start:end], true
				}
				return "", false
			}
		} else {
			matcher = func(s string) (string, bool) {
				loc := re.FindStringIndex(s)
				if loc == nil {
					return "", false
				}
				start := max(0, loc[0]-40)
				end := min(len(s), loc[1]+40)
				return s[start:end], true
			}
		}
	} else {
		lq := strings.ToLower(query)
		matcher = func(s string) (string, bool) {
			ls := strings.ToLower(s)
			if idx := strings.Index(ls, lq); idx >= 0 {
				start := max(0, idx-40)
				end := min(len(s), idx+len(lq)+40)
				return s[start:end], true
			}
			return "", false
		}
	}

	var results []*pb.SearchMatch
	for _, entry := range snapshot {
		if len(extSet) > 0 && !extSet[entry.Extension] {
			continue
		}
		// 文件名匹配
		ctx, ok := matcher(entry.Name)
		if !ok {
			// Snippet 匹配
			ctx, ok = matcher(entry.Snippet)
		}
		if ok {
			results = append(results, &pb.SearchMatch{
				File:    entry,
				Context: ctx,
				Score:   1,
			})
			if len(results) >= maxResults {
				break
			}
		}
	}
	return results
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
