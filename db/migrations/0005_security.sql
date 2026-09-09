-- Locks down every table from Supabase's auto-generated REST API
-- (PostgREST/anon/authenticated roles). This app only ever connects via a
-- direct Postgres connection (DATABASE_URL), which isn't affected by RLS
-- since the default `postgres` role bypasses it — so no policies are
-- needed here. Enabling RLS with zero policies simply denies all access
-- through the public API surface, closing the gap that Supabase's
-- Security Advisor otherwise flags as "RLS Disabled in Public" for every
-- table. Run this last, after every table above already exists.

alter table documents enable row level security;
alter table chunks enable row level security;
alter table api_calls enable row level security;
alter table chats enable row level security;
alter table chat_messages enable row level security;
alter table stage_timings enable row level security;
alter table agent_tools enable row level security;
alter table tool_call_log enable row level security;
alter table agent_memories enable row level security;
alter table settings enable row level security;
