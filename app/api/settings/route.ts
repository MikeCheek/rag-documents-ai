import { NextRequest, NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/rag/settings";
import type { AppLimits, AppSettings, QueryOptimizationMode, RerankMode } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NUMERIC_BOUNDS: Record<keyof AppLimits, { min: number; max: number }> = {
  cohereMonthlyCap: { min: 1, max: 1_000_000 },
  coherePerMinuteCap: { min: 1, max: 1_000_000 },
  openrouterPerMinuteCap: { min: 1, max: 1_000_000 },
  openrouterDailyCap: { min: 1, max: 1_000_000 },
  // Deliberately tight: each step is a real API call in a loop, so a huge
  // cap risks a runaway, expensive request rather than just a UI oddity.
  agentMaxSteps: { min: 1, max: 20 },
};
const NUMERIC_KEYS = Object.keys(NUMERIC_BOUNDS) as (keyof AppLimits)[];

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
      const { min, max } = NUMERIC_BOUNDS[key];
      if (!Number.isFinite(value) || value < min || value > max) {
        return NextResponse.json(
          { error: `${key} must be a number between ${min} and ${max}` },
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

    if (body?.openrouterModel !== undefined) {
      const model = String(body.openrouterModel).trim();
      if (!model || model.length > 200) {
        return NextResponse.json(
          { error: "openrouterModel must be a non-empty model id (max 200 characters)." },
          { status: 400 }
        );
      }
      patch.openrouterModel = model;
    }

    if (body?.searxngBaseUrl !== undefined) {
      const url = String(body.searxngBaseUrl ?? "").trim();
      if (url && !/^https?:\/\//i.test(url)) {
        return NextResponse.json(
          { error: "searxngBaseUrl must start with http:// or https://, or be empty to clear it." },
          { status: 400 }
        );
      }
      patch.searxngBaseUrl = url || null;
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
