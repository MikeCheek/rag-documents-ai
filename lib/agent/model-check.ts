// Checks whether the configured OPENROUTER_MODEL actually supports tool
// calling, using OpenRouter's public /models endpoint (no API key
// required). Agent mode depends on this: a model without tool support will
// just never call any tools and effectively behave like plain RAG-less
// chat, silently, which is confusing without a clear warning.

import type { ModelToolCheck, FreeModelInfo } from "@/types";

type OpenRouterModelInfo = {
  id: string;
  name?: string;
  supported_parameters?: string[];
  pricing?: { prompt?: string; completion?: string };
};

let cache: { fetchedAt: number; models: OpenRouterModelInfo[] } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — this data changes rarely

async function fetchModels(): Promise<OpenRouterModelInfo[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.models;
  }

  const res = await fetch("https://openrouter.ai/api/v1/models");
  if (!res.ok) throw new Error(`OpenRouter models request failed: ${res.status}`);
  const json = await res.json();
  const models: OpenRouterModelInfo[] = json?.data ?? [];

  cache = { fetchedAt: Date.now(), models };
  return models;
}

function isFreeModel(model: OpenRouterModelInfo): boolean {
  if (model.id.endsWith(":free")) return true;
  const prompt = Number(model.pricing?.prompt ?? "1");
  const completion = Number(model.pricing?.completion ?? "1");
  return prompt === 0 && completion === 0;
}

function supportsTools(model: OpenRouterModelInfo): boolean {
  return Array.isArray(model.supported_parameters) && model.supported_parameters.includes("tools");
}

/** All free models, tools-capable ones first, for the Settings model picker. */
export async function listFreeModels(): Promise<FreeModelInfo[]> {
  const models = await fetchModels();
  return models
    .filter(isFreeModel)
    .map((m) => ({ id: m.id, name: m.name ?? m.id, supportsTools: supportsTools(m) }))
    .sort((a, b) => {
      if (a.supportsTools !== b.supportsTools) return a.supportsTools ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export type { ModelToolCheck, FreeModelInfo };

export async function checkModelToolSupport(modelId: string): Promise<ModelToolCheck> {
  const isAutoRouter = modelId === "openrouter/free";

  try {
    const models = await fetchModels();

    if (isAutoRouter) {
      // Not a concrete model — OpenRouter picks one per request, so its
      // tool support can't be checked directly. Surface real alternatives
      // instead of just a generic warning.
      const suggestions = models
        .filter((m) => isFreeModel(m) && supportsTools(m))
        .slice(0, 5)
        .map((m) => m.id);
      return { modelId, isAutoRouter: true, supportsTools: null, suggestions };
    }

    const match = models.find((m) => m.id === modelId);
    if (!match) {
      return { modelId, isAutoRouter: false, supportsTools: null, suggestions: [] };
    }

    const ok = supportsTools(match);
    const suggestions = ok
      ? []
      : models
          .filter((m) => isFreeModel(m) && supportsTools(m))
          .slice(0, 5)
          .map((m) => m.id);

    return { modelId, isAutoRouter: false, supportsTools: ok, suggestions };
  } catch {
    return { modelId, isAutoRouter, supportsTools: null, suggestions: [] };
  }
}
