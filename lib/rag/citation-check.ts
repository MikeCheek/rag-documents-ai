import { ALL_STOPWORDS, detectLanguage, tokenizeWords } from "./language";

// Checks an answer's [n] citations against the passages they point to,
// after the answer is written. Cheap, local, and deliberately conservative
// — it flags things worth a second look, it doesn't prove anything:
//
//  - missing_source: a citation number with no matching source.
//  - numbers_not_found: a figure in the sentence (2+ digits, decimals,
//    percentages) that appears in none of its cited passages, the most
//    common way a model's answer drifts from its sources.
//  - weak_support: the sentence shares almost no content words with its
//    cited passages. Skipped when the sentence and passages are in
//    different languages (an Italian answer citing an English document is
//    a translation, not unsupported), and for very short sentences.

export type CitationIssueKind = "missing_source" | "numbers_not_found" | "weak_support";

export type CitationIssue = {
  sentence: string;
  citations: number[];
  kind: CitationIssueKind;
  detail: string;
};

export type CitationCheck = {
  /** Sentences that carried at least one citation and were checked. */
  checkedSentences: number;
  issues: CitationIssue[];
};

const CITATION = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
const MIN_CONTENT_WORDS = 4;
const WEAK_SUPPORT_BELOW = 0.25;
/** Words are compared by prefix — a crude, language-agnostic stemmer
 *  ("mitochondria"/"mitochondrial", "produce"/"produces"). */
const STEM_LENGTH = 5;

/** Answer text split into sentences / list items, markdown stripped. */
export function splitAnswerSentences(answer: string): string[] {
  return answer
    .replace(/```[\s\S]*?```/g, " ")
    .split(/\n+/)
    // List markers come off first, so "1. Item" isn't split at its "1.".
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, ""))
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[^\s\[])/))
    .map((s) => s.replace(/[*_`#>]/g, "").trim())
    .filter(Boolean);
}

/** Numbers worth checking, normalized to their digits ("1,234.5" -> "12345"). */
export function extractFigures(text: string): string[] {
  const matches = text.match(/\d[\d.,]*\d|\d/g) ?? [];
  return matches
    .map((m) => m.replace(/[.,]/g, ""))
    .filter((digits) => digits.length >= 2);
}

function contentStems(text: string): string[] {
  return tokenizeWords(text)
    .filter((w) => w.length >= 4 && !ALL_STOPWORDS.has(w))
    .map((w) => w.slice(0, STEM_LENGTH));
}

export function checkCitations(answer: string, passages: string[]): CitationCheck {
  const issues: CitationIssue[] = [];
  let checkedSentences = 0;

  for (const raw of splitAnswerSentences(answer)) {
    const citations = [...raw.matchAll(CITATION)].flatMap((m) =>
      m[1].split(",").map((n) => Number(n.trim()))
    );
    if (citations.length === 0) continue;
    checkedSentences++;

    const sentence = raw.replace(CITATION, "").replace(/\s+/g, " ").trim();
    const missing = [...new Set(citations.filter((n) => n < 1 || n > passages.length))];
    if (missing.length) {
      issues.push({
        sentence,
        citations,
        kind: "missing_source",
        detail: `Cites ${missing.map((n) => `[${n}]`).join(", ")}, but there ${
          passages.length === 1 ? "is only 1 source" : `are only ${passages.length} sources`
        }.`,
      });
    }

    const cited = [...new Set(citations)].filter((n) => n >= 1 && n <= passages.length).map((n) => passages[n - 1]);
    if (cited.length === 0) continue;
    const citedText = cited.join(" ");

    const sourceFigures = new Set(extractFigures(citedText));
    const unmatched = [...new Set(extractFigures(sentence))].filter((f) => !sourceFigures.has(f));
    if (unmatched.length) {
      const shown = [...sentence.matchAll(/\d[\d.,]*\d|\d/g)]
        .map((m) => m[0])
        .filter((m) => unmatched.includes(m.replace(/[.,]/g, "")));
      issues.push({
        sentence,
        citations,
        kind: "numbers_not_found",
        detail: `${[...new Set(shown)].join(", ")} ${shown.length === 1 ? "doesn't" : "don't"} appear in the cited source${cited.length === 1 ? "" : "s"}.`,
      });
      continue; // one issue per sentence is enough
    }

    const stems = contentStems(sentence);
    if (stems.length < MIN_CONTENT_WORDS) continue;
    const sentenceLang = detectLanguage(sentence);
    const sourceLang = detectLanguage(citedText);
    if (sentenceLang !== "simple" && sourceLang !== "simple" && sentenceLang !== sourceLang) continue;

    const sourceStems = new Set(contentStems(citedText));
    const coverage = stems.filter((s) => sourceStems.has(s)).length / stems.length;
    if (coverage < WEAK_SUPPORT_BELOW) {
      issues.push({
        sentence,
        citations,
        kind: "weak_support",
        detail: `Shares few words with the cited source${cited.length === 1 ? "" : "s"} (${Math.round(coverage * 100)}% of its key terms).`,
      });
    }
  }

  return { checkedSentences, issues };
}
