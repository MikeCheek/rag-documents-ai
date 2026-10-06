import { NextRequest, NextResponse } from "next/server";
import { getDb, agentToolsTable } from "@/db";
import { loadAllCustomTools } from "@/lib/agent/custom-tools";
import { getBuiltinToolInfo, isBuiltinTool } from "@/lib/agent/tools";
import { getSettings } from "@/lib/rag/settings";
import { validateTool, ValidationError } from "@/lib/agent/tool-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [custom, settings] = await Promise.all([loadAllCustomTools(), getSettings()]);
    return NextResponse.json({ builtin: getBuiltinToolInfo(settings), custom });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to load tools" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const input = validateTool(await req.json());
    if (isBuiltinTool(input.name)) {
      return NextResponse.json({ error: `"${input.name}" is the name of a built-in tool.` }, { status: 400 });
    }
    const db = getDb();
    const [created] = await db.insert(agentToolsTable).values(input).returning();
    return NextResponse.json({ tool: created });
  } catch (err: any) {
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: 400 });
    const message = err?.code === "23505" ? "A tool with that name already exists." : err?.message;
    return NextResponse.json({ error: message ?? "Failed to create tool" }, { status: 500 });
  }
}
