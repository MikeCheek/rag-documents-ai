import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { startTestMcpServer } from "./helpers/mcp-server";

// The Integrations API routes against real Postgres (and a real MCP
// server): what's stored, what's returned to the browser, what cascades.
const url = process.env.TEST_DATABASE_URL;
const TAG = `int${Date.now()}`;

const req = (path: string, method = "GET", body?: unknown) =>
  new NextRequest(`http://localhost${path}`, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });

describe.skipIf(!url)("Integrations API (real Postgres)", () => {
  let db: any;
  let schema: typeof import("@/db");
  let orm: typeof import("drizzle-orm");
  let mcp: Awaited<ReturnType<typeof startTestMcpServer>>;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    schema = await import("@/db");
    orm = await import("drizzle-orm");
    db = schema.getDb();
    mcp = await startTestMcpServer("tok-abc");
  });

  afterAll(async () => {
    await mcp?.close();
    if (!db) return;
    await db.delete(schema.apiConnectionsTable).where(orm.like(schema.apiConnectionsTable.name, `${TAG}%`));
    await db.delete(schema.mcpServersTable).where(orm.like(schema.mcpServersTable.name, `${TAG}%`));
  });

  it("creates a connection with tools, counts them, and never returns the secret", async () => {
    const { POST, GET } = await import("@/app/api/api-connections/route");
    const created = await POST(
      req("/api/api-connections", "POST", {
        name: `${TAG} api`,
        baseUrl: "https://api.example.com/v1/",
        authType: "header",
        authName: "X-API-Key",
        authValue: "super-secret-key",
        tools: [
          { name: `${TAG}_list`, description: "List items", method: "GET", urlTemplate: "/items?limit={limit}", parameters: [{ name: "limit", type: "integer", description: "", required: false }] },
          { name: `${TAG}_create`, description: "Create item", method: "POST", urlTemplate: "/items", parameters: [] },
        ],
      })
    );
    expect(created.status).toBe(200);
    const { id, toolsCreated } = await created.json();
    expect(toolsCreated).toBe(2);

    const listed = await (await GET()).text();
    expect(listed).not.toContain("super-secret-key");
    const mine = JSON.parse(listed).connections.find((c: any) => c.id === id);
    expect(mine).toMatchObject({ baseUrl: "https://api.example.com/v1", hasSecret: true, toolCount: 2, authName: "X-API-Key" });

    // Updating without a secret keeps the stored one.
    const { PATCH, DELETE } = await import("@/app/api/api-connections/[id]/route");
    expect((await PATCH(req(`/x`, "PATCH", { authValue: "", baseUrl: "https://api.example.com/v2" }), { params: { id } })).status).toBe(200);
    const [row] = await db.select().from(schema.apiConnectionsTable).where(orm.eq(schema.apiConnectionsTable.id, id));
    expect(row).toMatchObject({ authValue: "super-secret-key", baseUrl: "https://api.example.com/v2" });

    // Deleting the connection deletes its tools.
    await DELETE(req("/x", "DELETE"), { params: { id } });
    const tools = await db.select().from(schema.agentToolsTable).where(orm.like(schema.agentToolsTable.name, `${TAG}%`));
    expect(tools).toHaveLength(0);
  });

  it("rejects a tool import that clashes with a built-in tool, creating nothing", async () => {
    const { POST } = await import("@/app/api/api-connections/route");
    const res = await POST(
      req("/api/api-connections", "POST", {
        name: `${TAG} clash`,
        baseUrl: "https://api.example.com",
        tools: [{ name: "calculator", description: "x", method: "GET", urlTemplate: "/x" }],
      })
    );
    expect(res.status).toBe(400);
    const rows = await db.select().from(schema.apiConnectionsTable).where(orm.eq(schema.apiConnectionsTable.name, `${TAG} clash`));
    expect(rows).toHaveLength(0);
  });

  it("reads an OpenAPI spec from a URL", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/yaml" });
      res.end("openapi: 3.0.0\ninfo: {title: Demo}\nservers: [{url: /api}]\npaths:\n  /ping:\n    get: {operationId: ping, summary: Ping}\n");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const specUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/openapi.yaml`;
    try {
      const { POST } = await import("@/app/api/api-connections/openapi/route");
      const res = await POST(req("/x", "POST", { url: specUrl }));
      const spec = await res.json();
      expect(spec.title).toBe("Demo");
      expect(spec.baseUrl).toBe(specUrl.replace("/openapi.yaml", "/api"));
      expect(spec.operations.map((o: any) => o.name)).toEqual(["ping"]);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("stores an MCP server, lists its tools live, and keeps header values server-side", async () => {
    const { POST, GET } = await import("@/app/api/mcp-servers/route");
    const created = await POST(
      req("/x", "POST", { name: `${TAG}calc`, transport: "http", url: mcp.url, headers: { Authorization: "Bearer tok-abc" } })
    );
    expect(created.status).toBe(200);
    const { id } = await created.json();

    const listed = await (await GET()).text();
    expect(listed).not.toContain("tok-abc");
    expect(JSON.parse(listed).servers.find((s: any) => s.id === id).headerNames).toEqual(["Authorization"]);

    const tools = await import("@/app/api/mcp-servers/[id]/tools/route");
    const res = await tools.GET(new Request("http://x"), { params: { id } });
    expect((await res.json()).tools.map((t: any) => t.name)).toEqual(["add", "fail"]);

    // Turning a tool off, with a blank header value kept as-is.
    const { PATCH } = await import("@/app/api/mcp-servers/[id]/route");
    await PATCH(req("/x", "PATCH", { disabledTools: ["fail"], headers: { Authorization: "" } }), { params: { id } });
    const [row] = await db.select().from(schema.mcpServersTable).where(orm.eq(schema.mcpServersTable.id, id));
    expect(row.headers).toEqual({ Authorization: "Bearer tok-abc" });

    // What the agent gets for a turn: the enabled tools, callable.
    const { openMcpTools } = await import("@/lib/agent/mcp");
    const session = await openMcpTools();
    try {
      const mine = session.tools.filter((t) => t.name.startsWith(`${TAG}calc__`));
      expect(mine.map((t) => t.name)).toEqual([`${TAG}calc__add`]);
      expect(await mine[0].call({ a: 20, b: 22 })).toEqual({ success: true, result: "42" });
    } finally {
      await session.close();
    }
  });
});
