import { eq } from "drizzle-orm";
import { getDb, settingsTable } from "@/db";
import type { AppLimits, AppSettings, QueryOptimizationMode, RerankMode } from "@/types";

export type { AppLimits, AppSettings, QueryOptimizationMode, RerankMode };

export const DEFAULT_LIMITS: AppLimits = {
  cohereMonthlyCap: 1000,
  coherePerMinuteCap: 10,
  openrouterPerMinuteCap: 20,
  openrouterDailyCap: 50,
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
      queryOptimization: row.queryOptimization as QueryOptimizationMode,
      rerankMethod: row.rerankMethod as RerankMode,
    };
  }

  // First read: create the singleton row. Default reranking to Cohere only
  // if a key is actually configured, otherwise start on the free local
  // option rather than a mode that would silently no-op every time.
  const seed: AppSettings = {
    ...DEFAULT_LIMITS,
    queryOptimization: "local",
    rerankMethod: process.env.COHERE_API_KEY ? "cohere" : "bm25",
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
