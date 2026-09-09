-- Run after 0000-0004 (Supabase SQL editor), or via `npm run db:push`
-- (see README for why `db:push` isn't reliable against Supabase directly).

alter table chat_messages
  add column if not exists mode text not null default 'rag';

alter table chat_messages
  add column if not exists agent_steps jsonb;

alter table settings
  add column if not exists agent_max_steps integer not null default 6;

create table if not exists agent_tools (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null,
  method text not null default 'GET',
  url_template text not null,
  parameters jsonb not null,
  headers jsonb,
  enabled boolean not null default true,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
);

create table if not exists tool_call_log (
  id serial primary key,
  chat_id uuid references chats(id) on delete set null,
  tool_name text not null,
  success boolean not null default true,
  duration_ms integer,
  created_at timestamp not null default now()
);

create index if not exists tool_call_log_tool_name_created_index
  on tool_call_log (tool_name, created_at);

-- Same reasoning as 0003_rls.sql: this app only ever connects via
-- DATABASE_URL directly, never through Supabase's REST API, so RLS with no
-- policies simply closes that API surface off without affecting the app.
alter table agent_tools enable row level security;
alter table tool_call_log enable row level security;
