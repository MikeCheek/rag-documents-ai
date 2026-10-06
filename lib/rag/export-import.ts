import { eq } from "drizzle-orm";
import {
  getDb,
  documentsTable,
  chunksTable,
  chatsTable,
  chatMessagesTable,
  agentMemoriesTable,
  agentToolsTable,
  settingsTable,
} from "@/db";

// A full backup of everything a person has actually created in this app —
// documents (with their chunks and embeddings, so a restore doesn't need
// to re-run the embedding model), chats and their messages, agent memory,
// and custom tools. `settings` is included for reference only and is
// never auto-applied on import — the live deployment's own configuration
// (model, rate limits, etc.) isn't something an import should silently
// overwrite.
export const EXPORT_VERSION = 1;

export type ExportBundle = {
  version: number;
  exportedAt: string;
  documents: Array<{
    id: string;
    name: string;
    fileType: string;
    status: string;
    chunkCount: number;
    charCount: number;
    createdAt: string;
    chunks: Array<{
      chunkIndex: number;
      content: string;
      embedding: number[] | null;
      usageCount: number;
      // Optional so export files from before page tracking still import.
      pageStart?: number | null;
      pageEnd?: number | null;
    }>;
  }>;
  chats: Array<{
    id: string;
    title: string;
    pinned: boolean;
    createdAt: string;
    updatedAt: string;
    messages: Array<{
      role: string;
      content: string;
      mode: string;
      sources: unknown;
      rerankMethod: string | null;
      agentSteps: unknown;
      apiCallCount: number | null;
      durationMs: number | null;
      createdAt: string;
    }>;
  }>;
  agentMemories: Array<{ content: string; createdAt: string }>;
  agentTools: Array<{
    name: string;
    description: string;
    method: string;
    urlTemplate: string;
    parameters: unknown;
    headers: unknown;
    enabled: boolean;
  }>;
  settingsForReference: Record<string, unknown> | null;
};

export async function exportAllData(): Promise<ExportBundle> {
  const db = getDb();

  const [documents, allChunks, chats, allMessages, agentMemories, agentTools, settingsRows] =
    await Promise.all([
      db.select().from(documentsTable),
      db.select().from(chunksTable),
      db.select().from(chatsTable),
      db.select().from(chatMessagesTable).where(eq(chatMessagesTable.isActiveVersion, true)),
      db.select().from(agentMemoriesTable),
      db.select().from(agentToolsTable),
      db.select().from(settingsTable),
    ]);

  const chunksByDoc = new Map<string, typeof allChunks>();
  for (const chunk of allChunks) {
    if (!chunksByDoc.has(chunk.documentId)) chunksByDoc.set(chunk.documentId, []);
    chunksByDoc.get(chunk.documentId)!.push(chunk);
  }

  const messagesByChat = new Map<string, typeof allMessages>();
  for (const msg of allMessages) {
    if (!messagesByChat.has(msg.chatId)) messagesByChat.set(msg.chatId, []);
    messagesByChat.get(msg.chatId)!.push(msg);
  }

  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    documents: documents.map((doc) => ({
      id: doc.id,
      name: doc.name,
      fileType: doc.fileType,
      status: doc.status,
      chunkCount: doc.chunkCount,
      charCount: doc.charCount,
      createdAt: doc.createdAt.toISOString(),
      chunks: (chunksByDoc.get(doc.id) ?? [])
        .sort((a, b) => a.chunkIndex - b.chunkIndex)
        .map((c) => ({
          chunkIndex: c.chunkIndex,
          content: c.content,
          embedding: c.embedding as number[] | null,
          usageCount: c.usageCount,
          pageStart: c.pageStart,
          pageEnd: c.pageEnd,
        })),
    })),
    chats: chats.map((chat) => ({
      id: chat.id,
      title: chat.title,
      pinned: chat.pinned,
      createdAt: chat.createdAt.toISOString(),
      updatedAt: chat.updatedAt.toISOString(),
      messages: (messagesByChat.get(chat.id) ?? [])
        .sort((a, b) => a.id - b.id)
        .map((m) => ({
          role: m.role,
          content: m.content,
          mode: m.mode,
          sources: m.sources,
          rerankMethod: m.rerankMethod,
          agentSteps: m.agentSteps,
          apiCallCount: m.apiCallCount,
          durationMs: m.durationMs,
          createdAt: m.createdAt.toISOString(),
        })),
    })),
    agentMemories: agentMemories.map((m) => ({
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
    agentTools: agentTools.map((t) => ({
      name: t.name,
      description: t.description,
      method: t.method,
      urlTemplate: t.urlTemplate,
      parameters: t.parameters,
      headers: t.headers,
      enabled: t.enabled,
    })),
    settingsForReference: settingsRows[0] ? { ...settingsRows[0] } : null,
  };
}

export type ImportSummary = {
  documents: number;
  chunks: number;
  chats: number;
  messages: number;
  agentMemories: number;
  agentTools: number;
  skippedTools: number;
};

/**
 * Imports a previously-exported bundle as *new* data — every document and
 * chat gets a fresh id (documents/chunks and chats/messages are inserted
 * together, so nothing needs to reference an id across separate imports)
 * rather than overwriting or merging with anything that already exists.
 * This is deliberately additive-only: there's no "replace everything"
 * mode here — that's what the Danger Zone is for, used before an import
 * if that's what's actually wanted.
 */
export async function importAllData(bundle: ExportBundle): Promise<ImportSummary> {
  if (!bundle || typeof bundle !== "object" || bundle.version !== EXPORT_VERSION) {
    throw new Error(
      `Unrecognized export file (expected version ${EXPORT_VERSION}). It may be from an incompatible version of this app.`
    );
  }

  const db = getDb();
  const summary: ImportSummary = {
    documents: 0,
    chunks: 0,
    chats: 0,
    messages: 0,
    agentMemories: 0,
    agentTools: 0,
    skippedTools: 0,
  };

  for (const doc of bundle.documents ?? []) {
    const [inserted] = await db
      .insert(documentsTable)
      .values({
        name: doc.name,
        fileType: doc.fileType,
        status: doc.status,
        chunkCount: doc.chunkCount,
        charCount: doc.charCount,
        createdAt: new Date(doc.createdAt),
      })
      .returning({ id: documentsTable.id });

    summary.documents++;

    if (doc.chunks?.length) {
      await db.insert(chunksTable).values(
        doc.chunks.map((c) => ({
          documentId: inserted.id,
          chunkIndex: c.chunkIndex,
          content: c.content,
          embedding: c.embedding ?? undefined,
          usageCount: c.usageCount ?? 0,
          pageStart: c.pageStart ?? null,
          pageEnd: c.pageEnd ?? null,
        }))
      );
      summary.chunks += doc.chunks.length;
    }

    // Re-derive the centroid rather than trust an exported one — it's
    // cheap (the embeddings are already right here) and avoids importing
    // a stale value if this document's chunks changed between versions.
    if (doc.chunks?.length) {
      const { computeCentroid } = await import("./clustering");
      const centroid = computeCentroid(
        doc.chunks.map((c) => c.embedding).filter((e): e is number[] => !!e)
      );
      if (centroid.length > 0) {
        await db
          .update(documentsTable)
          .set({ centroidEmbedding: centroid })
          .where(eq(documentsTable.id, inserted.id));
      }
    }
  }

  for (const chat of bundle.chats ?? []) {
    const [inserted] = await db
      .insert(chatsTable)
      .values({
        title: chat.title,
        pinned: chat.pinned,
        createdAt: new Date(chat.createdAt),
        updatedAt: new Date(chat.updatedAt),
      })
      .returning({ id: chatsTable.id });

    summary.chats++;

    if (chat.messages?.length) {
      await db.insert(chatMessagesTable).values(
        chat.messages.map((m) => ({
          chatId: inserted.id,
          role: m.role,
          content: m.content,
          mode: m.mode,
          sources: m.sources ?? undefined,
          rerankMethod: m.rerankMethod ?? undefined,
          agentSteps: m.agentSteps ?? undefined,
          apiCallCount: m.apiCallCount ?? undefined,
          durationMs: m.durationMs ?? undefined,
          createdAt: new Date(m.createdAt),
        }))
      );
      summary.messages += chat.messages.length;
    }
  }

  if (bundle.agentMemories?.length) {
    await db.insert(agentMemoriesTable).values(
      bundle.agentMemories.map((m) => ({
        content: m.content,
        createdAt: new Date(m.createdAt),
      }))
    );
    summary.agentMemories = bundle.agentMemories.length;
  }

  for (const t of bundle.agentTools ?? []) {
    const inserted = await db
      .insert(agentToolsTable)
      .values({
        name: t.name,
        description: t.description,
        method: t.method,
        urlTemplate: t.urlTemplate,
        parameters: t.parameters as any,
        headers: t.headers as any,
        enabled: t.enabled,
      })
      .onConflictDoNothing({ target: agentToolsTable.name })
      .returning({ id: agentToolsTable.id });

    if (inserted.length > 0) summary.agentTools++;
    else summary.skippedTools++;
  }

  return summary;
}
