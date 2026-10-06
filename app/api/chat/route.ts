import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, chatsTable, chatMessagesTable } from "@/db";
import { getOpenRouter } from "@/lib/rag/clients";
import { runRetrievalPipeline } from "@/lib/rag/pipeline";
import { runAgentLoop } from "@/lib/agent/loop";
import { getSettings } from "@/lib/rag/settings";
import { createEventStream } from "@/lib/stream";
import { incrementChunkUsage, logApiCall } from "@/lib/rag/usage";
import { deriveTitle, loadChatContext } from "@/lib/rag/chats";
import { maybeCompactChat } from "@/lib/rag/compaction";
import { TimingCollector, persistTimings } from "@/lib/rag/timing";
import { openrouterLimiter } from "@/lib/rag/rate-limiter";
import type { ChatMode } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SYSTEM_PROMPT_BASE = `You are a careful research assistant that answers questions using only the excerpts provided in <context>. Each excerpt is labeled with a source number like [1], [2], etc.

Rules:
1. Answer using only information found in the context. Do not use outside knowledge.
2. Cite every factual claim with the matching source number in square brackets, e.g. "The mitochondria produces ATP [2]." Cite inline, right after the claim.
3. If multiple sources support a claim, cite all of them, e.g. [1][3].
4. If the context does not contain enough information to answer, say so plainly and explain what's missing. Do not guess or invent facts.
5. Write in clear, well-organized prose (short paragraphs or a list when helpful). Do not repeat the question back.
6. For math, chemistry, or nuclear notation, write LaTeX delimited with single dollar signs for inline (e.g. $E=mc^2$) and double dollar signs for standalone equations (e.g. $$...$$). Do not use \\( \\) or \\[ \\] delimiters.`;

export async function POST(req: NextRequest) {
  const { stream, send, close } = createEventStream();

  (async () => {
    let chatId: string | undefined;
    try {
      const body = await req.json();
      const query: string = (body?.query ?? "").trim();
      chatId = typeof body?.chatId === "string" ? body.chatId : undefined;
      const mode: ChatMode = body?.mode === "agent" ? "agent" : "rag";
      // Present only when this turn is replacing an edited message —
      // tags both the new user message and its reply so they join the
      // same version group as whatever was just deactivated by
      // /api/chats/[id]/messages/start-edit, instead of starting a new,
      // unrelated group.
      const editGroupId: string | undefined =
        typeof body?.editGroupId === "string" ? body.editGroupId : undefined;

      if (!query) {
        send({ type: "error", message: "Empty question." });
        close();
        return;
      }

      const db = getDb();

      if (!chatId) {
        const [chat] = await db
          .insert(chatsTable)
          .values({ title: deriveTitle(query) })
          .returning();
        chatId = chat.id;
        send({
          type: "chat",
          chat: {
            id: chat.id,
            title: chat.title,
            pinned: chat.pinned,
            createdAt: chat.createdAt,
            updatedAt: chat.updatedAt,
          },
        });
      }

      const activeChatId: string = chatId;
      const { history, summary } = await loadChatContext(activeChatId);
      const settings = await getSettings();
      const turnStartedAt = Date.now();
      const timing = new TimingCollector();

      await db.insert(chatMessagesTable).values({
        chatId: activeChatId,
        role: "user",
        content: query,
        mode,
        editGroupId,
      });

      // ---------------------------------------------------------------
      // Agent mode: the model can call tools (possibly several times) in
      // a loop before producing a final answer. See lib/agent/loop.ts.
      // ---------------------------------------------------------------
      if (mode === "agent") {
        const { finalContent, steps, sources, llmCallCount } = await runAgentLoop(
          query,
          history,
          summary,
          activeChatId,
          settings,
          {
            onStage: (stage, detail) => send({ type: "stage", stage, detail }),
            onStep: (step) => send({ type: "agent_step", step }),
            onToken: (content) => send({ type: "token", content }),
            onSources: (sources) =>
              send({ type: "sources", sources, rerankMethod: settings.rerankMethod }),
          },
          timing,
          req.signal
        );

        const durationMs = Date.now() - turnStartedAt;
        timing.record("total", durationMs);

        const wasStopped = req.signal.aborted;
        const persistedContent =
          finalContent || (wasStopped ? "_(Stopped before an answer was generated.)_" : "");

        const [assistantMessage] = await db
          .insert(chatMessagesTable)
          .values({
            chatId: activeChatId,
            role: "assistant",
            content: persistedContent,
            mode: "agent",
            agentSteps: steps.length ? steps : null,
            sources: sources.length ? sources : null,
            rerankMethod: sources.length ? settings.rerankMethod : null,
            apiCallCount: llmCallCount,
            durationMs,
            editGroupId,
          })
          .returning();
        await db
          .update(chatsTable)
          .set({ updatedAt: new Date() })
          .where(eq(chatsTable.id, activeChatId));

        persistTimings(activeChatId, assistantMessage.id, "agent", timing.getAll());

        send({ type: "usage", apiCallCount: llmCallCount, durationMs });
        send({ type: "done" });
        maybeCompactChat(activeChatId);
        return;
      }

      // ---------------------------------------------------------------
      // RAG mode: fixed retrieve-then-answer pipeline.
      // ---------------------------------------------------------------
      const { sources, rerankMethod } = await runRetrievalPipeline(
        query,
        history,
        summary,
        settings,
        (stage, detail) => send({ type: "stage", stage, detail }),
        timing,
        req.signal
      );

      send({ type: "sources", sources, rerankMethod });
      incrementChunkUsage(sources.map((s) => s.chunkId));

      let answer = "";
      // Deterministic from settings: the pipeline makes exactly one
      // optimize_query call when that mode is "llm", and the final answer
      // call only happens when there are sources to answer from.
      let llmCallCount = settings.queryOptimization === "llm" ? 1 : 0;

      if (sources.length === 0) {
        answer =
          "I couldn't find anything relevant in the uploaded documents to answer that. Try uploading a document on this topic, or rephrase your question.";
        send({ type: "token", content: answer });
      } else {
        llmCallCount++;
        const context = sources
          .map((s, i) => `[${i + 1}] (from "${s.documentName}")\n${s.content}`)
          .join("\n\n---\n\n");

        const systemPrompt = summary
          ? `${SYSTEM_PROMPT_BASE}\n\nEarlier conversation summary, for context:\n${summary}`
          : SYSTEM_PROMPT_BASE;

        const waitStartedAt = Date.now();
        await openrouterLimiter.waitForSlot(settings.openrouterPerMinuteCap, (waitMs) =>
          send({
            type: "stage",
            stage: "rate_limited",
            detail: `waiting ${Math.ceil(waitMs / 1000)}s for OpenRouter's rate limit`,
          })
        );
        const actuallyWaitedMs = Date.now() - waitStartedAt;
        if (actuallyWaitedMs > 50) timing.record("rate_limit_wait", actuallyWaitedMs);

        await timing.time("generate", async () => {
          const openrouter = getOpenRouter();
          let totalTokens: number | undefined;

          try {
            const completion = await openrouter.chat.completions.create(
              {
                model: settings.openrouterModel,
                stream: true,
                stream_options: { include_usage: true },
                temperature: 0.3,
                messages: [
                  { role: "system", content: systemPrompt },
                  ...history.slice(-6).map((m) => ({ role: m.role, content: m.content })),
                  {
                    role: "user",
                    content: `<context>\n${context}\n</context>\n\nQuestion: ${query}`,
                  },
                ],
              },
              { signal: req.signal }
            );

            for await (const chunk of completion) {
              const delta = chunk.choices[0]?.delta?.content;
              if (delta) {
                answer += delta;
                send({ type: "token", content: delta });
              }
              if (chunk.usage?.total_tokens) totalTokens = chunk.usage.total_tokens;
            }
          } catch (err: any) {
            // A genuine failure (before or during the stream) should still
            // surface normally — only a deliberate stop (our own signal
            // firing) is handled here, keeping whatever text streamed in
            // before it rather than throwing the partial answer away.
            if (!req.signal.aborted) throw err;
          }

          logApiCall("openrouter", "chat_completion", { tokensUsed: totalTokens });
        });
      }

      const durationMs = Date.now() - turnStartedAt;
      timing.record("total", durationMs);

      const persistedAnswer =
        answer || (req.signal.aborted ? "_(Stopped before an answer was generated.)_" : "");

      const [assistantMessage] = await db
        .insert(chatMessagesTable)
        .values({
          chatId: activeChatId,
          role: "assistant",
          content: persistedAnswer,
          mode: "rag",
          sources: sources.length ? sources : null,
          rerankMethod,
          apiCallCount: llmCallCount,
          durationMs,
          editGroupId,
        })
        .returning();
      await db
        .update(chatsTable)
        .set({ updatedAt: new Date() })
        .where(eq(chatsTable.id, activeChatId));

      persistTimings(activeChatId, assistantMessage.id, "rag", timing.getAll());

      send({ type: "usage", apiCallCount: llmCallCount, durationMs });
      send({ type: "done" });

      // Fire-and-forget: keeps future turns' context bounded once a chat
      // gets long. Runs after the response is already sent.
      maybeCompactChat(activeChatId);
    } catch (err: any) {
      if (req.signal.aborted) {
        // Expected: the user hit "stop" before either branch's own
        // graceful-abort handling had a chance to run (e.g. during
        // loadChatContext or the initial insert) — not a real failure,
        // so no scary log line and no error event nobody's there to see.
      } else {
        console.error("Chat route failed:", err);
        send({ type: "error", message: err?.message ?? "Something went wrong." });
      }
    } finally {
      close();
    }
  })();

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
