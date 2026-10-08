// How much of the model's context window a chat's conversation may use,
// and how much it uses now.
//
// Every request sends the conversation so far (the compaction summary,
// plus every message since it) on top of fixed parts: the system prompt,
// retrieved passages or tool results, and room for the answer. The
// conversation's share is the "budget" below; when the next request would
// go over it, older messages are folded into the summary first
// (lib/rag/compaction.ts), so the request always fits.

import { getContextWindow } from "@/lib/agent/model-check";

/** Used when the model's window isn't known, e.g. for the openrouter/free auto-router. */
export const DEFAULT_CONTEXT_WINDOW = 32_768;

/**
 * Even on models with huge windows, the conversation is compacted past
 * this: every token of history is re-sent (and billed) on every turn,
 * and answers get slower and less focused long before 1M tokens.
 */
export const MAX_CONVERSATION_TOKENS = 64_000;

/**
 * A conservative token estimate: about 3.5 characters per token. Real
 * tokenizers vary by model and language; overestimating a little means
 * compacting slightly early rather than overflowing the window.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/** Per-message overhead (role markers and separators) on top of its text. */
const MESSAGE_OVERHEAD_TOKENS = 4;

export type HistoryLike = { content: string }[];

/** Estimated tokens the conversation part of the next request takes. */
export function conversationTokens(summary: string | null, history: HistoryLike, pending = ""): number {
  let total = summary ? estimateTokens(summary) + MESSAGE_OVERHEAD_TOKENS : 0;
  for (const m of history) total += estimateTokens(m.content) + MESSAGE_OVERHEAD_TOKENS;
  if (pending) total += estimateTokens(pending) + MESSAGE_OVERHEAD_TOKENS;
  return total;
}

/**
 * The conversation's share of a context window. The rest (35%, between
 * 6k and 40k tokens) is kept for the system prompt, retrieved passages or
 * tool results, and the answer.
 */
export function conversationBudget(windowTokens: number): number {
  const reserve = Math.min(Math.max(Math.round(windowTokens * 0.35), 6_000), 40_000);
  return Math.max(2_000, Math.min(windowTokens - reserve, MAX_CONVERSATION_TOKENS));
}

export type ContextLimits = {
  model: string;
  /** The model's context window, or DEFAULT_CONTEXT_WINDOW when unknown. */
  windowTokens: number;
  windowKnown: boolean;
  budgetTokens: number;
};

export async function contextLimitsFor(model: string): Promise<ContextLimits> {
  const known = await getContextWindow(model);
  const windowTokens = known ?? DEFAULT_CONTEXT_WINDOW;
  return { model, windowTokens, windowKnown: known !== null, budgetTokens: conversationBudget(windowTokens) };
}
