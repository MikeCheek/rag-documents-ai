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

-- Added as separate statements, not inside `create table`, so this file
-- also brings an existing chunks table up to date when re-run (as
-- `npm run db:migrate` does on databases set up before it existed) —
-- `create table if not exists` would skip them there, and the index
-- below would then fail on the missing column.
alter table chunks add column if not exists page_start integer; -- source PDF page range; null for unpaged formats
alter table chunks add column if not exists page_end integer;
-- Postgres text-search configuration for the chunk's language (english,
-- italian, ... or simple), detected per document at ingestion
-- (lib/rag/language.ts), so keyword search stems each language correctly.
alter table chunks add column if not exists ts_config regconfig not null default 'english';
-- Keyword half of hybrid search (lib/rag/retrieve.ts), kept in sync with
-- content and language automatically.
alter table chunks add column if not exists content_tsv tsvector
  generated always as (to_tsvector(ts_config, content)) stored;

create index if not exists chunks_content_tsv_index
  on chunks using gin (content_tsv);

-- Ingestion state shown on the Shelf while the background worker
-- (lib/jobs/worker.ts) processes a document, plus what it was indexed with.
alter table documents add column if not exists language text not null default 'english'; -- Postgres text-search config name
alter table documents add column if not exists embedding_model text; -- null = legacy Xenova/all-MiniLM-L6-v2
alter table documents add column if not exists stage text; -- queued | ocr | embedding | reembedding (while not ready)
alter table documents add column if not exists progress_done integer not null default 0;
alter table documents add column if not exists progress_total integer not null default 0;

-- Background job queue (lib/jobs/queue.ts): ingestion and re-embedding run
-- here rather than inside the upload request, so large files and OCR don't
-- hit the request time limit or die when the browser goes away.
create table if not exists jobs (
  id serial primary key,
  type text not null, -- ingest | reembed
  document_id uuid references documents(id) on delete cascade,
  payload jsonb, -- ingest: extracted pages/text, cleared when done
  file bytea, -- original PDF bytes, only kept when pages need OCR
  status text not null default 'queued', -- queued | running | done | failed
  attempts integer not null default 0,
  last_error text,
  locked_at timestamp,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
);

create index if not exists jobs_status_id_index on jobs (status, id);
create index if not exists jobs_document_id_index on jobs (document_id);

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
