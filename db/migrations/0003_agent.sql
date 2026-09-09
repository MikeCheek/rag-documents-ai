-- Everything specific to Agent mode that isn't the settings that control
-- it (those live in 0004_settings.sql).

-- User-defined tools available in Agent mode. Deliberately HTTP-calling
-- rather than arbitrary code, so "create more tools" doesn't mean running
-- untrusted code server-side — the server just makes a bounded, guarded
-- HTTP request (see lib/agent/ssrf-guard.ts) and returns the response.
create table if not exists agent_tools (
  id uuid primary key default gen_random_uuid(),
  name text not null unique, -- shown to the LLM as the function name; identifier-safe
  description text not null,
  method text not null default 'GET', -- GET | POST
  url_template text not null, -- e.g. https://api.example.com/search?q={query}
  parameters jsonb not null, -- ToolParameter[]
  headers jsonb, -- Record<string,string> | null — static headers, e.g. an API key
  enabled boolean not null default true,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
);

-- One row per tool invocation (built-in or custom), so tool usage is
-- tracked the same way API usage already is.
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

-- Persistent facts/instructions the agent has been asked to remember.
-- Global (not scoped to one chat) and injected into the Agent-mode system
-- prompt on every turn, so memory carries across chats, not just within
-- one — separate from (and in addition to) each chat's own history.
create table if not exists agent_memories (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
);
