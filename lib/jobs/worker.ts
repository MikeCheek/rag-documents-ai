import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, documentsTable } from "@/db";
import { describeError } from "@/lib/db-errors";
import { currentEmbeddingModel, LEGACY_EMBEDDING_MODEL } from "@/lib/rag/embeddings";
import {
  claimNextJob,
  completeJob,
  documentsWithActiveJobs,
  enqueueJob,
  failJob,
  type Job,
} from "./queue";
import { processIngestJob, processReembedJob } from "./processors";

// The background worker: one loop per server process, started from
// instrumentation.ts when the Next.js server boots (or standalone with
// `npm run worker`). It processes one job at a time, polling the jobs
// table when idle. Needs a long-running server (`npm run dev` /
// `npm start`); on serverless hosts, run `npm run worker` somewhere
// instead.

const IDLE_POLL_MS = 1500;
const ERROR_BACKOFF_MS = 10_000;

export async function processJob(job: Job) {
  if (job.type === "ingest") return processIngestJob(job);
  if (job.type === "reembed") return processReembedJob(job);
  throw new Error(`Unknown job type: ${job.type}`);
}

/** Runs one job if there is one. Returns whether a job was found. */
export async function runNextJob(): Promise<boolean> {
  const job = await claimNextJob();
  if (!job) return false;

  try {
    await processJob(job);
    await completeJob(job.id);
  } catch (err) {
    const message = describeError(err, "Processing failed");
    console.error(`Job ${job.id} (${job.type}) failed, attempt ${job.attempts}:`, err);
    const willRetry = await failJob(job, message);
    const db = getDb();
    await db
      .update(documentsTable)
      .set(
        willRetry
          ? { status: "queued", stage: "queued", error: `Retrying after an error: ${message}` }
          : { status: "failed", stage: null, error: message }
      )
      .where(eq(documentsTable.id, job.documentId));
  }
  return true;
}

/**
 * Brings documents in line with the current setup, once per start:
 *  - documents embedded with a different model (including every document
 *    from before the multilingual model) are queued for re-embedding;
 *  - documents left "processing" by the old in-request upload flow, with
 *    no job to finish them, are marked failed instead of spinning forever.
 */
export async function reconcileDocuments() {
  const db = getDb();
  const active = await documentsWithActiveJobs();
  const model = currentEmbeddingModel();

  const stale = await db
    .select({ id: documentsTable.id })
    .from(documentsTable)
    .where(
      and(
        eq(documentsTable.status, "ready"),
        sql`coalesce(${documentsTable.embeddingModel}, ${LEGACY_EMBEDDING_MODEL}) <> ${model}`
      )
    );
  for (const { id } of stale) {
    if (active.has(id)) continue;
    await enqueueJob({ type: "reembed", documentId: id });
    await db
      .update(documentsTable)
      .set({ status: "queued", stage: "reembedding", progressDone: 0, progressTotal: 0 })
      .where(eq(documentsTable.id, id));
  }

  const orphaned = await db
    .select({ id: documentsTable.id })
    .from(documentsTable)
    .where(inArray(documentsTable.status, ["processing", "queued"]));
  const orphanIds = orphaned.map((d) => d.id).filter((id) => !active.has(id) && !stale.some((s) => s.id === id));
  if (orphanIds.length) {
    await db
      .update(documentsTable)
      .set({ status: "failed", stage: null, error: "Processing was interrupted. Delete this document and upload it again." })
      .where(inArray(documentsTable.id, orphanIds));
  }

  if (stale.length) console.log(`Queued ${stale.length} document(s) for re-embedding with ${model}.`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

declare global {
  // eslint-disable-next-line no-var
  var __readingRoomWorker: Promise<void> | undefined;
}

/** Starts the worker loop once per process (dev hot reloads included). */
export function startWorker() {
  if (globalThis.__readingRoomWorker) return;
  globalThis.__readingRoomWorker = (async () => {
    let reconciled = false;
    for (;;) {
      try {
        if (!reconciled) {
          await reconcileDocuments();
          reconciled = true;
        }
        const didWork = await runNextJob();
        if (!didWork) await sleep(IDLE_POLL_MS);
      } catch (err) {
        // Usually the database being unreachable or not migrated yet.
        console.error("Background worker error (retrying shortly):", describeError(err));
        await sleep(ERROR_BACKOFF_MS);
      }
    }
  })();
}
