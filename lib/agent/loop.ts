import { generateText, tool, jsonSchema, stepCountIs } from "ai";
import { getDb, toolCallLogTable } from "@/db";
import { getAgentModel } from "@/lib/rag/clients";
import { logApiCall } from "@/lib/rag/usage";
import type { TimingCollector } from "@/lib/rag/timing";
import { openrouterLimiter } from "@/lib/rag/rate-limiter";
import type { AgentStep, AppSettings, Source } from "@/types";
import {
  getAvailableBuiltinTools,
  getBuiltinToolInfo,
  executeBuiltinTool,
} from "./tools";
import { loadEnabledCustomTools, customToolToFunctionSchema, executeCustomTool } from "./custom-tools";
import { listMemories, formatMemoriesForPrompt } from "./memory";

export { getBuiltinToolInfo };

// Orchestrates Agent mode's tool-calling loop using the Vercel AI SDK
// (`generateText` with `tools`), rather than a hand-rolled while-loop
// against the raw OpenRouter chat-completions endpoint. The SDK owns the
// "call model -> run tools -> feed results back -> call model again"
// mechanics; everything specific to this app (citation numbering across
// searches, the per-tool-call step budget, exact-repeat caching, live step
// events, tool-call logging, memory injection) lives in the tool
// `execute()` wrappers below, so none of that behavior changed by adopting
// the SDK — only who drives the round-trips did.

const AGENT_SYSTEM_PROMPT = `You are a helpful assistant with access to tools. The user has uploaded documents you can search — check them proactively whenever a question could plausibly relate to material they've uploaded, even if they don't explicitly ask you to check; use list_documents first if you're unsure what's available. Use search_documents for anything needing specific information from those documents rather than relying on general/training knowledge for document-specific claims.

You also have persistent memory that carries across every future chat, not just this one — the current contents are listed below. Whenever the user asks you to remember something, or states a standing preference or instruction ("always...", "never...", a fact about themselves worth keeping), call the remember tool to actually save it — don't just say you'll remember it. Call forget if they ask you to forget something or a saved memory is now outdated.

Be economical with tool calls: prefer one well-chosen query per distinct concept over several overlapping variations of the same query, and stop searching once you have enough information rather than re-querying for marginal gains. Never issue two searches that differ only slightly in wording — if a search didn't return what you needed, either try one genuinely different angle or move on.

Once you have enough information, give a clear, well-organized final answer without calling any more tools. Cite passages you used with [1], [2], etc. matching the index shown next to each result — that numbering is consistent across every search you've made this turn, so the same source always has the same number. For math, chemistry, or nuclear notation, write LaTeX delimited with single dollar signs for inline (e.g. $E=mc^2$) and double dollar signs for standalone equations (e.g. $$...$$). Do not use \\( \\) or \\[ \\] delimiters.`;

export type AgentLoopCallbacks = {
  onStage: (stage: string, detail?: string) => void;
  onStep: (step: AgentStep) => void;
  onToken: (content: string) => void;
  onSources: (sources: Source[]) => void;
};

export type AgentLoopResult = {
  finalContent: string;
  steps: AgentStep[];
  sources: Source[];
  llmCallCount: number;
};

type ToolOutcome = { success: boolean; result: unknown; sources?: Source[] };

// Accumulates sources across every search_documents call in a single turn
// and assigns each unique chunk one stable, turn-wide citation number —
// without this, a second search restarting its own numbering at 1 would
// make "[1]" in the model's final answer ambiguous (which call's result 1?).
class SourceRegistry {
  private byChunkId = new Map<number, number>();
  private list: Source[] = [];

  register(sources: Source[]): number[] {
    return sources.map((source) => {
      const existing = this.byChunkId.get(source.chunkId);
      if (existing) return existing;
      this.list.push(source);
      const index = this.list.length;
      this.byChunkId.set(source.chunkId, index);
      return index;
    });
  }

  getAll(): Source[] {
    return this.list;
  }
}

function renumberSearchResult(result: unknown, globalIndices: number[]): unknown {
  if (result && typeof result === "object" && Array.isArray((result as any).results)) {
    return {
      ...(result as any),
      results: (result as any).results.map((r: any, i: number) => ({
        ...r,
        index: globalIndices[i] ?? r.index,
      })),
    };
  }
  return result;
}

async function streamFinalAnswer(content: string, onToken: (chunk: string) => void) {
  if (!content) return;
  // generateText's result is the full final text at once (not incrementally
  // streamed), so it's revealed in small chunks with a short delay between
  // them purely so the UI's existing token-by-token rendering matches RAG
  // mode's real streaming.
  const words = content.split(/(\s+)/);
  const CHUNK_SIZE = 3;
  for (let i = 0; i < words.length; i += CHUNK_SIZE) {
    onToken(words.slice(i, i + CHUNK_SIZE).join(""));
    await new Promise((resolve) => setTimeout(resolve, 12));
  }
}

async function logToolCall(chatId: string, toolName: string, success: boolean, durationMs: number) {
  try {
    const db = getDb();
    await db.insert(toolCallLogTable).values({ chatId, toolName, success, durationMs });
  } catch (err) {
    console.error("Failed to log tool call:", err);
  }
}

export async function runAgentLoop(
  query: string,
  history: { role: "user" | "assistant"; content: string }[],
  summary: string | null,
  chatId: string,
  settings: AppSettings,
  callbacks: AgentLoopCallbacks,
  timing: TimingCollector
): Promise<AgentLoopResult> {
  const loopStartedAt = Date.now();
  const model = getAgentModel(settings.openrouterModel);
  const customTools = await loadEnabledCustomTools();
  const builtinDefs = getAvailableBuiltinTools(settings);

  const memories = await listMemories();
  const memorySection = `Current memory:\n${formatMemoriesForPrompt(memories)}`;
  const systemPrompt = summary
    ? `${AGENT_SYSTEM_PROMPT}\n\n${memorySection}\n\nEarlier conversation summary, for context:\n${summary}`
    : `${AGENT_SYSTEM_PROMPT}\n\n${memorySection}`;

  const steps: AgentStep[] = [];
  const sourceRegistry = new SourceRegistry();
  const maxSteps = settings.agentMaxSteps;

  // The cap is enforced per *tool call*, not per LLM round-trip, inside
  // each tool's own execute() below — a single round can legally request
  // several tool calls at once, and capping only rounds (as our first,
  // buggy hand-rolled version did) would let a single over-eager response
  // blow straight through the intended limit.
  let toolCallsUsed = 0;
  const resultCache = new Map<string, ToolOutcome>();

  function dedupeKey(name: string, args: Record<string, unknown>): string {
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(args).sort()) {
      const v = args[key];
      normalized[key] = typeof v === "string" ? v.trim().toLowerCase() : v;
    }
    return `${name}:${JSON.stringify(normalized)}`;
  }

  function makeExecutor(name: string, rawExecute: (args: Record<string, unknown>) => Promise<ToolOutcome>) {
    return async (rawInput: unknown) => {
      const args = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, unknown>;

      const callStep: AgentStep = {
        type: "tool_call",
        id: `${name}-${steps.length}-${Date.now()}`,
        name,
        arguments: args,
      };
      steps.push(callStep);
      callbacks.onStep(callStep);

      // Budget exhausted — return an error result instead of running the
      // real tool. The SDK feeds this back to the model as the tool's
      // result automatically, so the model sees exactly why it stopped.
      if (toolCallsUsed >= maxSteps) {
        const skipped = { error: "Step limit reached — this call was skipped." };
        const resultStep: AgentStep = {
          type: "tool_result",
          id: callStep.id,
          name,
          result: JSON.stringify(skipped),
          success: false,
          durationMs: 0,
        };
        steps.push(resultStep);
        callbacks.onStep(resultStep);
        return skipped;
      }

      const key = dedupeKey(name, args);
      const cached = resultCache.get(key);

      callbacks.onStage("calling_tool", name);
      const startedAt = Date.now();

      const outcome: ToolOutcome = cached ?? (await rawExecute(args));
      const durationMs = Date.now() - startedAt;
      toolCallsUsed++;

      if (!cached) {
        resultCache.set(key, outcome);
        logToolCall(chatId, name, outcome.success, durationMs);
        timing.record(`tool:${name}`, durationMs);
      }

      // Register any sources this call surfaced (idempotent per chunk, so
      // re-registering on a cache hit is safe) and rewrite the "index"
      // fields the model sees to the turn-wide global numbering.
      let displayResult = outcome.result;
      if (outcome.sources && outcome.sources.length > 0) {
        const globalIndices = sourceRegistry.register(outcome.sources);
        displayResult = renumberSearchResult(outcome.result, globalIndices);
      }

      const resultForModel = cached
        ? { note: "Identical call already made this turn — reusing that result.", result: displayResult }
        : displayResult;

      const resultStep: AgentStep = {
        type: "tool_result",
        id: callStep.id,
        name,
        result: JSON.stringify(resultForModel).slice(0, 4000),
        success: outcome.success,
        durationMs,
      };
      steps.push(resultStep);
      callbacks.onStep(resultStep);
      callbacks.onStage("thinking", `${toolCallsUsed} of ${maxSteps} tool calls used`);

      return resultForModel;
    };
  }

  const toolMap: Record<string, any> = {};

  for (const def of builtinDefs) {
    const name = def.function.name;
    toolMap[name] = tool({
      description: def.function.description,
      inputSchema: jsonSchema(def.function.parameters as any),
      execute: makeExecutor(name, (args) => executeBuiltinTool(name, args, settings)),
    });
  }

  for (const customToolRecord of customTools) {
    const schema = customToolToFunctionSchema(customToolRecord);
    toolMap[customToolRecord.name] = tool({
      description: schema.function.description,
      inputSchema: jsonSchema(schema.function.parameters as any),
      execute: makeExecutor(customToolRecord.name, (args) => executeCustomTool(customToolRecord, args)),
    });
  }

  callbacks.onStage("thinking", `0 of ${maxSteps} tool calls used`);

  // Timed per LLM round-trip via onStepEnd, since generateText drives all
  // of them internally in one call — this is the only point we get a hook
  // between rounds to measure each one individually.
  let lastRoundEndedAt = Date.now();

  const result = await generateText({
    model,
    system: systemPrompt,
    messages: [
      ...history.slice(-6).map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: query },
    ] as any,
    tools: toolMap,
    temperature: 0.3,
    // Generous round-based backstop only — the real, correctness-critical
    // limit is the per-tool-call cap enforced inside each execute() above.
    stopWhen: stepCountIs(maxSteps + 4),
    // Awaited before every round's model call (including the first) — the
    // only hook available for gating individual round-trips now that the
    // SDK drives the multi-step loop internally rather than this file.
    // Wait time is measured and excluded from the next onStepEnd's
    // "llm_call" duration (by fast-forwarding lastRoundEndedAt past it),
    // recorded as its own "rate_limit_wait" entry instead — otherwise a
    // long queue wait would masquerade as slow model latency on the chart.
    prepareStep: async () => {
      const waitStartedAt = Date.now();
      await openrouterLimiter.waitForSlot(settings.openrouterPerMinuteCap, (waitMs) =>
        callbacks.onStage("rate_limited", `waiting ${Math.ceil(waitMs / 1000)}s for OpenRouter's rate limit`)
      );
      const actuallyWaitedMs = Date.now() - waitStartedAt;
      if (actuallyWaitedMs > 50) {
        timing.record("rate_limit_wait", actuallyWaitedMs);
        lastRoundEndedAt += actuallyWaitedMs;
      }
      return undefined;
    },
    onStepEnd: (step: any) => {
      const now = Date.now();
      timing.record("llm_call", now - lastRoundEndedAt);
      lastRoundEndedAt = now;

      if (step?.text && step.text.trim()) {
        const messageStep: AgentStep = { type: "message", content: step.text };
        steps.push(messageStep);
        callbacks.onStep(messageStep);
      }
    },
  });

  // One logApiCall per LLM round-trip actually made, purposed by whether
  // that round produced tool calls (still deciding) or not (the final
  // answer) — keeps the Ledger's "Answers generated" stat accurate.
  for (const step of result.steps) {
    const isFinalStep = !step.toolCalls || step.toolCalls.length === 0;
    logApiCall("openrouter", isFinalStep ? "chat_completion" : "agent_step", {
      tokensUsed: step.usage?.totalTokens,
    });
  }

  const finalContent =
    result.text && result.text.trim()
      ? result.text
      : "I wasn't able to finish within the step limit.";

  const sources = sourceRegistry.getAll();
  callbacks.onSources(sources);
  callbacks.onStage("generating");
  await streamFinalAnswer(finalContent, callbacks.onToken);

  timing.record("total", Date.now() - loopStartedAt);

  return { finalContent, steps, sources, llmCallCount: result.steps.length };
}
