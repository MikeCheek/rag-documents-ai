import { NextResponse } from "next/server";
import { computeDocumentClusters } from "@/lib/rag/clustering";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await computeDocumentClusters();
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to compute document clusters" },
      { status: 500 }
    );
  }
}
