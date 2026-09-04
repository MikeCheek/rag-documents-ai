import { and, cosineDistance, desc, eq, notInArray, sql } from "drizzle-orm";
import { UMAP } from "umap-js";
import { getDb, chunksTable, documentsTable } from "@/db";
import { generateEmbedding } from "./embeddings";
import type { EmbeddingSpacePoint, EmbeddingSpaceResult } from "@/types";

export type { EmbeddingSpacePoint, EmbeddingSpaceResult };

const NEIGHBOR_COUNT = 40;
const CONTRAST_SAMPLE_COUNT = 25;
const SCALE = 6; // final coordinates spread roughly across -SCALE..SCALE
const MIN_POINTS_FOR_UMAP = 4; // below this, UMAP's neighbor graph is too degenerate to be meaningful

export async function computeEmbeddingSpace(query: string): Promise<EmbeddingSpaceResult> {
  const db = getDb();
  const queryEmbedding = await generateEmbedding(query);

  const similarity = sql<number>`1 - (${cosineDistance(chunksTable.embedding, queryEmbedding)})`;

  const neighborRows = await db
    .select({
      chunkId: chunksTable.id,
      documentId: chunksTable.documentId,
      documentName: documentsTable.name,
      content: chunksTable.content,
      embedding: chunksTable.embedding,
      similarity,
    })
    .from(chunksTable)
    .innerJoin(documentsTable, eq(chunksTable.documentId, documentsTable.id))
    .where(eq(documentsTable.status, "ready"))
    .orderBy(desc(similarity))
    .limit(NEIGHBOR_COUNT);

  const neighborIds = new Set(neighborRows.map((r) => r.chunkId));

  const contrastRows =
    neighborIds.size > 0
      ? await db
          .select({
            chunkId: chunksTable.id,
            documentId: chunksTable.documentId,
            documentName: documentsTable.name,
            content: chunksTable.content,
            embedding: chunksTable.embedding,
            similarity,
          })
          .from(chunksTable)
          .innerJoin(documentsTable, eq(chunksTable.documentId, documentsTable.id))
          .where(
            and(
              eq(documentsTable.status, "ready"),
              notInArray(chunksTable.id, [...neighborIds])
            )
          )
          .orderBy(sql`random()`)
          .limit(CONTRAST_SAMPLE_COUNT)
      : [];

  const rows = [...neighborRows, ...contrastRows];

  if (rows.length === 0) {
    return { query: { x: 0, y: 0, z: 0 }, points: [] };
  }

  const coords =
    rows.length + 1 >= MIN_POINTS_FOR_UMAP
      ? projectWithUmap(queryEmbedding, rows)
      : projectRadially(rows);

  const [queryPoint, ...chunkPoints] = coords;

  return {
    query: { x: queryPoint[0], y: queryPoint[1], z: queryPoint[2] },
    points: rows.map((r, i) => ({
      chunkId: r.chunkId,
      documentId: r.documentId,
      documentName: r.documentName,
      content: r.content,
      similarity: r.similarity,
      isNeighbor: neighborIds.has(r.chunkId),
      x: chunkPoints[i][0],
      y: chunkPoints[i][1],
      z: chunkPoints[i][2],
    })),
  };
}

function projectWithUmap(
  queryEmbedding: number[],
  rows: { embedding: number[] | null }[]
): number[][] {
  const vectors = [queryEmbedding, ...rows.map((r) => r.embedding as number[])];
  const nNeighbors = Math.max(2, Math.min(15, vectors.length - 1));

  const umap = new UMAP({ nComponents: 3, nNeighbors, minDist: 0.25 });
  const projected = umap.fit(vectors);

  return normalizeToScale(projected, SCALE);
}

// Used only when there are too few passages for UMAP's neighbor graph to be
// meaningful (e.g. right after the first upload). Places the query at the
// origin and each chunk on a sphere around it, closer for higher similarity,
// at a deterministic (not actually random) angle so the layout doesn't
// reshuffle between requests for the same data.
function projectRadially(rows: { chunkId: number; similarity: number }[]): number[][] {
  const points: number[][] = [[0, 0, 0]];

  for (const row of rows) {
    const seed = hashInt(row.chunkId);
    const theta = ((seed % 1000) / 1000) * Math.PI * 2;
    const phi = (((seed >> 10) % 1000) / 1000) * Math.PI;
    const closeness = Math.max(0, Math.min(1, row.similarity));
    const radius = SCALE * (1.1 - closeness * 0.7);

    points.push([
      radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.sin(phi) * Math.sin(theta),
      radius * Math.cos(phi),
    ]);
  }

  return points;
}

function normalizeToScale(points: number[][], scale: number): number[][] {
  const dims = points[0].length;
  const centers: number[] = [];
  const spreads: number[] = [];

  for (let d = 0; d < dims; d++) {
    const values = points.map((p) => p[d]);
    const center = values.reduce((sum, v) => sum + v, 0) / values.length;
    centers.push(center);
    spreads.push(Math.max(...values.map((v) => Math.abs(v - center)), 1e-6));
  }

  const globalSpread = Math.max(...spreads);

  return points.map((p) => p.map((v, d) => ((v - centers[d]) / globalSpread) * scale));
}

function hashInt(n: number): number {
  let hash = (n ^ 0x9e3779b9) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return hash;
}
