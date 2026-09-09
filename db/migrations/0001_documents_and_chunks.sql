-- Documents (uploaded source files) and their chunks (the embedded
-- passages actually retrieved at query time). Every document also gets a
-- centroid_embedding — the elementwise mean of its own chunks' embeddings,
-- computed once when it finishes processing — which is what "Group
-- similar" on the Shelf clusters documents by; see lib/rag/clustering.ts.

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  file_type text not null,
  status text not null default 'processing', -- processing | ready | failed
  error text,
  chunk_count integer not null default 0,
  char_count integer not null default 0,
  centroid_embedding vector(384),
  created_at timestamp not null default now()
);

create table if not exists chunks (
  id serial primary key,
  document_id uuid not null references documents(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  embedding vector(384),
  usage_count integer not null default 0,
  created_at timestamp not null default now()
);

create index if not exists chunks_embedding_index
  on chunks using hnsw (embedding vector_cosine_ops);

create index if not exists chunks_document_id_index
  on chunks (document_id);

-- One row per call made to an external (or local) AI service, so the
-- dashboard can show usage against each provider's free-tier limits.
create table if not exists api_calls (
  id serial primary key,
  provider text not null, -- openrouter | cohere | local
  purpose text not null, -- optimize_query | chat_completion | rerank | embedding | compaction | agent_step
  count integer not null default 1, -- lets one row represent a batch (e.g. N embeddings)
  tokens_used integer,
  created_at timestamp not null default now()
);

create index if not exists api_calls_provider_created_index
  on api_calls (provider, created_at);
