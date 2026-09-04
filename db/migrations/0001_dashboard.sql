-- Run this after 0000_init.sql (Supabase SQL editor), or via `npm run db:push`.

alter table chunks add column if not exists usage_count integer not null default 0;

create table if not exists api_calls (
  id serial primary key,
  provider text not null,
  purpose text not null,
  count integer not null default 1,
  tokens_used integer,
  created_at timestamp not null default now()
);

create index if not exists api_calls_provider_created_index
  on api_calls (provider, created_at);
