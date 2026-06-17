# LLM Wiki Layer

This project now has a local markdown wiki layer under `storage/wiki/`. It complements the existing RAG and memory systems by compiling task traces, research artifacts, and curated notes into durable pages that can be browsed, linked, linted, and reused across sessions.

## Storage Layout

- `storage/wiki/index.md`: generated catalog of compiled pages.
- `storage/wiki/log.md`: append-only chronological operation log.
- `storage/wiki/entities/`: entity pages for agents, platforms, topics, providers, and similar durable concepts.
- `storage/wiki/generated/`: compiled task traces and notes.
- `storage/wiki/sources/`: compiled research/source pages.
- `storage/wiki/playbooks/`: reserved for reusable procedures and operating playbooks.

## Backend API

- `POST /wiki/compile`: compile `trace`, `research`, or `text` into a wiki page.
- `GET /wiki/pages`: list compiled pages with frontmatter summaries.
- `GET /wiki/pages/{page_id}`: read a wiki page by id.
- `POST /wiki/index/rebuild`: regenerate `index.md` from page frontmatter.
- `GET /wiki/graph`: return a graph from markdown wikilinks.
- `GET /wiki/health`: run deterministic health checks for broken links, missing provenance, and orphan pages.

## Example

```json
POST /wiki/compile
{
  "source_type": "text",
  "title": "小红书发布 SOP",
  "page_type": "playbook",
  "tags": ["publishing", "xiaohongshu"],
  "content": "1. 先审核内容。\n2. 再准备封面图。\n3. 最后发布并记录结果。"
}
```

## Design Notes

Raw sources remain unchanged in their original stores. The wiki is a compiled, inspectable layer with `source_hash` and `source_refs` metadata so future tooling can verify, refresh, or roll back derived knowledge.
