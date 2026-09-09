import { Parser } from "expr-eval";
import { desc } from "drizzle-orm";
import { getDb, documentsTable } from "@/db";
import { retrieveChunks } from "@/lib/rag/retrieve";
import { rankDocuments } from "@/lib/rag/rerank";
import { getSettings } from "@/lib/rag/settings";
import { incrementChunkUsage } from "@/lib/rag/usage";
import { listMemories, saveMemory, deleteMemory } from "./memory";
import type { AppSettings, BuiltinToolInfo, Source } from "@/types";

// Every built-in tool follows the OpenAI-compatible function-calling shape,
// which OpenRouter passes straight through to whichever underlying model is
// serving the request.
export const BUILTIN_TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "search_documents",
      description:
        "Search the user's uploaded documents for passages relevant to a query. Call this whenever a question needs specific information from the documents rather than general knowledge. Can be called more than once with refined queries.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query." },
          limit: {
            type: "number",
            description: "Max number of passages to return (1-10, default 5).",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_documents",
      description:
        "List all documents currently uploaded, with their processing status, so you know what's actually available before searching.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "calculator",
      description: "Evaluate a basic arithmetic expression, e.g. \"(12 + 8) * 3 / 2\".",
      parameters: {
        type: "object",
        properties: {
          expression: { type: "string", description: "The arithmetic expression to evaluate." },
        },
        required: ["expression"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "current_datetime",
      description:
        "Get the current date and time, optionally in a specific IANA timezone (e.g. \"Europe/Rome\").",
      parameters: {
        type: "object",
        properties: {
          timezone: { type: "string", description: "Optional IANA timezone name." },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "web_search",
      description:
        "Search the public web for current information beyond the uploaded documents or training knowledge (news, current events, anything time-sensitive or likely too recent to be trained on). Uses a self-hosted or public SearXNG instance, a free and open-source metasearch engine, not a paid search API.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The web search query." },
          limit: {
            type: "number",
            description: "Max number of results to return (1-10, default 5).",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "remember",
      description:
        "Save a fact, preference, or standing instruction to persistent memory, which carries across every future chat, not just this one. Call this whenever the user asks you to remember something, or states something you should always/never do, a preference, or a fact about themselves worth keeping — don't just say you'll remember it, actually save it.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "The fact or instruction to remember, written as a short, self-contained statement.",
          },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_memories",
      description:
        "List everything currently saved to persistent memory. The full list is already provided to you at the start of this conversation — call this only if you want to double-check the current, up-to-date list (e.g. right after saving or forgetting something).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "forget",
      description:
        "Delete a previously saved memory by its id (from list_memories or the memory list you were given). Call this when the user asks you to forget something or a saved memory is outdated.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The id of the memory to delete." },
        },
        required: ["id"],
      },
    },
  },
];

export function getBuiltinToolInfo(settings: AppSettings): BuiltinToolInfo[] {
  return BUILTIN_TOOL_DEFINITIONS.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    configured: t.function.name === "web_search" ? !!settings.searxngBaseUrl : true,
  }));
}

export function isBuiltinTool(name: string): boolean {
  return BUILTIN_TOOL_DEFINITIONS.some((t) => t.function.name === name);
}

/** Tools actually offered to the model this turn - web_search is left out
 *  entirely (rather than offered and guaranteed to fail) when no SearXNG
 *  instance is configured. */
export function getAvailableBuiltinTools(settings: AppSettings) {
  return BUILTIN_TOOL_DEFINITIONS.filter(
    (t) => t.function.name !== "web_search" || !!settings.searxngBaseUrl
  );
}

async function execSearchDocuments(
  args: { query?: string; limit?: number }
): Promise<{ result: unknown; sources: Source[] }> {
  const query = String(args.query ?? "").trim();
  if (!query) throw new Error("query is required");

  const limit = Math.min(Math.max(Math.round(args.limit ?? 5), 1), 10);
  const settings = await getSettings();
  const retrieved = await retrieveChunks(query, { limit: 12 });
  const { results } = await rankDocuments(query, retrieved, limit, settings.rerankMethod);

  incrementChunkUsage(results.map((r) => r.chunkId));

  if (results.length === 0) {
    return {
      result: { results: [], note: "No relevant passages found for this query." },
      sources: [],
    };
  }

  // "index" here is placeholder, local-only numbering (1..N within this one
  // call) — the caller (the agent loop) rewrites it to a turn-wide global
  // index once these sources are registered, so citations stay unambiguous
  // even across multiple search_documents calls in the same turn.
  return {
    result: {
      results: results.map((r, i) => ({
        index: i + 1,
        document: r.documentName,
        excerpt: r.content.slice(0, 500),
        relevance: `${Math.round(Math.max(0, Math.min(1, r.relevanceScore)) * 100)}%`,
      })),
    },
    sources: results,
  };
}

async function execListDocuments() {
  const db = getDb();
  const rows = await db
    .select({
      name: documentsTable.name,
      status: documentsTable.status,
      chunkCount: documentsTable.chunkCount,
    })
    .from(documentsTable)
    .orderBy(desc(documentsTable.createdAt));

  return { documents: rows };
}

function execCalculator(args: { expression?: string }) {
  const expression = String(args.expression ?? "").trim();
  if (!expression) throw new Error("expression is required");
  // expr-eval parses/evaluates a restricted arithmetic grammar — no access
  // to globals, no arbitrary code execution, unlike eval()/Function().
  const parser = new Parser();
  const result = parser.evaluate(expression);
  return { expression, result };
}

function execCurrentDatetime(args: { timezone?: string }) {
  const now = new Date();
  if (!args.timezone) {
    return { iso: now.toISOString(), formatted: now.toUTCString() };
  }
  try {
    const formatted = new Intl.DateTimeFormat("en-US", {
      dateStyle: "full",
      timeStyle: "long",
      timeZone: args.timezone,
    }).format(now);
    return { iso: now.toISOString(), timezone: args.timezone, formatted };
  } catch {
    return { iso: now.toISOString(), error: `Unknown timezone: ${args.timezone}` };
  }
}

async function execRemember(args: { content?: string }) {
  const content = String(args.content ?? "").trim();
  if (!content) throw new Error("content is required");
  const memory = await saveMemory(content);
  return { saved: memory };
}

async function execListMemories() {
  const memories = await listMemories();
  return { memories };
}

async function execForget(args: { id?: string }) {
  const id = String(args.id ?? "").trim();
  if (!id) throw new Error("id is required");
  const deleted = await deleteMemory(id);
  return deleted ? { deleted: true, id } : { deleted: false, error: "No memory found with that id." };
}

export type BuiltinToolOutcome = { success: boolean; result: unknown; sources?: Source[] };

const WEB_SEARCH_TIMEOUT_MS = 10_000;
const WEB_SEARCH_MAX_SNIPPET_CHARS = 500;

async function execWebSearch(args: { query?: string; limit?: number }, searxngBaseUrl: string | null) {
  const query = String(args.query ?? "").trim();
  if (!query) throw new Error("query is required");

  if (!searxngBaseUrl) {
    throw new Error(
      "Web search isn't configured. Set a SearXNG instance URL in Settings (Agent mode section)."
    );
  }

  const limit = Math.min(Math.max(Math.round(args.limit ?? 5), 1), 10);
  const url = new URL("/search", searxngBaseUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEB_SEARCH_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), { signal: controller.signal });

    if (res.status === 403) {
      throw new Error(
        "SearXNG returned 403 Forbidden - its JSON output format is very likely not enabled on this instance (most public instances disable it by default). See Settings for setup notes, or self-host with 'json' added to search.formats in settings.yml."
      );
    }
    if (!res.ok) {
      throw new Error(`SearXNG request failed with status ${res.status}.`);
    }

    const data = await res.json();
    const rawResults = Array.isArray(data?.results) ? data.results : [];

    if (rawResults.length === 0) {
      return { results: [], note: "No web results found for this query." };
    }

    return {
      results: rawResults.slice(0, limit).map((r: any, i: number) => ({
        index: i + 1,
        title: String(r?.title ?? "").slice(0, 200),
        url: String(r?.url ?? ""),
        snippet: String(r?.content ?? "").slice(0, WEB_SEARCH_MAX_SNIPPET_CHARS),
      })),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function executeBuiltinTool(
  name: string,
  args: Record<string, any>,
  settings: AppSettings
): Promise<BuiltinToolOutcome> {
  try {
    switch (name) {
      case "search_documents": {
        const { result, sources } = await execSearchDocuments(args);
        return { success: true, result, sources };
      }
      case "list_documents":
        return { success: true, result: await execListDocuments() };
      case "calculator":
        return { success: true, result: execCalculator(args) };
      case "current_datetime":
        return { success: true, result: execCurrentDatetime(args) };
      case "web_search":
        return { success: true, result: await execWebSearch(args, settings.searxngBaseUrl) };
      case "remember":
        return { success: true, result: await execRemember(args) };
      case "list_memories":
        return { success: true, result: await execListMemories() };
      case "forget":
        return { success: true, result: await execForget(args) };
      default:
        return { success: false, result: { error: `Unknown built-in tool: ${name}` } };
    }
  } catch (err: any) {
    return { success: false, result: { error: err?.message ?? "Tool call failed" } };
  }
}
