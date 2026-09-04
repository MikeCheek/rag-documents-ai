import { NextResponse } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { getDb, documentsTable, chunksTable } from "@/db";
import { getUsageSnapshot } from "@/lib/rag/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getDb();

    const [docStats] = await db
      .select({
        total: sql<number>`count(*)`,
        ready: sql<number>`count(*) filter (where ${documentsTable.status} = 'ready')`,
        processing: sql<number>`count(*) filter (where ${documentsTable.status} = 'processing')`,
        failed: sql<number>`count(*) filter (where ${documentsTable.status} = 'failed')`,
        totalChunks: sql<number>`coalesce(sum(${documentsTable.chunkCount}), 0)`,
        totalChars: sql<number>`coalesce(sum(${documentsTable.charCount}), 0)`,
      })
      .from(documentsTable);

    const chunks = await db
      .select({
        chunkId: chunksTable.id,
        documentId: chunksTable.documentId,
        documentName: documentsTable.name,
        chunkIndex: chunksTable.chunkIndex,
        content: chunksTable.content,
        usageCount: chunksTable.usageCount,
      })
      .from(chunksTable)
      .innerJoin(documentsTable, eq(chunksTable.documentId, documentsTable.id))
      .orderBy(desc(chunksTable.usageCount), desc(chunksTable.createdAt))
      .limit(500);

    const { usage, limits, configured } = await getUsageSnapshot();

    return NextResponse.json({
      documents: docStats ?? {
        total: 0,
        ready: 0,
        processing: 0,
        failed: 0,
        totalChunks: 0,
        totalChars: 0,
      },
      usage,
      limits,
      configured,
      chunks,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to load dashboard data" },
      { status: 500 }
    );
  }
}
