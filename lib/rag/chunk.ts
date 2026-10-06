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

export type ChunkOptions = { chunkSize?: number; overlap?: number };

export type PagedChunk = {
  content: string;
  /** 1-based page range the chunk's text came from; null without pages. */
  pageStart: number | null;
  pageEnd: number | null;
};

type Unit = { text: string; words: number; page: number | null };

function toUnits(text: string, page: number | null, chunkSize: number): Unit[] {
  return splitSentences(text)
    .flatMap((s) => (wordCount(s) > chunkSize ? splitLongSentence(s, chunkSize) : [s]))
    .map((t) => ({ text: t, words: wordCount(t), page }));
}

function packUnits(units: Unit[], chunkSize: number, overlap: number): PagedChunk[] {
  const chunks: PagedChunk[] = [];
  let current: Unit[] = [];
  let currentWords = 0;

  const emit = () => {
    const pages = current.map((u) => u.page).filter((p): p is number => p !== null);
    chunks.push({
      content: current.map((u) => u.text).join(" "),
      pageStart: pages.length ? Math.min(...pages) : null,
      pageEnd: pages.length ? Math.max(...pages) : null,
    });
  };

  for (const unit of units) {
    if (currentWords + unit.words > chunkSize && current.length > 0) {
      emit();

      // Seed the next chunk with trailing sentences worth up to `overlap`
      // words, never the whole previous chunk (that would loop forever).
      const carried: Unit[] = [];
      let carriedWords = 0;
      for (let i = current.length - 1; i > 0; i--) {
        if (carriedWords + current[i].words > overlap) break;
        carried.unshift(current[i]);
        carriedWords += current[i].words;
      }
      // Drop the overlap if it would push the next chunk over size anyway.
      if (carriedWords + unit.words > chunkSize) {
        current = [];
        currentWords = 0;
      } else {
        current = carried;
        currentWords = carriedWords;
      }
    }
    current.push(unit);
    currentWords += unit.words;
  }

  if (current.length > 0) emit();
  return chunks;
}

export function chunkText(
  text: string,
  { chunkSize = DEFAULT_CHUNK_WORDS, overlap = DEFAULT_OVERLAP_WORDS }: ChunkOptions = {}
): string[] {
  return packUnits(toUnits(text, null, chunkSize), chunkSize, overlap).map((c) => c.content);
}

/**
 * Chunks a paged document (one string per page, in order). Chunks still
 * flow across page breaks — a passage isn't cut short just because the
 * page ended — but each one records the page range it spans.
 */
export function chunkPages(
  pages: string[],
  { chunkSize = DEFAULT_CHUNK_WORDS, overlap = DEFAULT_OVERLAP_WORDS }: ChunkOptions = {}
): PagedChunk[] {
  const units = pages.flatMap((text, i) => toUnits(text, i + 1, chunkSize));
  return packUnits(units, chunkSize, overlap);
}
