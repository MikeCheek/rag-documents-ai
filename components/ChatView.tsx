"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, BookOpen } from "lucide-react";
import type {
  AgentStep,
  ChatMessage,
  ChatSummary,
  DocumentRecord,
  Source,
  StoredChatMessage,
} from "@/types";
import { uid } from "@/lib/utils";
import { useMode } from "./ModeProvider";
import { AgentModelWarning } from "./AgentModelWarning";
import { MessageBubble } from "./MessageBubble";
import { SourcesDrawer } from "./SourcesDrawer";

const EXAMPLE_PROMPTS = [
  "Summarize what these documents cover",
  "What are the key figures or dates mentioned?",
  "Find anything about risks or limitations",
];

export function ChatView({
  chatId,
  documents,
  onChatCreated,
  onChatTouched,
}: {
  chatId: string | null;
  documents: DocumentRecord[];
  onChatCreated: (chat: ChatSummary) => void;
  onChatTouched: () => void;
}) {
  const { mode } = useMode();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [input, setInput] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [activeCitation, setActiveCitation] = useState<{
    messageId: string;
    index: number;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Set right before we learn a new chat's id from our own send() call, so
  // the history-load effect below (which reacts to chatId changing) knows
  // to skip re-fetching and clobbering the message list that's actively
  // streaming in this same request.
  const skipNextHistoryLoadRef = useRef(false);

  const readyDocs = documents.filter((d) => d.status === "ready");
  const activeMessage = messages.find((m) => m.id === activeCitation?.messageId);

  // Load (or clear) the message history whenever the selected chat changes.
  useEffect(() => {
    setActiveCitation(null);

    if (skipNextHistoryLoadRef.current) {
      skipNextHistoryLoadRef.current = false;
      return;
    }

    setInput("");

    if (!chatId) {
      setMessages([]);
      return;
    }

    let cancelled = false;
    setLoadingHistory(true);

    fetch(`/api/chats/${chatId}`)
      .then((res) => res.json())
      .then((json: { messages?: StoredChatMessage[] }) => {
        if (cancelled || !json.messages) return;
        setMessages(
          json.messages.map((m) => ({
            id: String(m.id),
            role: m.role,
            content: m.content,
            mode: m.mode,
            sources: m.sources ?? undefined,
            rerankMethod: m.rerankMethod ?? undefined,
            agentSteps: m.agentSteps ?? undefined,
          }))
        );
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });

    return () => {
      cancelled = true;
    };
  }, [chatId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || isBusy) return;

    setInput("");
    setIsBusy(true);

    const userMsg: ChatMessage = { id: uid(), role: "user", content: question, mode };
    const assistantId = uid();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      mode,
      isStreaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    function update(patch: Partial<ChatMessage>) {
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, ...patch } : m))
      );
    }

    function appendStep(step: AgentStep) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, agentSteps: [...(m.agentSteps ?? []), step] }
            : m
        )
      );
    }

    let resolvedChatId = chatId;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: question, chatId: chatId ?? undefined, mode }),
      });
      if (!res.body) throw new Error("No response stream from server.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let content = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);

          if (event.type === "chat") {
            resolvedChatId = event.chat.id;
            skipNextHistoryLoadRef.current = true;
            onChatCreated(event.chat);
          } else if (event.type === "stage") {
            update({ stage: event.stage, stageDetail: event.detail });
          } else if (event.type === "sources") {
            update({ sources: event.sources as Source[], rerankMethod: event.rerankMethod });
          } else if (event.type === "agent_step") {
            appendStep(event.step as AgentStep);
          } else if (event.type === "token") {
            content += event.content;
            update({ content });
          } else if (event.type === "error") {
            update({ error: event.message, isStreaming: false });
          } else if (event.type === "done") {
            update({ isStreaming: false });
          }
        }
      }
    } catch (err: any) {
      update({ error: err?.message ?? "Something went wrong.", isStreaming: false });
    } finally {
      setIsBusy(false);
      if (resolvedChatId) onChatTouched();
    }
  }

  return (
    <div className="flex-1 flex min-w-0">
      <div className="flex-1 flex flex-col min-w-0">
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {mode === "agent" && <AgentModelWarning />}
          {loadingHistory ? (
            <p className="text-sm text-paper-400 py-16 text-center">Loading conversation...</p>
          ) : messages.length === 0 ? (
            <EmptyState hasDocuments={readyDocs.length > 0} mode={mode} onPick={send} />
          ) : (
            <div className="max-w-[720px] mx-auto px-6 py-8 flex flex-col gap-6">
              {messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  onCiteClick={(index) => setActiveCitation({ messageId: m.id, index })}
                />
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-ink-600 bg-ink-900 px-6 py-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="max-w-[720px] mx-auto flex items-end gap-2 rounded-xl border border-ink-600 bg-ink-800 px-3 py-2 focus-within:border-brass-400/60 transition-colors"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={1}
              placeholder={
                readyDocs.length === 0
                  ? "Upload a document to start asking questions..."
                  : mode === "agent"
                  ? "Ask the agent to do something..."
                  : "Ask about your documents..."
              }
              className="flex-1 resize-none bg-transparent text-[15px] text-paper-200 placeholder:text-paper-400 outline-none py-1.5 max-h-40"
            />
            <button
              type="submit"
              disabled={isBusy || !input.trim()}
              className="flex items-center justify-center h-8 w-8 rounded-lg bg-brass-400 text-ink-950 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-brass-300 transition-colors shrink-0"
              aria-label="Send"
            >
              <ArrowUp size={16} strokeWidth={2.5} />
            </button>
          </form>
          <p className="max-w-[720px] mx-auto text-center text-[11px] text-paper-400 mt-2 leading-relaxed">
            {mode === "agent" ? (
              <>
                AI-generated — it can make mistakes, so check anything important.
                Agent mode can call tools (document search, calculator, and any
                tools you've added) before answering — its steps are shown live
                and saved with the message. It remembers earlier messages within
                this chat, but not across different chats.
              </>
            ) : (
              <>
                AI-generated — it can make mistakes, so check anything important.
                This is a RAG assistant, not an autonomous agent: it retrieves
                passages and answers fresh each turn rather than taking actions.
                It remembers earlier messages within this chat, but not across
                different chats. Switch to Agent mode (top right) for tool use.
              </>
            )}
          </p>
        </div>
      </div>

      {activeMessage?.sources && activeMessage.sources.length > 0 && (
        <SourcesDrawer
          sources={activeMessage.sources}
          rerankMethod={activeMessage.rerankMethod}
          activeIndex={activeCitation?.index ?? null}
          onClose={() => setActiveCitation(null)}
        />
      )}
    </div>
  );
}

function EmptyState({
  hasDocuments,
  mode,
  onPick,
}: {
  hasDocuments: boolean;
  mode: "rag" | "agent";
  onPick: (text: string) => void;
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center px-6 text-center">
      <div className="flex items-center justify-center h-12 w-12 rounded-full border border-brass-400/40 mb-5">
        <BookOpen size={20} className="text-brass-300" />
      </div>
      <h2 className="font-serif italic text-3xl text-paper-100">
        {mode === "agent" ? "Ask the agent anything" : "Ask your documents anything"}
      </h2>
      <p className="text-paper-400 mt-3 max-w-md leading-relaxed">
        {mode === "agent"
          ? "It can search your documents, use its other tools, and show you exactly how it got to an answer."
          : hasDocuments
          ? "Every answer is grounded in what you've uploaded, with numbered sources you can open and check."
          : "Add a document on the shelf, then come back here to ask about it."}
      </p>
      {hasDocuments && (
        <div className="mt-6 flex flex-col gap-2 w-full max-w-sm">
          {EXAMPLE_PROMPTS.map((p) => (
            <button
              key={p}
              onClick={() => onPick(p)}
              className="text-left text-sm text-paper-300 border border-ink-600 rounded-lg px-4 py-2.5 hover:border-brass-400/50 hover:bg-ink-800 transition-colors"
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
