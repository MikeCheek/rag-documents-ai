import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getDb, documentsTable } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getDb();
    const rows = await db
      .select()
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
