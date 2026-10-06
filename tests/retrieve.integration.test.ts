import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Runs against a real Postgres with pgvector and every migration applied,
// e.g. TEST_DATABASE_URL=postgresql://postgres@localhost:5432/rag_test.
// Skipped otherwise. Embeddings are stubbed with hand-made vectors, so no
// model download is needed and similarities are predictable.
const url = process.env.TEST_DATABASE_URL;

// Each "topic" is one axis of the 384-dim space; text is embedded as the
// normalized sum of the axes of the topics it mentions.
const TOPICS = ["mitochondria", "weather", "cooking", "invoice"];
function fakeEmbedding(text: string): number[] {
  const v = new Array(384).fill(0);
  const lower = text.toLowerCase();
  TOPICS.forEach((t, i) => {
    if (lower.includes(t)) v[i] = 1;
  });
  if (v.every((x) => x === 0)) v[383] = 1;
  const norm = Math.hypot(...v);
  return v.map((x) => x / norm);
}

vi.mock("@/lib/rag/embeddings", () => ({
  EMBEDDING_DIMENSIONS: 384,
  generateEmbedding: async (t: string) => fakeEmbedding(t),
  generateEmbeddings: async (ts: string[]) => ts.map(fakeEmbedding),
}));

describe.skipIf(!url)("retrieveChunks (hybrid, real Postgres)", () => {
  let retrieveChunks: typeof import("@/lib/rag/retrieve").retrieveChunks;
  let db: any;
  let schema: typeof import("@/db");
  const docIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    schema = await import("@/db");
    ({ retrieveChunks } = await import("@/lib/rag/retrieve"));
    db = schema.getDb();

    const addDoc = async (name: string, status: string, chunks: string[]) => {
      const [doc] = await db.insert(schema.documentsTable).values({ name, fileType: "txt", status }).returning();
      docIds.push(doc.id);
      await db.insert(schema.chunksTable).values(
        chunks.map((content, chunkIndex) => ({
          documentId: doc.id,
          chunkIndex,
          content,
          embedding: fakeEmbedding(content),
        }))
      );
    };

    await addDoc("bio.txt", "ready", [
      "Mitochondria produce ATP through oxidative phosphorylation.",
      "Mitochondria have their own DNA.",
    ]);
    await addDoc("misc.txt", "ready", [
      "The weather in spring is mild.",
      // Embeds as "cooking" — far from an invoice question — but contains
      // the exact code a user would search for.
      "Cooking order reference XJ9000 was shipped late.",
    ]);
    await addDoc("draft.txt", "processing", ["Mitochondria draft notes that are not ready yet."]);
  });

  afterAll(async () => {
    if (!db) return;
    const { inArray } = await import("drizzle-orm");
    await db.delete(schema.documentsTable).where(inArray(schema.documentsTable.id, docIds));
  });

  it("finds semantically similar chunks, best first, only from ready documents", async () => {
    const results = await retrieveChunks("Tell me about mitochondria");
    const contents = results.map((r) => r.content);
    expect(contents.slice(0, 2).every((c) => c.startsWith("Mitochondria"))).toBe(true);
    expect(contents.some((c) => c.includes("draft"))).toBe(false);
    expect(results[0].similarity).toBeGreaterThan(0.9);
  });

  it("finds an exact keyword the embedding misses", async () => {
    // Embeds as the "invoice" axis, orthogonal to every stored chunk, so
    // vector search alone returns nothing above the similarity threshold.
    const results = await retrieveChunks("invoice XJ9000");
    expect(results.map((r) => r.content)).toContain("Cooking order reference XJ9000 was shipped late.");
  });

  it("uses keywordQuery for the keyword half only", async () => {
    const results = await retrieveChunks("invoice", { keywordQuery: "xj9000" });
    expect(results.map((r) => r.content)).toEqual(["Cooking order reference XJ9000 was shipped late."]);
  });
});
