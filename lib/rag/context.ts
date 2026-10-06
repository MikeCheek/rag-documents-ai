import { and, eq, or } from "drizzle-orm";
import { getDb, chunksTable } from "@/db";

// Context expansion: a retrieved chunk is ~180 words, and the sentence
// that actually answers a question often sits just across a chunk
// boundary. So each source given to the model also carries the end of the
// chunk before it and the start of the chunk after it, from the same
// document. The citation still points at the source itself; the
// neighbors are only context.

/** How much of each neighbor to include, in words, nearest the source. */
export const NEIGHBOR_WORDS = 120;
/** Overlap search limit: chunking carries over at most ~30 words. */
const MAX_OVERLAP_WORDS = 80;

export type ExpandableSource = { chunkId: number; documentId: string; chunkIndex?: number; content: string };

/**
 * Number of words at the end of `before` that repeat at the start of
 * `after` (chunks overlap by a sentence or two; this avoids saying it twice).
 */
export function overlapWords(before: string[], after: string[]): number {
  const max = Math.min(MAX_OVERLAP_WORDS, before.length, after.length);
  for (let k = max; k > 0; k--) {
    let same = true;
    for (let i = 0; i < k; i++) {
      if (before[before.length - k + i] !== after[i]) {
        same = false;
        break;
      }
    }
    if (same) return k;
  }
  return 0;
}

/** Joins prev + main + next, dropping overlaps and trimming neighbors. */
export function stitch(prev: string | null, main: string, next: string | null): string {
  const mainWords = main.split(/\s+/).filter(Boolean);
  const parts: string[] = [];

  if (prev) {
    const prevWords = prev.split(/\s+/).filter(Boolean);
    const kept = prevWords.slice(0, prevWords.length - overlapWords(prevWords, mainWords));
    const tail = kept.slice(-NEIGHBOR_WORDS);
    if (tail.length) parts.push((kept.length > tail.length ? "… " : "") + tail.join(" "));
  }

  parts.push(main);

  if (next) {
    const nextWords = next.split(/\s+/).filter(Boolean);
    const kept = nextWords.slice(overlapWords(mainWords, nextWords));
    const head = kept.slice(0, NEIGHBOR_WORDS);
    if (head.length) parts.push(head.join(" ") + (kept.length > head.length ? " …" : ""));
  }

  return parts.join(" ");
}

/**
 * Returns chunkId -> source text with its neighbors stitched on. Neighbors
 * that are themselves among the sources are skipped (they're already in
 * the context under their own number).
 */
export async function expandWithNeighbors<T extends ExpandableSource>(sources: T[]): Promise<Map<number, string>> {
  const expanded = new Map<number, string>(sources.map((s) => [s.chunkId, s.content]));
  const indexed = sources.filter((s): s is T & { chunkIndex: number } => typeof s.chunkIndex === "number");
  if (indexed.length === 0) return expanded;

  const isSource = new Set(indexed.map((s) => `${s.documentId}:${s.chunkIndex}`));
  const wanted = new Map<string, { documentId: string; chunkIndex: number }>();
  for (const s of indexed) {
    for (const idx of [s.chunkIndex - 1, s.chunkIndex + 1]) {
      const key = `${s.documentId}:${idx}`;
      if (idx >= 0 && !isSource.has(key)) wanted.set(key, { documentId: s.documentId, chunkIndex: idx });
    }
  }
  if (wanted.size === 0) return expanded;

  const db = getDb();
  const rows = await db
    .select({ documentId: chunksTable.documentId, chunkIndex: chunksTable.chunkIndex, content: chunksTable.content })
    .from(chunksTable)
    .where(
      or(
        ...[...wanted.values()].map((w) =>
          and(eq(chunksTable.documentId, w.documentId), eq(chunksTable.chunkIndex, w.chunkIndex))
        )
      )
    );
  const byKey = new Map(rows.map((r) => [`${r.documentId}:${r.chunkIndex}`, r.content]));

  for (const s of indexed) {
    const prev = byKey.get(`${s.documentId}:${s.chunkIndex - 1}`) ?? null;
    const next = byKey.get(`${s.documentId}:${s.chunkIndex + 1}`) ?? null;
    expanded.set(s.chunkId, stitch(prev, s.content, next));
  }
  return expanded;
}
