import { NextResponse } from "next/server";
import { listServerTools, loadMcpServer } from "@/lib/agent/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Connects to the server now and lists its tools — also the "Test connection" check. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const server = await loadMcpServer(params.id).catch(() => null);
  if (!server) return NextResponse.json({ error: "MCP server not found" }, { status: 404 });
  try {
    const startedAt = Date.now();
    const tools = await listServerTools(server);
    return NextResponse.json({ tools, durationMs: Date.now() - startedAt });
  } catch (err: any) {
    return NextResponse.json({ error: `Couldn't connect: ${err?.message ?? err}` }, { status: 502 });
  }
}
