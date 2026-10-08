import { describe, expect, it } from "vitest";
import { conversationBudget, conversationTokens, estimateTokens, MAX_CONVERSATION_TOKENS } from "@/lib/rag/context-budget";
import { batchForSummary, splitForCompaction } from "@/lib/rag/compaction";

describe("context budget", () => {
  it("keeps a reserve for passages and the answer", () => {
    expect(conversationBudget(8_000)).toBe(2_000); // 6k minimum reserve
    expect(conversationBudget(32_768)).toBe(32_768 - Math.round(32_768 * 0.35));
    expect(conversationBudget(131_072)).toBe(Math.min(131_072 - 40_000, MAX_CONVERSATION_TOKENS));
    expect(conversationBudget(1_000_000)).toBe(MAX_CONVERSATION_TOKENS);
  });

  it("estimates the conversation including the summary and the pending question", () => {
    const history = [{ content: "a".repeat(350) }, { content: "b".repeat(35) }];
    expect(estimateTokens("a".repeat(350))).toBe(100);
    expect(conversationTokens(null, history)).toBe(100 + 4 + 10 + 4);
    expect(conversationTokens("s".repeat(35), history, "q".repeat(7))).toBe(10 + 4 + 118 + 2 + 4);
  });
});

describe("splitForCompaction", () => {
  const msg = (role: string, tokens: number) => ({ role, content: "x".repeat(Math.round(tokens * 3.5)) });

  it("keeps the recent messages that fit 30% of the budget, starting at a question", () => {
    const messages = [msg("user", 300), msg("assistant", 300), msg("user", 200), msg("assistant", 200), msg("user", 50), msg("assistant", 50)];
    // Budget 1000: keep up to 300 tokens -> the last two (≈108), not the 200s.
    const { fold, keep } = splitForCompaction(messages, 1_000);
    expect(keep).toHaveLength(2);
    expect(keep[0].role).toBe("user");
    expect(fold).toHaveLength(4);
  });

  it("always keeps the last exchange, even if it's large", () => {
    const messages = [msg("user", 100), msg("assistant", 100), msg("user", 900), msg("assistant", 900)];
    const { fold, keep } = splitForCompaction(messages, 1_000);
    expect(keep).toHaveLength(2);
    expect(fold).toHaveLength(2);
  });

  it("keeps only the last exchange when asked for a minimal split", () => {
    const messages = [msg("user", 10), msg("assistant", 10), msg("user", 10), msg("assistant", 10)];
    expect(splitForCompaction(messages, 1_000).fold).toHaveLength(0);
    const { fold, keep } = splitForCompaction(messages, 1_000, true);
    expect(fold).toHaveLength(2);
    expect(keep).toHaveLength(2);
  });

  it("has nothing to fold in a single exchange", () => {
    expect(splitForCompaction([msg("user", 5_000), msg("assistant", 5_000)], 1_000).fold).toHaveLength(0);
  });
});

describe("batchForSummary", () => {
  it("splits messages into batches under the size limit", () => {
    const m = (tokens: number) => ({ content: "x".repeat(tokens * 3.5) });
    const batches = batchForSummary([m(400), m(400), m(400), m(900), m(100)], 1_000);
    expect(batches.map((b) => b.length)).toEqual([2, 1, 2]);
  });
});
