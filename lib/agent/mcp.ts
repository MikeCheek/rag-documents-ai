import { eq } from "drizzle-orm";
import { getDb, mcpServersTable } from "@/db";
import type { McpServerRecord, McpToolInfo, McpTransportType } from "@/types";

// Model Context Protocol servers as a source of Agent-mode tools. Each
// enabled server is connected at the start of an Agent turn, its tools are
// offered to the model as `<server>__<tool>`, and the connection is closed
// when the turn ends. A server that can't be reached is skipped (and the
// turn says so) rather than failing the whole answer.
//
// Transports: "http" (Streamable HTTP, the current MCP standard) and "sse"
// (the older HTTP+SSE transport) connect to a URL. "stdio" launches a
// local command, which means running a program on this server, so it's
// refused unless ALLOW_MCP_STDIO=1 is set.

const CONNECT_TIMEOUT_MS = 10_000;
const CALL_TIMEOUT_MS = 30_000;
const MAX_RESULT_CHARS = 8_000;

export const MCP_SERVER_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/;

/** A server with its secrets (header and env values) — server-side only. */
export type McpServerConfig = {
  id: string;
  name: string;
  transport: McpTransportType;
  url: string | null;
  headers: Record<string, string> | null;
  command: string | null;
  args: string[];
  env: Record<string, string> | null;
  enabled: boolean;
  disabledTools: string[];
  createdAt: Date;
};

function rowToConfig(row: typeof mcpServersTable.$inferSelect): McpServerConfig {
  return {
    id: row.id,
    name: row.name,
    transport: row.transport as McpTransportType,
    url: row.url,
    headers: (row.headers as Record<string, string> | null) ?? null,
    command: row.command,
    args: (row.args as string[] | null) ?? [],
    env: (row.env as Record<string, string> | null) ?? null,
    enabled: row.enabled,
    disabledTools: (row.disabledTools as string[] | null) ?? [],
    createdAt: row.createdAt,
  };
}

/** What the browser may see: names of headers/env vars, never their values. */
export function toPublicRecord(server: McpServerConfig): McpServerRecord {
  return {
    id: server.id,
    name: server.name,
    transport: server.transport,
    url: server.url,
    headerNames: Object.keys(server.headers ?? {}),
    command: server.command,
    args: server.args,
    envNames: Object.keys(server.env ?? {}),
    enabled: server.enabled,
    disabledTools: server.disabledTools,
    createdAt: server.createdAt.toISOString(),
  };
}

export async function loadMcpServers(onlyEnabled = false): Promise<McpServerConfig[]> {
  const db = getDb();
  const rows = onlyEnabled
    ? await db.select().from(mcpServersTable).where(eq(mcpServersTable.enabled, true))
    : await db.select().from(mcpServersTable);
  return rows.map(rowToConfig);
}

export async function loadMcpServer(id: string): Promise<McpServerConfig | null> {
  const db = getDb();
  const [row] = await db.select().from(mcpServersTable).where(eq(mcpServersTable.id, id));
  return row ? rowToConfig(row) : null;
}

export function stdioAllowed(): boolean {
  return process.env.ALLOW_MCP_STDIO === "1";
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms);
    promise.then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e) => (clearTimeout(timer), reject(e))
    );
  });
}

type McpClient = Awaited<ReturnType<typeof import("@ai-sdk/mcp").createMCPClient>>;

export async function connectMcpServer(server: McpServerConfig): Promise<McpClient> {
  const { createMCPClient } = await import("@ai-sdk/mcp");
  let transport: any;
  if (server.transport === "stdio") {
    if (!stdioAllowed()) {
      throw new Error("stdio MCP servers are disabled. Set ALLOW_MCP_STDIO=1 to allow launching local commands.");
    }
    if (!server.command) throw new Error("No command configured.");
    const { Experimental_StdioMCPTransport } = await import("@ai-sdk/mcp/mcp-stdio");
    transport = new Experimental_StdioMCPTransport({
      command: server.command,
      args: server.args,
      env: { ...(process.env as Record<string, string>), ...(server.env ?? {}) },
      stderr: "ignore",
    });
  } else {
    if (!server.url) throw new Error("No URL configured.");
    transport = { type: server.transport, url: server.url, headers: server.headers ?? undefined };
  }
  return withTimeout(
    createMCPClient({ transport, clientName: "reading-room" }),
    CONNECT_TIMEOUT_MS,
    `Connecting to ${server.name}`
  );
}

/** Tool names as the model sees them: `<server>__<tool>`, function-name safe. */
export function mcpToolName(server: string, tool: string): string {
  return `${server}__${tool}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

/** Flattens an MCP tool result (text, images, resources) into text for the model. */
export function mcpResultToText(result: any): string {
  const parts: string[] = [];
  for (const item of result?.content ?? []) {
    if (item.type === "text") parts.push(item.text);
    else if (item.type === "image") parts.push(`[image: ${item.mimeType ?? "unknown type"}]`);
    else if (item.type === "audio") parts.push(`[audio: ${item.mimeType ?? "unknown type"}]`);
    else if (item.type === "resource") parts.push(item.resource?.text ?? `[resource: ${item.resource?.uri}]`);
    else if (item.type === "resource_link") parts.push(`[resource: ${item.uri}]`);
  }
  if (parts.length === 0 && result?.structuredContent) parts.push(JSON.stringify(result.structuredContent));
  if (parts.length === 0 && result?.toolResult !== undefined) parts.push(JSON.stringify(result.toolResult));
  const text = parts.join("\n\n");
  return text.length > MAX_RESULT_CHARS ? text.slice(0, MAX_RESULT_CHARS) + "\n…(truncated)" : text;
}

/** Lists a server's tools (for Settings), marking which are switched off. */
export async function listServerTools(server: McpServerConfig): Promise<McpToolInfo[]> {
  const client = await connectMcpServer(server);
  try {
    const { tools } = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS, `Listing ${server.name}'s tools`);
    return tools.map((t: any) => ({
      name: t.name,
      description: t.description ?? "",
      enabled: !server.disabledTools.includes(t.name),
    }));
  } finally {
    await client.close().catch(() => {});
  }
}

export type McpAgentTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  call: (args: Record<string, unknown>) => Promise<{ success: boolean; result: unknown }>;
};

/**
 * Connects to every enabled server for one Agent turn. Returns the tools
 * to offer, the servers that failed to connect (with why), and a close()
 * the caller must run when the turn ends.
 */
export async function openMcpTools(abortSignal?: AbortSignal): Promise<{
  tools: McpAgentTool[];
  failures: { server: string; error: string }[];
  close: () => Promise<void>;
}> {
  const servers = await loadMcpServers(true);
  const clients: McpClient[] = [];
  const tools: McpAgentTool[] = [];
  const failures: { server: string; error: string }[] = [];

  await Promise.all(
    servers.map(async (server) => {
      try {
        const client = await connectMcpServer(server);
        clients.push(client);
        const { tools: listed } = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS, `Listing ${server.name}'s tools`);
        for (const t of listed as any[]) {
          if (server.disabledTools.includes(t.name)) continue;
          tools.push({
            name: mcpToolName(server.name, t.name),
            description: `[${server.name}] ${t.description ?? t.title ?? t.name}`,
            inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
            call: async (args) => {
              try {
                const result = await client.callTool({
                  name: t.name,
                  arguments: args,
                  options: { signal: abortSignal, timeout: CALL_TIMEOUT_MS },
                });
                return { success: !(result as any).isError, result: mcpResultToText(result) };
              } catch (err: any) {
                return { success: false, result: { error: err?.message ?? "MCP tool call failed" } };
              }
            },
          });
        }
      } catch (err: any) {
        failures.push({ server: server.name, error: err?.message ?? String(err) });
      }
    })
  );

  return {
    tools,
    failures,
    close: async () => {
      await Promise.all(clients.map((c) => c.close().catch(() => {})));
    },
  };
}
