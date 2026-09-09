-- Not part of the numbered setup sequence — a one-off utility for
-- existing databases that predate documents.centroid_embedding (used by
-- "Group similar" on the Shelf). New uploads already compute this inline
-- during processing; this only catches up documents that were already
-- sitting in the database before that code existed. Safe to re-run: only
-- touches rows where centroid_embedding is still null.

update documents d
set centroid_embedding = sub.avg_embedding
from (
  select document_id, avg(embedding) as avg_embedding
  from chunks
  where embedding is not null
  group by document_id
) sub
where d.id = sub.document_id
  and d.status = 'ready'
  and d.centroid_embedding is null;
