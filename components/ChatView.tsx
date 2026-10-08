"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, BookOpen, Square } from "lucide-react";
import { DocumentScopePicker } from "./DocumentScopePicker";
import { ContextGauge } from "./ContextGauge";
import type {
  ContextUsage,
  AgentStep,
  ChatMessage,
  ChatSummary,
  DocumentRecord,
  MessageVersion,
  Source,
  StoredChatMessage,
} from "@/types";
import { uid } from "@/lib/utils";
import { toSpeakableText } from "@/lib/voice/speakable-text";
import { useMode } from "./ModeProvider";
import { AgentModelWarning } from "./AgentModelWarning";
import { MessageBubble } from "./MessageBubble";
import { SourcesDrawer } from "./SourcesDrawer";
import { VoiceInputButton } from "./VoiceInputButton";

const EXAMPLE_PROMPTS = [
  "Summarize what my documents cover",
  "What are the key figures or dates mentioned in my documents?",
  "Find anything about risks or limitations in my documents",
];

function storedToChatMessage(m: StoredChatMessage): ChatMessage {
  return {
    id: String(m.id),
    role: m.role,
    content: m.content,
    mode: m.mode,
    sources: m.sources ?? undefined,
    rerankMethod: m.rerankMethod ?? undefined,
    agentSteps: m.agentSteps ?? undefined,
    apiCallCount: m.apiCallCount ?? undefined,
    durationMs: m.durationMs ?? undefined,
    editGroupId: m.editGroupId ?? undefined,
    citationCheck: m.citationCheck ?? undefined,
    documentScope: m.documentScope ?? undefined,
  };
}

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
  // The URL named a chat that doesn't exist (deleted, or a mistyped link).
  const [notFound, setNotFound] = useState(false);
  const [input, setInput] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  // Documents the next questions are limited to; empty = all of them.
  const [scope, setScope] = useState<string[]>([]);
  const [context, setContext] = useState<ContextUsage | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [activeCitation, setActiveCitation] = useState<{
    messageId: string;
    index: number;
  } | null>(null);
  // Every past version of an edited turn stays in the database, not just
  // the current one — these two caches back the "Edited · 2/3 ◀ ▶"
  // navigation. Fetched lazily per edit group, not for the whole chat at
  // once, since most messages are never edited.
  const [versionsByGroup, setVersionsByGroup] = useState<Record<string, MessageVersion[]>>({});
  const [versionIndexByGroup, setVersionIndexByGroup] = useState<Record<string, number>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  // Set right before we learn a new chat's id from our own send() call, so
  // the history-load effect below (which reacts to chatId changing) knows
  // to skip re-fetching and clobbering the message list that's actively
  // streaming in this same request.
  const skipNextHistoryLoadRef = useRef(false);
  // The in-flight request's own controller, so the send button (turned
  // into a stop button while busy) can actually cancel it — client-side
  // (stop reading the stream) and server-side (the route threads this
  // same signal into every OpenRouter/Cohere call it makes, so stopping
  // really does stop paying for tokens, not just stop watching them).
  const abortControllerRef = useRef<AbortController | null>(null);

  const readyDocs = documents.filter((d) => d.status === "ready");
  // Drop documents from the scope once they're deleted.
  const activeScope = scope.filter((id) => readyDocs.some((d) => d.id === id));
  const activeMessage = messages.find((m) => m.id === activeCitation?.messageId);

  const lastUserMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") return messages[i].id;
    }
    return null;
  }, [messages]);

  // Load (or clear) the message history whenever the selected chat changes.
  useEffect(() => {
    setActiveCitation(null);
    setEditingMessageId(null);
    setVersionsByGroup({});
    setVersionIndexByGroup({});
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    setSpeakingMessageId(null);

    if (skipNextHistoryLoadRef.current) {
      skipNextHistoryLoadRef.current = false;
      return;
    }

    setInput("");
    setNotFound(false);

    if (!chatId) {
      setMessages([]);
      setContext(null);
      // A new chat searches everything until told otherwise.
      setScope([]);
      return;
    }

    let cancelled = false;
    setLoadingHistory(true);

    fetch(`/api/chats/${encodeURIComponent(chatId)}`)
      .then(async (res) => {
        if (res.status === 404) {
          if (!cancelled) {
            setMessages([]);
            setNotFound(true);
          }
          return {};
        }
        return res.json();
      })
      .then((json: { messages?: StoredChatMessage[]; context?: ContextUsage | null }) => {
        if (cancelled || !json.messages) return;
        setMessages(json.messages.map(storedToChatMessage));
        setContext(json.context ?? null);
        // Reopening a chat restores the "Search in" choice its last
        // question used, so follow-ups stay in the same documents.
        const lastUser = [...json.messages].reverse().find((m) => m.role === "user");
        setScope(lastUser?.documentScope?.map((d) => d.id) ?? []);
      })
      .catch(() => { })
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

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    };
  }, []);

  // Any message currently showing an edit_group_id gets its version list
  // fetched in the background — cheap (most chats have none), and means
  // the "2/3" count is already there the first time someone looks,
  // rather than only appearing after a click.
  useEffect(() => {
    if (!chatId) return;
    const groupIds = new Set(
      messages.filter((m) => m.editGroupId).map((m) => m.editGroupId!)
    );
    groupIds.forEach((editGroupId) => {
      if (versionsByGroup[editGroupId]) return;
      fetch(`/api/chats/${chatId}/messages/versions/${editGroupId}`)
        .then((res) => res.json())
        .then((json: { versions?: MessageVersion[] }) => {
          if (!json.versions?.length) return;
          setVersionsByGroup((prev) => ({ ...prev, [editGroupId]: json.versions! }));
          setVersionIndexByGroup((prev) =>
            editGroupId in prev ? prev : { ...prev, [editGroupId]: json.versions!.length - 1 }
          );
        })
        .catch(() => { });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, chatId]);

  async function send(text: string, editGroupId?: string) {
    const question = text.trim();
    if (!question || isBusy) return;
    // A chat that turned out not to exist can't be continued: this message
    // starts a new one (and the flag is cleared, so the next message
    // continues that new chat rather than starting yet another).
    const targetChatId = notFound ? null : chatId;
    setNotFound(false);

    setInput("");
    setIsBusy(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const documentScope = activeScope.length
      ? readyDocs.filter((d) => activeScope.includes(d.id)).map((d) => ({ id: d.id, name: d.name }))
      : null;
    const userMsg: ChatMessage = { id: uid(), role: "user", content: question, mode, editGroupId, documentScope };
    const assistantId = uid();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      mode,
      isStreaming: true,
      editGroupId,
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
        body: JSON.stringify({
          query: question,
          chatId: targetChatId ?? undefined,
          mode,
          editGroupId,
          documentIds: activeScope.length ? activeScope : undefined,
        }),
        signal: controller.signal,
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
          } else if (event.type === "citation_check") {
            update({ citationCheck: event.citationCheck });
          } else if (event.type === "sources") {
            update({ sources: event.sources as Source[], rerankMethod: event.rerankMethod });
          } else if (event.type === "agent_step") {
            appendStep(event.step as AgentStep);
          } else if (event.type === "usage") {
            update({ apiCallCount: event.apiCallCount, durationMs: event.durationMs });
          } else if (event.type === "token") {
            content += event.content;
            update({ content });
          } else if (event.type === "token_reset") {
            // Agent mode: text streamed so far was preamble to a tool call.
            content = "";
            update({ content });
          } else if (event.type === "error") {
            update({ error: event.message, isStreaming: false });
          } else if (event.type === "context") {
            setContext(event.context as ContextUsage);
          } else if (event.type === "done") {
            update({ isStreaming: false });
          }
        }
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        // A deliberate stop, not a failure — keep whatever streamed in so
        // far (already reflected via `update({ content })` above) rather
        // than showing a red error for something the user asked for.
        update({ isStreaming: false });
      } else {
        update({ error: err?.message ?? "Something went wrong.", isStreaming: false });
      }
    } finally {
      setIsBusy(false);
      abortControllerRef.current = null;
      if (resolvedChatId) onChatTouched();
    }
  }

  /** "Compact now" from the context gauge. Returns an error message, or null. */
  async function compactNow(): Promise<string | null> {
    if (!chatId) return null;
    try {
      const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/compact`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) return json?.error ?? "Compaction failed.";
      if (json.context) setContext(json.context);
      return json.compacted ? null : "Nothing to compact yet.";
    } catch {
      return "Compaction failed.";
    }
  }

  function stop() {
    abortControllerRef.current?.abort();
  }

  function toggleSpeak(messageId: string, content: string) {
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    // Only one utterance plays at a time — starting a new one (or
    // stopping the current one) always cancels whatever's already
    // speaking, since speechSynthesis itself is a single global queue,
    // not something scoped per message.
    window.speechSynthesis.cancel();

    if (speakingMessageId === messageId) {
      setSpeakingMessageId(null);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(toSpeakableText(content));
    utterance.onend = () => setSpeakingMessageId((id) => (id === messageId ? null : id));
    utterance.onerror = () => setSpeakingMessageId((id) => (id === messageId ? null : id));
    setSpeakingMessageId(messageId);
    window.speechSynthesis.speak(utterance);
  }

  async function saveEdit(messageId: string, newText: string) {
    const trimmed = newText.trim();
    setEditingMessageId(null);
    if (!trimmed) return;

    const target = messages.find((m) => m.id === messageId);
    const idx = messages.findIndex((m) => m.id === messageId);
    if (idx !== -1) {
      setMessages((prev) => prev.slice(0, idx));
    }

    let editGroupId = target?.editGroupId ?? undefined;

    if (chatId) {
      try {
        const res = await fetch(`/api/chats/${chatId}/messages/start-edit`, {
          method: "POST",
        });
        const json = await res.json();
        if (res.ok && json.editGroupId) {
          editGroupId = json.editGroupId;
          // A new version is about to exist — drop any cached list for
          // this group so it's refetched (and its index reset to
          // "latest") once the new version actually lands.
          setVersionsByGroup((prev) => {
            const next = { ...prev };
            delete next[editGroupId!];
            return next;
          });
          setVersionIndexByGroup((prev) => {
            const next = { ...prev };
            delete next[editGroupId!];
            return next;
          });
        }
      } catch {
        // Best-effort: if this fails, send() below still creates a fresh
        // pair — just not tagged as a version of the old one. The old
        // pair stays in the database either way (never deleted), so
        // nothing is lost, only the version link between them.
      }
    }

    send(trimmed, editGroupId);
  }

  function navigateVersion(editGroupId: string, direction: -1 | 1) {
    const versions = versionsByGroup[editGroupId];
    if (!versions) return;
    const current = versionIndexByGroup[editGroupId] ?? versions.length - 1;
    const target = current + direction;
    if (target < 0 || target >= versions.length) return;

    const version = versions[target];
    setMessages((prev) => {
      const userIdx = prev.findIndex((m) => m.editGroupId === editGroupId && m.role === "user");
      if (userIdx === -1) return prev;
      const next = [...prev];
      next[userIdx] = storedToChatMessage(version.userMessage);
      if (version.assistantMessage && next[userIdx + 1]?.role === "assistant") {
        next[userIdx + 1] = storedToChatMessage(version.assistantMessage);
      }
      return next;
    });

    setVersionIndexByGroup((prev) => ({ ...prev, [editGroupId]: target }));
  }

  return (
    <div className="flex-1 flex min-w-0">
      <div className="flex-1 flex flex-col min-w-0">
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {mode === "agent" && <AgentModelWarning />}
          {loadingHistory ? (
            <p className="text-sm text-paper-400 py-16 text-center">Loading conversation...</p>
          ) : notFound && messages.length === 0 ? (
            <div className="py-16 text-center">
              <p className="font-serif text-xl text-paper-200 mb-2">This chat doesn&apos;t exist</p>
              <p className="text-sm text-paper-400">
                It may have been deleted, or the link is mistyped. Ask something below to start a new chat, or{" "}
                <Link href="/" className="text-brass-300 hover:underline">
                  go to a new chat
                </Link>
                .
              </p>
            </div>
          ) : messages.length === 0 ? (
            <EmptyState hasDocuments={readyDocs.length > 0} mode={mode} onPick={send} />
          ) : (
            <div className="w-full mx-auto px-6 py-8 flex flex-col gap-6">
              {messages.map((m) => {
                const versions = m.editGroupId ? versionsByGroup[m.editGroupId] : undefined;
                const versionIndex = m.editGroupId
                  ? versionIndexByGroup[m.editGroupId] ?? (versions ? versions.length - 1 : undefined)
                  : undefined;
                return (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    onCiteClick={(index) => setActiveCitation({ messageId: m.id, index })}
                    isLastUserMessage={m.role === "user" && m.id === lastUserMessageId}
                    isEditing={editingMessageId === m.id}
                    editDisabled={isBusy}
                    onStartEdit={() => setEditingMessageId(m.id)}
                    onCancelEdit={() => setEditingMessageId(null)}
                    onSaveEdit={(text) => saveEdit(m.id, text)}
                    versionCount={versions?.length}
                    versionIndex={versionIndex}
                    onPrevVersion={
                      m.editGroupId ? () => navigateVersion(m.editGroupId!, -1) : undefined
                    }
                    onNextVersion={
                      m.editGroupId ? () => navigateVersion(m.editGroupId!, 1) : undefined
                    }
                    isSpeaking={speakingMessageId === m.id}
                    onToggleSpeak={() => toggleSpeak(m.id, m.content)}
                  />
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-ink-600 bg-ink-900 px-6 py-4">
          <DocumentScopePicker documents={readyDocs} selected={activeScope} onChange={setScope} />
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
            <VoiceInputButton value={input} onChange={setInput} disabled={isBusy} />
            {isBusy ? (
              <button
                type="button"
                onClick={stop}
                className="flex items-center justify-center h-8 w-8 rounded-lg bg-rust-500 text-ink-950 hover:bg-rust-400 transition-colors shrink-0"
                aria-label="Stop"
                title="Stop generating"
              >
                <Square size={13} fill="currentColor" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="flex items-center justify-center h-8 w-8 rounded-lg bg-brass-400 text-ink-950 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-brass-300 transition-colors shrink-0"
                aria-label="Send"
              >
                <ArrowUp size={16} strokeWidth={2.5} />
              </button>
            )}
          </form>
          <div className="max-w-[720px] mx-auto mt-2 flex items-center gap-3">
            <ContextGauge context={context} busy={isBusy} onCompact={compactNow} />
            <p className="flex-1 text-center text-[11px] text-paper-400 leading-relaxed">
              {mode === "agent" ? (
                <>AI-generated: it can make mistakes, so check anything important.</>
              ) : (
                <>
                  AI-generated: it can make mistakes, so check anything important.
                  This is a RAG assistant, not an autonomous agent.
                </>
              )}
            </p>
            {/* Balances the gauge, so the note stays centered under the input. */}
            <div className="w-14 shrink-0" aria-hidden />
          </div>
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
