import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The real /api/chat route handler against Postgres, with the embedding
// model and OpenRouter stubbed: checks what the route actually does with a
// request, end to end (scope, sources, citation check, persistence).
const url = process.env.TEST_DATABASE_URL;
const TAG = `route-${Date.now()}`;

const TOPICS = ["mitochondria", "invoice"];
function fakeEmbedding(text: string): number[] {
  const v = new Array(384).fill(0);
  TOPICS.forEach((t, i) => text.toLowerCase().includes(t) && (v[i] = 1));
  if (v.every((x) => x === 0)) v[383] = 1;
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
}
vi.mock("@/lib/rag/embeddings", () => ({
  EMBEDDING_DIMENSIONS: 384,
  LEGACY_EMBEDDING_MODEL: "legacy-model",
  currentEmbeddingModel: () => "test-model",
  generateEmbedding: async (t: string) => fakeEmbedding(t),
  generateEmbeddings: async (ts: string[]) => ts.map(fakeEmbedding),
}));

// What the stubbed model "answers", and what it was asked.
const llm = { answer: "", lastPrompt: "" };
vi.mock("@/lib/rag/clients", () => ({
  getOpenRouter: () => ({
    chat: {
      completions: {
        create: async (req: any) => {
          llm.lastPrompt = JSON.stringify(req.messages);
          return (async function* () {
            for (const word of llm.answer.split(/(?<= )/)) yield { choices: [{ delta: { content: word } }] };
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
  const res = await POST(
    new NextRequest("http://localhost/api/chat", { method: "POST", body: JSON.stringify(body) })
  );
  const text = await res.text();
  return text.trim().split("\n").map((l) => JSON.parse(l));
}

describe.skipIf(!url)("POST /api/chat (real Postgres)", () => {
  let db: any;
  let schema: typeof import("@/db");
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    schema = await import("@/db");
    db = schema.getDb();
    // Settings that make RAG mode fully local apart from the stubbed answer.
    const { updateSettings } = await import("@/lib/rag/settings");
    await updateSettings({ queryOptimization: "off", rerankMethod: "off" } as any);

    for (const [name, content] of [
      ["bio", "Mitochondria produce ATP for the cell."],
      ["bio2", "More notes about mitochondria and invoice-free biology."],
      ["inv", "Invoice 2024-17 totals 4,200 euros."],
    ]) {
      const [doc] = await db
        .insert(schema.documentsTable)
        .values({ name: `${TAG}-${name}.txt`, fileType: "txt", status: "ready", embeddingModel: "test-model" })
        .returning();
      ids[name] = doc.id;
      await db.insert(schema.chunksTable).values({
        documentId: doc.id,
        chunkIndex: 0,
        content,
        embedding: fakeEmbedding(content),
      });
    }
  });

  afterAll(async () => {
    if (!db) return;
    const { like } = await import("drizzle-orm");
    await db.delete(schema.documentsTable).where(like(schema.documentsTable.name, `${TAG}%`));
    await db.delete(schema.chatsTable).where(like(schema.chatsTable.title, `${TAG}%`));
  });

  it("answers from every document by default", async () => {
    llm.answer = "Mitochondria produce ATP for the cell [1].";
    const events = await ask({ query: `${TAG} mitochondria`, mode: "rag" });
    const sources = events.find((e) => e.type === "sources").sources;
    expect(new Set(sources.map((s: any) => s.documentId))).toEqual(new Set([ids.bio, ids.bio2]));
  });

  it("only searches the documents in the 'Search in' scope", async () => {
    llm.answer = "Invoice 2024-17 totals 4,200 euros [1].";
    const events = await ask({ query: `${TAG} mitochondria invoice`, mode: "rag", documentIds: [ids.inv] });
    const sources = events.find((e) => e.type === "sources").sources;
    expect(sources.map((s: any) => s.documentId)).toEqual([ids.inv]);
    expect(llm.lastPrompt).toContain("Invoice 2024-17");
    expect(llm.lastPrompt).not.toContain("Mitochondria produce ATP");

    // The scope is saved on the question, with names, for the "Searched in" chip.
    const chatId = events.find((e) => e.type === "chat").chat.id;
    const { and, eq } = await import("drizzle-orm");
    const [question] = await db
      .select()
      .from(schema.chatMessagesTable)
      .where(and(eq(schema.chatMessagesTable.chatId, chatId), eq(schema.chatMessagesTable.role, "user")));
    expect(question.documentScope).toEqual([{ id: ids.inv, name: `${TAG}-inv.txt` }]);
  });

  it("saves the answer with its citation check", async () => {
    llm.answer = "Invoice 2024-17 totals 9,900 euros [1].";
    const events = await ask({ query: `${TAG} invoice total`, mode: "rag", documentIds: [ids.inv] });
    const check = events.find((e) => e.type === "citation_check").citationCheck;
    expect(check.issues.map((i: any) => i.kind)).toEqual(["numbers_not_found"]);
    const chatId = events.find((e) => e.type === "chat").chat.id;
    const { eq } = await import("drizzle-orm");
    const msgs = await db.select().from(schema.chatMessagesTable).where(eq(schema.chatMessagesTable.chatId, chatId));
    expect(msgs.find((m: any) => m.role === "assistant").citationCheck.issues).toHaveLength(1);
  });
});
