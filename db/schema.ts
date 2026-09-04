import {
  index,
  pgTable,
  serial,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  vector,
  uuid,
} from "drizzle-orm/pg-core";

// One row per uploaded source document (the original file).
export const documentsTable = pgTable("documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  fileType: text("file_type").notNull(),
  status: text("status").notNull().default("processing"), // processing | ready | failed
  error: text("error"),
  chunkCount: integer("chunk_count").notNull().default(0),
  charCount: integer("char_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// One row per chunk of a document, with its embedding vector.
// Xenova/all-MiniLM-L6-v2 outputs 384 dimensions.
export const chunksTable = pgTable(
  "chunks",
  {
    id: serial("id").primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documentsTable.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 384 }),
    usageCount: integer("usage_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    embeddingIndex: index("chunks_embedding_index").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops")
    ),
    documentIdIndex: index("chunks_document_id_index").on(table.documentId),
  })
);

// One row per call made to an external (or local) AI service, so the
// dashboard can show usage against each provider's free-tier limits.
export const apiCallsTable = pgTable("api_calls", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull(), // "openrouter" | "cohere" | "local"
  purpose: text("purpose").notNull(), // "optimize_query" | "chat_completion" | "rerank" | "embedding" | "compaction"
  count: integer("count").notNull().default(1), // lets one row represent a batch (e.g. N embeddings)
  tokensUsed: integer("tokens_used"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// One row per conversation. `summary` + `summarizedThroughId` implement
// compaction: once a chat gets long, older messages get folded into
// `summary` and excluded from the context sent to the LLM, while staying
// in `chat_messages` so the full transcript still displays in the UI.
export const chatsTable = pgTable("chats", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull().default("New chat"),
  pinned: boolean("pinned").notNull().default(false),
  summary: text("summary"),
  summarizedThroughId: integer("summarized_through_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// One row per message in a chat.
export const chatMessagesTable = pgTable(
  "chat_messages",
  {
    id: serial("id").primaryKey(),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chatsTable.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // "user" | "assistant"
    content: text("content").notNull(),
    sources: jsonb("sources"), // Source[] | null, only set on assistant messages
    rerankMethod: text("rerank_method"), // "cohere" | "bm25" | "vector" | null
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    chatIdIndex: index("chat_messages_chat_id_index").on(table.chatId),
  })
);

// Singleton row (id = 1) holding the user-adjustable free-tier limits shown
// and checked against on the dashboard.
export const settingsTable = pgTable("settings", {
  id: integer("id").primaryKey(),
  cohereMonthlyCap: integer("cohere_monthly_cap").notNull().default(1000),
  coherePerMinuteCap: integer("cohere_per_minute_cap").notNull().default(10),
  openrouterPerMinuteCap: integer("openrouter_per_minute_cap").notNull().default(20),
  openrouterDailyCap: integer("openrouter_daily_cap").notNull().default(50),
  queryOptimization: text("query_optimization").notNull().default("local"), // "off" | "local" | "llm"
  rerankMethod: text("rerank_method").notNull().default("cohere"), // "cohere" | "bm25" | "off"
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertDocument = typeof documentsTable.$inferInsert;
export type SelectDocument = typeof documentsTable.$inferSelect;
export type InsertChunk = typeof chunksTable.$inferInsert;
export type SelectChunk = typeof chunksTable.$inferSelect;
export type InsertApiCall = typeof apiCallsTable.$inferInsert;
export type SelectApiCall = typeof apiCallsTable.$inferSelect;
export type InsertChat = typeof chatsTable.$inferInsert;
export type SelectChat = typeof chatsTable.$inferSelect;
export type InsertChatMessage = typeof chatMessagesTable.$inferInsert;
export type SelectChatMessage = typeof chatMessagesTable.$inferSelect;
export type SelectSettings = typeof settingsTable.$inferSelect;
