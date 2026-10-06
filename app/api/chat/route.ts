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
import { formatPages } from "@/lib/utils";
import { describeError } from "@/lib/db-errors";

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
    // Tracked outside the try so a failure partway through a turn can still
    // be saved: without this, a failed turn left a question with no reply
    // in the chat's history, and any answer streamed so far was lost.
    let awaitingReply = false;
    let partialAnswer = "";
    let turnMode: ChatMode = "rag";
    let turnEditGroupId: string | undefined;
    try {
      const body = await req.json();
      const query: string = (body?.query ?? "").trim();
      chatId = typeof body?.chatId === "string" ? body.chatId : undefined;
      const mode: ChatMode = body?.mode === "agent" ? "agent" : "rag";
      turnMode = mode;
      // Optional: restrict this question to specific documents (by id).
      const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const documentIds: string[] | undefined = Array.isArray(body?.documentIds)
        ? body.documentIds.filter((id: unknown): id is string => typeof id === "string" && UUID.test(id))
        : undefined;
      // Present only when this turn is replacing an edited message —
      // tags both the new user message and its reply so they join the
      // same version group as whatever was just deactivated by
      // /api/chats/[id]/messages/start-edit, instead of starting a new,
      // unrelated group.
      const editGroupId: string | undefined =
        typeof body?.editGroupId === "string" ? body.editGroupId : undefined;
      turnEditGroupId = editGroupId;

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
      awaitingReply = true;

      // ---------------------------------------------------------------
      // Agent mode: the model can call tools (possibly several times) in
      // a loop before producing a final answer. See lib/agent/loop.ts.
      // ---------------------------------------------------------------
      if (mode === "agent") {
        const { finalContent, steps, sources, rerankMethod, llmCallCount } = await runAgentLoop(
          query,
          history,
          summary,
          activeChatId,
          settings,
          {
            onStage: (stage, detail) => send({ type: "stage", stage, detail }),
            onStep: (step) => send({ type: "agent_step", step }),
            onToken: (content) => {
              partialAnswer += content;
              send({ type: "token", content });
            },
            onTokenReset: () => {
              partialAnswer = "";
              send({ type: "token_reset" });
            },
            onSources: (sources, rerankMethod) => send({ type: "sources", sources, rerankMethod }),
          },
          timing,
          { documentIds, abortSignal: req.signal }
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
            rerankMethod: sources.length ? rerankMethod : null,
            apiCallCount: llmCallCount,
            durationMs,
            editGroupId,
          })
          .returning();
        awaitingReply = false;
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
        { documentIds, abortSignal: req.signal }
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
          .map((s, i) => {
            const pages = formatPages(s.pageStart, s.pageEnd);
            return `[${i + 1}] (from "${s.documentName}"${pages ? `, ${pages}` : ""})\n${s.content}`;
          })
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
                partialAnswer = answer;
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
      awaitingReply = false;
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
      const stopped = req.signal.aborted;
      // A stop that lands before either branch's own graceful-abort
      // handling (e.g. during retrieval) isn't a failure: no error log, and
      // no error event, since nobody's listening anymore.
      if (!stopped) console.error("Chat route failed:", err);
      const message = describeError(err);
      if (!stopped) send({ type: "error", message });
      // Either way the question gets a reply in the history, rather than
      // being left unanswered: what was produced so far, plus why it ended.
      if (awaitingReply && chatId) {
        await saveFailedTurn(chatId, turnMode, partialAnswer, stopped ? null : message, turnEditGroupId);
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

/** Saves whatever was produced before a turn failed or was stopped, plus
 *  why it ended, so reopening the chat shows that instead of an unanswered
 *  question. `error` is null for a deliberate stop. */
async function saveFailedTurn(
  chatId: string,
  mode: ChatMode,
  partial: string,
  error: string | null,
  editGroupId: string | undefined
) {
  try {
    const note = error ? `_This answer was interrupted: ${error}_` : "_(Stopped before an answer was generated.)_";
    const content = !partial.trim() ? note : error ? `${partial}\n\n${note}` : partial;
    const db = getDb();
    await db.insert(chatMessagesTable).values({ chatId, role: "assistant", content, mode, editGroupId });
    await db.update(chatsTable).set({ updatedAt: new Date() }).where(eq(chatsTable.id, chatId));
  } catch (saveErr) {
    console.error("Failed to save interrupted turn:", saveErr);
  }
}
