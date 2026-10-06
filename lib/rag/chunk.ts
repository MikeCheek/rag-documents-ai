// Splits text into overlapping chunks along paragraph and sentence
// boundaries, so a chunk never starts or ends mid-sentence unless a single
// sentence is longer than a whole chunk.
//
// Sizes are in words and chosen for the embedding model: all-MiniLM-L6-v2
// truncates its input at 256 tokens (~190 English words), so anything past
// that point in a chunk is invisible to vector search. 180 words keeps the
// whole chunk inside the window. The overlap carries the last sentence(s)
// of each chunk into the next, so a fact straddling a boundary stays
// retrievable from either side.

export const DEFAULT_CHUNK_WORDS = 180;
export const DEFAULT_OVERLAP_WORDS = 30;

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Paragraphs first (blank lines), then sentences within each paragraph. */
export function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  for (const paragraph of text.split(/\n\s*\n/)) {
    const flat = paragraph.replace(/\s+/g, " ").trim();
    if (!flat) continue;
    // A sentence ends at . ! or ? (optionally followed by closing quotes or
    // brackets) and whitespace. Abbreviations occasionally split early,
    // which only costs a slightly earlier chunk boundary.
    const parts = flat.split(/(?<=[.!?]["')\]]*)\s+/);
    for (const part of parts) if (part.trim()) sentences.push(part.trim());
  }
  return sentences;
}

/** Hard-splits a sentence that alone exceeds the chunk size. */
function splitLongSentence(sentence: string, chunkSize: number): string[] {
  const words = sentence.split(/\s+/).filter(Boolean);
  const pieces: string[] = [];
  for (let i = 0; i < words.length; i += chunkSize) {
    pieces.push(words.slice(i, i + chunkSize).join(" "));
  }
  return pieces;
}

export function chunkText(
  text: string,
  {
    chunkSize = DEFAULT_CHUNK_WORDS,
    overlap = DEFAULT_OVERLAP_WORDS,
  }: { chunkSize?: number; overlap?: number } = {}
): string[] {
  const units = splitSentences(text).flatMap((s) =>
    wordCount(s) > chunkSize ? splitLongSentence(s, chunkSize) : [s]
  );
  if (units.length === 0) return [];

  const chunks: string[] = [];
  let current: string[] = [];
  let currentWords = 0;

  for (const unit of units) {
    const words = wordCount(unit);
    if (currentWords + words > chunkSize && current.length > 0) {
      chunks.push(current.join(" "));

      // Seed the next chunk with trailing sentences worth up to `overlap`
      // words, never the whole previous chunk (that would loop forever).
      const carried: string[] = [];
      let carriedWords = 0;
      for (let i = current.length - 1; i > 0; i--) {
        const w = wordCount(current[i]);
        if (carriedWords + w > overlap) break;
        carried.unshift(current[i]);
        carriedWords += w;
      }
      // Drop the overlap if it would push the next chunk over size anyway.
      if (carriedWords + words > chunkSize) {
        current = [];
        currentWords = 0;
      } else {
        current = carried;
        currentWords = carriedWords;
      }
    }
    current.push(unit);
    currentWords += words;
  }

  if (current.length > 0) chunks.push(current.join(" "));
  return chunks;
}
