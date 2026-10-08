import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Context tracking and compaction through the real /api/chat route,
// against Postgres, with a stubbed model whose context window is small
// enough to fill in a few messages.
const url = process.env.TEST_DATABASE_URL;
const TAG = `ctx-${Date.now()}`;

vi.mock("@/lib/rag/embeddings", () => ({
  EMBEDDING_DIMENSIONS: 384,
  LEGACY_EMBEDDING_MODEL: "legacy-model",
  currentEmbeddingModel: () => "test-model",
  generateEmbedding: async () => [1, ...new Array(383).fill(0)],
  generateEmbeddings: async (ts: string[]) => ts.map(() => [1, ...new Array(383).fill(0)]),
}));

// 8k window: a 2k-token conversation budget (lib/rag/context-budget.ts).
vi.mock("@/lib/agent/model-check", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent/model-check")>()),
  getContextWindow: async () => 8_000,
}));

// Records every request: summaries (not streamed) and answers (streamed).
const calls: { stream: boolean; prompt: string }[] = [];
vi.mock("@/lib/rag/clients", () => ({
  getOpenRouter: () => ({
    chat: {
      completions: {
        create: async (req: any) => {
          const prompt = JSON.stringify(req.messages);
          calls.push({ stream: !!req.stream, prompt });
          if (!req.stream) {
            return { choices: [{ message: { content: `SUMMARY#${calls.length}` } }], usage: { total_tokens: 50 } };
          }
          return (async function* () {
            yield { choices: [{ delta: { content: "An answer." } }] };
            yield { choices: [], usage: { prompt_tokens: 1234, total_tokens: 1300 } };
          })();
        },
      },
    },
  }),
  getCohere: () => null,
  getAgentModel: () => null,
}));

async function ask(body: object) {
  const { POST } = await import("@/app/api/chat/route");
  const { NextRequest } = await import("next/server");
  const res = await POST(new NextRequest("http://localhost/api/chat", { method: "POST", body: JSON.stringify(body) }));
  return (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
}

const long = (marker: string) => `${marker} ${"lorem ipsum dolor sit amet ".repeat(55)}`; // ~430 tokens

describe.skipIf(!url)("context tracking and compaction (real Postgres)", () => {
  let db: any;
  let schema: typeof import("@/db");
  let orm: typeof import("drizzle-orm");

  async function makeChat(title: string, messages: { role: string; content: string; isActiveVersion?: boolean }[]) {
    const [chat] = await db.insert(schema.chatsTable).values({ title: `${TAG} ${title}` }).returning();
    for (const m of messages) await db.insert(schema.chatMessagesTable).values({ chatId: chat.id, ...m });
    return chat.id as string;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    schema = await import("@/db");
    orm = await import("drizzle-orm");
    db = schema.getDb();
    const { updateSettings } = await import("@/lib/rag/settings");
    await updateSettings({ queryOptimization: "off", rerankMethod: "off", openrouterModel: "test/model" } as any);
    const [doc] = await db
      .insert(schema.documentsTable)
      .values({ name: `${TAG}.txt`, fileType: "txt", status: "ready", embeddingModel: "test-model" })
      .returning();
    await db.insert(schema.chunksTable).values({
      documentId: doc.id,
      chunkIndex: 0,
      content: "Some passage.",
      embedding: [1, ...new Array(383).fill(0)],
    });
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(schema.documentsTable).where(orm.like(schema.documentsTable.name, `${TAG}%`));
    await db.delete(schema.chatsTable).where(orm.like(schema.chatsTable.title, `${TAG}%`));
  });

  it("sends the whole conversation while it fits, and reports how full it is", async () => {
    // 10 short messages: more than the 6 that used to be sent.
    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      content: `short message M${i}`,
    }));
    const chatId = await makeChat("fits", messages);
    calls.length = 0;

    const events = await ask({ chatId, query: "next question", mode: "rag" });

    expect(events.some((e) => e.stage === "compacting")).toBe(false);
    expect(calls.filter((c) => !c.stream)).toHaveLength(0);
    const answerPrompt = calls.find((c) => c.stream)!.prompt;
    for (let i = 0; i < 10; i++) expect(answerPrompt).toContain(`M${i}`);

    const context = events.find((e) => e.type === "context")!.context;
    expect(context).toMatchObject({ windowTokens: 8_000, windowKnown: true, budgetTokens: 2_000, messageCount: 12 });
    expect(context.usedTokens).toBeGreaterThan(0);
    expect(context.usedTokens).toBeLessThan(context.budgetTokens);
    // The real prompt size OpenRouter reported is saved with the answer.
    expect(context.lastPromptTokens).toBe(1234);
  });

  it("compacts before a turn that wouldn't fit, ignoring edited-away messages", async () => {
    const chatId = await makeChat("full", [
      { role: "user", content: long("FIRST") },
      { role: "assistant", content: long("A1") },
      { role: "user", content: long("EDITED_AWAY"), isActiveVersion: false },
      { role: "assistant", content: long("EDITED_AWAY_REPLY"), isActiveVersion: false },
      { role: "user", content: long("Q2") },
      { role: "assistant", content: long("A2") },
      { role: "user", content: long("Q3") },
      { role: "assistant", content: long("LAST_REPLY") },
    ]);
    calls.length = 0;

    const events = await ask({ chatId, query: "and now?", mode: "rag" });

    expect(events.some((e) => e.type === "stage" && e.stage === "compacting")).toBe(true);
    expect(events.some((e) => e.type === "error")).toBe(false);

    const summaries = calls.filter((c) => !c.stream);
    expect(summaries.length).toBeGreaterThan(0);
    expect(summaries.map((c) => c.prompt).join()).toContain("FIRST");
    expect(calls.map((c) => c.prompt).join()).not.toContain("EDITED_AWAY");

    // The answer gets the summary plus the most recent messages, not the folded ones.
    const answerPrompt = calls.find((c) => c.stream)!.prompt;
    expect(answerPrompt).toContain(`SUMMARY#${summaries.length}`);
    expect(answerPrompt).toContain("LAST_REPLY");
    expect(answerPrompt).not.toContain("FIRST");

    const [chat] = await db.select().from(schema.chatsTable).where(orm.eq(schema.chatsTable.id, chatId));
    expect(chat.summary).toBe(`SUMMARY#${summaries.length}`);
    expect(chat.summarizedThroughId).toBeTruthy();

    const context = events.find((e) => e.type === "context")!.context;
    expect(context.summarized).toBe(true);
    expect(context.usedTokens).toBeLessThanOrEqual(context.budgetTokens);

    // The summary calls count toward the answer's LLM calls.
    const usage = events.find((e) => e.type === "usage")!;
    expect(usage.apiCallCount).toBe(summaries.length + 1);
  });

  it("compacts on demand, and the chat API reports the context", async () => {
    const chatId = await makeChat("manual", [
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "a2" },
    ]);
    const { NextRequest } = await import("next/server");
    const { POST } = await import("@/app/api/chats/[id]/compact/route");
    const res = await POST(new NextRequest(`http://localhost/api/chats/${chatId}/compact`, { method: "POST" }), {
      params: { id: chatId },
    });
    const json = await res.json();
    expect(json).toMatchObject({ compacted: true, foldedMessages: 2 });
    expect(json.context).toMatchObject({ summarized: true, messageCount: 2 });

    const { GET } = await import("@/app/api/chats/[id]/route");
    const chat = await (await GET(new NextRequest(`http://localhost/api/chats/${chatId}`), { params: { id: chatId } })).json();
    expect(chat.context).toMatchObject({ budgetTokens: 2_000, messageCount: 2, summarized: true });
  });
});
