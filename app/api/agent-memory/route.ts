import { NextRequest, NextResponse } from "next/server";
import { listMemories, saveMemory } from "@/lib/agent/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const memories = await listMemories();
    return NextResponse.json({ memories });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to load memory" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const content = String(body?.content ?? "").trim();
    if (!content) {
      return NextResponse.json({ error: "Content can't be empty" }, { status: 400 });
    }
    const memory = await saveMemory(content);
    return NextResponse.json({ memory });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to save memory" },
      { status: 500 }
    );
  }
}
