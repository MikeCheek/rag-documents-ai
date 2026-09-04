import { NextRequest, NextResponse } from "next/server";
import { computeEmbeddingSpace } from "@/lib/rag/embedding-space";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const query: string = (body?.query ?? "").trim();

    if (!query) {
      return NextResponse.json({ error: "Enter a word or phrase." }, { status: 400 });
    }

    const result = await computeEmbeddingSpace(query);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("Embedding space route failed:", err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to map the embedding space" },
      { status: 500 }
    );
  }
}
