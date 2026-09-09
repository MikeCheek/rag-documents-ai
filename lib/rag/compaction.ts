import { and, asc, eq, gt } from "drizzle-orm";
import { getDb, chatsTable, chatMessagesTable } from "@/db";
import { getOpenRouter } from "./clients";
import { getSettings } from "./settings";
import { logApiCall } from "./usage";

// Once a chat has this many messages since its last compaction, fold all
// but the most recent ones into a running summary. Keeps the context sent
// to the LLM (and the tokens billed) bounded, no matter how long a chat gets.
const COMPACT_TRIGGER_MESSAGES = 24;
const KEEP_RECENT_MESSAGES = 8;

const SUMMARY_SYSTEM_PROMPT = `You maintain a running summary of an ongoing conversation between a person and an assistant that answers questions about the person's documents. Write a concise summary of the conversation segment given, preserving specific facts, figures, names, and decisions. If a prior summary is given, merge it with the new segment into one updated summary rather than listing them separately. Output only the summary text, nothing else.`;

/**
 * Best-effort: summarizes older messages in a chat once it gets long, and
 * advances `summarizedThroughId` so future turns use the summary instead of
 * the full transcript. Never throws — a failure here just means the next
 * turn sends a longer context, not that the chat breaks.
 */
export async function maybeCompactChat(chatId: string): Promise<void> {
  try {
    const db = getDb();
    const [chat] = await db.select().from(chatsTable).where(eq(chatsTable.id, chatId));
    if (!chat) return;

    const afterId = chat.summarizedThroughId ?? 0;
    const uncompacted = await db
      .select()
      .from(chatMessagesTable)
      .where(and(eq(chatMessagesTable.chatId, chatId), gt(chatMessagesTable.id, afterId)))
      .orderBy(asc(chatMessagesTable.id));

    if (uncompacted.length < COMPACT_TRIGGER_MESSAGES) return;

    const toFold = uncompacted.slice(0, uncompacted.length - KEEP_RECENT_MESSAGES);
    if (toFold.length === 0) return;

    const transcript = toFold
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");

    const openrouter = getOpenRouter();
    const settings = await getSettings();
    const response = await openrouter.chat.completions.create({
      model: settings.openrouterModel,
      temperature: 0.2,
      messages: [
        { role: "system", content: SUMMARY_SYSTEM_PROMPT },
        ...(chat.summary
          ? [{ role: "user" as const, content: `Prior summary:\n${chat.summary}` }]
          : []),
        { role: "user", content: `Conversation segment to fold in:\n\n${transcript}` },
      ],
    });

    logApiCall("openrouter", "compaction", { tokensUsed: response.usage?.total_tokens });

    const newSummary = response.choices[0]?.message?.content?.trim();
    if (!newSummary) return;

    const lastFoldedId = toFold[toFold.length - 1].id;
    await db
      .update(chatsTable)
      .set({ summary: newSummary, summarizedThroughId: lastFoldedId })
      .where(eq(chatsTable.id, chatId));
  } catch (err) {
    console.error("Chat compaction failed:", err);
  }
}
