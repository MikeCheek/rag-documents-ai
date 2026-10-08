-- For existing databases only — the baseline (0002) already includes this
-- for anyone setting up fresh, so it's a no-op there.
--
-- The real prompt size of each answer's request, as reported by
-- OpenRouter, shown with the chat's context gauge.

alter table chat_messages add column if not exists prompt_tokens integer;
