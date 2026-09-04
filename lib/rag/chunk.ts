// Splits text into overlapping word-based chunks. Overlap keeps a sentence
// that straddles a chunk boundary retrievable from either chunk.

export function chunkText(
  text: string,
  { chunkSize = 350, overlap = 50 }: { chunkSize?: number; overlap?: number } = {}
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const chunks: string[] = [];
  const step = Math.max(1, chunkSize - overlap);

  for (let i = 0; i < words.length; i += step) {
    const slice = words.slice(i, i + chunkSize);
    if (slice.length === 0) break;
    chunks.push(slice.join(" "));
    if (i + chunkSize >= words.length) break;
  }

  return chunks;
}
