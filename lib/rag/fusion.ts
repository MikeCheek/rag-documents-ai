// Reciprocal Rank Fusion: merges several ranked lists into one by summing
// 1 / (k + rank) for every list an item appears in. Rank-based rather than
// score-based, so lists on completely different scales (cosine similarity,
// Postgres ts_rank, BM25) combine without any normalization or tuning.
// k = 60 is the constant from the original paper (Cormack et al., 2009)
// and the de-facto default everywhere hybrid search uses RRF.

export const RRF_K = 60;

export function reciprocalRankFusion<T>(
  lists: T[][],
  keyOf: (item: T) => string | number,
  k: number = RRF_K
): { item: T; score: number }[] {
  const fused = new Map<string | number, { item: T; score: number; firstSeen: number }>();
  let order = 0;

  for (const list of lists) {
    list.forEach((item, rank) => {
      const key = keyOf(item);
      const contribution = 1 / (k + rank + 1);
      const existing = fused.get(key);
      if (existing) {
        existing.score += contribution;
      } else {
        fused.set(key, { item, score: contribution, firstSeen: order++ });
      }
    });
  }

  return Array.from(fused.values())
    .sort((a, b) => b.score - a.score || a.firstSeen - b.firstSeen)
    .map(({ item, score }) => ({ item, score }));
}
