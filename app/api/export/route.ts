import { NextResponse } from "next/server";
import { exportAllData } from "@/lib/rag/export-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const bundle = await exportAllData();
    const json = JSON.stringify(bundle, null, 2);
    const filename = `reading-room-export-${new Date().toISOString().slice(0, 10)}.json`;

    return new NextResponse(json, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to export data" },
      { status: 500 }
    );
  }
}
