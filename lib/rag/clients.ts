import { CohereClient } from "cohere-ai";
import OpenAI from "openai";

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

let _cohere: CohereClient | null = null;
export function getCohere(): CohereClient | null {
  const token = process.env.COHERE_API_KEY;
  if (!token) return null;
  if (_cohere) return _cohere;
  _cohere = new CohereClient({ token });
  return _cohere;
}

// "openrouter/free" is OpenRouter's own auto-router: it picks a free
// (:free) model per-request so you don't have to hardcode one that might
// get rotated out. Override with a specific model id via OPENROUTER_MODEL.
export const CHAT_MODEL = process.env.OPENROUTER_MODEL || "openrouter/free";
