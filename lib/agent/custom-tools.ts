import { eq } from "drizzle-orm";
import { getDb, agentToolsTable } from "@/db";
import type { AgentToolRecord, ToolParameter } from "@/types";
import { assertSafeToolUrl } from "./ssrf-guard";

const TOOL_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_CHARS = 8_000;

function rowToRecord(row: typeof agentToolsTable.$inferSelect): AgentToolRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    method: row.method as "GET" | "POST",
    urlTemplate: row.urlTemplate,
    parameters: row.parameters as ToolParameter[],
    headers: (row.headers as Record<string, string> | null) ?? null,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function loadEnabledCustomTools(): Promise<AgentToolRecord[]> {
  const db = getDb();
  const rows = await db.select().from(agentToolsTable).where(eq(agentToolsTable.enabled, true));
  return rows.map(rowToRecord);
}

export async function loadAllCustomTools(): Promise<AgentToolRecord[]> {
  const db = getDb();
  const rows = await db.select().from(agentToolsTable);
  return rows.map(rowToRecord);
}

export function customToolToFunctionSchema(tool: AgentToolRecord) {
  const properties: Record<string, { type: string; description: string }> = {};
  const required: string[] = [];

  for (const p of tool.parameters) {
    properties[p.name] = { type: p.type, description: p.description };
    if (p.required) required.push(p.name);
  }

  return {
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: { type: "object", properties, required },
    },
  };
}

function fillTemplate(
  template: string,
  args: Record<string, unknown>,
  usedKeys: Set<string>
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    usedKeys.add(key);
    const value = args[key];
    return value === undefined ? "" : encodeURIComponent(String(value));
  });
}

export async function executeCustomTool(
  tool: AgentToolRecord,
  args: Record<string, unknown>
): Promise<{ success: boolean; result: unknown }> {
  try {
    const usedKeys = new Set<string>();
    let urlStr = fillTemplate(tool.urlTemplate, args, usedKeys);

    if (tool.method === "GET") {
      const url = new URL(urlStr);
      for (const [key, value] of Object.entries(args)) {
        if (usedKeys.has(key) || value === undefined) continue;
        url.searchParams.set(key, String(value));
      }
      urlStr = url.toString();
    }

    const safeUrl = await assertSafeToolUrl(urlStr);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS);

    try {
      const res = await fetch(safeUrl.toString(), {
        method: tool.method,
        headers: {
          ...(tool.headers ?? {}),
          ...(tool.method === "POST" ? { "Content-Type": "application/json" } : {}),
        },
        body: tool.method === "POST" ? JSON.stringify(args) : undefined,
        signal: controller.signal,
      });

      const text = (await res.text()).slice(0, MAX_RESPONSE_CHARS);
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        // Not JSON — keep as plain text.
      }

      if (!res.ok) {
        return { success: false, result: { status: res.status, body: parsed } };
      }
      return { success: true, result: parsed };
    } finally {
      clearTimeout(timeout);
    }
  } catch (err: any) {
    return { success: false, result: { error: err?.message ?? "Tool call failed" } };
  }
}
