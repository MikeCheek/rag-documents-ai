import { CohereClient } from "cohere-ai";
import OpenAI from "openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

// Uses the OpenAI SDK, but pointed at OpenRouter's OpenAI-compatible
// endpoint so any OpenRouter model (including free ones, e.g.
// "openrouter/free") can be used as the main LLM.
let _openrouter: OpenAI | null = null;
export function getOpenRouter() {
  if (_openrouter) return _openrouter;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set. Add it to .env.local.");
  }
  _openrouter = new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      // Optional, but OpenRouter uses these for their public leaderboards.
      "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
      "X-Title": "Reading Room RAG",
    },
  });
  return _openrouter;
}

// Vercel AI SDK's OpenRouter provider — used only by the Agent mode loop
// (lib/agent/loop.ts), which needs AI SDK's multi-step tool-calling
// orchestration. Everything else (RAG answers, query optimization,
// compaction) stays on the plain OpenAI-SDK client above, since a single
// completion call doesn't benefit from it.
let _openrouterAiSdk: ReturnType<typeof createOpenRouter> | null = null;
function getOpenRouterAiSdkProvider() {
  if (_openrouterAiSdk) return _openrouterAiSdk;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set. Add it to .env.local.");
  }
  _openrouterAiSdk = createOpenRouter({
    apiKey,
    appName: "Reading Room",
    appUrl: process.env.APP_URL || "http://localhost:3000",
  });
  return _openrouterAiSdk;
}

export function getAgentModel(modelId: string) {
  return getOpenRouterAiSdkProvider().chat(modelId);
}

let _cohere: CohereClient | null = null;
export function getCohere(): CohereClient | null {
  const token = process.env.COHERE_API_KEY;
  if (!token) return null;
  if (_cohere) return _cohere;
  _cohere = new CohereClient({ token });
  return _cohere;
}
