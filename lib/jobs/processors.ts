import { asc, eq } from "drizzle-orm";
import { getDb, chunksTable, documentsTable } from "@/db";
import { chunkPages, chunkText, type PagedChunk } from "@/lib/rag/chunk";
import { currentEmbeddingModel, generateEmbeddings } from "@/lib/rag/embeddings";
import { computeCentroid } from "@/lib/rag/clustering";
import { detectLanguage } from "@/lib/rag/language";
import { ocrPdfPages, pagesNeedingOcr } from "@/lib/rag/ocr";
import { saveJobProgress, touchJob, type Job } from "./queue";

const EMBED_BATCH = 16;

type Stage = "queued" | "ocr" | "embedding" | "reembedding";

async function setProgress(job: Job, stage: Stage, done: number, total: number) {
  const db = getDb();
  await db
    .update(documentsTable)
    .set({ status: "processing", stage, progressDone: done, progressTotal: total, error: null })
    .where(eq(documentsTable.id, job.documentId));
  await touchJob(job.id);
}

async function embedWithProgress(job: Job, stage: Stage, texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];
  await setProgress(job, stage, 0, texts.length);
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    embeddings.push(...(await generateEmbeddings(texts.slice(i, i + EMBED_BATCH), "passage")));
    await setProgress(job, stage, embeddings.length, texts.length);
  }
  return embeddings;
}

/** Language from a sample spread across the document, not just its start. */
function sampleForLanguage(parts: string[]): string {
  const step = Math.max(1, Math.floor(parts.length / 20));
  return parts.filter((_, i) => i % step === 0).join(" ").slice(0, 20_000);
}

/**
 * Ingests an uploaded document: OCRs PDF pages without a text layer,
 * detects the language, chunks, embeds, and stores everything. Safe to
 * re-run after a failure: existing chunks are replaced, not duplicated.
 */
export async function processIngestJob(job: Job) {
  if (!job.payload) throw new Error("This upload's extracted text is no longer available; upload it again.");
  let pages = job.payload.pages ? [...job.payload.pages] : null;
  let text = job.payload.text ?? "";

  if (pages && job.file) {
    const toOcr = pagesNeedingOcr(pages);
    if (toOcr.length > 0) {
      await setProgress(job, "ocr", 0, toOcr.length);
      const recognized = await ocrPdfPages(new Uint8Array(job.file), toOcr, (done, total) =>
        setProgress(job, "ocr", done, total)
      );
      pages = pages.map((p, i) => recognized.get(i + 1) ?? p);
      // Keep the OCR result: if embedding fails and the job is retried,
      // it starts from the recognized text instead of OCRing again.
      await saveJobProgress(job.id, { pages, text: null });
    }
  }
  if (pages) text = pages.join("\n\n");

  if (!text.trim()) {
    throw new Error(
      pages ? "No text found in this PDF, even with OCR." : "No extractable text was found in this file."
    );
  }

  const chunks: PagedChunk[] = pages
    ? chunkPages(pages)
    : chunkText(text).map((content) => ({ content, pageStart: null, pageEnd: null }));
  if (chunks.length === 0) throw new Error("Text extraction produced no chunks.");

  const language = detectLanguage(sampleForLanguage(chunks.map((c) => c.content)));
  const embeddings = await embedWithProgress(job, "embedding", chunks.map((c) => c.content));

  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.delete(chunksTable).where(eq(chunksTable.documentId, job.documentId));
    for (let i = 0; i < chunks.length; i += 200) {
      await tx.insert(chunksTable).values(
        chunks.slice(i, i + 200).map((chunk, j) => ({
          documentId: job.documentId,
          chunkIndex: i + j,
          content: chunk.content,
          pageStart: chunk.pageStart,
          pageEnd: chunk.pageEnd,
          tsConfig: language,
          embedding: embeddings[i + j],
        }))
      );
    }
    await tx
      .update(documentsTable)
      .set({
        status: "ready",
        stage: null,
        progressDone: 0,
        progressTotal: 0,
        error: null,
        chunkCount: chunks.length,
        charCount: text.trim().length,
        centroidEmbedding: computeCentroid(embeddings),
        language,
        embeddingModel: currentEmbeddingModel(),
      })
      .where(eq(documentsTable.id, job.documentId));
  });
}

/**
 * Re-embeds an existing document's chunks with the current model (after
 * EMBEDDING_MODEL changes, or for documents from before the multilingual
 * model), and re-detects its language so keyword search stems it
 * correctly. The text and chunk boundaries are kept as they are.
 */
export async function processReembedJob(job: Job) {
  const db = getDb();
  const chunks = await db
    .select({ id: chunksTable.id, content: chunksTable.content })
    .from(chunksTable)
    .where(eq(chunksTable.documentId, job.documentId))
    .orderBy(asc(chunksTable.chunkIndex));

  const language = detectLanguage(sampleForLanguage(chunks.map((c) => c.content)));
  const embeddings = await embedWithProgress(job, "reembedding", chunks.map((c) => c.content));

  await db.transaction(async (tx) => {
    for (let i = 0; i < chunks.length; i++) {
      await tx
        .update(chunksTable)
        .set({ embedding: embeddings[i], tsConfig: language })
        .where(eq(chunksTable.id, chunks[i].id));
    }
    await tx
      .update(documentsTable)
      .set({
        status: "ready",
        stage: null,
        progressDone: 0,
        progressTotal: 0,
        error: null,
        centroidEmbedding: embeddings.length ? computeCentroid(embeddings) : null,
        language,
        embeddingModel: currentEmbeddingModel(),
      })
      .where(eq(documentsTable.id, job.documentId));
  });
}
