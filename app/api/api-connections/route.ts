import { NextRequest, NextResponse } from "next/server";
import { getDb, agentToolsTable, apiConnectionsTable } from "@/db";
import { listConnectionRecords, validateConnection } from "@/lib/agent/connections";
import { validateTool, ValidationError } from "@/lib/agent/tool-validation";
import { isBuiltinTool } from "@/lib/agent/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ connections: await listConnectionRecords() });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Failed to load connections" }, { status: 500 });
  }
}

/**
 * Creates a connection, optionally with tools for it (the OpenAPI import
 * sends the operations the user picked). All-or-nothing: one invalid or
 * duplicate tool name and nothing is created.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const connection = validateConnection(body);
    const tools = (Array.isArray(body?.tools) ? body.tools : []).map((t: any) =>
      validateTool({ ...t, connectionId: "pending" })
    );
    for (const t of tools) {
      if (isBuiltinTool(t.name)) throw new ValidationError(`"${t.name}" is the name of a built-in tool; rename it.`);
    }

    const db = getDb();
    const created = await db.transaction(async (tx) => {
      const [c] = await tx
        .insert(apiConnectionsTable)
        .values({
          name: connection.name!,
          baseUrl: connection.baseUrl!,
          authType: connection.authType ?? "none",
          authName: connection.authName ?? null,
          authValue: connection.authValue ?? null,
          headers: connection.headers ?? null,
          allowPrivateNetwork: connection.allowPrivateNetwork ?? false,
        })
        .returning({ id: apiConnectionsTable.id });
      if (tools.length) {
        await tx.insert(agentToolsTable).values(tools.map((t: any) => ({ ...t, connectionId: c.id })));
      }
      return c;
    });

    return NextResponse.json({ id: created.id, toolsCreated: tools.length });
  } catch (err: any) {
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: 400 });
    const message =
      err?.code === "23505" || err?.cause?.code === "23505"
        ? "A connection or tool with one of these names already exists. Rename it (e.g. with a prefix) and try again."
        : err?.message;
    return NextResponse.json({ error: message ?? "Failed to create connection" }, { status: 500 });
  }
}
