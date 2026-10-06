import { NextRequest, NextResponse } from "next/server";
import { executeCustomTool, loadConnections, loadCustomTool } from "@/lib/agent/custom-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Runs a custom tool once with the given arguments, exactly as the agent would. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const tool = await loadCustomTool(params.id);
    if (!tool) return NextResponse.json({ error: "Tool not found" }, { status: 404 });
    const body = await req.json().catch(() => ({}));
    const args = body?.args && typeof body.args === "object" ? body.args : {};
    const connection = tool.connectionId ? (await loadConnections()).get(tool.connectionId) : null;
    const startedAt = Date.now();
    const outcome = await executeCustomTool(tool, args, connection);
    return NextResponse.json({ ...outcome, durationMs: Date.now() - startedAt });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Test failed" }, { status: 500 });
  }
}
