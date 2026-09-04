import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, documentsTable } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "Name can't be empty" }, { status: 400 });
    }

    const db = getDb();
    const [updated] = await db
      .update(documentsTable)
      .set({ name: name.slice(0, 300) })
      .where(eq(documentsTable.id, params.id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    return NextResponse.json({ document: updated });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to rename document" },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getDb();
    await db.delete(documentsTable).where(eq(documentsTable.id, params.id));
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to delete document" },
      { status: 500 }
    );
  }
}
