import { NextResponse } from "next/server";
import { getSettings } from "@/lib/rag/settings";
import { checkModelToolSupport } from "@/lib/agent/model-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await getSettings();
    const check = await checkModelToolSupport(settings.openrouterModel);
    return NextResponse.json(check);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to check model" },
      { status: 500 }
    );
  }
}
