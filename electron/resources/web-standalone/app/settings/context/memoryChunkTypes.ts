export interface MemoryEntityRef {
  id: string;
  label: string;
  kind: string;
  count?: number;
}

export interface CodeEntityRef {
  kind: string;
  label: string;
  path?: string;
  symbol?: string;
  line?: number;
  source?: string;
}

export interface MemoryChunk {
  id: string;
  source_id: string;
  source_kind: string;
  content_preview: string;
  content_full?: string;
  timestamp_ms: number;
  status: string;
  metadata: Record<string, unknown>;
  entities: MemoryEntityRef[];
  code_entities?: CodeEntityRef[];
}

export interface MemorySource {
  id: string;
  label: string;
  kind: string;
  count: number;
  status: string;
}

export interface MemoryChunksResponse {
  chunks: MemoryChunk[];
  sources: MemorySource[];
  top_people: MemoryEntityRef[];
  top_topics: MemoryEntityRef[];
  count: number;
  snapshot_at?: string;
}

export interface NavigatorSelection {
  sourceIds: string[];
  entityIds: string[];
}
