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
};

export type RerankResultMethod = "cohere" | "bm25" | "vector";

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
  stage?: string;
  stageDetail?: string;
  isStreaming?: boolean;
  error?: string;
};

export type DocumentStatus = "processing" | "ready" | "failed";

export type DocumentRecord = {
  id: string;
  name: string;
  fileType: string;
  status: DocumentStatus;
  error?: string | null;
  chunkCount: number;
  charCount: number;
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

export type DashboardData = UsageSnapshot & {
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
  createdAt: string;
};

export type ToolParameter = {
  name: string;
  type: "string" | "number" | "boolean";
  description: string;
  required: boolean;
};

export type AgentToolRecord = {
  id: string;
  name: string;
  description: string;
  method: "GET" | "POST";
  urlTemplate: string;
  parameters: ToolParameter[];
  headers: Record<string, string> | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

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
