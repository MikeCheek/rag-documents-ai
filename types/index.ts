export type ChatRole = "user" | "assistant";

// "rag": retrieve-then-answer, no autonomy beyond the fixed pipeline.
// "agent": the model can call tools (possibly several times, in a loop)
// before producing a final answer. Tracked per-message, not per-chat, so a
// single conversation can freely mix both.
export type ChatMode = "rag" | "agent";

export type Source = {
  chunkId: number;
  documentId: string;
  documentName: string;
  content: string;
  similarity: number;
  relevanceScore: number;
  /** Source PDF page range; absent/null for unpaged formats and older chunks. */
  pageStart?: number | null;
  pageEnd?: number | null;
  /** Position within its document (absent on answers saved before it existed). */
  chunkIndex?: number;
};

export type RerankResultMethod = "cohere" | "bm25" | "vector";

export type { CitationCheck, CitationIssue } from "@/lib/rag/citation-check";
import type { CitationCheck } from "@/lib/rag/citation-check";

export type AgentStep =
  | { type: "message"; content: string }
  | { type: "tool_call"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; result: string; success: boolean; durationMs: number };

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  mode?: ChatMode;
  sources?: Source[];
  rerankMethod?: RerankResultMethod | string;
  agentSteps?: AgentStep[];
  apiCallCount?: number;
  durationMs?: number;
  createdAt?: string;
  editGroupId?: string | null;
  citationCheck?: CitationCheck | null;
  documentScope?: DocumentScopeEntry[] | null;
  stage?: string;
  stageDetail?: string;
  isStreaming?: boolean;
  error?: string;
};

export type DocumentStatus = "queued" | "processing" | "ready" | "failed";

export type DocumentRecord = {
  id: string;
  name: string;
  fileType: string;
  status: DocumentStatus;
  error?: string | null;
  chunkCount: number;
  charCount: number;
  /** Postgres text-search config of the detected language, e.g. "italian". */
  language?: string;
  /** While queued/processing: queued | ocr | embedding | reembedding. */
  stage?: string | null;
  progressDone?: number;
  progressTotal?: number;
  createdAt: string;
};

export type ProviderUsage = {
  callsToday: number;
  callsMonth: number;
  callsAllTime: number;
  callsLastMinute: number;
  tokensMonth: number;
  tokensAllTime: number;
  byPurpose: Record<string, number>;
};

export type ChunkUsageRow = {
  chunkId: number;
  documentId: string;
  documentName: string;
  chunkIndex: number;
  content: string;
  usageCount: number;
};

export type AppLimits = {
  cohereMonthlyCap: number;
  coherePerMinuteCap: number;
  openrouterPerMinuteCap: number;
  openrouterDailyCap: number;
  agentMaxSteps: number;
};

// "off": send the question to the retriever as typed.
// "local": free, local NLP (stopword removal + lemmatization via wink-nlp).
// "llm": rewrite the query with an OpenRouter call for the best retrieval
//   quality (can resolve pronouns/context across the conversation).
export type QueryOptimizationMode = "off" | "local" | "llm";

// "cohere": Cohere's neural Rerank API (falls back to "bm25" automatically
//   if unconfigured or the call fails).
// "bm25": free, local, lexical-overlap ranking.
// "off": skip reranking, keep plain vector-similarity order.
export type RerankMode = "cohere" | "bm25" | "off";

export type AppSettings = AppLimits & {
  queryOptimization: QueryOptimizationMode;
  rerankMethod: RerankMode;
  openrouterModel: string;
  searxngBaseUrl: string | null;
  whisperModel: string;
};

export type ProviderConfigured = {
  openrouter: boolean;
  cohere: boolean;
};

export type UsageSnapshot = {
  usage: {
    openrouter: ProviderUsage;
    cohere: ProviderUsage;
    local: ProviderUsage;
  };
  limits: AppSettings;
  configured: ProviderConfigured;
};

export type StageTimingRow = {
  stage: string;
  avgDurationMs: number;
  count: number;
  minDurationMs: number;
  maxDurationMs: number;
};

export type TimingDailyPoint = {
  date: string;
  avgDurationMs: number;
};

export type DashboardData = UsageSnapshot & {
  embeddingModel?: string;
  documents: {
    total: number;
    ready: number;
    processing: number;
    failed: number;
    totalChunks: number;
    totalChars: number;
  };
  chunks: ChunkUsageRow[];
  toolUsage: ToolUsageRow[];
  timingByStage: StageTimingRow[];
  timingDailyTrend: TimingDailyPoint[];
};

export type ChatSummary = {
  id: string;
  title: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
};

export type StoredChatMessage = {
  id: number;
  chatId: string;
  role: ChatRole;
  content: string;
  mode: ChatMode;
  sources: Source[] | null;
  rerankMethod: RerankResultMethod | string | null;
  agentSteps: AgentStep[] | null;
  apiCallCount: number | null;
  durationMs: number | null;
  editGroupId: string | null;
  citationCheck?: CitationCheck | null;
  documentScope?: DocumentScopeEntry[] | null;
  createdAt: string;
};

export type MessageVersion = {
  index: number; // 0-based position among this group's versions, oldest first
  userMessage: StoredChatMessage;
  assistantMessage: StoredChatMessage | null;
};

export type ToolParameterType = "string" | "number" | "integer" | "boolean" | "array" | "object";

export type ToolParameter = {
  name: string;
  type: ToolParameterType;
  description: string;
  required: boolean;
  /** Allowed values, e.g. from an OpenAPI enum. */
  enum?: string[];
};

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type AgentToolRecord = {
  id: string;
  name: string;
  description: string;
  method: HttpMethod;
  /** Absolute URL, or a path relative to the connection's base URL. */
  urlTemplate: string;
  parameters: ToolParameter[];
  headers: Record<string, string> | null;
  connectionId: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ApiAuthType = "none" | "bearer" | "header" | "query";

/** An API connection as the browser sees it: the secret is never included. */
export type ApiConnectionRecord = {
  id: string;
  name: string;
  baseUrl: string;
  authType: ApiAuthType;
  authName: string | null;
  hasSecret: boolean;
  headerNames: string[];
  allowPrivateNetwork: boolean;
  toolCount: number;
  createdAt: string;
};

export type McpTransportType = "http" | "sse" | "stdio";

/** An MCP server as the browser sees it: header and env values are never included. */
export type McpServerRecord = {
  id: string;
  name: string;
  transport: McpTransportType;
  url: string | null;
  headerNames: string[];
  command: string | null;
  args: string[];
  envNames: string[];
  enabled: boolean;
  disabledTools: string[];
  createdAt: string;
};

export type McpToolInfo = { name: string; description: string; enabled: boolean };

export type DocumentScopeEntry = { id: string; name: string };

export type AgentMemory = {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type BuiltinToolInfo = {
  name: string;
  description: string;
  configured: boolean;
};

export type ToolUsageRow = {
  toolName: string;
  calls: number;
  successRate: number;
  lastUsed: string | null;
};

export type ModelToolCheck = {
  modelId: string;
  isAutoRouter: boolean;
  supportsTools: boolean | null;
  suggestions: string[];
};

export type FreeModelInfo = {
  id: string;
  name: string;
  supportsTools: boolean;
};

export type EmbeddingSpacePoint = {
  chunkId: number;
  documentId: string;
  documentName: string;
  content: string;
  similarity: number;
  isNeighbor: boolean;
  x: number;
  y: number;
  z: number;
};

export type EmbeddingSpaceResult = {
  query: { x: number; y: number; z: number };
  points: EmbeddingSpacePoint[];
};

export type DocumentCluster = {
  id: string;
  label: string;
  documentIds: string[];
};

export type ClusterResult = {
  clusters: DocumentCluster[];
  singletonIds: string[];
};
