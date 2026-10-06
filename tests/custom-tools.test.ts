import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executeCustomTool, prepareRequest, type ApiConnection } from "@/lib/agent/custom-tools";
import type { AgentToolRecord } from "@/types";

const tool = (over: Partial<AgentToolRecord>): AgentToolRecord => ({
  id: "t",
  name: "t",
  description: "",
  method: "GET",
  urlTemplate: "",
  parameters: [],
  headers: null,
  connectionId: null,
  enabled: true,
  createdAt: "",
  updatedAt: "",
  ...over,
});

const conn = (over: Partial<ApiConnection>): ApiConnection => ({
  id: "c",
  name: "api",
  baseUrl: "https://api.example.com/v1/",
  authType: "none",
  authName: null,
  authValue: null,
  headers: null,
  allowPrivateNetwork: false,
  ...over,
});

describe("prepareRequest", () => {
  it("fills path placeholders (encoded), drops empty query params, sends the rest as query for GET", () => {
    const r = prepareRequest(
      tool({ urlTemplate: "/pets/{id}?limit={limit}&q={q}" }),
      { id: "a/b c", q: "cats", extra: 5 },
      conn({})
    );
    expect(r.url).toBe("https://api.example.com/v1/pets/a%2Fb%20c?q=cats&extra=5");
    expect(r.body).toBeUndefined();
  });

  it("sends unused arguments as a JSON body for POST/PUT/PATCH", () => {
    const r = prepareRequest(tool({ method: "PATCH", urlTemplate: "/pets/{id}" }), { id: 7, name: "Rex", tags: ["a"] }, conn({}));
    expect(r.url).toBe("https://api.example.com/v1/pets/7");
    expect(JSON.parse(r.body!)).toEqual({ name: "Rex", tags: ["a"] });
    expect(r.headers["Content-Type"]).toBe("application/json");
  });

  it.each([
    ["bearer", null, (r: any) => expect(r.headers.Authorization).toBe("Bearer tok")],
    ["header", "X-API-Key", (r: any) => expect(r.headers["X-API-Key"]).toBe("tok")],
    ["query", "api_key", (r: any) => expect(new URL(r.url).searchParams.get("api_key")).toBe("tok")],
  ] as const)("applies %s auth", (authType, authName, check) => {
    check(prepareRequest(tool({ urlTemplate: "/x" }), {}, conn({ authType, authName, authValue: "tok" })));
  });

  it("never sends a connection's secret to another origin", () => {
    const r = prepareRequest(
      tool({ urlTemplate: "https://elsewhere.example.org/x" }),
      {},
      conn({ authType: "bearer", authValue: "tok", headers: { "X-Org": "1" } })
    );
    expect(r.headers.Authorization).toBeUndefined();
    expect(r.headers["X-Org"]).toBeUndefined();
  });

  it("only trusts the connection's own host, and only when allowed", () => {
    expect(prepareRequest(tool({ urlTemplate: "/x" }), {}, conn({ allowPrivateNetwork: true })).trustedHost).toBe("api.example.com");
    expect(prepareRequest(tool({ urlTemplate: "/x" }), {}, conn({})).trustedHost).toBeUndefined();
  });

  it("refuses a relative URL without a connection", () => {
    expect(() => prepareRequest(tool({ urlTemplate: "/x" }), {})).toThrow(/no API connection/);
  });
});

describe("executeCustomTool against a local API", () => {
  let server: http.Server;
  let base: string;
  const seen: { method?: string; url?: string; auth?: string; body?: string }[] = [];

  beforeAll(async () => {
    server = http.createServer(async (req, res) => {
      let body = "";
      for await (const c of req) body += c;
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
      if (req.url?.startsWith("/echo-secret")) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `bad token ${req.headers.authorization}` }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, method: req.method }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("blocks a private address unless the connection allows it", async () => {
    const blocked = await executeCustomTool(tool({ urlTemplate: "/items" }), {}, conn({ baseUrl: base }));
    expect(blocked.success).toBe(false);
    expect(JSON.stringify(blocked.result)).toMatch(/private\/internal/);

    const allowed = await executeCustomTool(
      tool({ method: "PUT", urlTemplate: "/items/{id}" }),
      { id: 3, title: "x" },
      conn({ baseUrl: base, allowPrivateNetwork: true, authType: "bearer", authValue: "tok123" })
    );
    expect(allowed).toEqual({ success: true, result: { ok: true, method: "PUT" } });
    expect(seen.at(-1)).toMatchObject({ method: "PUT", url: "/items/3", auth: "Bearer tok123", body: '{"title":"x"}' });
  });

  it("redacts the secret if the API echoes it back", async () => {
    const res = await executeCustomTool(
      tool({ urlTemplate: "/echo-secret" }),
      {},
      conn({ baseUrl: base, allowPrivateNetwork: true, authType: "bearer", authValue: "tok123" })
    );
    expect(res.success).toBe(false);
    expect(JSON.stringify(res.result)).not.toContain("tok123");
    expect(JSON.stringify(res.result)).toContain("[redacted]");
  });
});
