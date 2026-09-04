import { gte, inArray, sql } from "drizzle-orm";
import { getDb, apiCallsTable, chunksTable } from "@/db";
import { getSettings } from "./settings";

/**
 * Records a call to an AI service so the dashboard can show usage against
 * free-tier limits. Best-effort: a logging failure never breaks the actual
 * request, it's just swallowed and logged to the server console.
 */
export async function logApiCall(
  provider: "openrouter" | "cohere" | "local",
  purpose: "optimize_query" | "chat_completion" | "rerank" | "embedding" | "compaction",
  options: { count?: number; tokensUsed?: number } = {}
) {
  try {
    const db = getDb();
    await db.insert(apiCallsTable).values({
      provider,
      purpose,
      count: options.count ?? 1,
      tokensUsed: options.tokensUsed ?? null,
    });
  } catch (err) {
    console.error("Failed to log API call:", err);
  }
}

/**
 * Marks chunks as "used" — called whenever a chunk is included in the
 * final context sent to the LLM for an answer, regardless of whether the
 * person reads the answer.
 */
export async function incrementChunkUsage(chunkIds: number[]) {
  if (chunkIds.length === 0) return;
  try {
    const db = getDb();
    await db
      .update(chunksTable)
      .set({ usageCount: sql`${chunksTable.usageCount} + 1` })
      .where(inArray(chunksTable.id, chunkIds));
  } catch (err) {
    console.error("Failed to record chunk usage:", err);
  }
}

export type ProviderUsageStats = {
  callsToday: number;
  callsMonth: number;
  callsAllTime: number;
  callsLastMinute: number;
  tokensMonth: number;
  tokensAllTime: number;
  byPurpose: Record<string, number>;
};

/**
 * Aggregates API call logs into per-provider stats, plus the current
 * (user-adjustable) limits and whether each provider's key is configured.
 * Shared by the lightweight usage-dots endpoint and the full dashboard.
 */
export async function getUsageSnapshot() {
  const db = getDb();
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const oneMinuteAgo = new Date(now.getTime() - 60_000);

  const allTimeRows = await db
    .select({
      provider: apiCallsTable.provider,
      purpose: apiCallsTable.purpose,
      calls: sql<number>`coalesce(sum(${apiCallsTable.count}), 0)`,
      tokens: sql<number>`coalesce(sum(${apiCallsTable.tokensUsed}), 0)`,
    })
    .from(apiCallsTable)
    .groupBy(apiCallsTable.provider, apiCallsTable.purpose);

  const monthRows = await db
    .select({
      provider: apiCallsTable.provider,
      purpose: apiCallsTable.purpose,
      count: apiCallsTable.count,
      tokensUsed: apiCallsTable.tokensUsed,
      createdAt: apiCallsTable.createdAt,
    })
    .from(apiCallsTable)
    .where(gte(apiCallsTable.createdAt, startOfMonth));

  const providers = ["openrouter", "cohere", "local"] as const;
  const usage = Object.fromEntries(
    providers.map((provider) => {
      const monthly = monthRows.filter((r) => r.provider === provider);
      const callsMonth = monthly.reduce((sum, r) => sum + r.count, 0);
      const callsToday = monthly
        .filter((r) => r.createdAt >= startOfToday)
        .reduce((sum, r) => sum + r.count, 0);
      const callsLastMinute = monthly
        .filter((r) => r.createdAt >= oneMinuteAgo)
        .reduce((sum, r) => sum + r.count, 0);
      const tokensMonth = monthly.reduce((sum, r) => sum + (r.tokensUsed ?? 0), 0);
      const providerAllTime = allTimeRows.filter((r) => r.provider === provider);
      const callsAllTime = providerAllTime.reduce((sum, r) => sum + r.calls, 0);
      const tokensAllTime = providerAllTime.reduce((sum, r) => sum + r.tokens, 0);
      const byPurpose = Object.fromEntries(providerAllTime.map((r) => [r.purpose, r.calls]));

      const stats: ProviderUsageStats = {
        callsToday,
        callsMonth,
        callsAllTime,
        callsLastMinute,
        tokensMonth,
        tokensAllTime,
        byPurpose,
      };
      return [provider, stats];
    })
  ) as Record<(typeof providers)[number], ProviderUsageStats>;

  const limits = await getSettings();

  return {
    usage,
    limits,
    configured: {
      openrouter: !!process.env.OPENROUTER_API_KEY,
      cohere: !!process.env.COHERE_API_KEY,
    },
  };
}
