-- Run this after 0000_init.sql and 0001_dashboard.sql (Supabase SQL editor),
-- or via `npm run db:push`.

create table if not exists chats (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'New chat',
  pinned boolean not null default false,
  summary text,
  summarized_through_id integer,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
);

create table if not exists chat_messages (
  id serial primary key,
  chat_id uuid not null references chats(id) on delete cascade,
  role text not null,
  content text not null,
  sources jsonb,
  reranked boolean,
  created_at timestamp not null default now()
);

create index if not exists chat_messages_chat_id_index
  on chat_messages (chat_id);

create index if not exists chats_pinned_updated_index
  on chats (pinned desc, updated_at desc);

create table if not exists settings (
  id integer primary key,
  cohere_monthly_cap integer not null default 1000,
  cohere_per_minute_cap integer not null default 10,
  openrouter_per_minute_cap integer not null default 20,
  openrouter_daily_cap integer not null default 50,
  updated_at timestamp not null default now()
);

insert into settings (id) values (1) on conflict (id) do nothing;
