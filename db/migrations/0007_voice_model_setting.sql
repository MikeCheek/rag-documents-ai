-- For existing databases only — the six-file baseline (0000-0005) already
-- includes this column for anyone setting up fresh, so this is a no-op
-- there. Run this once if upgrading a database created before this file
-- existed, to add the setting controlling which Whisper model variant
-- the mic button loads for local speech-to-text.

alter table settings
  add column if not exists whisper_model text not null default 'Xenova/whisper-tiny.en';
