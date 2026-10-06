import type { McpTransportType } from "@/types";
import { MCP_SERVER_NAME_PATTERN } from "./mcp";
import { ValidationError } from "./tool-validation";

const TRANSPORTS: McpTransportType[] = ["http", "sse", "stdio"];

function stringRecord(raw: unknown, what: string, keyPattern: RegExp): Record<string, string> | null {
  if (raw === null) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ValidationError(`${what} must be an object.`);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!keyPattern.test(k)) throw new ValidationError(`Invalid ${what.toLowerCase()} name: "${k}"`);
    out[k] = String(v);
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Validates MCP server fields. Header and env values are write-only: on
 * update, a key sent with an empty value keeps its stored value (the
 * browser never has it), and `merge` combines them with what's stored.
 */
export function validateMcpServer(body: any, partial = false) {
  const out: Record<string, any> = {};
  if (!partial || body?.name !== undefined) {
    const name = String(body?.name ?? "").trim();
    if (!MCP_SERVER_NAME_PATTERN.test(name)) {
      throw new ValidationError("Name must start with a letter and use only letters, numbers, - and _ (max 32). Tools are offered as <name>__<tool>.");
    }
    out.name = name;
  }
  const transport = (body?.transport ?? (partial ? undefined : "http")) as McpTransportType | undefined;
  if (transport !== undefined) {
    if (!TRANSPORTS.includes(transport)) throw new ValidationError("Transport must be http, sse or stdio.");
    out.transport = transport;
  }
  if (body?.url !== undefined || (!partial && transport !== "stdio")) {
    const url = String(body?.url ?? "").trim();
    if (transport !== "stdio" || url) {
      try {
        const u = new URL(url);
        if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
      } catch {
        throw new ValidationError("Server URL must be a full http:// or https:// URL.");
      }
    }
    out.url = url || null;
  }
  if (body?.command !== undefined || (!partial && transport === "stdio")) {
    const command = String(body?.command ?? "").trim();
    if (transport === "stdio" && !command) throw new ValidationError("A command is required for stdio servers.");
    out.command = command || null;
  }
  if (body?.args !== undefined) {
    if (!Array.isArray(body.args)) throw new ValidationError("Arguments must be a list.");
    out.args = body.args.map(String);
  }
  if (body?.headers !== undefined) out.headers = stringRecord(body.headers, "Headers", /^[A-Za-z0-9-]+$/);
  if (body?.env !== undefined) out.env = stringRecord(body.env, "Environment variables", /^[A-Za-z_][A-Za-z0-9_]*$/);
  if (typeof body?.enabled === "boolean") out.enabled = body.enabled;
  if (body?.disabledTools !== undefined) {
    if (!Array.isArray(body.disabledTools)) throw new ValidationError("disabledTools must be a list.");
    out.disabledTools = body.disabledTools.map(String);
  }
  return out;
}

/** Applies write-only semantics: empty values keep what's stored. */
export function mergeSecrets(
  incoming: Record<string, string> | null | undefined,
  stored: Record<string, string> | null
): Record<string, string> | null | undefined {
  if (incoming === undefined) return undefined;
  if (incoming === null) return null;
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries(incoming)) {
    const value = v === "" ? stored?.[k] : v;
    if (value !== undefined) merged[k] = value;
  }
  return Object.keys(merged).length ? merged : null;
}
