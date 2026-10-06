import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import { makeImagePdf } from "./helpers/make-pdf";

// The background worker against real Postgres: ingestion (including real
// OCR), retries, re-embedding, startup reconciliation, and claim
// exclusivity. Embeddings are stubbed; see retrieve.integration.test.ts.
const url = process.env.TEST_DATABASE_URL;

const embedControl = { failuresLeft: 0 };
vi.mock("@/lib/rag/embeddings", () => ({
  EMBEDDING_DIMENSIONS: 384,
  LEGACY_EMBEDDING_MODEL: "legacy-model",
  currentEmbeddingModel: () => "test-model",
  generateEmbedding: async () => Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0)),
  generateEmbeddings: async (texts: string[]) => {
    if (embedControl.failuresLeft > 0) {
      embedControl.failuresLeft--;
      throw new Error("embedding model unavailable");
    }
    return texts.map(() => Array.from({ length: 384 }, (_, i) => (i === 1 ? 1 : 0)));
  },
}));

const TAG = `jobs-${Date.now()}`;

describe.skipIf(!url)("background jobs (real Postgres)", () => {
  let db: any;
  let schema: typeof import("@/db");
  let orm: typeof import("drizzle-orm");
  let queue: typeof import("@/lib/jobs/queue");
  let worker: typeof import("@/lib/jobs/worker");

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.JOB_RETRY_DELAY_SECONDS = "0";
    schema = await import("@/db");
    orm = await import("drizzle-orm");
    queue = await import("@/lib/jobs/queue");
    worker = await import("@/lib/jobs/worker");
    db = schema.getDb();
  });

  beforeEach(async () => {
    embedControl.failuresLeft = 0;
    // Leftovers from an earlier interrupted run would otherwise be claimed first.
    await db.delete(schema.jobsTable).where(orm.inArray(schema.jobsTable.status, ["queued", "running"]));
  });

  afterAll(async () => {
    if (db) await db.delete(schema.documentsTable).where(orm.like(schema.documentsTable.name, `${TAG}%`));
  });

  async function newDoc(name: string, extra: object = {}) {
    const [doc] = await db
      .insert(schema.documentsTable)
      .values({ name: `${TAG}-${name}`, fileType: "txt", status: "queued", stage: "queued", ...extra })
      .returning();
    return doc;
  }
  const getDoc = async (id: string) =>
    (await db.select().from(schema.documentsTable).where(orm.eq(schema.documentsTable.id, id)))[0];
  const getChunks = (id: string) =>
    db
      .select()
      .from(schema.chunksTable)
      .where(orm.eq(schema.chunksTable.documentId, id))
      .orderBy(orm.asc(schema.chunksTable.chunkIndex));
  const getJob = async (id: number) =>
    (await db.select().from(schema.jobsTable).where(orm.eq(schema.jobsTable.id, id)))[0];

  it("ingests a document: language, chunks, embeddings, then clears the payload", async () => {
    const doc = await newDoc("it.txt");
    const text = "I mitocondri sono la centrale energetica della cellula. ".repeat(60);
    const jobId = await queue.enqueueJob({ type: "ingest", documentId: doc.id, payload: { pages: null, text } });

    expect(await worker.runNextJob()).toBe(true);

    const ready = await getDoc(doc.id);
    expect(ready).toMatchObject({ status: "ready", stage: null, language: "italian", embeddingModel: "test-model" });
    expect(ready.chunkCount).toBeGreaterThan(1);
    const chunks = await getChunks(doc.id);
    expect(chunks).toHaveLength(ready.chunkCount);
    expect(chunks.every((c: any) => c.tsConfig === "italian" && c.embedding?.length === 384)).toBe(true);
    expect(await getJob(jobId)).toMatchObject({ status: "done", payload: null, file: null });
    expect(await worker.runNextJob()).toBe(false);
  });

  it("OCRs scanned pages and keeps page numbers", async () => {
    const canvas = createCanvas(1224, 1584);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 1224, 1584);
    ctx.fillStyle = "black";
    ctx.font = "48px sans-serif";
    ctx.fillText("Scanned page about photosynthesis.", 120, 200);
    const pdf = makeImagePdf([
      { jpeg: canvas.toBuffer("image/jpeg"), width: 1224, height: 1584 },
      { jpeg: canvas.toBuffer("image/jpeg"), width: 1224, height: 1584 },
    ]);
    const doc = await newDoc("scan.pdf", { fileType: "pdf" });
    await queue.enqueueJob({
      type: "ingest",
      documentId: doc.id,
      // Page 2 "has" a text layer, so only page 1 is OCR'd.
      payload: { pages: ["", "This second page already has a real text layer."], text: null },
      file: pdf,
    });

    // First attempt: OCR succeeds, embedding fails. The retry must reuse
    // the OCR'd text (the PDF is gone from the job by then).
    embedControl.failuresLeft = 1;
    await worker.runNextJob();
    const [job] = await db.select().from(schema.jobsTable).where(orm.eq(schema.jobsTable.documentId, doc.id));
    expect(job.file).toBeNull();
    expect(job.payload.pages[0]).toMatch(/photosynthesis/);
    await worker.runNextJob();

    const chunks = await getChunks(doc.id);
    const all = chunks.map((c: any) => c.content).join(" ");
    expect(all).toMatch(/Scanned page about photosynthesis/);
    expect(all).toMatch(/second page already has a real text layer/);
    expect(chunks[0].pageStart).toBe(1);
    expect(chunks[chunks.length - 1].pageEnd).toBe(2);
    expect((await getDoc(doc.id)).status).toBe("ready");
  }, 120_000);

  it("retries a failed job, then succeeds", async () => {
    const doc = await newDoc("retry.txt");
    const jobId = await queue.enqueueJob({
      type: "ingest",
      documentId: doc.id,
      payload: { pages: null, text: "Some text worth indexing about cells and energy." },
    });

    embedControl.failuresLeft = 1;
    await worker.runNextJob();
    expect(await getDoc(doc.id)).toMatchObject({ status: "queued", error: expect.stringMatching(/Retrying/) });
    expect(await getJob(jobId)).toMatchObject({ status: "queued", attempts: 1 });

    await worker.runNextJob();
    expect(await getDoc(doc.id)).toMatchObject({ status: "ready", error: null });
  });

  it("waits before retrying", async () => {
    process.env.JOB_RETRY_DELAY_SECONDS = "60";
    try {
      const doc = await newDoc("backoff.txt");
      await queue.enqueueJob({ type: "ingest", documentId: doc.id, payload: { pages: null, text: "Some text." } });
      embedControl.failuresLeft = 1;
      expect(await worker.runNextJob()).toBe(true);
      // Failed once: not claimable again until the delay has passed.
      expect(await worker.runNextJob()).toBe(false);
    } finally {
      process.env.JOB_RETRY_DELAY_SECONDS = "0";
    }
  });

  it("gives up after the last attempt, and can be retried by hand", async () => {
    const doc = await newDoc("broken.txt");
    const jobId = await queue.enqueueJob({
      type: "ingest",
      documentId: doc.id,
      payload: { pages: null, text: "Text that will fail to embed, repeatedly." },
    });

    embedControl.failuresLeft = queue.MAX_ATTEMPTS;
    for (let i = 0; i < queue.MAX_ATTEMPTS; i++) await worker.runNextJob();
    expect(await getDoc(doc.id)).toMatchObject({ status: "failed", error: "embedding model unavailable" });
    expect(await getJob(jobId)).toMatchObject({ status: "failed", attempts: queue.MAX_ATTEMPTS });
    expect(await worker.runNextJob()).toBe(false);

    expect(await queue.retryDocumentJob(doc.id)).toBe(true);
    await worker.runNextJob();
    expect((await getDoc(doc.id)).status).toBe("ready");
  });

  it("re-embeds documents from another model and fails orphaned ones on startup", async () => {
    const legacy = await newDoc("legacy.txt", { status: "ready", stage: null, embeddingModel: null, chunkCount: 1 });
    await db.insert(schema.chunksTable).values({
      documentId: legacy.id,
      chunkIndex: 0,
      content: "Die Mitochondrien sind das Kraftwerk der Zelle und erzeugen die Energie, die von ihr genutzt wird.",
      embedding: Array.from({ length: 384 }, (_, i) => (i === 5 ? 1 : 0)),
    });
    const orphan = await newDoc("orphan.txt", { status: "processing" });

    await worker.reconcileDocuments();
    expect(await getDoc(legacy.id)).toMatchObject({ status: "queued", stage: "reembedding" });
    expect(await getDoc(orphan.id)).toMatchObject({ status: "failed", error: expect.stringMatching(/interrupted/) });

    // Running it again doesn't queue the same document twice.
    await worker.reconcileDocuments();
    const jobs = await db.select().from(schema.jobsTable).where(orm.eq(schema.jobsTable.documentId, legacy.id));
    expect(jobs).toHaveLength(1);

    // Reconcile looks at every document in the database, so other stale
    // documents may be queued too: drain the queue rather than run one job.
    for (let i = 0; i < 50 && (await worker.runNextJob()); i++);
    expect(await getDoc(legacy.id)).toMatchObject({ status: "ready", embeddingModel: "test-model", language: "german" });
    const [chunk] = await getChunks(legacy.id);
    expect(chunk.tsConfig).toBe("german");
    expect(chunk.embedding[1]).toBe(1); // the new (stubbed) model's vector
  });

  it("never hands one job to two workers", async () => {
    const doc = await newDoc("race.txt");
    await queue.enqueueJob({ type: "ingest", documentId: doc.id, payload: { pages: null, text: "Race." } });
    const claims = await Promise.all([queue.claimNextJob(), queue.claimNextJob(), queue.claimNextJob()]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });
});
