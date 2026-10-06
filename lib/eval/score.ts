// Scoring for the retrieval eval (scripts/eval-retrieval.ts): did the
// passages retrieved for a question include the one that answers it?

export type EvalCase = {
  question: string;
  /** Document (file name) the answer lives in. Case-insensitive. */
  document: string;
  /** Optional phrase the answering passage must contain. Case- and whitespace-insensitive. */
  contains?: string;
};

export type RetrievedForEval = { documentName: string; content: string };

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function isHit(c: EvalCase, r: RetrievedForEval): boolean {
  if (normalize(r.documentName) !== normalize(c.document)) return false;
  return c.contains ? normalize(r.content).includes(normalize(c.contains)) : true;
}

/** 1-based rank of the first passage that answers the case, or null. */
export function firstHitRank(c: EvalCase, results: RetrievedForEval[]): number | null {
  const i = results.findIndex((r) => isHit(c, r));
  return i === -1 ? null : i + 1;
}

export type EvalSummary = {
  cases: number;
  /** Share of cases answered by the top passage. */
  hitAt1: number;
  /** Share of cases answered anywhere in the returned passages. */
  hitAtK: number;
  /** Mean reciprocal rank: 1 for rank 1, 0.5 for rank 2, ... 0 for a miss. */
  mrr: number;
};

export function summarize(ranks: (number | null)[]): EvalSummary {
  const n = ranks.length || 1;
  return {
    cases: ranks.length,
    hitAt1: ranks.filter((r) => r === 1).length / n,
    hitAtK: ranks.filter((r) => r !== null).length / n,
    mrr: ranks.reduce<number>((sum, r) => sum + (r ? 1 / r : 0), 0) / n,
  };
}

export function validateCases(raw: unknown): EvalCase[] {
  if (!Array.isArray(raw)) throw new Error("Eval file must be a JSON array of cases.");
  return raw.map((c, i) => {
    if (!c || typeof c.question !== "string" || typeof c.document !== "string") {
      throw new Error(`Case ${i + 1}: "question" and "document" are required strings.`);
    }
    if (c.contains !== undefined && typeof c.contains !== "string") {
      throw new Error(`Case ${i + 1}: "contains" must be a string.`);
    }
    return { question: c.question, document: c.document, contains: c.contains };
  });
}
