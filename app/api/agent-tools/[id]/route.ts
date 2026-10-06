import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, agentToolsTable } from "@/db";
import { validateToolPatch, validateUrlTemplate, ValidationError } from "@/lib/agent/tool-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const patch = validateToolPatch(await req.json());
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const db = getDb();
    const [current] = await db.select().from(agentToolsTable).where(eq(agentToolsTable.id, params.id));
    if (!current) return NextResponse.json({ error: "Tool not found" }, { status: 404 });
    // The URL and connection are only valid together.
    validateUrlTemplate(
      patch.urlTemplate ?? current.urlTemplate,
      !!(patch.connectionId !== undefined ? patch.connectionId : current.connectionId)
    );

    const [updated] = await db
      .update(agentToolsTable)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(agentToolsTable.id, params.id))
      .returning();
    return NextResponse.json({ tool: updated });
  } catch (err: any) {
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: 400 });
    return NextResponse.json({ error: err?.message ?? "Failed to update tool" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getDb();
    await db.delete(agentToolsTable).where(eq(agentToolsTable.id, params.id));
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to delete tool" },
      { status: 500 }
    );
  }
}
