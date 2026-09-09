import { getOptimizedQuery } from "./optimize-query";
import { localOptimizeQuery } from "./local-nlp";
import { retrieveChunks } from "./retrieve";
import { rankDocuments, type RankedChunk, type RerankResultMethod } from "./rerank";
import type { AppSettings } from "@/types";

export type PipelineStage =
  | "optimizing"
  | "retrieving"
  | "reranking"
  | "generating";

export type PipelineResult = {
  optimizedQuery: string;
  sources: RankedChunk[];
  rerankMethod: RerankResultMethod;
};

export async function runRetrievalPipeline(
  query: string,
  history: { role: "user" | "assistant"; content: string }[],
  summary: string | null,
  settings: AppSettings,
  onStage: (stage: PipelineStage, detail?: string) => void
): Promise<PipelineResult> {
  onStage("optimizing", modeLabel(settings.queryOptimization));
  let optimizedQuery = query;
  if (settings.queryOptimization === "llm") {
    optimizedQuery = await getOptimizedQuery(query, history, summary, settings.openrouterModel);
  } else if (settings.queryOptimization === "local") {
    optimizedQuery = await localOptimizeQuery(query);
  }
  // "off" -> optimizedQuery stays the raw question.

  onStage("retrieving", optimizedQuery);
  const retrieved = await retrieveChunks(optimizedQuery, { limit: 12 });

  onStage("reranking", `${retrieved.length} candidate chunk(s)`);
  const { results: sources, method } = await rankDocuments(
    optimizedQuery,
    retrieved,
    5,
    settings.rerankMethod
  );

  return { optimizedQuery, sources, rerankMethod: method };
}

function modeLabel(mode: "off" | "local" | "llm"): string {
  if (mode === "llm") return "via LLM";
  if (mode === "local") return "local NLP";
  return "skipped";
}
