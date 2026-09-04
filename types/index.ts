export type ChatRole = "user" | "assistant";

export type Source = {
  chunkId: number;
  documentId: string;
  documentName: string;
  content: string;
  similarity: number;
  relevanceScore: number;
};

export type RerankResultMethod = "cohere" | "bm25" | "vector";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  sources?: Source[];
  rerankMethod?: RerankResultMethod | string;
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
  sources: Source[] | null;
  rerankMethod: RerankResultMethod | string | null;
  createdAt: string;
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
