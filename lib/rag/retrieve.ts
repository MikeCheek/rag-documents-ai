import { and, asc, cosineDistance, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, chunksTable, documentsTable } from "@/db";
import { generateEmbedding } from "./embeddings";
import { reciprocalRankFusion } from "./fusion";
import { isSchemaOutOfDate } from "@/lib/db-errors";

export type RetrievedChunk = {
  chunkId: number;
  documentId: string;
  documentName: string;
  content: string;
  similarity: number;
  pageStart: number | null;
  pageEnd: number | null;
};

export type RetrieveOptions = {
  limit?: number;
  minSimilarity?: number;
  /**
   * Text used for the keyword (full-text) half of hybrid search. Defaults
   * to `query`. Kept separate because the two halves want different
   * inputs: the embedding model was trained on natural sentences, so the
   * vector half should see the question as written, while the keyword
   * half only cares about the content words.
   */
  keywordQuery?: string;
  /** Only search these documents. Omitted or empty = every ready document. */
  documentIds?: string[];
};

/**
 * Hybrid retrieval: a semantic (pgvector) search and a keyword (Postgres
 * full-text) search run in parallel, merged with Reciprocal Rank Fusion.
 * Vector search finds paraphrases; keyword search finds exact names,
 * codes, and rare terms that a 384-dimension embedding tends to blur.
 *
 * Results come back in fused order, each still carrying its cosine
 * similarity to the query (what the UI's relevance bar shows when
 * reranking is off).
 */
export async function retrieveChunks(
  query: string,
  options: RetrieveOptions = {}
): Promise<RetrievedChunk[]> {
  const { limit = 12, minSimilarity = 0.25, keywordQuery = query } = options;
  const documentIds = options.documentIds?.length ? options.documentIds : undefined;

  const queryEmbedding = await generateEmbedding(query);

  const [vectorHits, keywordHits] = await Promise.all([
    vectorSearch(queryEmbedding, limit, minSimilarity, documentIds),
    keywordSearch(keywordQuery, queryEmbedding, limit, documentIds),
  ]);

  if (keywordHits.length === 0) return vectorHits;

  return reciprocalRankFusion([vectorHits, keywordHits], (c) => c.chunkId)
    .slice(0, limit)
    .map(({ item }) => item);
}

function inScope(documentIds: string[] | undefined) {
  return and(
    eq(documentsTable.status, "ready"),
    documentIds ? inArray(chunksTable.documentId, documentIds) : undefined
  );
}

function similarityTo(queryEmbedding: number[]) {
  return sql<number>`1 - (${cosineDistance(chunksTable.embedding, queryEmbedding)})`;
}

async function vectorSearch(
  queryEmbedding: number[],
  limit: number,
  minSimilarity: number,
  documentIds?: string[]
): Promise<RetrievedChunk[]> {
  const db = getDb();
  const distance = cosineDistance(chunksTable.embedding, queryEmbedding);

  // Ordered by the raw `<=>` distance, ascending — the only shape pgvector's
  // HNSW index can serve. Ordering by a derived expression (e.g.
  // `1 - distance DESC`) or filtering on it in WHERE silently falls back to
  // a sequential scan over every chunk. The similarity threshold is applied
  // afterwards, in JS, on the handful of rows the index returned.
  //
  // Scoped to specific documents, the opposite is wanted: the HNSW index
  // finds the nearest chunks overall and the document filter is applied
  // after, so a small document's chunks could all be filtered out of a
  // 12-row result. Adding 0 makes the sort key an expression the index
  // can't serve, so Postgres instead does an exact scan of just those
  // documents' chunks (via the document_id index), which is small.
  const orderKey = documentIds ? sql`(${distance}) + 0` : distance;
  const rows = await db
    .select({
      chunkId: chunksTable.id,
      documentId: chunksTable.documentId,
      documentName: documentsTable.name,
      content: chunksTable.content,
      pageStart: chunksTable.pageStart,
      pageEnd: chunksTable.pageEnd,
      similarity: similarityTo(queryEmbedding),
    })
    .from(chunksTable)
    .innerJoin(documentsTable, eq(chunksTable.documentId, documentsTable.id))
    .where(inScope(documentIds))
    .orderBy(asc(orderKey))
    .limit(limit);

  return rows
    .map((r) => ({ ...r, similarity: Number(r.similarity) }))
    .filter((r) => r.similarity > minSimilarity);
}

/**
 * Turns free text into an OR-query for Postgres's to_tsquery: any matching
 * term counts, and ts_rank_cd rewards chunks matching more (and rarer,
 * closer-together) terms. websearch_to_tsquery would AND every word, which
 * is far too strict for a natural-language question.
 */
export function toOrTsQuery(text: string): string {
  const terms = new Set(
    (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 1)
  );
  return Array.from(terms).join(" | ");
}

let keywordSearchUnavailable = false;

async function keywordSearch(
  text: string,
  queryEmbedding: number[],
  limit: number,
  documentIds?: string[]
): Promise<RetrievedChunk[]> {
  if (keywordSearchUnavailable) return [];
  const tsQuery = toOrTsQuery(text);
  if (!tsQuery) return [];

  const db = getDb();
  const query = sql`to_tsquery('english', ${tsQuery})`;
  const rank = sql<number>`ts_rank_cd(${sql.raw('"chunks"."content_tsv"')}, ${query})`;

  try {
    const rows = await db
      .select({
        chunkId: chunksTable.id,
        documentId: chunksTable.documentId,
        documentName: documentsTable.name,
        content: chunksTable.content,
        pageStart: chunksTable.pageStart,
        pageEnd: chunksTable.pageEnd,
        similarity: similarityTo(queryEmbedding),
      })
      .from(chunksTable)
      .innerJoin(documentsTable, eq(chunksTable.documentId, documentsTable.id))
      .where(
        and(inScope(documentIds), sql`${sql.raw('"chunks"."content_tsv"')} @@ ${query}`)
      )
      .orderBy(desc(rank))
      .limit(limit);

    return rows.map((r) => ({ ...r, similarity: Number(r.similarity) }));
  } catch (err: any) {
    // The content_tsv column comes from migration 0006. Until it's been
    // run, degrade to vector-only search instead of failing every query.
    // Only disable for good if it's specifically content_tsv that's
    // missing; any other missing column (a different pending migration)
    // fails the vector half too and surfaces as a "run db:migrate" error.
    const pgMessage = String(err?.cause?.message ?? err?.message ?? "");
    if (isSchemaOutOfDate(err) && pgMessage.includes("content_tsv")) {
      keywordSearchUnavailable = true;
      console.warn(
        "Keyword search disabled: chunks.content_tsv is missing. Run `npm run db:migrate` to enable hybrid search."
      );
      return [];
    }
    throw err;
  }
}
