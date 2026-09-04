// Fully local, free query processing: stopword removal + lemmatization via
// wink-nlp, a pure-JS NLP library with a bundled English model (no network
// calls, no API key, ~125ms one-time load then a few ms per call). Used
// both to rewrite queries locally (as an alternative to the LLM rewrite)
// and to tokenize text for local BM25 reranking.

let nlpPromise: Promise<any> | null = null;

async function getNlp() {
  if (!nlpPromise) {
    nlpPromise = (async () => {
      const winkNLP = (await import("wink-nlp")).default;
      const model = (await import("wink-eng-lite-web-model")).default;
      return winkNLP(model);
    })();
  }
  return nlpPromise;
}

/**
 * Tokenizes text into lowercased lemmas, dropping stopwords and
 * punctuation. Shared by the local query optimizer and the BM25 reranker
 * so both score/rewrite against the same vocabulary.
 */
export async function getLemmaTokens(text: string): Promise<string[]> {
  const nlp = await getNlp();
  const its = nlp.its;
  const doc = nlp.readDoc(text);

  const tokens: string[] = [];
  doc.tokens().each((token: any) => {
    if (token.out(its.type) !== "word") return;
    if (token.out(its.stopWordFlag)) return;
    const lemma = token.out(its.lemma) || token.out();
    if (lemma) tokens.push(String(lemma).toLowerCase());
  });

  return tokens;
}

/**
 * Rewrites a query using local NLP only: strips stopwords and filler,
 * reduces words to their lemma (e.g. "running" -> "run", "reports" ->
 * "report"). No API call, no cost. Less context-aware than an LLM rewrite
 * (it can't resolve pronouns against conversation history), but works well
 * for direct, keyword-bearing questions.
 */
export async function localOptimizeQuery(query: string): Promise<string> {
  const tokens = await getLemmaTokens(query);
  const rewritten = tokens.join(" ").trim();
  // If NLP stripped everything (e.g. a query that's all stopwords/punctuation),
  // fall back to the original text rather than searching with nothing.
  return rewritten || query;
}
