import { and, cosineDistance, desc, eq, gt, sql } from "drizzle-orm";
import { getDb, chunksTable, documentsTable } from "@/db";
import { generateEmbedding } from "./embeddings";

export type RetrievedChunk = {
  chunkId: number;
  documentId: string;
  documentName: string;
  content: string;
  similarity: number;
};

export async function retrieveChunks(
  query: string,
  options: { limit?: number; minSimilarity?: number } = {}
): Promise<RetrievedChunk[]> {
  const { limit = 12, minSimilarity = 0.25 } = options;
  const db = getDb();

  const queryEmbedding = await generateEmbedding(query);

  const similarity = sql<number>`1 - (${cosineDistance(
    chunksTable.embedding,
    queryEmbedding
  )})`;

  const rows = await db
    .select({
      chunkId: chunksTable.id,
      documentId: chunksTable.documentId,
      documentName: documentsTable.name,
      content: chunksTable.content,
      similarity,
    })
    .from(chunksTable)
    .innerJoin(documentsTable, eq(chunksTable.documentId, documentsTable.id))
    .where(and(gt(similarity, minSimilarity), eq(documentsTable.status, "ready")))
    .orderBy((t) => desc(t.similarity))
    .limit(limit);

  return rows;
}
