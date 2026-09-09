import { eq } from "drizzle-orm";
import { getDb, settingsTable } from "@/db";
import type { AppLimits, AppSettings, QueryOptimizationMode, RerankMode } from "@/types";

export type { AppLimits, AppSettings, QueryOptimizationMode, RerankMode };

export const DEFAULT_LIMITS: AppLimits = {
  cohereMonthlyCap: 1000,
  coherePerMinuteCap: 10,
  openrouterPerMinuteCap: 20,
  openrouterDailyCap: 50,
  agentMaxSteps: 6,
};

const QUERY_OPTIMIZATION_MODES: QueryOptimizationMode[] = ["off", "local", "llm"];
const RERANK_MODES: RerankMode[] = ["cohere", "bm25", "off"];

export async function getSettings(): Promise<AppSettings> {
  const db = getDb();
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.id, 1));

  if (row) {
    return {
      cohereMonthlyCap: row.cohereMonthlyCap,
      coherePerMinuteCap: row.coherePerMinuteCap,
      openrouterPerMinuteCap: row.openrouterPerMinuteCap,
      openrouterDailyCap: row.openrouterDailyCap,
      agentMaxSteps: row.agentMaxSteps,
      openrouterModel: row.openrouterModel,
      searxngBaseUrl: row.searxngBaseUrl,
      queryOptimization: row.queryOptimization as QueryOptimizationMode,
      rerankMethod: row.rerankMethod as RerankMode,
    };
  }

  // First read: create the singleton row. Default reranking to Cohere only
  // if a key is actually configured, otherwise start on the free local
  // option rather than a mode that would silently no-op every time. The
  // model seeds from OPENROUTER_MODEL if set, so an existing deployment's
  // env-configured model carries over — after this it's DB-controlled via
  // Settings, not the env var, which only matters for a first run.
  const seed: AppSettings = {
    ...DEFAULT_LIMITS,
    queryOptimization: "local",
    rerankMethod: process.env.COHERE_API_KEY ? "cohere" : "bm25",
    openrouterModel: process.env.OPENROUTER_MODEL || "openrouter/free",
    searxngBaseUrl: process.env.SEARXNG_BASE_URL?.trim() || null,
  };

  await db.insert(settingsTable).values({ id: 1, ...seed }).onConflictDoNothing();

  return seed;
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  if (patch.queryOptimization && !QUERY_OPTIMIZATION_MODES.includes(patch.queryOptimization)) {
    throw new Error(`Invalid queryOptimization: ${patch.queryOptimization}`);
  }
  if (patch.rerankMethod && !RERANK_MODES.includes(patch.rerankMethod)) {
    throw new Error(`Invalid rerankMethod: ${patch.rerankMethod}`);
  }
  if (patch.openrouterModel !== undefined) {
    const model = patch.openrouterModel.trim();
    if (!model || model.length > 200) {
      throw new Error("openrouterModel must be a non-empty model id (max 200 characters).");
    }
    patch.openrouterModel = model;
  }
  if (patch.searxngBaseUrl !== undefined) {
    const url = (patch.searxngBaseUrl ?? "").trim();
    if (!url) {
      patch.searxngBaseUrl = null; // clears it — web search stops being offered
    } else if (!/^https?:\/\//i.test(url)) {
      throw new Error("searxngBaseUrl must start with http:// or https://");
    } else {
      patch.searxngBaseUrl = url.replace(/\/+$/, ""); // no trailing slash
    }
  }

  const db = getDb();
  const current = await getSettings();
  const next = { ...current, ...patch };

  await db
    .insert(settingsTable)
    .values({ id: 1, ...next })
    .onConflictDoUpdate({
      target: settingsTable.id,
      set: { ...next, updatedAt: new Date() },
    });

  return next;
}
