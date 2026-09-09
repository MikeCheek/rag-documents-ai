import { NextResponse } from "next/server";
import { listFreeModels } from "@/lib/agent/model-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const models = await listFreeModels();
    return NextResponse.json({ models });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to load OpenRouter models" },
      { status: 500 }
    );
  }
}
