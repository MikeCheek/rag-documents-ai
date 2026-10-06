-- Failed sign-in attempts (lib/auth/login-limiter.ts), so the lockout
-- after too many wrong passwords survives restarts and is shared by every
-- server process.

create table if not exists login_failures (
  id serial primary key,
  client_key text not null, -- the client's IP address
  failed_at timestamp not null default now()
);

create index if not exists login_failures_client_key_idx on login_failures (client_key, failed_at);

-- Keep it out of Supabase's REST API like every other table (0005_security.sql).
alter table login_failures enable row level security;
