import http from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

/**
 * A real MCP server over Streamable HTTP on localhost, with two tools.
 * Requires `Authorization: Bearer <token>` when a token is given.
 */
export async function startTestMcpServer(token?: string) {
  const server = http.createServer(async (req, res) => {
    if (token && req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401).end("unauthorized");
      return;
    }
    // Stateless: a fresh MCP server and transport per request.
    const mcp = new McpServer({ name: "test-server", version: "1.0.0" });
    mcp.tool("add", "Adds two numbers", { a: z.number(), b: z.number() }, async ({ a, b }) => ({
      content: [{ type: "text", text: String(a + b) }],
    }));
    mcp.tool("fail", "Always fails", {}, async () => ({
      isError: true,
      content: [{ type: "text", text: "something went wrong" }],
    }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      mcp.close();
    });
    await mcp.connect(transport);
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    await transport.handleRequest(req, res, body);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
