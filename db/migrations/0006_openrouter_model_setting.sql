-- Run after 0000-0005 (Supabase SQL editor), or via `npm run db:push`
-- (see README for why `db:push` isn't reliable against Supabase directly).

-- Moves OPENROUTER_MODEL from an env-only value into a live, editable
-- setting (Settings screen), so it can be changed without redeploying.
-- The env var still seeds the initial value the first time this row is
-- read after this migration, via application code, not this migration.
alter table settings
  add column if not exists openrouter_model text not null default 'openrouter/free';
