-- Run after 0000-0006 (Supabase SQL editor), or via `npm run db:push`
-- (see README for why `db:push` isn't reliable against Supabase directly).

create table if not exists agent_memories (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
);

-- Same reasoning as 0003_rls.sql / 0005_agent_mode.sql: this app only ever
-- connects via DATABASE_URL directly, never through Supabase's REST API,
-- so RLS with no policies simply closes that API surface off.
alter table agent_memories enable row level security;
