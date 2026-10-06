import { NextRequest, NextResponse } from "next/server";
import { getDb, mcpServersTable } from "@/db";
import { loadMcpServers, stdioAllowed, toPublicRecord } from "@/lib/agent/mcp";
import { validateMcpServer } from "@/lib/agent/mcp-validation";
import { ValidationError } from "@/lib/agent/tool-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const servers = await loadMcpServers();
    return NextResponse.json({ servers: servers.map(toPublicRecord), stdioAllowed: stdioAllowed() });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Failed to load MCP servers" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const input = validateMcpServer(await req.json());
    const db = getDb();
    const [created] = await db
      .insert(mcpServersTable)
      .values({ ...input, name: input.name, args: input.args ?? [], disabledTools: input.disabledTools ?? [] })
      .returning({ id: mcpServersTable.id });
    return NextResponse.json({ id: created.id });
  } catch (err: any) {
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: 400 });
    const message = err?.code === "23505" || err?.cause?.code === "23505" ? "An MCP server with that name already exists." : err?.message;
    return NextResponse.json({ error: message ?? "Failed to add MCP server" }, { status: 500 });
  }
}
