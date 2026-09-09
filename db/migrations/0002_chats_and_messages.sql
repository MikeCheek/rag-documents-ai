-- Conversations and their messages. `summary` + `summarized_through_id` on
-- chats implement compaction: once a chat gets long, older messages fold
-- into `summary` and drop out of what's sent to the LLM, while staying in
-- chat_messages so the full transcript still displays in the UI.
--
-- chat_messages carries fields used by both RAG and Agent mode, since
-- mode is tracked per message, not per chat (a single conversation can
-- mix both) — sources/rerank_method are RAG-only, agent_steps is
-- Agent-only, api_call_count and duration_ms apply to both.

create table if not exists chats (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'New chat',
  pinned boolean not null default false,
  summary text,
  summarized_through_id integer,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
);

create index if not exists chats_pinned_updated_index
  on chats (pinned desc, updated_at desc);

create table if not exists chat_messages (
  id serial primary key,
  chat_id uuid not null references chats(id) on delete cascade,
  role text not null, -- user | assistant
  content text not null,
  mode text not null default 'rag', -- rag | agent — which pipeline produced/received this message
  sources jsonb, -- Source[] | null — RAG mode only
  rerank_method text, -- cohere | bm25 | vector | null — RAG mode only
  agent_steps jsonb, -- AgentStep[] | null — agent mode only
  api_call_count integer, -- # of LLM (OpenRouter) calls made to produce this message
  duration_ms integer, -- total time taken to produce this message
  created_at timestamp not null default now()
);

create index if not exists chat_messages_chat_id_index
  on chat_messages (chat_id);

-- Granular timing for every stage/call within a turn (RAG pipeline steps
-- or Agent tool calls/LLM round-trips), plus one "total" row per turn —
-- the source data for the Ledger's timing charts.
create table if not exists stage_timings (
  id serial primary key,
  chat_id uuid references chats(id) on delete cascade,
  message_id integer references chat_messages(id) on delete cascade,
  mode text not null, -- rag | agent
  stage text not null, -- optimize_query | retrieve | rerank | generate | llm_call | tool:<name> | rate_limit_wait | total | ...
  duration_ms integer not null,
  created_at timestamp not null default now()
);

create index if not exists stage_timings_stage_index on stage_timings (stage);
create index if not exists stage_timings_created_index on stage_timings (created_at);
