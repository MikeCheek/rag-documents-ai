// Local, free embeddings via Xenova/transformers.js — no API key, no per-call
// cost. The model downloads once on first use and is cached on disk.
// Must run in the Node.js runtime (not Edge).
//
// The default is multilingual-e5-small, which embeds ~100 languages into
// one shared space (an Italian question finds an English passage and vice
// versa), at the same 384 dimensions as the all-MiniLM-L6-v2 this app used
// before, so the database columns don't change. Set EMBEDDING_MODEL to
// switch; each document records the model that embedded it, and the
// background worker re-embeds documents from a different model
// (lib/jobs/worker.ts), since vectors from two models aren't comparable.

import { logApiCall } from "./usage";

export const EMBEDDING_DIMENSIONS = 384;

export const LEGACY_EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

type ModelSpec = {
  /** Prepended to search queries / stored passages. E5 models are trained
   *  with these and are noticeably worse without them. */
  queryPrefix: string;
  passagePrefix: string;
};

export const EMBEDDING_MODELS: Record<string, ModelSpec> = {
  "Xenova/multilingual-e5-small": { queryPrefix: "query: ", passagePrefix: "passage: " },
  [LEGACY_EMBEDDING_MODEL]: { queryPrefix: "", passagePrefix: "" },
};

export const DEFAULT_EMBEDDING_MODEL = "Xenova/multilingual-e5-small";

export function currentEmbeddingModel(): string {
  const configured = process.env.EMBEDDING_MODEL?.trim();
  if (!configured) return DEFAULT_EMBEDDING_MODEL;
  if (!EMBEDDING_MODELS[configured]) {
    throw new Error(
      `EMBEDDING_MODEL "${configured}" isn't supported. Use one of: ${Object.keys(EMBEDDING_MODELS).join(", ")}.`
    );
  }
  return configured;
}

const embedders = new Map<string, Promise<any>>();

async function getEmbedder(model: string) {
  let embedder = embedders.get(model);
  if (!embedder) {
    embedder = (async () => {
      const { pipeline } = await import("@xenova/transformers");
      return pipeline("feature-extraction", model);
    })();
    // A failed load (e.g. no network for the first download) shouldn't be
    // cached forever; the next call retries.
    embedder.catch(() => embedders.delete(model));
    embedders.set(model, embedder);
  }
  return embedder;
}

export type EmbeddingKind = "query" | "passage";

export async function generateEmbeddings(
  texts: string[],
  kind: EmbeddingKind = "passage",
  model: string = currentEmbeddingModel()
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const spec = EMBEDDING_MODELS[model];
  const prefix = kind === "query" ? spec.queryPrefix : spec.passagePrefix;
  const embedder = await getEmbedder(model);
  // One forward pass for the whole batch (padded to its longest text)
  // rather than one per text — much faster on uploads.
  const output = await embedder(
    texts.map((t) => prefix + t),
    { pooling: "mean", normalize: true }
  );
  const flat = output.data as Float32Array;
  if (flat.length !== texts.length * EMBEDDING_DIMENSIONS) {
    throw new Error(`${model} returned ${flat.length / texts.length} dimensions; expected ${EMBEDDING_DIMENSIONS}.`);
  }
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    results.push(Array.from(flat.subarray(i * EMBEDDING_DIMENSIONS, (i + 1) * EMBEDDING_DIMENSIONS)));
  }
  logApiCall("local", "embedding", { count: texts.length });
  return results;
}

/** Embeds a search query (with the model's query prefix). */
export async function generateEmbedding(text: string): Promise<number[]> {
  const [embedding] = await generateEmbeddings([text], "query");
  return embedding;
}
