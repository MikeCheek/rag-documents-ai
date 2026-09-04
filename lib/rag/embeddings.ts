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
  const embedder = await getEmbedder();
  const results: number[][] = [];
  for (const text of texts) {
    const output = await embedder(text, { pooling: "mean", normalize: true });
    results.push(Array.from(output.data) as number[]);
  }
  logApiCall("local", "embedding", { count: texts.length });
  return results;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const [embedding] = await generateEmbeddings([text]);
  return embedding;
}
