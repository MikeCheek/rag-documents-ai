import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Real export -> import round trip against Postgres (see
// retrieve.integration.test.ts for TEST_DATABASE_URL). Only looks at rows
// tagged with this run's unique marker, since other test files share the
// database and run in parallel.
const url = process.env.TEST_DATABASE_URL;
const TAG = `rt-${Date.now()}`;

describe.skipIf(!url)("export/import round trip (real Postgres)", () => {
  let db: any;
  let schema: typeof import("@/db");
  let orm: typeof import("drizzle-orm");
  let exportAllData: typeof import("@/lib/rag/export-import").exportAllData;
  let importAllData: typeof import("@/lib/rag/export-import").importAllData;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    schema = await import("@/db");
    orm = await import("drizzle-orm");
    ({ exportAllData, importAllData } = await import("@/lib/rag/export-import"));
    db = schema.getDb();

    const [doc] = await db
      .insert(schema.documentsTable)
      .values({ name: `${TAG}.pdf`, fileType: "pdf", status: "ready", chunkCount: 2 })
      .returning();
    const embedding = Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0));
    await db.insert(schema.chunksTable).values([
      { documentId: doc.id, chunkIndex: 0, content: "First passage.", embedding, pageStart: 1, pageEnd: 1 },
      { documentId: doc.id, chunkIndex: 1, content: "Second passage.", embedding, pageStart: 1, pageEnd: 2 },
    ]);

    // A chat whose last question was edited once: the first version is
    // inactive, the second is the one the chat shows.
    const [chat] = await db.insert(schema.chatsTable).values({ title: TAG }).returning();
    const group = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const m = (role: string, content: string, extra: object = {}) => ({
      chatId: chat.id,
      role,
      content,
      mode: "rag",
      ...extra,
    });
    await db.insert(schema.chatMessagesTable).values([
      m("user", "hello"),
      m("assistant", "hi"),
      m("user", "original question", { editGroupId: group, isActiveVersion: false }),
      m("assistant", "original answer", { editGroupId: group, isActiveVersion: false }),
      m("user", "edited question", { editGroupId: group }),
      m("assistant", "edited answer", { editGroupId: group }),
    ]);
  });

  afterAll(async () => {
    if (!db) return;
    const { like } = orm;
    await db.delete(schema.documentsTable).where(like(schema.documentsTable.name, `${TAG}%`));
    await db.delete(schema.chatsTable).where(like(schema.chatsTable.title, `${TAG}%`));
  });

  it("restores documents with page ranges, and each chat's current conversation", async () => {
    const bundle = await exportAllData();
    const exportedChat = bundle.chats.find((c) => c.title === TAG)!;
    // Export keeps only the current version of an edited message, so the
    // backup is the conversation as it reads now, without the older
    // versions of the edited turn.
    expect(exportedChat.messages.map((x) => x.content)).toEqual(["hello", "hi", "edited question", "edited answer"]);

    // Round-trip through JSON, as the downloaded file would.
    const summary = await importAllData(JSON.parse(JSON.stringify({
      ...bundle,
      documents: bundle.documents.filter((d) => d.name === `${TAG}.pdf`),
      chats: [exportedChat],
      agentMemories: [],
      agentTools: [],
    })));
    expect(summary).toMatchObject({ documents: 1, chunks: 2, chats: 1, messages: 4 });

    const { and, asc, eq } = orm;
    const docs = await db.select().from(schema.documentsTable).where(eq(schema.documentsTable.name, `${TAG}.pdf`));
    expect(docs).toHaveLength(2);
    const imported = docs.find((d: any) => d.id !== bundle.documents.find((x) => x.name === `${TAG}.pdf`)!.id);
    const chunks = await db
      .select()
      .from(schema.chunksTable)
      .where(eq(schema.chunksTable.documentId, imported.id))
      .orderBy(asc(schema.chunksTable.chunkIndex));
    expect(chunks.map((c: any) => [c.content, c.pageStart, c.pageEnd])).toEqual([
      ["First passage.", 1, 1],
      ["Second passage.", 1, 2],
    ]);
    expect(imported.centroidEmbedding).toHaveLength(384);

    const chats = await db.select().from(schema.chatsTable).where(eq(schema.chatsTable.title, TAG));
    const newChat = chats.find((c: any) => c.id !== exportedChat.id);
    const messages = await db
      .select()
      .from(schema.chatMessagesTable)
      .where(and(eq(schema.chatMessagesTable.chatId, newChat.id), eq(schema.chatMessagesTable.isActiveVersion, true)))
      .orderBy(asc(schema.chatMessagesTable.id));
    expect(messages.map((x: any) => x.content)).toEqual(["hello", "hi", "edited question", "edited answer"]);
  });
});
