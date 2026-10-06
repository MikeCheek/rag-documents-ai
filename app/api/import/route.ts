import { NextRequest, NextResponse } from "next/server";
import { importAllData, type ExportBundle } from "@/lib/rag/export-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const bundle = (await req.json()) as ExportBundle;
    const summary = await importAllData(bundle);
    return NextResponse.json({ ok: true, summary });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to import data" },
      { status: 400 }
    );
  }
}
