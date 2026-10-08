import { and, asc, eq, gt } from "drizzle-orm";
import { getDb, chatsTable, chatMessagesTable } from "@/db";
import { getOpenRouter } from "./clients";
import { getSettings } from "./settings";
import { logApiCall } from "./usage";
import { openrouterLimiter } from "./rate-limiter";
import { contextLimitsFor, conversationTokens, estimateTokens } from "./context-budget";

// Compaction: when a chat's conversation no longer fits its share of the
// model's context window (lib/rag/context-budget.ts), older messages are
// folded into a running summary, and only the summary plus the recent
// messages are sent from then on. The full transcript stays in the
// database and on screen; only what the model is sent changes.
//
// It runs before a turn whose request wouldn't fit (app/api/chat), or on
// demand ("Compact now" under the prompt bar).

/** Recent messages kept verbatim: up to this share of the budget... */
const KEEP_RECENT_SHARE = 0.3;
/** ...but always at least the last exchange. */
const MIN_KEEP_MESSAGES = 2;

const SUMMARY_SYSTEM_PROMPT = (maxWords: number) =>
  `You maintain a running summary of an ongoing conversation between a person and an assistant that answers questions about the person's documents. The summary replaces the older part of the conversation for the assistant, so keep everything needed to continue it: specific facts, figures, names, document titles, decisions, open questions, and the person's stated preferences. If a prior summary is given, merge it with the new segment into one updated summary rather than listing them separately. Stay under ${maxWords} words. Output only the summary text, nothing else.`;

export type CompactionResult = {
  compacted: boolean;
  /** Messages folded into the summary. */
  foldedMessages: number;
  /** Summarization calls made (one per batch). */
  llmCalls: number;
};

type CompactOptions = {
  /** Fold even when the conversation still fits ("Compact now"). */
  force?: boolean;
  /** The question about to be sent, counted toward the budget. */
  pending?: string;
  abortSignal?: AbortSignal;
};

// One compaction at a time per chat: a second request waits for the first
// and then re-checks, instead of both folding the same messages.
const running = new Map<string, Promise<CompactionResult>>();

export function compactChat(chatId: string, options: CompactOptions = {}): Promise<CompactionResult> {
  const previous = running.get(chatId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => runCompaction(chatId, options));
  running.set(chatId, next);
  const cleanup = () => {
    if (running.get(chatId) === next) running.delete(chatId);
  };
  next.then(cleanup, cleanup);
  return next;
}

/**
 * Which messages to fold: everything except the recent ones that fit the
 * kept share of the budget. `minimal` keeps only the last exchange, for
 * compacting on demand.
 */
export function splitForCompaction<T extends { role: string; content: string }>(
  messages: T[],
  budgetTokens: number,
  minimal = false
): { fold: T[]; keep: T[] } {
  const keepBudget = minimal ? 0 : budgetTokens * KEEP_RECENT_SHARE;
  let keepFrom = messages.length;
  let kept = 0;
  while (keepFrom > 0) {
    const tokens = conversationTokens(null, [messages[keepFrom - 1]]);
    const mustKeep = messages.length - keepFrom < MIN_KEEP_MESSAGES;
    if (!mustKeep && kept + tokens > keepBudget) break;
    kept += tokens;
    keepFrom--;
  }
  // Start the kept part at a question, not halfway through an exchange.
  while (keepFrom < messages.length - 1 && messages[keepFrom].role !== "user") keepFrom++;
  return { fold: messages.slice(0, keepFrom), keep: messages.slice(keepFrom) };
}

/** Groups messages into batches small enough to summarize in one request. */
export function batchForSummary<T extends { content: string }>(messages: T[], maxTokens: number): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let size = 0;
  for (const m of messages) {
    const tokens = estimateTokens(m.content);
    if (current.length && size + tokens > maxTokens) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(m);
    size += tokens;
  }
  if (current.length) batches.push(current);
  return batches;
}

async function runCompaction(chatId: string, options: CompactOptions): Promise<CompactionResult> {
  const none: CompactionResult = { compacted: false, foldedMessages: 0, llmCalls: 0 };
  const db = getDb();
  const [chat] = await db.select().from(chatsTable).where(eq(chatsTable.id, chatId));
  if (!chat) return none;

  const settings = await getSettings();
  const limits = await contextLimitsFor(settings.openrouterModel);

  const messages = await db
    .select({ id: chatMessagesTable.id, role: chatMessagesTable.role, content: chatMessagesTable.content })
    .from(chatMessagesTable)
    .where(
      and(
        eq(chatMessagesTable.chatId, chatId),
        gt(chatMessagesTable.id, chat.summarizedThroughId ?? 0),
        eq(chatMessagesTable.isActiveVersion, true)
      )
    )
    .orderBy(asc(chatMessagesTable.id));

  const fits = conversationTokens(chat.summary, messages, options.pending) <= limits.budgetTokens;
  if (fits && !options.force) return none;

  // On demand, fold as much as possible; otherwise keep a useful recent
  // stretch verbatim, so compaction doesn't come back every turn.
  const { fold } = splitForCompaction(messages, limits.budgetTokens, !!options.force && fits);
  if (fold.length === 0) return none;

  // Each summarization request has to fit the model too: the prior
  // summary plus a batch of messages, with room for the new summary.
  const summaryTokens = Math.max(300, Math.round(limits.budgetTokens * 0.15));
  const batchTokens = Math.max(2_000, Math.min(Math.floor(limits.windowTokens * 0.5) - summaryTokens, 24_000));
  const maxMessageChars = Math.floor(batchTokens * 3.5 * 0.9);

  const openrouter = getOpenRouter();
  let summary = chat.summary;
  let llmCalls = 0;
  let folded = 0;

  for (const batch of batchForSummary(fold, batchTokens)) {
    const transcript = batch
      .map((m) => {
        const text = m.content.length > maxMessageChars ? `${m.content.slice(0, maxMessageChars)}…` : m.content;
        return `${m.role === "user" ? "User" : "Assistant"}: ${text}`;
      })
      .join("\n\n");

    await openrouterLimiter.waitForSlot(settings.openrouterPerMinuteCap);
    const response = await openrouter.chat.completions.create(
      {
        model: settings.openrouterModel,
        temperature: 0.2,
        messages: [
          { role: "system", content: SUMMARY_SYSTEM_PROMPT(Math.round(summaryTokens * 0.7)) },
          ...(summary ? [{ role: "user" as const, content: `Prior summary:\n${summary}` }] : []),
          { role: "user", content: `Conversation segment to fold in:\n\n${transcript}` },
        ],
      },
      { signal: options.abortSignal }
    );
    llmCalls++;
    logApiCall("openrouter", "compaction", { tokensUsed: response.usage?.total_tokens });

    const newSummary = response.choices[0]?.message?.content?.trim();
    if (!newSummary) throw new Error("The model returned an empty summary.");

    // Saved after every batch, so a failure part-way keeps the progress.
    summary = newSummary;
    folded += batch.length;
    await db
      .update(chatsTable)
      .set({ summary, summarizedThroughId: batch[batch.length - 1].id })
      .where(eq(chatsTable.id, chatId));
  }

  return { compacted: true, foldedMessages: folded, llmCalls };
}
