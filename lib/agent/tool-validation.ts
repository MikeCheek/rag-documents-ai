import type { HttpMethod, ToolParameter } from "@/types";

// Validation shared by the custom-tool routes (create, update, OpenAPI
// import), so every path into agent_tools enforces the same rules.

export const TOOL_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]{1,63}$/;
export const HTTP_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const PARAM_TYPES = ["string", "number", "integer", "boolean", "array", "object"];
const PARAM_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}$/;

export class ValidationError extends Error {}

export type ToolInput = {
  name: string;
  description: string;
  method: HttpMethod;
  urlTemplate: string;
  parameters: ToolParameter[];
  headers: Record<string, string> | null;
  connectionId: string | null;
};

function cleanParameters(raw: unknown): ToolParameter[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.map((p: any) => {
    const name = String(p?.name ?? "").trim();
    if (!PARAM_NAME_PATTERN.test(name)) throw new ValidationError(`Invalid parameter name: "${name}"`);
    if (seen.has(name)) throw new ValidationError(`Parameter "${name}" is listed twice.`);
    seen.add(name);
    if (!PARAM_TYPES.includes(p?.type)) throw new ValidationError(`Parameter "${name}" has an invalid type.`);
    const param: ToolParameter = {
      name,
      type: p.type,
      description: String(p?.description ?? "").slice(0, 1000),
      required: !!p?.required,
    };
    if (Array.isArray(p?.enum) && p.enum.length) param.enum = p.enum.map(String).slice(0, 100);
    return param;
  });
}

function cleanHeaders(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object") return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!/^[A-Za-z0-9-]+$/.test(k)) throw new ValidationError(`Invalid header name: "${k}"`);
    out[k] = String(v);
  }
  return Object.keys(out).length ? out : null;
}

/** Validates a full tool definition (create / import). */
export function validateTool(body: any): ToolInput {
  const name = String(body?.name ?? "").trim();
  if (!TOOL_NAME_PATTERN.test(name)) {
    throw new ValidationError(
      "Name must be 2-64 characters, start with a letter or underscore, and contain only letters, numbers, and underscores (it's used as the function name the model calls)."
    );
  }
  const description = String(body?.description ?? "").trim();
  if (!description) throw new ValidationError("Description is required.");

  const method = String(body?.method ?? "GET").toUpperCase() as HttpMethod;
  if (!HTTP_METHODS.includes(method)) throw new ValidationError(`Method must be one of ${HTTP_METHODS.join(", ")}.`);

  const connectionId = typeof body?.connectionId === "string" && body.connectionId ? body.connectionId : null;
  const urlTemplate = String(body?.urlTemplate ?? "").trim();
  validateUrlTemplate(urlTemplate, !!connectionId);

  return {
    name,
    description,
    method,
    urlTemplate,
    parameters: cleanParameters(body?.parameters),
    headers: cleanHeaders(body?.headers),
    connectionId,
  };
}

export function validateUrlTemplate(urlTemplate: string, hasConnection: boolean) {
  if (!urlTemplate) throw new ValidationError("URL is required.");
  const absolute = /^https?:\/\//i.test(urlTemplate);
  if (!absolute && !hasConnection) {
    throw new ValidationError("URL must start with http:// or https:// (or pick an API connection and use a path like /items/{id}).");
  }
  if (!absolute && !urlTemplate.startsWith("/")) {
    throw new ValidationError("A path for an API connection must start with /, e.g. /items/{id}.");
  }
}

/** Validates the fields present in a partial update. */
export function validateToolPatch(body: any): Partial<ToolInput> & { enabled?: boolean } {
  const patch: Partial<ToolInput> & { enabled?: boolean } = {};
  if (typeof body?.enabled === "boolean") patch.enabled = body.enabled;
  if (typeof body?.description === "string") {
    if (!body.description.trim()) throw new ValidationError("Description is required.");
    patch.description = body.description.trim();
  }
  if (body?.method !== undefined) {
    const method = String(body.method).toUpperCase() as HttpMethod;
    if (!HTTP_METHODS.includes(method)) throw new ValidationError(`Method must be one of ${HTTP_METHODS.join(", ")}.`);
    patch.method = method;
  }
  if (body?.connectionId !== undefined) patch.connectionId = body.connectionId || null;
  if (body?.urlTemplate !== undefined) patch.urlTemplate = String(body.urlTemplate).trim();
  if (body?.parameters !== undefined) patch.parameters = cleanParameters(body.parameters);
  if (body?.headers !== undefined) patch.headers = cleanHeaders(body.headers);
  return patch;
}
