import { getCohere } from "./clients";
import { logApiCall } from "./usage";
import { bm25Rank } from "./bm25";
import type { RetrievedChunk } from "./retrieve";
import type { RerankMode } from "./settings";

export type RankedChunk = RetrievedChunk & { relevanceScore: number };
export type RerankResultMethod = "cohere" | "bm25" | "vector";

function byVectorSimilarity(documents: RetrievedChunk[], limit: number): RankedChunk[] {
  return documents.slice(0, limit).map((d) => ({ ...d, relevanceScore: d.similarity }));
}

/**
 * Ranks retrieved chunks by relevance, using whichever method `mode`
 * selects:
 *  - "cohere": Cohere's neural Rerank API. Falls back to local BM25 (not
 *    plain vector order) if no COHERE_API_KEY is set or the call fails for
 *    any reason — a rerank attempt should never fail the whole request.
 *  - "bm25": local, free, lexical-overlap ranking. No API call.
 *  - "off": skip reranking entirely, keep vector-similarity order.
 */
export async function rankDocuments(
  query: string,
  documents: RetrievedChunk[],
  limit: number,
  mode: RerankMode
): Promise<{ results: RankedChunk[]; method: RerankResultMethod }> {
  if (documents.length === 0) {
    return { results: [], method: "vector" };
  }

  if (mode === "off") {
    return { results: byVectorSimilarity(documents, limit), method: "vector" };
  }

  if (mode === "bm25") {
    return { results: await bm25Rank(query, documents, limit), method: "bm25" };
  }

  // mode === "cohere"
  const cohere = getCohere();
  if (!cohere) {
    return { results: await bm25Rank(query, documents, limit), method: "bm25" };
  }

  try {
    const rerank = await cohere.v2.rerank({
      query,
      topN: Math.min(limit, documents.length),
      documents: documents.map((doc) => doc.content),
      model: "rerank-english-v3.0",
    });

    logApiCall("cohere", "rerank");

    const results = rerank.results.map((result) => ({
      ...documents[result.index],
      relevanceScore: result.relevanceScore,
    }));

    return { results, method: "cohere" };
  } catch (err) {
    console.error("Cohere rerank failed, falling back to local BM25:", err);
    logApiCall("cohere", "rerank");
    return { results: await bm25Rank(query, documents, limit), method: "bm25" };
  }
}
