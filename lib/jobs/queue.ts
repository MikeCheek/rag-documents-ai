import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, jobsTable } from "@/db";

// A small Postgres-backed job queue: no extra infrastructure, and jobs
// survive restarts. Claiming uses FOR UPDATE SKIP LOCKED, so several
// server processes can poll the same table without two of them ever
// running one job. A job whose worker died (crash, redeploy) is reclaimed
// once its lock goes stale; long jobs refresh the lock as they make
// progress (touchJob), so they're never mistaken for dead ones.

export type JobType = "ingest" | "reembed";

export type IngestPayload = {
  /** One entry per page for paged formats (PDF), else null. */
  pages: string[] | null;
  /** Whole text for unpaged formats, else null. */
  text: string | null;
};

export type Job = {
  id: number;
  type: JobType;
  documentId: string;
  payload: IngestPayload | null;
  file: Buffer | null;
  attempts: number;
};

export const MAX_ATTEMPTS = 3;
export const STALE_LOCK_MINUTES = 15;

/** Wait before retry n is attempts × this, so a brief outage (network,
 *  database restart) doesn't use up every attempt within seconds. */
export function retryDelaySeconds(): number {
  const configured = Number(process.env.JOB_RETRY_DELAY_SECONDS);
  return Number.isFinite(configured) && configured >= 0 ? configured : 30;
}

export async function enqueueJob(job: {
  type: JobType;
  documentId: string;
  payload?: IngestPayload;
  file?: Buffer;
}): Promise<number> {
  const db = getDb();
  const [row] = await db
    .insert(jobsTable)
    .values({
      type: job.type,
      documentId: job.documentId,
      payload: job.payload ?? null,
      file: job.file ?? null,
    })
    .returning({ id: jobsTable.id });
  return row.id;
}

/** Atomically takes the oldest runnable job, or returns null. */
export async function claimNextJob(): Promise<Job | null> {
  const db = getDb();
  const rows = (await db.execute(sql`
    update jobs
    set status = 'running', locked_at = now(), attempts = attempts + 1, updated_at = now()
    where id = (
      select id from jobs
      where (status = 'queued'
             and (attempts = 0 or updated_at <= now() - make_interval(secs => attempts * ${retryDelaySeconds()})))
         or (status = 'running' and locked_at < now() - make_interval(mins => ${STALE_LOCK_MINUTES}))
      order by id
      for update skip locked
      limit 1
    )
    returning id, type, document_id, payload, file, attempts
  `)) as unknown as any[];

  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    documentId: row.document_id,
    payload: row.payload,
    file: row.file ? Buffer.from(row.file) : null,
    attempts: row.attempts,
  };
}

/**
 * Replaces a running job's payload with work already done (e.g. OCR'd
 * pages) and drops its file, so a retry doesn't redo the slow part.
 */
export async function saveJobProgress(id: number, payload: IngestPayload) {
  const db = getDb();
  await db.update(jobsTable).set({ payload, file: null, updatedAt: new Date() }).where(eq(jobsTable.id, id));
}

/** Refreshes a running job's lock, so a long job isn't reclaimed as dead. */
export async function touchJob(id: number) {
  const db = getDb();
  await db.update(jobsTable).set({ lockedAt: new Date(), updatedAt: new Date() }).where(eq(jobsTable.id, id));
}

/** Marks a job done and drops its payload and file, which can be large. */
export async function completeJob(id: number) {
  const db = getDb();
  await db
    .update(jobsTable)
    .set({ status: "done", payload: null, file: null, lastError: null, updatedAt: new Date() })
    .where(eq(jobsTable.id, id));
}

/**
 * Records a failure. Returns true if the job will be retried, false if it
 * has used up its attempts (its payload is kept, so it can still be
 * retried by hand from the Shelf).
 */
export async function failJob(job: Job, error: string): Promise<boolean> {
  const db = getDb();
  const retry = job.attempts < MAX_ATTEMPTS;
  await db
    .update(jobsTable)
    .set({ status: retry ? "queued" : "failed", lastError: error, lockedAt: null, updatedAt: new Date() })
    .where(eq(jobsTable.id, job.id));
  return retry;
}

/** Puts a document's most recent failed job back in the queue. */
export async function retryDocumentJob(documentId: string): Promise<boolean> {
  const db = getDb();
  const [job] = await db
    .select({ id: jobsTable.id })
    .from(jobsTable)
    .where(and(eq(jobsTable.documentId, documentId), eq(jobsTable.status, "failed")))
    .orderBy(sql`${jobsTable.id} desc`)
    .limit(1);
  if (!job) return false;
  await db
    .update(jobsTable)
    .set({ status: "queued", attempts: 0, lastError: null, updatedAt: new Date() })
    .where(eq(jobsTable.id, job.id));
  return true;
}

/** Ids of documents that have a job waiting or running. */
export async function documentsWithActiveJobs(): Promise<Set<string>> {
  const db = getDb();
  const rows = await db
    .select({ documentId: jobsTable.documentId })
    .from(jobsTable)
    .where(inArray(jobsTable.status, ["queued", "running"]));
  return new Set(rows.map((r) => r.documentId).filter((id): id is string => !!id));
}
