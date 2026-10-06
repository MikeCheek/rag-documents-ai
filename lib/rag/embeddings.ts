// Local, free embeddings via Xenova/transformers.js — no API key, no per-call
// cost. The model (~90MB) downloads once on first use and is cached on disk.
// Must run in the Node.js runtime (not Edge).

import { logApiCall } from "./usage";

let embedderPromise: Promise<any> | null = null;

async function getEmbedder() {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      const { pipeline } = await import("@xenova/transformers");
      return pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    })();
  }
  return embedderPromise;
}

export const EMBEDDING_DIMENSIONS = 384;

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const embedder = await getEmbedder();
  // One forward pass for the whole batch (padded to its longest text)
  // rather than one per text — much faster on uploads.
  const output = await embedder(texts, { pooling: "mean", normalize: true });
  const flat = output.data as Float32Array;
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    results.push(Array.from(flat.subarray(i * EMBEDDING_DIMENSIONS, (i + 1) * EMBEDDING_DIMENSIONS)));
  }
  logApiCall("local", "embedding", { count: texts.length });
  return results;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const [embedding] = await generateEmbeddings([text]);
  return embedding;
}
