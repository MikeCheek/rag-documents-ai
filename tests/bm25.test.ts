import { describe, expect, it } from "vitest";
import { bm25Rank } from "@/lib/rag/bm25";
import type { RetrievedChunk } from "@/lib/rag/retrieve";

const chunk = (chunkId: number, content: string): RetrievedChunk => ({
  chunkId,
  documentId: "d",
  documentName: "doc",
  content,
  similarity: 0.5,
  pageStart: null,
  pageEnd: null,
});

describe("bm25Rank", () => {
  it("promotes a lexical match without dropping semantic hits that share no words", async () => {
    const retrieved = [
      chunk(1, "Cellular respiration converts glucose into usable energy."), // semantic #1, no shared terms
      chunk(2, "The weather was pleasant all week."),
      chunk(3, "Mitochondria produce ATP through oxidative phosphorylation."),
    ];
    const ranked = await bm25Rank("How do mitochondria produce ATP?", retrieved, 3);

    expect(ranked[0].chunkId).toBe(3);
    // Pure BM25 would sink chunk 1 to the bottom with chunk 2; fusion keeps
    // its retrieval rank in play, so it stays above the irrelevant one.
    expect(ranked.map((r) => r.chunkId)).toEqual([3, 1, 2]);
    expect(ranked[0].relevanceScore).toBe(1);
  });

  it("respects the limit", async () => {
    const ranked = await bm25Rank("x", [chunk(1, "a"), chunk(2, "b"), chunk(3, "c")], 2);
    expect(ranked).toHaveLength(2);
  });
});
