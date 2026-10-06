-- Singleton row (id = 1) holding every user-adjustable setting: the
-- model, free-tier usage limits shown on the dashboard, query
-- optimization / reranking mode, Agent mode's step cap, web search's
-- SearXNG URL, and which Whisper variant local speech-to-text loads.
-- Read/written by lib/rag/settings.ts, editable from the Settings
-- screen. (The TTS voice/rate the speaker button uses lives in the
-- browser's own localStorage instead — see lib/voice/tts-preferences.ts
-- — since available system voices are inherently per-device.)

create table if not exists settings (
  id integer primary key,
  cohere_monthly_cap integer not null default 1000,
  cohere_per_minute_cap integer not null default 10,
  openrouter_per_minute_cap integer not null default 20,
  openrouter_daily_cap integer not null default 50,
  query_optimization text not null default 'local', -- off | local | llm
  rerank_method text not null default 'cohere', -- cohere | bm25 | off
  agent_max_steps integer not null default 6,
  openrouter_model text not null default 'openrouter/free',
  searxng_base_url text, -- null = web search not configured/offered
  whisper_model text not null default 'Xenova/whisper-tiny.en',
  updated_at timestamp not null default now()
);

insert into settings (id) values (1) on conflict (id) do nothing;
