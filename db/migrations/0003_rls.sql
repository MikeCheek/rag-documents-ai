-- Locks down every table from Supabase's auto-generated REST API
-- (PostgREST/anon/authenticated roles). This app only ever connects via a
-- direct Postgres connection (DATABASE_URL), which isn't affected by RLS,
-- so no policies are needed -- enabling RLS with zero policies simply
-- denies all access through the public API surface.

alter table documents enable row level security;
alter table chunks enable row level security;
alter table api_calls enable row level security;
alter table chats enable row level security;
alter table chat_messages enable row level security;
alter table settings enable row level security;
