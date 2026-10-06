-- For existing databases only — the baselines (0001, 0002, 0005) already
-- include all of this for anyone setting up fresh, so it's a no-op there.
--
-- Background ingestion (jobs table, per-document progress), multilingual
-- indexing (per-document language and embedding model, per-chunk text
-- search config), and per-answer citation checks.

alter table documents add column if not exists language text not null default 'english';
alter table documents add column if not exists embedding_model text;
alter table documents add column if not exists stage text;
alter table documents add column if not exists progress_done integer not null default 0;
alter table documents add column if not exists progress_total integer not null default 0;

create table if not exists jobs (
  id serial primary key,
  type text not null,
  document_id uuid references documents(id) on delete cascade,
  payload jsonb,
  file bytea,
  status text not null default 'queued',
  attempts integer not null default 0,
  last_error text,
  locked_at timestamp,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
);
create index if not exists jobs_status_id_index on jobs (status, id);
create index if not exists jobs_document_id_index on jobs (document_id);
alter table jobs enable row level security;

alter table chat_messages add column if not exists citation_check jsonb;

alter table chunks add column if not exists ts_config regconfig not null default 'english';

-- content_tsv was English-only (0008 / older 0001). Rebuild it to use each
-- chunk's own ts_config. A generated column's expression can't be altered
-- in place, so it's dropped and re-added — only when it's the old form, so
-- re-running this file is cheap.
do $$
begin
  if exists (
    select 1
    from pg_attribute a
    join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'chunks'::regclass
      and a.attname = 'content_tsv'
      and pg_get_expr(d.adbin, d.adrelid) not like '%ts_config%'
  ) then
    drop index if exists chunks_content_tsv_index;
    alter table chunks drop column content_tsv;
  end if;
end $$;

alter table chunks add column if not exists content_tsv tsvector
  generated always as (to_tsvector(ts_config, content)) stored;
create index if not exists chunks_content_tsv_index on chunks using gin (content_tsv);
