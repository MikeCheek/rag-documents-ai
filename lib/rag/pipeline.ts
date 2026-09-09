import { getOptimizedQuery } from "./optimize-query";
import { localOptimizeQuery } from "./local-nlp";
import { retrieveChunks } from "./retrieve";
import { rankDocuments, type RankedChunk, type RerankResultMethod } from "./rerank";
import type { TimingCollector } from "./timing";
import { openrouterLimiter } from "./rate-limiter";
import type { AppSettings } from "@/types";

export type PipelineStage =
  | "optimizing"
  | "retrieving"
  | "reranking"
  | "generating"
  | "rate_limited";

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
  onStage: (stage: PipelineStage, detail?: string) => void,
  timing: TimingCollector
): Promise<PipelineResult> {
  onStage("optimizing", modeLabel(settings.queryOptimization));
  let optimizedQuery = query;
  if (settings.queryOptimization === "llm") {
    // Waited for outside the timed span, and recorded separately, so a
    // rate-limit queue delay doesn't masquerade as slow model latency in
    // the "optimize_query" stage's duration.
    const waitStartedAt = Date.now();
    await openrouterLimiter.waitForSlot(settings.openrouterPerMinuteCap, (waitMs) =>
      onStage("rate_limited", `waiting ${Math.ceil(waitMs / 1000)}s for OpenRouter's rate limit`)
    );
    const actuallyWaitedMs = Date.now() - waitStartedAt;
    if (actuallyWaitedMs > 50) timing.record("rate_limit_wait", actuallyWaitedMs);

    optimizedQuery = await timing.time("optimize_query", () =>
      getOptimizedQuery(query, history, summary, settings.openrouterModel)
    );
  } else if (settings.queryOptimization === "local") {
    optimizedQuery = await timing.time("optimize_query_local", () => localOptimizeQuery(query));
  }
  // "off" -> optimizedQuery stays the raw question.

  onStage("retrieving", optimizedQuery);
  const retrieved = await timing.time("retrieve", () => retrieveChunks(optimizedQuery, { limit: 12 }));

  onStage("reranking", `${retrieved.length} candidate chunk(s)`);
  const { results: sources, method } = await timing.time("rerank", () =>
    rankDocuments(optimizedQuery, retrieved, 5, settings.rerankMethod, settings.coherePerMinuteCap, (waitMs) =>
      onStage("rate_limited", `waiting ${Math.ceil(waitMs / 1000)}s for Cohere's rate limit`)
    )
  );

  return { optimizedQuery, sources, rerankMethod: method };
}

function modeLabel(mode: "off" | "local" | "llm"): string {
  if (mode === "llm") return "via LLM";
  if (mode === "local") return "local NLP";
  return "skipped";
}
