import { and, asc, eq, gt } from "drizzle-orm";
import { getDb, chatsTable, chatMessagesTable } from "@/db";

export type HistoryMessage = { role: "user" | "assistant"; content: string };

/** Turns the first message of a new chat into a short, readable title. */
export function deriveTitle(query: string): string {
  const clean = query.trim().replace(/\s+/g, " ");
  const MAX = 60;
  if (clean.length <= MAX) return clean || "New chat";

  const cut = clean.slice(0, MAX);
  const lastSpace = cut.lastIndexOf(" ");
  const trimmed = lastSpace > 20 ? cut.slice(0, lastSpace) : cut;
  return `${trimmed}…`;
}

/**
 * Loads the context a chat should use for its next turn: any standing
 * summary from compaction, plus every message since the last compaction
 * (verbatim). Does not include the message currently being answered.
 */
export async function loadChatContext(
  chatId: string
): Promise<{ history: HistoryMessage[]; summary: string | null }> {
  const db = getDb();
  const [chat] = await db.select().from(chatsTable).where(eq(chatsTable.id, chatId));
  if (!chat) return { history: [], summary: null };

  const afterId = chat.summarizedThroughId ?? 0;
  const rows = await db
    .select({ role: chatMessagesTable.role, content: chatMessagesTable.content })
    .from(chatMessagesTable)
    .where(and(eq(chatMessagesTable.chatId, chatId), gt(chatMessagesTable.id, afterId)))
    .orderBy(asc(chatMessagesTable.id));

  return {
    history: rows.map((r) => ({ role: r.role as "user" | "assistant", content: r.content })),
    summary: chat.summary,
  };
}
