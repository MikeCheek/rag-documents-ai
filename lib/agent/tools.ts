import { Parser } from "expr-eval";
import { desc } from "drizzle-orm";
import { getDb, documentsTable } from "@/db";
import { retrieveChunks } from "@/lib/rag/retrieve";
import { rankDocuments } from "@/lib/rag/rerank";
import { getSettings } from "@/lib/rag/settings";
import { incrementChunkUsage } from "@/lib/rag/usage";
import type { BuiltinToolInfo } from "@/types";

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
];

export const BUILTIN_TOOL_INFO: BuiltinToolInfo[] = BUILTIN_TOOL_DEFINITIONS.map((t) => ({
  name: t.function.name,
  description: t.function.description,
}));

export function isBuiltinTool(name: string): boolean {
  return BUILTIN_TOOL_DEFINITIONS.some((t) => t.function.name === name);
}

async function execSearchDocuments(args: { query?: string; limit?: number }) {
  const query = String(args.query ?? "").trim();
  if (!query) throw new Error("query is required");

  const limit = Math.min(Math.max(Math.round(args.limit ?? 5), 1), 10);
  const settings = await getSettings();
  const retrieved = await retrieveChunks(query, { limit: 12 });
  const { results } = await rankDocuments(query, retrieved, limit, settings.rerankMethod);

  incrementChunkUsage(results.map((r) => r.chunkId));

  if (results.length === 0) {
    return { results: [], note: "No relevant passages found for this query." };
  }

  return {
    results: results.map((r, i) => ({
      index: i + 1,
      document: r.documentName,
      excerpt: r.content.slice(0, 500),
      relevance: `${Math.round(Math.max(0, Math.min(1, r.relevanceScore)) * 100)}%`,
    })),
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

export async function executeBuiltinTool(
  name: string,
  args: Record<string, any>
): Promise<{ success: boolean; result: unknown }> {
  try {
    switch (name) {
      case "search_documents":
        return { success: true, result: await execSearchDocuments(args) };
      case "list_documents":
        return { success: true, result: await execListDocuments() };
      case "calculator":
        return { success: true, result: execCalculator(args) };
      case "current_datetime":
        return { success: true, result: execCurrentDatetime(args) };
      default:
        return { success: false, result: { error: `Unknown built-in tool: ${name}` } };
    }
  } catch (err: any) {
    return { success: false, result: { error: err?.message ?? "Tool call failed" } };
  }
}
