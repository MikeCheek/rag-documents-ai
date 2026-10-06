import { beforeEach, describe, expect, it, vi } from "vitest";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { TimingCollector } from "@/lib/rag/timing";
import type { AppSettings } from "@/types";

// Everything that would touch the database or the network is stubbed; the
// model is the AI SDK's own mock, so this exercises the real streamText loop.
const model = { current: null as any };
vi.mock("@/db", () => ({ getDb: () => ({ insert: () => ({ values: async () => {} }) }), toolCallLogTable: {} }));
vi.mock("@/lib/rag/clients", () => ({ getAgentModel: () => model.current }));
vi.mock("@/lib/rag/usage", () => ({ logApiCall: vi.fn(), incrementChunkUsage: vi.fn() }));
vi.mock("@/lib/agent/memory", () => ({
  listMemories: async () => [],
  formatMemoriesForPrompt: () => "(none)",
  saveMemory: vi.fn(),
  deleteMemory: vi.fn(),
}));
vi.mock("@/lib/agent/custom-tools", () => ({
  loadEnabledCustomTools: async () => [],
  customToolToFunctionSchema: vi.fn(),
  executeCustomTool: vi.fn(),
}));

const { runAgentLoop } = await import("@/lib/agent/loop");

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

function round(parts: any[], finish: "stop" | "tool-calls") {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start", warnings: [] },
        ...parts,
        { type: "finish", finishReason: { unified: finish, raw: finish }, usage },
      ],
    }),
  };
}

const text = (id: string, ...deltas: string[]) => [
  { type: "text-start", id },
  ...deltas.map((delta) => ({ type: "text-delta", id, delta })),
  { type: "text-end", id },
];

const settings = {
  openrouterModel: "mock",
  agentMaxSteps: 3,
  openrouterPerMinuteCap: 0,
  searxngBaseUrl: null,
  rerankMethod: "bm25",
} as unknown as AppSettings;

function callbacks() {
  const events: string[] = [];
  let content = "";
  return {
    events,
    content: () => content,
    cb: {
      onStage: () => {},
      onStep: (s: any) => events.push(`step:${s.type}:${s.name ?? ""}`),
      onToken: (t: string) => {
        content += t;
        events.push("token");
      },
      onTokenReset: () => {
        content = "";
        events.push("reset");
      },
      onSources: () => events.push("sources"),
    },
  };
}

describe("runAgentLoop", () => {
  beforeEach(() => {
    model.current = null;
  });

  it("streams the final answer, discarding preamble before a tool call", async () => {
    model.current = new MockLanguageModelV4({
      doStream: [
        round(
          [
            ...text("t1", "Let me ", "calculate."),
            { type: "tool-call", toolCallId: "c1", toolName: "calculator", input: '{"expression":"6*7"}' },
          ],
          "tool-calls"
        ),
        round(text("t2", "The answer ", "is 42."), "stop"),
      ],
    });

    const timing = new TimingCollector();
    const { cb, events, content } = callbacks();
    const result = await runAgentLoop("what is 6*7", [], null, "chat", settings, cb, timing);

    expect(result.finalContent).toBe("The answer is 42.");
    expect(content()).toBe("The answer is 42.");
    expect(result.llmCallCount).toBe(2);
    // Preamble was streamed, then reset once the round turned out to call a tool.
    expect(events.indexOf("reset")).toBeGreaterThan(events.indexOf("token"));
    expect(events).toContain("step:tool_call:calculator");
    expect(events).toContain("step:message:");
    const toolResult = result.steps.find((s) => s.type === "tool_result") as any;
    expect(toolResult.success).toBe(true);
    expect(toolResult.result).toContain("42");
    // The caller records "total"; the loop must not record it a second time.
    expect(timing.getAll().filter((t: any) => t.stage === "total")).toHaveLength(0);
    expect(timing.getAll().filter((t: any) => t.stage === "llm_call")).toHaveLength(2);
  });

  it("reports running out of steps instead of returning preamble", async () => {
    const call = (id: string) =>
      round(
        [...text(`t${id}`, "Still working"), { type: "tool-call", toolCallId: id, toolName: "calculator", input: '{"expression":"1+1"}' }],
        "tool-calls"
      );
    model.current = new MockLanguageModelV4({
      doStream: Array.from({ length: 10 }, (_, i) => call(String(i))),
    });

    const { cb, content } = callbacks();
    const result = await runAgentLoop("loop", [], null, "chat", settings, cb, new TimingCollector());
    expect(result.finalContent).toBe("I wasn't able to finish within the step limit.");
    expect(content()).toBe(result.finalContent);
  });

  it("keeps the partial answer when stopped mid-stream", async () => {
    const controller = new AbortController();
    model.current = new MockLanguageModelV4({
      doStream: [
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              ...text("t1", "The answer ", "is ", "forty-two", " and more"),
              { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
            ] as any[],
            chunkDelayInMs: 20,
          }),
        },
      ],
    });

    const { cb, content } = callbacks();
    const onToken = cb.onToken;
    let tokens = 0;
    cb.onToken = (t: string) => {
      onToken(t);
      // Stop right after the third token arrives, as the Stop button would.
      if (++tokens === 3) controller.abort();
    };

    const result = await runAgentLoop("q", [], null, "chat", settings, cb, new TimingCollector(), {
      abortSignal: controller.signal,
    });
    expect(result.finalContent).toBe("The answer is forty-two");
    expect(content()).toBe("The answer is forty-two");
    expect(result.llmCallCount).toBe(0);
  });

  it("surfaces model errors instead of returning an empty answer", async () => {
    model.current = new MockLanguageModelV4({
      doStream: [{ stream: simulateReadableStream({ chunks: [{ type: "error", error: new Error("upstream 503") }] }) }],
    });
    const { cb } = callbacks();
    await expect(runAgentLoop("x", [], null, "chat", settings, cb, new TimingCollector())).rejects.toThrow(
      "upstream 503"
    );
  });
});
