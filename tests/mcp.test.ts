import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectMcpServer,
  listServerTools,
  mcpResultToText,
  mcpToolName,
  type McpServerConfig,
} from "@/lib/agent/mcp";
import { startTestMcpServer } from "./helpers/mcp-server";

const config = (over: Partial<McpServerConfig>): McpServerConfig => ({
  id: "x",
  name: "calc",
  transport: "http",
  url: null,
  headers: null,
  command: null,
  args: [],
  env: null,
  enabled: true,
  disabledTools: [],
  createdAt: new Date(),
  ...over,
});

describe("MCP client against a real Streamable HTTP server", () => {
  let server: Awaited<ReturnType<typeof startTestMcpServer>>;
  beforeAll(async () => {
    server = await startTestMcpServer("s3cret");
  });
  afterAll(() => server.close());

  it("lists tools, marking switched-off ones", async () => {
    const tools = await listServerTools(
      config({ url: server.url, headers: { Authorization: "Bearer s3cret" }, disabledTools: ["fail"] })
    );
    expect(tools).toEqual([
      { name: "add", description: "Adds two numbers", enabled: true },
      { name: "fail", description: "Always fails", enabled: false },
    ]);
  });

  it("calls a tool and reports tool errors", async () => {
    const client = await connectMcpServer(config({ url: server.url, headers: { Authorization: "Bearer s3cret" } }));
    try {
      const ok = await client.callTool({ name: "add", arguments: { a: 2, b: 40 } });
      expect(mcpResultToText(ok)).toBe("42");
      const bad = await client.callTool({ name: "fail", arguments: {} });
      expect((bad as any).isError).toBe(true);
      expect(mcpResultToText(bad)).toBe("something went wrong");
    } finally {
      await client.close();
    }
  });

  it("fails clearly without the right credentials", async () => {
    await expect(listServerTools(config({ url: server.url }))).rejects.toThrow();
  });

  it("refuses stdio servers unless explicitly allowed", async () => {
    delete process.env.ALLOW_MCP_STDIO;
    await expect(connectMcpServer(config({ transport: "stdio", command: "echo" }))).rejects.toThrow(/ALLOW_MCP_STDIO/);
  });
});

describe("helpers", () => {
  it("builds function-safe, prefixed tool names", () => {
    expect(mcpToolName("github", "create_issue")).toBe("github__create_issue");
    expect(mcpToolName("fs", "read.file")).toBe("fs__read_file");
  });

  it("flattens mixed MCP content to text", () => {
    expect(
      mcpResultToText({
        content: [
          { type: "text", text: "Hello" },
          { type: "image", mimeType: "image/png", data: "..." },
          { type: "resource", resource: { uri: "file:///a", text: "file body" } },
        ],
      })
    ).toBe("Hello\n\n[image: image/png]\n\nfile body");
    expect(mcpResultToText({ content: [], structuredContent: { a: 1 } })).toBe('{"a":1}');
  });
});
