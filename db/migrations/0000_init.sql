-- Run this once in the Supabase SQL editor (or via `npm run db:push`).

create extension if not exists vector;

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  file_type text not null,
  status text not null default 'processing',
  error text,
  chunk_count integer not null default 0,
  char_count integer not null default 0,
  created_at timestamp not null default now()
);

create table if not exists chunks (
  id serial primary key,
  document_id uuid not null references documents(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  embedding vector(384),
  created_at timestamp not null default now()
);

create index if not exists chunks_embedding_index
  on chunks using hnsw (embedding vector_cosine_ops);

create index if not exists chunks_document_id_index
  on chunks (document_id);
