import { and, asc, desc, eq, gt } from "drizzle-orm";
import { getDb, chatsTable, chatMessagesTable } from "@/db";
import type { ContextUsage } from "@/types";
import { contextLimitsFor, conversationTokens } from "./context-budget";

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
 *
 * Only the current version of edited messages counts: a question that was
 * edited away, and its answer, aren't part of the conversation anymore.
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
    .where(
      and(
        eq(chatMessagesTable.chatId, chatId),
        gt(chatMessagesTable.id, afterId),
        eq(chatMessagesTable.isActiveVersion, true)
      )
    )
    .orderBy(asc(chatMessagesTable.id));

  return {
    history: rows.map((r) => ({ role: r.role as "user" | "assistant", content: r.content })),
    summary: chat.summary,
  };
}

/**
 * How full the chat's context is: what the conversation part of its next
 * request would take, against the current model's budget for it, plus the
 * real prompt size OpenRouter reported for its last answer.
 */
export async function getContextUsage(chatId: string, model: string): Promise<ContextUsage> {
  const db = getDb();
  const [{ history, summary }, limits, [last]] = await Promise.all([
    loadChatContext(chatId),
    contextLimitsFor(model),
    db
      .select({ promptTokens: chatMessagesTable.promptTokens })
      .from(chatMessagesTable)
      .where(
        and(
          eq(chatMessagesTable.chatId, chatId),
          eq(chatMessagesTable.role, "assistant"),
          eq(chatMessagesTable.isActiveVersion, true)
        )
      )
      .orderBy(desc(chatMessagesTable.id))
      .limit(1),
  ]);
  return {
    ...limits,
    usedTokens: conversationTokens(summary, history),
    messageCount: history.length,
    summarized: !!summary,
    lastPromptTokens: last?.promptTokens ?? null,
  };
}
