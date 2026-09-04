import { NextResponse } from "next/server";
import { getUsageSnapshot } from "@/lib/rag/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lightweight endpoint (no document/chunk aggregation) for the small
// always-visible usage dots, polled from the sidebar.
export async function GET() {
  try {
    const snapshot = await getUsageSnapshot();
    return NextResponse.json(snapshot);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to load usage" },
      { status: 500 }
    );
  }
}
