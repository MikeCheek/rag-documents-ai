-- Run after 0000-0007 (Supabase SQL editor), or via `npm run db:push`
-- (see README for why `db:push` isn't reliable against Supabase directly).

alter table settings
  add column if not exists searxng_base_url text;

alter table chat_messages
  add column if not exists api_call_count integer;
