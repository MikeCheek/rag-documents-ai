-- For existing databases only — the six-file baseline (0000-0005) already
-- includes these columns for anyone setting up fresh, so this is a no-op
-- there. Run this once if upgrading a database created before this file
-- existed. Adds versioning for edited messages: editing the last user
-- message no longer deletes it, it deactivates the old user+assistant
-- pair and inserts a new one sharing an edit_group_id, so every version
-- stays reachable instead of being lost.

alter table chat_messages
  add column if not exists edit_group_id uuid;

alter table chat_messages
  add column if not exists is_active_version boolean not null default true;

create index if not exists chat_messages_edit_group_id_index
  on chat_messages (edit_group_id);
