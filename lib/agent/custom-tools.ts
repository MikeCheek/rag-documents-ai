import { eq } from "drizzle-orm";
import { getDb, agentToolsTable, apiConnectionsTable } from "@/db";
import type { AgentToolRecord, ApiAuthType, HttpMethod, ToolParameter } from "@/types";
import { guardedRequest } from "./ssrf-guard";

const TOOL_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_CHARS = 8_000;

/** An API connection with its secret — server-side only. */
export type ApiConnection = {
  id: string;
  name: string;
  baseUrl: string;
  authType: ApiAuthType;
  authName: string | null;
  authValue: string | null;
  headers: Record<string, string> | null;
  allowPrivateNetwork: boolean;
};

function rowToRecord(row: typeof agentToolsTable.$inferSelect): AgentToolRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    method: row.method as HttpMethod,
    urlTemplate: row.urlTemplate,
    parameters: row.parameters as ToolParameter[],
    headers: (row.headers as Record<string, string> | null) ?? null,
    connectionId: row.connectionId ?? null,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function rowToConnection(row: typeof apiConnectionsTable.$inferSelect): ApiConnection {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    authType: row.authType as ApiAuthType,
    authName: row.authName,
    authValue: row.authValue,
    headers: (row.headers as Record<string, string> | null) ?? null,
    allowPrivateNetwork: row.allowPrivateNetwork,
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

export async function loadCustomTool(id: string): Promise<AgentToolRecord | null> {
  const db = getDb();
  const [row] = await db.select().from(agentToolsTable).where(eq(agentToolsTable.id, id));
  return row ? rowToRecord(row) : null;
}

export async function loadConnections(): Promise<Map<string, ApiConnection>> {
  const db = getDb();
  const rows = await db.select().from(apiConnectionsTable);
  return new Map(rows.map((r) => [r.id, rowToConnection(r)]));
}

/** JSON schema for one parameter, as offered to the model. */
function parameterSchema(p: ToolParameter): Record<string, unknown> {
  const schema: Record<string, unknown> = { type: p.type, description: p.description };
  if (p.type === "array") schema.items = {};
  if (p.enum?.length) schema.enum = p.enum;
  return schema;
}

export function customToolToFunctionSchema(tool: AgentToolRecord) {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const p of tool.parameters) {
    properties[p.name] = parameterSchema(p);
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

function fillTemplate(template: string, args: Record<string, unknown>, usedKeys: Set<string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    usedKeys.add(key);
    const value = args[key];
    // Encoded, so a value can never change the URL's host or structure.
    return value === undefined || value === null ? "" : encodeURIComponent(String(value));
  });
}

function queryValue(value: unknown): string {
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export type PreparedRequest = {
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;
  body?: string;
  trustedHost?: string;
};

/**
 * Turns a tool definition plus the model's arguments into a concrete HTTP
 * request:
 *  - `{param}` placeholders in the URL template are filled (URL-encoded);
 *    query parameters left empty are dropped;
 *  - any other arguments go in the query string (GET, DELETE) or a JSON
 *    body (POST, PUT, PATCH);
 *  - with a connection, a relative template is resolved against its base
 *    URL and its auth and headers are applied — only for requests to that
 *    connection's own origin, so a secret never goes anywhere else.
 */
export function prepareRequest(
  tool: AgentToolRecord,
  args: Record<string, unknown>,
  connection?: ApiConnection | null
): PreparedRequest {
  const usedKeys = new Set<string>();
  const filled = fillTemplate(tool.urlTemplate, args, usedKeys);

  let url: URL;
  if (/^https?:\/\//i.test(filled)) {
    url = new URL(filled);
  } else if (connection) {
    url = new URL(connection.baseUrl.replace(/\/+$/, "") + "/" + filled.replace(/^\/+/, ""));
  } else {
    throw new Error(`"${tool.name}" has a relative URL but no API connection.`);
  }

  for (const [key, value] of [...url.searchParams.entries()]) {
    if (value === "") url.searchParams.delete(key);
  }

  const rest = Object.fromEntries(
    Object.entries(args).filter(([key, value]) => !usedKeys.has(key) && value !== undefined && value !== null)
  );
  const sendsBody = tool.method === "POST" || tool.method === "PUT" || tool.method === "PATCH";
  if (!sendsBody) {
    for (const [key, value] of Object.entries(rest)) url.searchParams.set(key, queryValue(value));
  }

  const headers: Record<string, string> = { Accept: "application/json, text/plain;q=0.9, */*;q=0.5" };
  let trustedHost: string | undefined;

  const sameOrigin = connection ? new URL(connection.baseUrl).origin === url.origin : false;
  if (connection && sameOrigin) {
    Object.assign(headers, connection.headers ?? {});
    if (connection.authValue) {
      if (connection.authType === "bearer") headers.Authorization = `Bearer ${connection.authValue}`;
      if (connection.authType === "header" && connection.authName) headers[connection.authName] = connection.authValue;
      if (connection.authType === "query" && connection.authName) {
        url.searchParams.set(connection.authName, connection.authValue);
      }
    }
    if (connection.allowPrivateNetwork) trustedHost = url.hostname.replace(/^\[|\]$/g, "");
  }
  Object.assign(headers, tool.headers ?? {});

  let body: string | undefined;
  if (sendsBody) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(rest);
  }

  return { url: url.toString(), method: tool.method, headers, body, trustedHost };
}

/** Replaces a secret wherever a response echoes it back (e.g. an error quoting the request). */
function redact(text: string, secret: string | null | undefined): string {
  return secret && secret.length >= 4 ? text.split(secret).join("[redacted]") : text;
}

export async function executeCustomTool(
  tool: AgentToolRecord,
  args: Record<string, unknown>,
  connection?: ApiConnection | null
): Promise<{ success: boolean; result: unknown }> {
  try {
    const request = prepareRequest(tool, args, connection);

    // Every hop (including redirects) is checked against private/internal
    // addresses at connect time — see lib/agent/ssrf-guard.ts — except the
    // connection's own host when the user allowed a private network.
    const res = await guardedRequest(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      timeoutMs: TOOL_TIMEOUT_MS,
      trustedHost: request.trustedHost,
      // Bytes, not chars, but close enough to bound what's read off the wire.
      maxBytes: MAX_RESPONSE_CHARS * 4,
    });

    const text = redact(res.text, connection?.authValue).slice(0, MAX_RESPONSE_CHARS);
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
  } catch (err: any) {
    return {
      success: false,
      result: { error: redact(err?.message ?? "Tool call failed", connection?.authValue) },
    };
  }
}
