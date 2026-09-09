import { sql } from "drizzle-orm";
import { getDb, toolCallLogTable } from "@/db";
import type { ToolUsageRow } from "@/types";

export async function getToolUsage(): Promise<ToolUsageRow[]> {
  const db = getDb();

  const rows = await db
    .select({
      toolName: toolCallLogTable.toolName,
      calls: sql<number>`count(*)`,
      successes: sql<number>`count(*) filter (where ${toolCallLogTable.success})`,
      lastUsed: sql<string>`max(${toolCallLogTable.createdAt})`,
    })
    .from(toolCallLogTable)
    .groupBy(toolCallLogTable.toolName)
    .orderBy(sql`count(*) desc`);

  return rows.map((r) => ({
    toolName: r.toolName,
    calls: Number(r.calls),
    successRate: Number(r.calls) > 0 ? Number(r.successes) / Number(r.calls) : 0,
    lastUsed: r.lastUsed,
  }));
}
