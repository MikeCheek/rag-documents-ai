import { getDb, toolCallLogTable } from "@/db";
import { getOpenRouter } from "@/lib/rag/clients";
import { logApiCall } from "@/lib/rag/usage";
import type { AgentStep, AppSettings } from "@/types";
import {
  BUILTIN_TOOL_DEFINITIONS,
  BUILTIN_TOOL_INFO,
  isBuiltinTool,
  executeBuiltinTool,
} from "./tools";
import { loadEnabledCustomTools, customToolToFunctionSchema, executeCustomTool } from "./custom-tools";

export { BUILTIN_TOOL_INFO };

const AGENT_SYSTEM_PROMPT = `You are a helpful assistant with access to tools. The user has uploaded documents you can search — check them proactively whenever a question could plausibly relate to material they've uploaded, even if they don't explicitly ask you to check; use list_documents first if you're unsure what's available. Use search_documents for anything needing specific information from those documents rather than relying on general/training knowledge for document-specific claims.

Be economical with tool calls: prefer one well-chosen query per distinct concept over several overlapping variations of the same query, and stop searching once you have enough information rather than re-querying for marginal gains. Never issue two searches that differ only slightly in wording — if a search didn't return what you needed, either try one genuinely different angle or move on.

Once you have enough information, give a clear, well-organized final answer without calling any more tools. Cite passages you used with [1], [2], etc. matching the order they were returned in when it's helpful. For math, chemistry, or nuclear notation, write LaTeX delimited with single dollar signs for inline (e.g. $E=mc^2$) and double dollar signs for standalone equations (e.g. $$...$$). Do not use \\( \\) or \\[ \\] delimiters.`;

export type AgentLoopCallbacks = {
  onStage: (stage: string, detail?: string) => void;
  onStep: (step: AgentStep) => void;
  onToken: (content: string) => void;
};

async function streamFinalAnswer(content: string, onToken: (chunk: string) => void) {
  if (!content) return;
  // The final answer already exists in full (tool-calling turns can't be
  // streamed incrementally the way a plain completion can), so it's
  // revealed in small chunks with a short delay between them purely so the
  // UI's existing token-by-token rendering looks the same as RAG mode.
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
  callbacks: AgentLoopCallbacks
): Promise<{ finalContent: string; steps: AgentStep[] }> {
  const openrouter = getOpenRouter();
  const customTools = await loadEnabledCustomTools();
  const customToolMap = new Map(customTools.map((t) => [t.name, t]));
  const toolSchemas = [
    ...BUILTIN_TOOL_DEFINITIONS,
    ...customTools.map(customToolToFunctionSchema),
  ];

  const systemPrompt = summary
    ? `${AGENT_SYSTEM_PROMPT}\n\nEarlier conversation summary, for context:\n${summary}`
    : AGENT_SYSTEM_PROMPT;

  const messages: any[] = [
    { role: "system", content: systemPrompt },
    ...history.slice(-6).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: query },
  ];

  const steps: AgentStep[] = [];
  const maxSteps = settings.agentMaxSteps;

  // The cap is on *tool calls*, not LLM round-trips — a single response can
  // legally request several tool calls at once (the API allows an array),
  // and executing all of them unconditionally would let one over-eager
  // response blow straight through the intended limit. Exact-repeat calls
  // (same tool, same arguments, case/whitespace-insensitive) are served
  // from a cache instead of re-running the pipeline, since some models
  // re-issue a call they've already made rather than trying something new.
  let toolCallsUsed = 0;
  const resultCache = new Map<string, { success: boolean; result: unknown }>();

  function dedupeKey(name: string, args: Record<string, unknown>): string {
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(args).sort()) {
      const v = args[key];
      normalized[key] = typeof v === "string" ? v.trim().toLowerCase() : v;
    }
    return `${name}:${JSON.stringify(normalized)}`;
  }

  while (toolCallsUsed < maxSteps) {
    callbacks.onStage("thinking", `${toolCallsUsed} of ${maxSteps} tool calls used`);

    const response = await openrouter.chat.completions.create({
      model: settings.openrouterModel,
      messages,
      tools: toolSchemas,
      tool_choice: "auto",
      temperature: 0.3,
    });

    const assistantMsg = response.choices[0]?.message;
    if (!assistantMsg) break;

    const toolCalls = assistantMsg.tool_calls ?? [];

    // Only a call that produces the actual final answer (no further tool
    // calls) counts as "chat_completion" for dashboard purposes — the
    // tool-deciding steps before it are real API calls too, just not
    // answers, so they're logged separately to keep that stat accurate.
    logApiCall("openrouter", toolCalls.length === 0 ? "chat_completion" : "agent_step", {
      tokensUsed: response.usage?.total_tokens,
    });

    if (toolCalls.length === 0) {
      const content = assistantMsg.content ?? "";
      callbacks.onStage("generating");
      await streamFinalAnswer(content, callbacks.onToken);
      return { finalContent: content, steps };
    }

    if (assistantMsg.content) {
      const messageStep: AgentStep = { type: "message", content: assistantMsg.content };
      steps.push(messageStep);
      callbacks.onStep(messageStep);
    }

    messages.push({
      role: "assistant",
      content: assistantMsg.content ?? null,
      tool_calls: toolCalls,
    });

    for (const toolCall of toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolCall.function.arguments || "{}");
      } catch {
        // Leave args empty — the tool executor will surface a clear error.
      }

      const callStep: AgentStep = {
        type: "tool_call",
        id: toolCall.id,
        name: toolCall.function.name,
        arguments: args,
      };
      steps.push(callStep);
      callbacks.onStep(callStep);

      // Budget exhausted mid-batch — every tool_call_id in the assistant
      // message above still needs a matching response, or the next API
      // call (the forced wrap-up) will be rejected as malformed.
      if (toolCallsUsed >= maxSteps) {
        const skipped = { error: "Step limit reached — this call was skipped." };
        const resultStep: AgentStep = {
          type: "tool_result",
          id: toolCall.id,
          name: toolCall.function.name,
          result: JSON.stringify(skipped),
          success: false,
          durationMs: 0,
        };
        steps.push(resultStep);
        callbacks.onStep(resultStep);
        messages.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(skipped) });
        continue;
      }

      const key = dedupeKey(toolCall.function.name, args);
      const cached = resultCache.get(key);

      callbacks.onStage("calling_tool", toolCall.function.name);
      const startedAt = Date.now();

      const outcome = cached
        ? cached
        : isBuiltinTool(toolCall.function.name)
        ? await executeBuiltinTool(toolCall.function.name, args)
        : customToolMap.has(toolCall.function.name)
        ? await executeCustomTool(customToolMap.get(toolCall.function.name)!, args)
        : { success: false, result: { error: `Unknown tool: ${toolCall.function.name}` } };

      const durationMs = Date.now() - startedAt;
      toolCallsUsed++;

      if (!cached) {
        resultCache.set(key, outcome);
        logToolCall(chatId, toolCall.function.name, outcome.success, durationMs);
      }

      const resultStr = cached
        ? JSON.stringify({
            note: "Identical call already made this turn — reusing that result.",
            result: outcome.result,
          })
        : JSON.stringify(outcome.result).slice(0, 4000);

      const resultStep: AgentStep = {
        type: "tool_result",
        id: toolCall.id,
        name: toolCall.function.name,
        result: resultStr,
        success: outcome.success,
        durationMs,
      };
      steps.push(resultStep);
      callbacks.onStep(resultStep);

      messages.push({ role: "tool", tool_call_id: toolCall.id, content: resultStr });
    }
  }

  // Step cap reached without a final answer — force one, with no tools
  // offered this time, so the loop can't keep going and the person isn't
  // left with nothing.
  callbacks.onStage("generating");
  const wrapUp = await openrouter.chat.completions.create({
    model: settings.openrouterModel,
    messages: [
      ...messages,
      {
        role: "user",
        content:
          "You've reached the step limit. Give your best answer now based on what you've found so far, without calling any more tools.",
      },
    ],
    temperature: 0.3,
  });

  logApiCall("openrouter", "chat_completion", { tokensUsed: wrapUp.usage?.total_tokens });

  const content =
    wrapUp.choices[0]?.message?.content ?? "I wasn't able to finish within the step limit.";
  await streamFinalAnswer(content, callbacks.onToken);
  return { finalContent: content, steps };
}
