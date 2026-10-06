// Local, free reranking via BM25 — the standard lexical-overlap ranking
// algorithm behind classic search engines (Elasticsearch/Lucene use it by
// default). No API call, no model download beyond the local NLP tokenizer
// already used for query optimization. Not as good at understanding
// paraphrases/synonyms as Cohere's neural reranker, but a solid, instant,
// free alternative or fallback.
//
// BM25 alone only sees word overlap, so on its own it would push a passage
// that paraphrases the question (zero shared words) to the bottom, however
// semantically close it is. Its ranking is therefore fused with the
// retrieval order (Reciprocal Rank Fusion) rather than replacing it.

import { getLemmaTokens } from "./local-nlp";
import type { RetrievedChunk } from "./retrieve";
import type { RankedChunk } from "./rerank";
import { reciprocalRankFusion } from "./fusion";

const K1 = 1.5;
const B = 0.75;

export async function bm25Rank(
  query: string,
  documents: RetrievedChunk[],
  limit: number
): Promise<RankedChunk[]> {
  if (documents.length === 0) return [];

  const queryTerms = new Set(await getLemmaTokens(query));
  const docTerms = await Promise.all(documents.map((d) => getLemmaTokens(d.content)));

  const n = documents.length;
  const avgDocLength = docTerms.reduce((sum, terms) => sum + terms.length, 0) / n || 1;

  // Document frequency: how many documents each query term appears in.
  const docFrequency = new Map<string, number>();
  for (const terms of docTerms) {
    const seen = new Set(terms);
    for (const term of queryTerms) {
      if (seen.has(term)) docFrequency.set(term, (docFrequency.get(term) ?? 0) + 1);
    }
  }

  function idf(term: string): number {
    const df = docFrequency.get(term) ?? 0;
    // +1 smoothing keeps this non-negative even when a term appears in
    // every candidate document.
    return Math.log((n - df + 0.5) / (df + 0.5) + 1);
  }

  const scored = documents.map((doc, i) => {
    const terms = docTerms[i];
    const docLength = terms.length || 1;
    const termFrequency = new Map<string, number>();
    for (const term of terms) termFrequency.set(term, (termFrequency.get(term) ?? 0) + 1);

    let score = 0;
    for (const term of queryTerms) {
      const f = termFrequency.get(term) ?? 0;
      if (f === 0) continue;
      const numerator = f * (K1 + 1);
      const denominator = f + K1 * (1 - B + (B * docLength) / avgDocLength);
      score += idf(term) * (numerator / denominator);
    }
    return { doc, score };
  });

  // Chunks with no query term at all don't get a lexical rank; they keep
  // only their retrieval rank in the fusion below.
  const lexicalOrder = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.doc);

  const fused = reciprocalRankFusion([documents, lexicalOrder], (d) => d.chunkId);
  const maxScore = fused[0]?.score || 1;

  return fused.slice(0, limit).map(({ item, score }) => ({
    ...item,
    // Normalized 0-1 against this batch's own top score, so the UI's
    // relevance bar stays meaningful regardless of the fused scale.
    relevanceScore: score / maxScore,
  }));
}
