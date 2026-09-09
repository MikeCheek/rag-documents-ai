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

      await db.insert(chatMessagesTable).values({
        chatId: activeChatId,
        role: "user",
        content: query,
        mode,
      });

      // ---------------------------------------------------------------
      // Agent mode: the model can call tools (possibly several times) in
      // a loop before producing a final answer. See lib/agent/loop.ts.
      // ---------------------------------------------------------------
      if (mode === "agent") {
        const { finalContent, steps } = await runAgentLoop(
          query,
          history,
          summary,
          activeChatId,
          settings,
          {
            onStage: (stage, detail) => send({ type: "stage", stage, detail }),
            onStep: (step) => send({ type: "agent_step", step }),
            onToken: (content) => send({ type: "token", content }),
          }
        );

        await db.insert(chatMessagesTable).values({
          chatId: activeChatId,
          role: "assistant",
          content: finalContent,
          mode: "agent",
          agentSteps: steps.length ? steps : null,
        });
        await db
          .update(chatsTable)
          .set({ updatedAt: new Date() })
          .where(eq(chatsTable.id, activeChatId));

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
        (stage, detail) => send({ type: "stage", stage, detail })
      );

      send({ type: "sources", sources, rerankMethod });
      incrementChunkUsage(sources.map((s) => s.chunkId));

      let answer = "";

      if (sources.length === 0) {
        answer =
          "I couldn't find anything relevant in the uploaded documents to answer that. Try uploading a document on this topic, or rephrase your question.";
        send({ type: "token", content: answer });
      } else {
        const context = sources
          .map((s, i) => `[${i + 1}] (from "${s.documentName}")\n${s.content}`)
          .join("\n\n---\n\n");

        const systemPrompt = summary
          ? `${SYSTEM_PROMPT_BASE}\n\nEarlier conversation summary, for context:\n${summary}`
          : SYSTEM_PROMPT_BASE;

        const openrouter = getOpenRouter();
        const completion = await openrouter.chat.completions.create({
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
        });

        let totalTokens: number | undefined;
        for await (const chunk of completion) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            answer += delta;
            send({ type: "token", content: delta });
          }
          if (chunk.usage?.total_tokens) totalTokens = chunk.usage.total_tokens;
        }

        logApiCall("openrouter", "chat_completion", { tokensUsed: totalTokens });
      }

      await db.insert(chatMessagesTable).values({
        chatId: activeChatId,
        role: "assistant",
        content: answer,
        mode: "rag",
        sources: sources.length ? sources : null,
        rerankMethod,
      });
      await db
        .update(chatsTable)
        .set({ updatedAt: new Date() })
        .where(eq(chatsTable.id, activeChatId));

      send({ type: "done" });

      // Fire-and-forget: keeps future turns' context bounded once a chat
      // gets long. Runs after the response is already sent.
      maybeCompactChat(activeChatId);
    } catch (err: any) {
      console.error("Chat route failed:", err);
      send({ type: "error", message: err?.message ?? "Something went wrong." });
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
