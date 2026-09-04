import { NextRequest, NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/rag/settings";
import type { AppLimits, AppSettings, QueryOptimizationMode, RerankMode } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NUMERIC_KEYS: (keyof AppLimits)[] = [
  "cohereMonthlyCap",
  "coherePerMinuteCap",
  "openrouterPerMinuteCap",
  "openrouterDailyCap",
];

const QUERY_OPTIMIZATION_MODES: QueryOptimizationMode[] = ["off", "local", "llm"];
const RERANK_MODES: RerankMode[] = ["cohere", "bm25", "off"];

export async function GET() {
  try {
    const limits = await getSettings();
    return NextResponse.json({ limits });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to load settings" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const patch: Partial<AppSettings> = {};

    for (const key of NUMERIC_KEYS) {
      if (body?.[key] === undefined) continue;
      const value = Number(body[key]);
      if (!Number.isFinite(value) || value < 1 || value > 1_000_000) {
        return NextResponse.json(
          { error: `${key} must be a number between 1 and 1,000,000` },
          { status: 400 }
        );
      }
      patch[key] = Math.round(value);
    }

    if (body?.queryOptimization !== undefined) {
      if (!QUERY_OPTIMIZATION_MODES.includes(body.queryOptimization)) {
        return NextResponse.json(
          { error: `queryOptimization must be one of: ${QUERY_OPTIMIZATION_MODES.join(", ")}` },
          { status: 400 }
        );
      }
      patch.queryOptimization = body.queryOptimization;
    }

    if (body?.rerankMethod !== undefined) {
      if (!RERANK_MODES.includes(body.rerankMethod)) {
        return NextResponse.json(
          { error: `rerankMethod must be one of: ${RERANK_MODES.join(", ")}` },
          { status: 400 }
        );
      }
      patch.rerankMethod = body.rerankMethod;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const limits = await updateSettings(patch);
    return NextResponse.json({ limits });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to update settings" },
      { status: 500 }
    );
  }
}
