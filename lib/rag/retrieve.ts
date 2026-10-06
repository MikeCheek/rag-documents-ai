import { and, asc, cosineDistance, desc, eq, sql } from "drizzle-orm";
import { getDb, chunksTable, documentsTable } from "@/db";
import { generateEmbedding } from "./embeddings";
import { reciprocalRankFusion } from "./fusion";

export type RetrievedChunk = {
  chunkId: number;
  documentId: string;
  documentName: string;
  content: string;
  similarity: number;
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

  const queryEmbedding = await generateEmbedding(query);

  const [vectorHits, keywordHits] = await Promise.all([
    vectorSearch(queryEmbedding, limit, minSimilarity),
    keywordSearch(keywordQuery, queryEmbedding, limit),
  ]);

  if (keywordHits.length === 0) return vectorHits;

  return reciprocalRankFusion([vectorHits, keywordHits], (c) => c.chunkId)
    .slice(0, limit)
    .map(({ item }) => item);
}

function similarityTo(queryEmbedding: number[]) {
  return sql<number>`1 - (${cosineDistance(chunksTable.embedding, queryEmbedding)})`;
}

async function vectorSearch(
  queryEmbedding: number[],
  limit: number,
  minSimilarity: number
): Promise<RetrievedChunk[]> {
  const db = getDb();
  const distance = cosineDistance(chunksTable.embedding, queryEmbedding);

  // Ordered by the raw `<=>` distance, ascending — the only shape pgvector's
  // HNSW index can serve. Ordering by a derived expression (e.g.
  // `1 - distance DESC`) or filtering on it in WHERE silently falls back to
  // a sequential scan over every chunk. The similarity threshold is applied
  // afterwards, in JS, on the handful of rows the index returned.
  const rows = await db
    .select({
      chunkId: chunksTable.id,
      documentId: chunksTable.documentId,
      documentName: documentsTable.name,
      content: chunksTable.content,
      similarity: similarityTo(queryEmbedding),
    })
    .from(chunksTable)
    .innerJoin(documentsTable, eq(chunksTable.documentId, documentsTable.id))
    .where(eq(documentsTable.status, "ready"))
    .orderBy(asc(distance))
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
  limit: number
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
        similarity: similarityTo(queryEmbedding),
      })
      .from(chunksTable)
      .innerJoin(documentsTable, eq(chunksTable.documentId, documentsTable.id))
      .where(
        and(
          eq(documentsTable.status, "ready"),
          sql`${sql.raw('"chunks"."content_tsv"')} @@ ${query}`
        )
      )
      .orderBy(desc(rank))
      .limit(limit);

    return rows.map((r) => ({ ...r, similarity: Number(r.similarity) }));
  } catch (err: any) {
    // The content_tsv column comes from migration 0006. Until it's been
    // run, degrade to vector-only search instead of failing every query.
    // 42703 = undefined_column.
    if (err?.code === "42703" || err?.cause?.code === "42703") {
      keywordSearchUnavailable = true;
      console.warn(
        "Keyword search disabled: chunks.content_tsv is missing. Run db/migrations/0006_hybrid_search.sql to enable hybrid search."
      );
      return [];
    }
    throw err;
  }
}
