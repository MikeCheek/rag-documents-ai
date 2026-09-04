-- Run after 0000-0003 (Supabase SQL editor), or via `npm run db:push`.

alter table settings
  add column if not exists query_optimization text not null default 'local';

alter table settings
  add column if not exists rerank_method text not null default 'cohere';

-- Replaces the old boolean "was this reranked by Cohere?" flag with the
-- actual method used ("cohere" | "bm25" | "vector"), now that there's more
-- than one reranking method.
alter table chat_messages
  add column if not exists rerank_method text;

alter table chat_messages
  drop column if exists reranked;
