import { sql, eq } from "drizzle-orm";
import { getDb, stageTimingsTable } from "@/db";
import type { StageTimingRow, TimingDailyPoint } from "@/types";

export type TimingEntry = { stage: string; durationMs: number };

/**
 * Collects timing for every stage/call within a single turn (RAG pipeline
 * steps, or Agent tool calls/LLM round-trips), so it can be persisted
 * afterward as one batch of rows referencing the assistant message once
 * that message actually exists (it doesn't yet while a turn is in
 * progress — that's created only after everything finishes).
 */
export class TimingCollector {
  private entries: TimingEntry[] = [];

  record(stage: string, durationMs: number) {
    this.entries.push({ stage, durationMs: Math.max(0, Math.round(durationMs)) });
  }

  async time<T>(stage: string, fn: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    try {
      return await fn();
    } finally {
      this.record(stage, Date.now() - startedAt);
    }
  }

  getAll(): TimingEntry[] {
    return this.entries;
  }
}

/** Aggregates stage_timings for the dashboard: average/min/max per stage,
 *  plus a daily trend of average total turn duration for the last 14 days. */
export async function getTimingStats(): Promise<{
  byStage: StageTimingRow[];
  dailyTrend: TimingDailyPoint[];
}> {
  const db = getDb();

  const byStageRows = await db
    .select({
      stage: stageTimingsTable.stage,
      avgDurationMs: sql<string>`avg(${stageTimingsTable.durationMs})`,
      count: sql<string>`count(*)`,
      minDurationMs: sql<string>`min(${stageTimingsTable.durationMs})`,
      maxDurationMs: sql<string>`max(${stageTimingsTable.durationMs})`,
    })
    .from(stageTimingsTable)
    .groupBy(stageTimingsTable.stage)
    .orderBy(sql`avg(${stageTimingsTable.durationMs}) desc`);

  const dailyTrendRows = await db
    .select({
      date: sql<string>`to_char(date_trunc('day', ${stageTimingsTable.createdAt}), 'YYYY-MM-DD')`,
      avgDurationMs: sql<string>`avg(${stageTimingsTable.durationMs})`,
    })
    .from(stageTimingsTable)
    .where(eq(stageTimingsTable.stage, "total"))
    .groupBy(sql`date_trunc('day', ${stageTimingsTable.createdAt})`)
    .orderBy(sql`date_trunc('day', ${stageTimingsTable.createdAt}) desc`)
    .limit(14);

  return {
    byStage: byStageRows.map((r) => ({
      stage: r.stage,
      avgDurationMs: Math.round(Number(r.avgDurationMs)),
      count: Number(r.count),
      minDurationMs: Number(r.minDurationMs),
      maxDurationMs: Number(r.maxDurationMs),
    })),
    dailyTrend: dailyTrendRows
      .map((r) => ({ date: r.date, avgDurationMs: Math.round(Number(r.avgDurationMs)) }))
      .reverse(), // oldest -> newest, for left-to-right chart reading
  };
}

export async function persistTimings(
  chatId: string,
  messageId: number,
  mode: "rag" | "agent",
  entries: TimingEntry[]
) {
  if (entries.length === 0) return;
  try {
    const db = getDb();
    await db.insert(stageTimingsTable).values(
      entries.map((e) => ({
        chatId,
        messageId,
        mode,
        stage: e.stage,
        durationMs: e.durationMs,
      }))
    );
  } catch (err) {
    console.error("Failed to persist stage timings:", err);
  }
}
