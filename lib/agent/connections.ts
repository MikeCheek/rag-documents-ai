import { eq, sql } from "drizzle-orm";
import { getDb, apiConnectionsTable } from "@/db";
import type { ApiAuthType, ApiConnectionRecord } from "@/types";
import { ValidationError } from "./tool-validation";

export const CONNECTION_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9 _.-]{0,63}$/;
const AUTH_TYPES: ApiAuthType[] = ["none", "bearer", "header", "query"];

/** Connections as the browser sees them — secrets reduced to "is one set". */
export async function listConnectionRecords(): Promise<ApiConnectionRecord[]> {
  const db = getDb();
  const rows = await db
    .select({
      c: apiConnectionsTable,
      // Qualified explicitly: an unqualified "id" inside the subquery would
      // resolve to agent_tools.id and always count 0.
      toolCount: sql<number>`(select count(*)::int from agent_tools t where t.connection_id = "api_connections"."id")`,
    })
    .from(apiConnectionsTable)
    .orderBy(apiConnectionsTable.createdAt);
  return rows.map(({ c, toolCount }) => ({
    id: c.id,
    name: c.name,
    baseUrl: c.baseUrl,
    authType: c.authType as ApiAuthType,
    authName: c.authName,
    hasSecret: !!c.authValue,
    headerNames: Object.keys((c.headers as Record<string, string> | null) ?? {}),
    allowPrivateNetwork: c.allowPrivateNetwork,
    toolCount: Number(toolCount),
    createdAt: c.createdAt.toISOString(),
  }));
}

export type ConnectionInput = {
  name?: string;
  baseUrl?: string;
  authType?: ApiAuthType;
  authName?: string | null;
  authValue?: string | null;
  headers?: Record<string, string> | null;
  allowPrivateNetwork?: boolean;
};

/**
 * Validates connection fields. On update (`partial`), only fields present
 * are checked, and an empty or missing secret leaves the stored one alone
 * (the browser never has it to send back).
 */
export function validateConnection(body: any, partial = false): ConnectionInput {
  const out: ConnectionInput = {};
  if (!partial || body?.name !== undefined) {
    const name = String(body?.name ?? "").trim();
    if (!CONNECTION_NAME_PATTERN.test(name)) throw new ValidationError("Connection name is required (letters, numbers, spaces, - _ .).");
    out.name = name;
  }
  if (!partial || body?.baseUrl !== undefined) {
    const baseUrl = String(body?.baseUrl ?? "").trim().replace(/\/+$/, "");
    try {
      const u = new URL(baseUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
    } catch {
      throw new ValidationError("Base URL must be a full http:// or https:// URL.");
    }
    out.baseUrl = baseUrl;
  }
  if (!partial || body?.authType !== undefined) {
    const authType = (body?.authType ?? "none") as ApiAuthType;
    if (!AUTH_TYPES.includes(authType)) throw new ValidationError("Invalid auth type.");
    out.authType = authType;
    const authName = typeof body?.authName === "string" ? body.authName.trim() : "";
    if ((authType === "header" || authType === "query") && !authName) {
      throw new ValidationError(authType === "header" ? "Header name is required." : "Query parameter name is required.");
    }
    out.authName = authType === "header" || authType === "query" ? authName : null;
    if (authType === "none") out.authValue = null;
  }
  if (typeof body?.authValue === "string" && body.authValue !== "" && out.authType !== "none") {
    out.authValue = body.authValue;
  }
  if (body?.clearSecret === true) out.authValue = null;
  if (body?.headers !== undefined) {
    if (body.headers === null) out.headers = null;
    else if (typeof body.headers === "object") {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(body.headers)) {
        if (!/^[A-Za-z0-9-]+$/.test(k)) throw new ValidationError(`Invalid header name: "${k}"`);
        headers[k] = String(v);
      }
      out.headers = Object.keys(headers).length ? headers : null;
    }
  }
  if (typeof body?.allowPrivateNetwork === "boolean") out.allowPrivateNetwork = body.allowPrivateNetwork;
  return out;
}

export async function connectionExists(id: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db.select({ id: apiConnectionsTable.id }).from(apiConnectionsTable).where(eq(apiConnectionsTable.id, id));
  return !!row;
}
