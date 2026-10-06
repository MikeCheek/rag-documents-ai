// Lightweight language detection by stopword frequency: function words
// ("the", "di", "le", "der", ...) make up a large, stable share of running
// text in every language, and their sets barely overlap, so counting them
// identifies a document's language reliably from a few hundred words. No
// model, no dependency.
//
// The result is a Postgres text-search configuration name, used to stem
// each document's keyword index in its own language (chunks.ts_config).
// "simple" (lowercase, no stemming, no stopwords) is the safe fallback for
// anything unrecognized.

export const SUPPORTED_LANGUAGES = [
  "english",
  "italian",
  "french",
  "german",
  "spanish",
  "portuguese",
  "dutch",
] as const;

export type TextSearchConfig = (typeof SUPPORTED_LANGUAGES)[number] | "simple";

const STOPWORDS: Record<(typeof SUPPORTED_LANGUAGES)[number], string[]> = {
  english: ["the", "and", "of", "to", "is", "in", "that", "it", "for", "was", "with", "as", "on", "are", "be", "this", "by", "which", "or", "from", "have", "not", "but", "an", "they", "were", "their", "has", "been", "would"],
  italian: ["il", "di", "che", "la", "per", "un", "una", "non", "sono", "del", "della", "gli", "le", "con", "si", "nel", "nella", "da", "dei", "delle", "anche", "come", "questo", "ha", "al", "alla", "ma", "più", "essere", "lo"],
  french: ["le", "la", "les", "de", "des", "et", "est", "un", "une", "du", "que", "qui", "dans", "pour", "pas", "sur", "au", "aux", "avec", "il", "elle", "sont", "ce", "cette", "ne", "par", "plus", "ou", "nous", "vous"],
  german: ["der", "die", "das", "und", "ist", "nicht", "ein", "eine", "zu", "den", "von", "mit", "sich", "des", "auf", "für", "im", "dem", "auch", "es", "an", "werden", "aus", "er", "hat", "dass", "sie", "nach", "bei", "wird"],
  spanish: ["el", "la", "de", "que", "y", "en", "los", "las", "del", "se", "por", "un", "una", "con", "para", "es", "al", "lo", "como", "más", "pero", "sus", "le", "ya", "o", "este", "esta", "son", "entre", "cuando"],
  portuguese: ["o", "a", "de", "que", "e", "do", "da", "em", "um", "uma", "para", "com", "não", "os", "as", "no", "na", "por", "mais", "dos", "das", "se", "ao", "como", "mas", "foi", "ele", "ela", "são", "também"],
  dutch: ["de", "het", "een", "en", "van", "is", "dat", "op", "te", "in", "zijn", "voor", "met", "niet", "aan", "er", "ook", "als", "bij", "door", "maar", "om", "dan", "naar", "wordt", "worden", "deze", "kan", "nog", "hij"],
};

const SETS = Object.fromEntries(
  Object.entries(STOPWORDS).map(([lang, words]) => [lang, new Set(words)])
) as Record<(typeof SUPPORTED_LANGUAGES)[number], Set<string>>;

/** Every stopword of every supported language — for language-agnostic tokenizing. */
export const ALL_STOPWORDS = new Set(Object.values(STOPWORDS).flat());

export function tokenizeWords(text: string): string[] {
  return text.toLowerCase().match(/\p{L}+/gu) ?? [];
}

/**
 * Detects the language of `text`, returning a Postgres text-search config
 * name. Needs a few function words to go on: short or unusual text (a
 * keyword list, a table of numbers) returns "simple".
 */
export function detectLanguage(text: string): TextSearchConfig {
  const words = tokenizeWords(text).slice(0, 5000);
  if (words.length === 0) return "simple";

  const scores = SUPPORTED_LANGUAGES.map((lang) => ({
    lang,
    hits: words.reduce((n, w) => n + (SETS[lang].has(w) ? 1 : 0), 0),
  })).sort((a, b) => b.hits - a.hits);

  const [best, second] = scores;
  // At least 2 function words, making up a plausible share of the text, and
  // clearly ahead of the runner-up (the lists overlap a little: "de", "la").
  if (best.hits < 2 || best.hits / words.length < 0.04) return "simple";
  if (second && best.hits < second.hits * 1.25) return "simple";
  return best.lang;
}
