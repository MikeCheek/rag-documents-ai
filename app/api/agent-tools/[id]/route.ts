import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, agentToolsTable } from "@/db";
import type { ToolParameter } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_PARAM_TYPES = ["string", "number", "boolean"];

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const patch: Record<string, unknown> = {};

    if (typeof body?.enabled === "boolean") patch.enabled = body.enabled;
    if (typeof body?.description === "string" && body.description.trim()) {
      patch.description = body.description.trim();
    }
    if (body?.method === "GET" || body?.method === "POST") patch.method = body.method;
    if (typeof body?.urlTemplate === "string" && /^https?:\/\//i.test(body.urlTemplate)) {
      patch.urlTemplate = body.urlTemplate.trim();
    }
    if (Array.isArray(body?.parameters)) {
      const parameters = body.parameters as ToolParameter[];
      for (const p of parameters) {
        if (!p.name || !VALID_PARAM_TYPES.includes(p.type)) {
          return NextResponse.json(
            { error: `Invalid parameter definition: ${JSON.stringify(p)}` },
            { status: 400 }
          );
        }
      }
      patch.parameters = parameters;
    }
    if (body?.headers === null || (body?.headers && typeof body.headers === "object")) {
      patch.headers = body.headers;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const db = getDb();
    const [updated] = await db
      .update(agentToolsTable)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(agentToolsTable.id, params.id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Tool not found" }, { status: 404 });
    }

    return NextResponse.json({ tool: updated });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to update tool" },
      { status: 500 }
    );
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
