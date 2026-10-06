import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, apiConnectionsTable } from "@/db";
import { validateConnection } from "@/lib/agent/connections";
import { ValidationError } from "@/lib/agent/tool-validation";
import { mergeSecrets } from "@/lib/agent/mcp-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const patch = validateConnection(await req.json(), true);
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    const db = getDb();
    if (patch.headers !== undefined) {
      // Header values are write-only in the UI: a blank value keeps the stored one.
      const [current] = await db
        .select({ headers: apiConnectionsTable.headers })
        .from(apiConnectionsTable)
        .where(eq(apiConnectionsTable.id, params.id));
      patch.headers = mergeSecrets(patch.headers, (current?.headers as Record<string, string> | null) ?? null) ?? null;
    }
    const [updated] = await db
      .update(apiConnectionsTable)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(apiConnectionsTable.id, params.id))
      .returning({ id: apiConnectionsTable.id });
    if (!updated) return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: 400 });
    const message = err?.code === "23505" || err?.cause?.code === "23505" ? "A connection with that name already exists." : err?.message;
    return NextResponse.json({ error: message ?? "Failed to update connection" }, { status: 500 });
  }
}

/** Deletes the connection and every tool that uses it. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getDb();
    await db.delete(apiConnectionsTable).where(eq(apiConnectionsTable.id, params.id));
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Failed to delete connection" }, { status: 500 });
  }
}
