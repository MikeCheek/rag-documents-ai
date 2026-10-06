-- For existing databases only — the baseline (0001) already includes this
-- column and index for anyone setting up fresh, so this is a no-op there.
--
-- Keyword half of hybrid search (see lib/rag/retrieve.ts). A generated
-- column keeps the full-text index in sync with chunk content
-- automatically, including for every chunk that already exists, so
-- nothing needs re-uploading. Optional: until this has been run, the app
-- falls back to vector-only search.

alter table chunks
  add column if not exists content_tsv tsvector
  generated always as (to_tsvector('english', content)) stored;

create index if not exists chunks_content_tsv_index
  on chunks using gin (content_tsv);
