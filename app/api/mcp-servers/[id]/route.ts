import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, mcpServersTable } from "@/db";
import { loadMcpServer } from "@/lib/agent/mcp";
import { mergeSecrets, validateMcpServer } from "@/lib/agent/mcp-validation";
import { ValidationError } from "@/lib/agent/tool-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const current = await loadMcpServer(params.id);
    if (!current) return NextResponse.json({ error: "MCP server not found" }, { status: 404 });
    const patch = validateMcpServer(await req.json(), true);
    if (patch.headers !== undefined) patch.headers = mergeSecrets(patch.headers, current.headers);
    if (patch.env !== undefined) patch.env = mergeSecrets(patch.env, current.env);
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

    const db = getDb();
    await db.update(mcpServersTable).set({ ...patch, updatedAt: new Date() }).where(eq(mcpServersTable.id, params.id));
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: 400 });
    const message = err?.code === "23505" || err?.cause?.code === "23505" ? "An MCP server with that name already exists." : err?.message;
    return NextResponse.json({ error: message ?? "Failed to update MCP server" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getDb();
    await db.delete(mcpServersTable).where(eq(mcpServersTable.id, params.id));
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Failed to delete MCP server" }, { status: 500 });
  }
}
