-- For existing databases only — the baselines (0002, 0003, 0005) already
-- include all of this for anyone setting up fresh, so it's a no-op there.
--
-- API connections and MCP servers for Agent mode, and the "Search in"
-- scope saved on each question.

create table if not exists api_connections (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  base_url text not null, -- e.g. https://api.github.com
  auth_type text not null default 'none', -- none | bearer | header | query
  auth_name text, -- header name (auth_type=header) or query parameter name (auth_type=query)
  auth_value text, -- the secret; never sent back to the browser
  headers jsonb, -- extra static headers for every request
  allow_private_network boolean not null default false, -- base URL may be localhost / a LAN address
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
);

-- A custom tool can belong to a connection: its URL template is then a
-- path relative to the connection's base URL, and the connection's auth is
-- applied to every call.
alter table agent_tools add column if not exists connection_id uuid references api_connections(id) on delete cascade;

-- Model Context Protocol servers whose tools are offered to Agent mode
-- (lib/agent/mcp.ts). transport: http (Streamable HTTP) | sse | stdio.
create table if not exists mcp_servers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique, -- identifier-safe; tool names are offered as <name>__<tool>
  transport text not null default 'http',
  url text, -- http / sse
  headers jsonb, -- http / sse, e.g. an Authorization header; never sent back to the browser
  command text, -- stdio
  args jsonb, -- stdio: string[]
  env jsonb, -- stdio: Record<string,string>; never sent back to the browser
  enabled boolean not null default true,
  disabled_tools jsonb not null default '[]', -- tool names switched off for this server
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
);

alter table api_connections enable row level security;
alter table mcp_servers enable row level security;

alter table chat_messages add column if not exists document_scope jsonb;
