import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getDb, documentsTable } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getDb();
    // Explicit columns: skips each document's 384-float centroid, which
    // the UI never uses and the Shelf polls this while documents process.
    const rows = await db
      .select({
        id: documentsTable.id,
        name: documentsTable.name,
        fileType: documentsTable.fileType,
        status: documentsTable.status,
        error: documentsTable.error,
        chunkCount: documentsTable.chunkCount,
        charCount: documentsTable.charCount,
        language: documentsTable.language,
        stage: documentsTable.stage,
        progressDone: documentsTable.progressDone,
        progressTotal: documentsTable.progressTotal,
        createdAt: documentsTable.createdAt,
      })
      .from(documentsTable)
      .orderBy(desc(documentsTable.createdAt));

    return NextResponse.json({ documents: rows });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to load documents" },
      { status: 500 }
    );
  }
}
