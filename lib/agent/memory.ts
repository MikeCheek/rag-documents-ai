import { desc, eq } from "drizzle-orm";
import { getDb, agentMemoriesTable } from "@/db";
import type { AgentMemory } from "@/types";

const MAX_CONTENT_LENGTH = 500;

function rowToMemory(row: typeof agentMemoriesTable.$inferSelect): AgentMemory {
  return {
    id: row.id,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listMemories(): Promise<AgentMemory[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(agentMemoriesTable)
    .orderBy(desc(agentMemoriesTable.createdAt));
  return rows.map(rowToMemory);
}

export async function saveMemory(content: string): Promise<AgentMemory> {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("content is required");

  const db = getDb();
  const [row] = await db
    .insert(agentMemoriesTable)
    .values({ content: trimmed.slice(0, MAX_CONTENT_LENGTH) })
    .returning();
  return rowToMemory(row);
}

export async function deleteMemory(id: string): Promise<boolean> {
  const db = getDb();
  const deleted = await db
    .delete(agentMemoriesTable)
    .where(eq(agentMemoriesTable.id, id))
    .returning({ id: agentMemoriesTable.id });
  return deleted.length > 0;
}

/** Renders the current memory list for inclusion in the agent system prompt. */
export function formatMemoriesForPrompt(memories: AgentMemory[]): string {
  if (memories.length === 0) {
    return "Nothing has been saved to memory yet.";
  }
  return memories.map((m) => `- (${m.id}) ${m.content}`).join("\n");
}
