import { sql, and, eq, lt, isNotNull, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, documentsTable, chunksTable } from "@/db";
import { getLemmaTokens } from "./local-nlp";

// Documents are grouped by similarity, not assigned to fixed categories —
// there's no label taxonomy to classify into, only how alike their content
// actually is. Fully local and free: it reuses each document's chunk
// embeddings (already computed at upload time) and wink-nlp's tokenizer
// (already a dependency for local reranking), no extra API calls.
//
// The cutoff is adaptive, not a fixed cosine-similarity number. A fixed
// threshold has an all-or-nothing failure mode: centroid-averaging dilutes
// topic signal across every chunk in a document (most of a document isn't
// about its "core" topic), which compresses the whole similarity range
// down — sometimes low enough that even genuinely related documents never
// cross a fixed bar, and *everything* lands in "not similar to others"
// rather than nothing. Instead, the threshold is set relative to this
// document set's own similarity distribution (mean + one standard
// deviation, with a low absolute floor as a backstop) — so documents that
// are similar *to each other*, relative to how similar this batch of
// documents is overall, still group, whatever the absolute numbers happen
// to be for a given embedding model and document mix.

const ABSOLUTE_FLOOR = 0.5; // never group documents this dissimilar, no matter the distribution
const RELATIVE_Z_SCORE = 1.0; // "clearly above average" for this document set
const MAX_LABEL_TERMS = 3;

export type DocumentCluster = {
  id: string;
  label: string;
  documentIds: string[];
};

export type ClusterResult = {
  clusters: DocumentCluster[];
  singletonIds: string[];
};

class UnionFind {
  private parent = new Map<string, string>();

  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    // path compression
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string) {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootA, rootB);
  }
}

/** Elementwise mean of a set of embedding vectors — the document's centroid. */
export function computeCentroid(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dims = vectors[0].length;
  const sum = new Array(dims).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dims; i++) sum[i] += v[i];
  }
  return sum.map((s) => s / vectors.length);
}

/**
 * A similarity cutoff relative to this specific set of pairwise
 * similarities, rather than one fixed number assumed to work for every
 * document set and embedding model. Pairs more than one standard
 * deviation above this batch's own mean similarity count as "genuinely
 * similar, relative to everything else in this batch" — floored so a
 * document set with almost no real variance (e.g. a handful of totally
 * unrelated documents) doesn't get force-grouped anyway.
 */
export function computeAdaptiveThreshold(similarities: number[]): number {
  if (similarities.length === 0) return ABSOLUTE_FLOOR;
  const mean = similarities.reduce((a, b) => a + b, 0) / similarities.length;
  const variance =
    similarities.reduce((a, b) => a + (b - mean) ** 2, 0) / similarities.length;
  const stddev = Math.sqrt(variance);
  return Math.max(ABSOLUTE_FLOOR, mean + RELATIVE_Z_SCORE * stddev);
}

async function labelCluster(documentIds: string[], fallbackNames: string[]): Promise<string> {
  try {
    const db = getDb();
    const sampleChunks = await db
      .select({ documentId: chunksTable.documentId, content: chunksTable.content })
      .from(chunksTable)
      .where(inArray(chunksTable.documentId, documentIds))
      .orderBy(chunksTable.chunkIndex)
      .limit(documentIds.length * 2); // ~first couple chunks per document

    const combinedText = sampleChunks.map((c) => c.content).join(" ").slice(0, 4000);
    if (!combinedText.trim()) throw new Error("no sample text");

    const tokens = await getLemmaTokens(combinedText);
    const freq = new Map<string, number>();
    for (const t of tokens) {
      if (t.length < 4) continue; // skip short/low-signal tokens
      freq.set(t, (freq.get(t) ?? 0) + 1);
    }

    const topTerms = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_LABEL_TERMS)
      .map(([term]) => term);

    if (topTerms.length === 0) throw new Error("no significant terms");

    return topTerms.map((t) => t[0].toUpperCase() + t.slice(1)).join(" / ");
  } catch {
    // Fall back to naming the group after its documents rather than failing.
    return fallbackNames.slice(0, 2).join(" & ") + (fallbackNames.length > 2 ? ", ..." : "");
  }
}

export async function computeDocumentClusters(): Promise<ClusterResult> {
  const db = getDb();

  const docs = await db
    .select({ id: documentsTable.id, name: documentsTable.name })
    .from(documentsTable)
    .where(and(eq(documentsTable.status, "ready"), isNotNull(documentsTable.centroidEmbedding)));

  if (docs.length < 2) {
    return { clusters: [], singletonIds: docs.map((d) => d.id) };
  }

  // Pairwise similarity computed in SQL via pgvector's cosine distance
  // operator, rather than pulling every centroid into the app to compare —
  // cheap for the document counts this app deals with (tens, not
  // millions). Fetched unfiltered so the threshold below can be derived
  // from this batch's actual distribution, not applied inside the query.
  const a = alias(documentsTable, "a");
  const b = alias(documentsTable, "b");
  const similarity = sql<number>`1 - (${a.centroidEmbedding} <=> ${b.centroidEmbedding})`;

  const pairs = await db
    .select({ a: a.id, b: b.id, similarity })
    .from(a)
    .innerJoin(b, lt(a.id, b.id))
    .where(
      and(
        eq(a.status, "ready"),
        eq(b.status, "ready"),
        isNotNull(a.centroidEmbedding),
        isNotNull(b.centroidEmbedding)
      )
    );

  const threshold = computeAdaptiveThreshold(pairs.map((p) => p.similarity));

  const uf = new UnionFind();
  for (const doc of docs) uf.find(doc.id); // ensure every doc has its own singleton group initially
  for (const row of pairs) {
    if (row.similarity > threshold) uf.union(row.a, row.b);
  }

  const groups = new Map<string, string[]>();
  for (const doc of docs) {
    const root = uf.find(doc.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(doc.id);
  }

  const nameById = new Map(docs.map((d) => [d.id, d.name]));
  const clusters: DocumentCluster[] = [];
  const singletonIds: string[] = [];

  for (const [root, documentIds] of groups) {
    if (documentIds.length < 2) {
      singletonIds.push(...documentIds);
      continue;
    }
    const label = await labelCluster(
      documentIds,
      documentIds.map((id) => nameById.get(id) ?? "")
    );
    clusters.push({ id: root, label, documentIds });
  }

  clusters.sort((a, b) => b.documentIds.length - a.documentIds.length);

  return { clusters, singletonIds };
}
