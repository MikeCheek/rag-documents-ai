import { NextRequest, NextResponse } from "next/server";
import { getDb, agentToolsTable } from "@/db";
import { loadAllCustomTools } from "@/lib/agent/custom-tools";
import { getBuiltinToolInfo } from "@/lib/agent/tools";
import { getSettings } from "@/lib/rag/settings";
import type { ToolParameter } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]{1,63}$/;
const VALID_PARAM_TYPES = ["string", "number", "boolean"];

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
    const body = await req.json();

    const name = String(body?.name ?? "").trim();
    const description = String(body?.description ?? "").trim();
    const method = body?.method === "POST" ? "POST" : "GET";
    const urlTemplate = String(body?.urlTemplate ?? "").trim();
    const parameters: ToolParameter[] = Array.isArray(body?.parameters) ? body.parameters : [];
    const headers =
      body?.headers && typeof body.headers === "object" ? body.headers : null;

    if (!NAME_PATTERN.test(name)) {
      return NextResponse.json(
        {
          error:
            "Name must be 2-64 characters, start with a letter or underscore, and contain only letters, numbers, and underscores (it's used as the function name the model calls).",
        },
        { status: 400 }
      );
    }
    if (!description) {
      return NextResponse.json({ error: "Description is required." }, { status: 400 });
    }
    if (!urlTemplate || !/^https?:\/\//i.test(urlTemplate)) {
      return NextResponse.json(
        { error: "URL template must start with http:// or https://" },
        { status: 400 }
      );
    }
    for (const p of parameters) {
      if (!p.name || !VALID_PARAM_TYPES.includes(p.type)) {
        return NextResponse.json(
          { error: `Invalid parameter definition: ${JSON.stringify(p)}` },
          { status: 400 }
        );
      }
    }

    const db = getDb();
    const [created] = await db
      .insert(agentToolsTable)
      .values({ name, description, method, urlTemplate, parameters, headers })
      .returning();

    return NextResponse.json({ tool: created });
  } catch (err: any) {
    const message =
      err?.code === "23505" ? `A tool named "${err?.detail ?? ""}" already exists.` : err?.message;
    return NextResponse.json(
      { error: message ?? "Failed to create tool" },
      { status: 500 }
    );
  }
}
