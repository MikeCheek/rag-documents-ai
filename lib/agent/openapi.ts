import type { ApiAuthType, HttpMethod, ToolParameter, ToolParameterType } from "@/types";

// Turns an OpenAPI 3.x or Swagger 2.0 document (JSON or YAML) into tool
// definitions for an API connection: one tool per operation, with path
// and query parameters as URL placeholders and JSON request-body fields as
// tool parameters. Only what's needed for that is read; anything the
// executor can't send (non-JSON bodies, bodies that aren't objects) is
// reported as unsupported rather than half-imported.

export type ImportedOperation = {
  /** Suggested tool name (function-name safe, unique within the spec). */
  name: string;
  method: HttpMethod;
  path: string;
  /** Relative URL template for the connection, e.g. /pets/{petId}?limit={limit} */
  urlTemplate: string;
  description: string;
  parameters: ToolParameter[];
  /** Why this operation can't be imported, if it can't. */
  unsupported?: string;
};

export type ImportedSpec = {
  title: string;
  /** Absolute base URL, or "" if the spec doesn't say (the user fills it in). */
  baseUrl: string;
  auth: { type: ApiAuthType; name: string | null; description: string } | null;
  operations: ImportedOperation[];
};

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const MAX_DESCRIPTION = 1000;

export async function parseSpecText(text: string): Promise<any> {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const { parse } = await import("yaml");
  return parse(trimmed);
}

/** Follows a local "#/components/..." reference (a few levels deep at most). */
function resolve(spec: any, node: any, depth = 0): any {
  if (!node || typeof node !== "object" || !node.$ref || depth > 8) return node;
  const ref: string = node.$ref;
  if (!ref.startsWith("#/")) return {};
  const target = ref
    .slice(2)
    .split("/")
    .reduce((obj: any, key) => obj?.[key.replace(/~1/g, "/").replace(/~0/g, "~")], spec);
  return resolve(spec, target, depth + 1);
}

function toParamType(schema: any): ToolParameterType {
  const t = Array.isArray(schema?.type) ? schema.type.find((x: string) => x !== "null") : schema?.type;
  if (t === "integer" || t === "number" || t === "boolean" || t === "array" || t === "object") return t;
  if (!t && schema?.properties) return "object";
  return "string";
}

export function toolNameFor(operationId: string | undefined, method: string, path: string): string {
  const base = operationId || `${method.toLowerCase()}_${path}`;
  const name = base
    .replace(/[{}]/g, "")
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  const safe = /^[a-zA-Z_]/.test(name) ? name : `op_${name}`;
  return safe.slice(0, 64) || "operation";
}

function baseUrlOf(spec: any, specUrl?: string): string {
  if (spec.swagger && spec.host) {
    const scheme = spec.schemes?.includes("https") ? "https" : spec.schemes?.[0] ?? "https";
    return `${scheme}://${spec.host}${spec.basePath ?? ""}`.replace(/\/+$/, "");
  }
  const server = spec.servers?.[0];
  if (!server?.url) return specUrl ? new URL(specUrl).origin : "";
  let url: string = server.url;
  for (const [name, v] of Object.entries<any>(server.variables ?? {})) url = url.replace(`{${name}}`, v.default ?? "");
  try {
    return new URL(url, specUrl).toString().replace(/\/+$/, "");
  } catch {
    return /^https?:\/\//.test(url) ? url.replace(/\/+$/, "") : "";
  }
}

function authOf(spec: any): ImportedSpec["auth"] {
  const schemes = spec.components?.securitySchemes ?? spec.securityDefinitions ?? {};
  for (const [key, raw] of Object.entries<any>(schemes)) {
    const s = resolve(spec, raw);
    if ((s.type === "http" && s.scheme?.toLowerCase() === "bearer") || s.type === "oauth2" || s.type === "openIdConnect") {
      return { type: "bearer", name: null, description: `${key}: bearer token` };
    }
    if (s.type === "apiKey" && (s.in === "header" || s.in === "query")) {
      return { type: s.in === "header" ? "header" : "query", name: s.name, description: `${key}: API key in ${s.in} "${s.name}"` };
    }
  }
  return null;
}

export function importSpec(spec: any, specUrl?: string): ImportedSpec {
  if (!spec || typeof spec !== "object" || (!spec.openapi && !spec.swagger) || !spec.paths) {
    throw new Error("This doesn't look like an OpenAPI/Swagger document (no \"openapi\"/\"swagger\" and \"paths\").");
  }

  const operations: ImportedOperation[] = [];
  const usedNames = new Set<string>();

  for (const [path, rawItem] of Object.entries<any>(spec.paths)) {
    const item = resolve(spec, rawItem);
    for (const method of METHODS) {
      const op = item?.[method.toLowerCase()];
      if (!op) continue;

      let name = toolNameFor(op.operationId, method, path);
      for (let i = 2; usedNames.has(name); i++) name = `${name.slice(0, 60)}_${i}`;
      usedNames.add(name);

      const parameters: ToolParameter[] = [];
      const query: string[] = [];
      let unsupported: string | undefined;

      const allParams = [...(item.parameters ?? []), ...(op.parameters ?? [])].map((p: any) => resolve(spec, p));
      // Operation-level parameters override path-level ones with the same name+location.
      const byKey = new Map<string, any>();
      for (const p of allParams) byKey.set(`${p.in}:${p.name}`, p);

      for (const p of byKey.values()) {
        if (p.in === "body") {
          // Swagger 2.0 body parameter.
          const schema = resolve(spec, p.schema);
          if (toParamType(schema) !== "object") unsupported = "its request body isn't a JSON object";
          else addBodyFields(spec, schema, parameters);
          continue;
        }
        if (p.in !== "path" && p.in !== "query") continue; // header/cookie: the connection handles auth
        const schema = resolve(spec, p.schema ?? p);
        parameters.push({
          name: p.name,
          type: toParamType(schema),
          description: truncate(p.description ?? `${p.in} parameter`),
          required: p.in === "path" ? true : !!p.required,
          ...(Array.isArray(schema?.enum) ? { enum: schema.enum.map(String) } : {}),
        });
        if (p.in === "query") query.push(p.name);
      }

      const body = resolve(spec, op.requestBody);
      if (body?.content) {
        const json = body.content["application/json"] ?? Object.entries<any>(body.content).find(([t]) => t.endsWith("+json"))?.[1];
        if (!json) unsupported = `its request body isn't JSON (${Object.keys(body.content).join(", ")})`;
        else {
          const schema = resolve(spec, json.schema);
          if (toParamType(schema) !== "object") unsupported = "its request body isn't a JSON object";
          else addBodyFields(spec, schema, parameters, !body.required);
        }
      }

      const urlTemplate = path + (query.length ? `?${query.map((q) => `${q}={${q}}`).join("&")}` : "");
      const description = truncate([op.summary, op.description].filter(Boolean).join(". ") || `${method} ${path}`);
      operations.push({ name, method, path, urlTemplate, description, parameters, ...(unsupported ? { unsupported } : {}) });
    }
  }

  return {
    title: spec.info?.title ?? "API",
    baseUrl: baseUrlOf(spec, specUrl),
    auth: authOf(spec),
    operations,
  };
}

function addBodyFields(spec: any, schema: any, parameters: ToolParameter[], bodyOptional = false) {
  const merged = mergeAllOf(spec, schema);
  const required = new Set<string>(merged.required ?? []);
  for (const [field, raw] of Object.entries<any>(merged.properties ?? {})) {
    if (parameters.some((p) => p.name === field)) continue;
    const s = resolve(spec, raw);
    if (s?.readOnly) continue;
    parameters.push({
      name: field,
      type: toParamType(s),
      description: truncate(s?.description ?? "request body field"),
      required: !bodyOptional && required.has(field),
      ...(Array.isArray(s?.enum) ? { enum: s.enum.map(String) } : {}),
    });
  }
}

function mergeAllOf(spec: any, schema: any): any {
  const s = resolve(spec, schema);
  if (!s?.allOf) return s ?? {};
  return s.allOf.reduce(
    (acc: any, part: any) => {
      const m = mergeAllOf(spec, part);
      return {
        properties: { ...acc.properties, ...(m.properties ?? {}) },
        required: [...acc.required, ...(m.required ?? [])],
      };
    },
    { properties: { ...(s.properties ?? {}) }, required: [...(s.required ?? [])] }
  );
}

function truncate(text: string): string {
  return text.length > MAX_DESCRIPTION ? text.slice(0, MAX_DESCRIPTION - 1) + "…" : text;
}
