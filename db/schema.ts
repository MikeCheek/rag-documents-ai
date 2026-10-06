import {
  customType,
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
  // Elementwise mean of all this document's chunk embeddings, computed once
  // when processing finishes — the basis for similarity-based grouping on
  // the Shelf, without re-scanning every chunk on every request.
  centroidEmbedding: vector("centroid_embedding", { dimensions: 384 }),
  // Postgres text-search config name for the document's detected language
  // (english, italian, ..., simple) — see lib/rag/language.ts.
  language: text("language").notNull().default("english"),
  // Model the chunks were embedded with; null = legacy all-MiniLM-L6-v2.
  // Only documents embedded with the current model are searched, and the
  // background worker re-embeds the rest (lib/jobs/worker.ts).
  embeddingModel: text("embedding_model"),
  // While not ready: what the background worker is doing, and how far.
  stage: text("stage"), // queued | ocr | embedding | reembedding
  progressDone: integer("progress_done").notNull().default(0),
  progressTotal: integer("progress_total").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

// Background job queue — see lib/jobs/queue.ts.
export const jobsTable = pgTable(
  "jobs",
  {
    id: serial("id").primaryKey(),
    type: text("type").notNull(), // ingest | reembed
    documentId: uuid("document_id").references(() => documentsTable.id, { onDelete: "cascade" }),
    payload: jsonb("payload"),
    file: bytea("file"),
    status: text("status").notNull().default("queued"), // queued | running | done | failed
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    lockedAt: timestamp("locked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    statusIdIndex: index("jobs_status_id_index").on(table.status, table.id),
    documentIdIndex: index("jobs_document_id_index").on(table.documentId),
  })
);

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
    // Source PDF page range this chunk came from (0007_chunk_pages.sql);
    // null for formats without pages.
    pageStart: integer("page_start"),
    pageEnd: integer("page_end"),
    // Text-search config (regconfig) for the chunk's language; drives the
    // generated content_tsv column, which isn't mapped here.
    tsConfig: text("ts_config").notNull().default("english"),
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
    mode: text("mode").notNull().default("rag"), // "rag" | "agent" — which pipeline produced/received this message
    sources: jsonb("sources"), // Source[] | null — RAG mode only
    rerankMethod: text("rerank_method"), // "cohere" | "bm25" | "vector" | null — RAG mode only
    agentSteps: jsonb("agent_steps"), // AgentStep[] | null — agent mode only
    apiCallCount: integer("api_call_count"), // # of LLM (OpenRouter) calls made to produce this message
    durationMs: integer("duration_ms"), // total time taken to produce this message
    // Editing the last user message never deletes anything — it deactivates
    // the old user+assistant pair (isActiveVersion: false) and inserts a
    // new one sharing the same editGroupId, so every past version stays in
    // the database and is reachable via the version-navigation UI. A
    // message that's never been part of an edit has editGroupId: null.
    editGroupId: uuid("edit_group_id"),
    isActiveVersion: boolean("is_active_version").notNull().default(true),
    citationCheck: jsonb("citation_check"), // CitationCheck | null — see lib/rag/citation-check.ts
    documentScope: jsonb("document_scope"), // [{ id, name }] | null — "Search in" on user messages
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    chatIdIndex: index("chat_messages_chat_id_index").on(table.chatId),
    editGroupIdIndex: index("chat_messages_edit_group_id_index").on(table.editGroupId),
  })
);

// User-defined tools available in Agent mode. Deliberately HTTP-calling
// rather than arbitrary code, so "create more tools" doesn't mean running
// untrusted code server-side — the server just makes a bounded, guarded
// HTTP request (see lib/agent/ssrf-guard.ts) and returns the response.
// Reusable base URL + auth that custom tools can share (0003_agent.sql).
export const apiConnectionsTable = pgTable("api_connections", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  baseUrl: text("base_url").notNull(),
  authType: text("auth_type").notNull().default("none"), // none | bearer | header | query
  authName: text("auth_name"), // header or query parameter name
  authValue: text("auth_value"), // secret — never returned to the browser
  headers: jsonb("headers"), // Record<string,string> | null
  allowPrivateNetwork: boolean("allow_private_network").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Model Context Protocol servers whose tools Agent mode can call (lib/agent/mcp.ts).
export const mcpServersTable = pgTable("mcp_servers", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  transport: text("transport").notNull().default("http"), // http | sse | stdio
  url: text("url"),
  headers: jsonb("headers"), // Record<string,string> | null — secret
  command: text("command"),
  args: jsonb("args"), // string[] | null
  env: jsonb("env"), // Record<string,string> | null — secret
  enabled: boolean("enabled").notNull().default(true),
  disabledTools: jsonb("disabled_tools").notNull().default([]), // string[]
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const agentToolsTable = pgTable("agent_tools", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(), // shown to the LLM as the function name; identifier-safe
  description: text("description").notNull(),
  method: text("method").notNull().default("GET"), // GET | POST | PUT | PATCH | DELETE
  urlTemplate: text("url_template").notNull(), // e.g. https://api.example.com/search?q={query}
  parameters: jsonb("parameters").notNull(), // ToolParameter[]
  headers: jsonb("headers"), // Record<string,string> | null — static headers, e.g. an API key
  // When set, urlTemplate is a path relative to the connection's base URL
  // and the connection's auth applies.
  connectionId: uuid("connection_id").references(() => apiConnectionsTable.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// One row per tool invocation (built-in or custom), so tool usage is
// tracked the same way API usage already is.
export const toolCallLogTable = pgTable("tool_call_log", {
  id: serial("id").primaryKey(),
  chatId: uuid("chat_id").references(() => chatsTable.id, { onDelete: "set null" }),
  toolName: text("tool_name").notNull(),
  success: boolean("success").notNull().default(true),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Persistent facts/instructions the agent has been asked to remember.
// Global (not scoped to one chat) and injected into the Agent-mode system
// prompt on every turn, so memory carries across chats, not just within
// one — separate from (and in addition to) each chat's own history.
export const agentMemoriesTable = pgTable("agent_memories", {
  id: uuid("id").defaultRandom().primaryKey(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Granular timing for every stage/call within a turn (RAG pipeline steps
// or Agent tool calls/LLM round-trips), plus one "total" row per turn — the
// source data for the Ledger's timing charts. messageId is nullable
// because timings are collected *during* processing, before the assistant
// message row exists to reference; it's backfilled right after that insert.
export const stageTimingsTable = pgTable(
  "stage_timings",
  {
    id: serial("id").primaryKey(),
    chatId: uuid("chat_id").references(() => chatsTable.id, { onDelete: "cascade" }),
    messageId: integer("message_id").references(() => chatMessagesTable.id, {
      onDelete: "cascade",
    }),
    mode: text("mode").notNull(), // "rag" | "agent"
    stage: text("stage").notNull(), // "optimize_query" | "retrieve" | "rerank" | "generate" | "llm_call" | "tool:<name>" | "total" | ...
    durationMs: integer("duration_ms").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    stageIndex: index("stage_timings_stage_index").on(table.stage),
    createdIndex: index("stage_timings_created_index").on(table.createdAt),
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
  agentMaxSteps: integer("agent_max_steps").notNull().default(6),
  openrouterModel: text("openrouter_model").notNull().default("openrouter/free"),
  searxngBaseUrl: text("searxng_base_url"), // null = web search not configured/offered
  // Which Whisper variant the mic button loads for local speech-to-text —
  // a server-side setting like openrouterModel, not a browser preference,
  // since it determines which model gets downloaded/run, the same
  // reasoning as the LLM model choice. The TTS voice/rate the speaker
  // button uses is the opposite: stored client-side (localStorage), since
  // available system voices are inherently per-device, not something a
  // server-side setting could meaningfully apply across browsers.
  whisperModel: text("whisper_model").notNull().default("Xenova/whisper-tiny.en"),
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
export type InsertAgentTool = typeof agentToolsTable.$inferInsert;
export type SelectAgentTool = typeof agentToolsTable.$inferSelect;
export type InsertToolCallLog = typeof toolCallLogTable.$inferInsert;
export type SelectToolCallLog = typeof toolCallLogTable.$inferSelect;
export type InsertAgentMemory = typeof agentMemoriesTable.$inferInsert;
export type SelectAgentMemory = typeof agentMemoriesTable.$inferSelect;
export type InsertStageTiming = typeof stageTimingsTable.$inferInsert;
export type SelectStageTiming = typeof stageTimingsTable.$inferSelect;
