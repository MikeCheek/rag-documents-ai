-- Which page(s) of the source PDF each chunk came from, so citations can
-- say "p. 12". Null for formats without pages (DOCX, TXT, MD, CSV) and for
-- PDF chunks uploaded before this migration (re-upload to get them).

alter table chunks add column if not exists page_start integer;
alter table chunks add column if not exists page_end integer;
