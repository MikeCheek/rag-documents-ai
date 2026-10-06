import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, documentsTable } from "@/db";
import { retryDocumentJob } from "@/lib/jobs/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Re-queues a failed document's last job (e.g. after fixing whatever broke it). */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const requeued = await retryDocumentJob(params.id);
    if (!requeued) {
      return NextResponse.json(
        { error: "Nothing to retry for this document. Delete it and upload it again." },
        { status: 409 }
      );
    }
    const db = getDb();
    await db
      .update(documentsTable)
      .set({ status: "queued", stage: "queued", error: null, progressDone: 0, progressTotal: 0 })
      .where(eq(documentsTable.id, params.id));
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Retry failed" }, { status: 500 });
  }
}
