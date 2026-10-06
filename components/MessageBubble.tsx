"use client";

import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import { AlertTriangle, Bot, BookOpen, Clock, Copy, Check, Pencil, ChevronLeft, ChevronRight } from "lucide-react";
import type { ChatMessage, Source } from "@/types";
import { normalizeMathDelimiters } from "@/lib/markdown";
import { PipelineStatus } from "./PipelineStatus";
import { AgentSteps } from "./AgentSteps";
import { SpeakButton } from "./SpeakButton";
import { cn, formatDuration, formatClockTime, formatPages } from "@/lib/utils";
import "katex/dist/katex.min.css";

// Groups citation chips by document, so a document cited via several
// passages shows as one chip with several numbered badges instead of the
// document name repeated once per passage — the more sources an answer
// has, the more this matters (an Agent-mode answer with 50 sources from
// 15 documents should read as 15 chips, not 50).
function groupSourcesByDocument(
  sources: Source[]
): { documentId: string; documentName: string; indices: number[] }[] {
  const order: string[] = [];
  const groups = new Map<string, { documentName: string; indices: number[] }>();

  sources.forEach((s, i) => {
    if (!groups.has(s.documentId)) {
      groups.set(s.documentId, { documentName: s.documentName, indices: [] });
      order.push(s.documentId);
    }
    groups.get(s.documentId)!.indices.push(i);
  });

  return order.map((documentId) => ({ documentId, ...groups.get(documentId)! }));
}

// Turn "[1]" style citation markers into markdown links (#cite-1) so
// react-markdown renders them, then we intercept those links below and
// render them as clickable citation badges instead. Math delimiters are
// normalized first so this never runs on raw LaTeX brace/bracket syntax.
function prepareContent(text: string): string {
  return normalizeMathDelimiters(text).replace(/\[(\d+)\]/g, "[$1](#cite-$1)");
}

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can fail (insecure context, permissions, etc.) —
      // fail silently; the button just won't show a confirmation.
    }
  }

  return (
    <button
      onClick={copy}
      className={cn(
        "p-1 rounded hover:bg-ink-700 text-paper-400 hover:text-paper-200 transition-colors",
        className
      )}
      aria-label="Copy message"
      title="Copy"
    >
      {copied ? <Check size={13} className="text-teal-400" /> : <Copy size={13} />}
    </button>
  );
}

function ModeBadge({
  mode,
  apiCallCount,
  durationMs,
  createdAt,
}: {
  mode: "rag" | "agent";
  apiCallCount?: number;
  durationMs?: number;
  createdAt?: string;
}) {
  const isAgent = mode === "agent";
  return (
    <div className="flex items-center gap-2.5 mb-1.5 text-[10px] uppercase tracking-wide text-paper-400 flex-wrap">
      <span className="flex items-center gap-1">
        {isAgent ? <Bot size={11} className="text-brass-300" /> : <BookOpen size={11} />}
        {isAgent ? "Agent" : "RAG"}
      </span>
      {typeof apiCallCount === "number" && (
        <span className="normal-case text-paper-400/80">
          {apiCallCount} LLM call{apiCallCount === 1 ? "" : "s"}
        </span>
      )}
      {typeof durationMs === "number" && (
        <span className="normal-case text-paper-400/80 flex items-center gap-1">
          <Clock size={10} />
          {formatDuration(durationMs)}
        </span>
      )}
      {createdAt && (
        <span className="normal-case text-paper-400/60">{formatClockTime(createdAt)}</span>
      )}
    </div>
  );
}

function AgentStageLine({ stage, detail }: { stage: string; detail?: string }) {
  if (stage === "rate_limited") {
    return (
      <p className="text-sm text-rust-400 font-mono flex items-center gap-1.5">
        <Clock size={12} className="animate-pulse" />
        {detail ?? "Waiting for rate limit..."}
      </p>
    );
  }
  const label =
    stage === "calling_tool"
      ? `Calling ${detail}...`
      : stage === "generating"
      ? "Writing answer..."
      : `Thinking${detail ? ` (${detail})` : ""}...`;
  return <p className="text-sm text-paper-400 font-mono animate-pulse">{label}</p>;
}

export function MessageBubble({
  message,
  onCiteClick,
  isLastUserMessage,
  isEditing,
  editDisabled,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  versionCount,
  versionIndex,
  onPrevVersion,
  onNextVersion,
  isSpeaking,
  onToggleSpeak,
}: {
  message: ChatMessage;
  onCiteClick: (index: number) => void;
  isLastUserMessage?: boolean;
  isEditing?: boolean;
  editDisabled?: boolean;
  onStartEdit?: () => void;
  onCancelEdit?: () => void;
  onSaveEdit?: (text: string) => void;
  versionCount?: number;
  versionIndex?: number;
  onPrevVersion?: () => void;
  onNextVersion?: () => void;
  isSpeaking?: boolean;
  onToggleSpeak?: () => void;
}) {
  const isUser = message.role === "user";
  const editRef = useRef<HTMLTextAreaElement>(null);

  if (isUser) {
    if (isEditing) {
      return (
        <div className="flex flex-col items-end animate-rise">
          <div className="max-w-[85%] w-full rounded-2xl rounded-tr-sm bg-ink-700 p-2">
            <textarea
              ref={editRef}
              autoFocus
              defaultValue={message.content}
              rows={Math.min(10, Math.max(2, message.content.split("\n").length + 1))}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  onCancelEdit?.();
                } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  onSaveEdit?.(editRef.current?.value ?? "");
                }
              }}
              className="w-full resize-none bg-transparent text-[15px] text-paper-200 outline-none px-2 py-1.5"
            />
            <div className="flex justify-end gap-2 px-1 pb-1">
              <button
                onClick={onCancelEdit}
                className="text-xs text-paper-400 hover:text-paper-200 px-2 py-1 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => onSaveEdit?.(editRef.current?.value ?? "")}
                className="text-xs bg-brass-400 text-ink-950 rounded-lg px-2.5 py-1 hover:bg-brass-300 transition-colors"
              >
                Save &amp; resend
              </button>
            </div>
          </div>
          <span className="text-[10px] text-paper-400/60 mt-1 mr-1">
            This creates a new version — the old message and its reply stay saved, reachable from "Edited" once you're done.
          </span>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-end animate-rise group">
        <div className="flex items-center gap-1">
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {isLastUserMessage && !editDisabled && (
              <button
                onClick={onStartEdit}
                className="p-1 rounded hover:bg-ink-700 text-paper-400 hover:text-paper-200 transition-colors"
                aria-label="Edit message"
                title="Edit and resend"
              >
                <Pencil size={13} />
              </button>
            )}
            <CopyButton text={message.content} />
          </div>
          <div className="max-w-[75%] rounded-2xl rounded-tr-sm bg-ink-700 px-4 py-2.5 text-[15px] text-paper-200">
            {message.content}
          </div>
        </div>
        {message.editGroupId && typeof versionIndex === "number" && versionCount ? (
          <div className="flex items-center gap-1 mt-1 mr-1 text-[10px] text-paper-400/70">
            <span>Edited</span>
            <button
              onClick={onPrevVersion}
              disabled={versionIndex <= 0}
              className="p-0.5 rounded hover:bg-ink-700 hover:text-paper-200 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
              aria-label="Previous version"
              title="Previous version"
            >
              <ChevronLeft size={11} />
            </button>
            <span className="font-mono">
              {versionIndex + 1}/{versionCount}
            </span>
            <button
              onClick={onNextVersion}
              disabled={versionIndex >= versionCount - 1}
              className="p-0.5 rounded hover:bg-ink-700 hover:text-paper-200 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
              aria-label="Next version"
              title="Next version"
            >
              <ChevronRight size={11} />
            </button>
          </div>
        ) : (
          message.createdAt && (
            <span className="text-[10px] text-paper-400/60 mt-1 mr-1">
              {formatClockTime(message.createdAt)}
            </span>
          )
        )}
      </div>
    );
  }

  const isAgent = message.mode === "agent";
  const agentSteps = message.agentSteps ?? [];
  const hasSteps = agentSteps.length > 0;
  const showStageOnly = message.isStreaming && !message.content && !hasSteps && message.stage;
  const sourceCount = message.sources?.length ?? 0;

  const components: Components = {
    a: ({ href, children }) => {
      if (href?.startsWith("#cite-")) {
        const n = parseInt(href.replace("#cite-", ""), 10);
        const valid = n >= 1 && n <= sourceCount;
        return (
          <button
            onClick={() => valid && onCiteClick(n - 1)}
            className={cn(
              "inline-flex items-center justify-center h-[18px] min-w-[18px] px-1 rounded-full border text-[10px] font-mono align-super mx-0.5 -translate-y-px transition-colors",
              valid
                ? "border-brass-400/70 text-brass-300 hover:bg-brass-400/10 cursor-pointer"
                : "border-ink-600 text-paper-400"
            )}
          >
            {n}
          </button>
        );
      }
      return (
        <a href={href} target="_blank" rel="noreferrer" className="underline">
          {children}
        </a>
      );
    },
    table: ({ children }) => (
      <div className="overflow-x-auto -mx-1 px-1">
        <table>{children}</table>
      </div>
    ),
  };

  return (
    <div className="flex justify-start animate-rise group">
      <div className="max-w-[80%] w-full">
        <div className="border-l-2 border-brass-400/50 pl-4">
          {message.error ? (
            <div className="flex items-start gap-2 text-rust-400 text-sm">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <p>{message.error}</p>
            </div>
          ) : (
            <>
              {message.mode && (
                <ModeBadge
                  mode={message.mode}
                  apiCallCount={message.apiCallCount}
                  durationMs={message.durationMs}
                  createdAt={message.createdAt}
                />
              )}

              {showStageOnly ? (
                isAgent ? (
                  <AgentStageLine stage={message.stage!} detail={message.stageDetail} />
                ) : (
                  <PipelineStatus stage={message.stage!} detail={message.stageDetail} kind="chat" />
                )
              ) : (
                <>
                  {isAgent && hasSteps && (
                    <AgentSteps steps={agentSteps} live={message.isStreaming} />
                  )}

                  {isAgent && message.isStreaming && !message.content && message.stage && (
                    <AgentStageLine stage={message.stage} detail={message.stageDetail} />
                  )}

                  <div className="prose-answer text-[15px] text-paper-200 leading-relaxed">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkMath]}
                      rehypePlugins={[rehypeKatex]}
                      components={components}
                    >
                      {prepareContent(message.content)}
                    </ReactMarkdown>
                    {message.isStreaming && (
                      <span className="inline-block w-1.5 h-4 bg-brass-400 align-middle ml-0.5 animate-blink" />
                    )}
                  </div>

                  {sourceCount > 0 && (
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-paper-400 mr-1">Sources</span>
                      {groupSourcesByDocument(message.sources!).map((group) => {
                        const MAX_BADGES = 6;
                        const shown = group.indices.slice(0, MAX_BADGES);
                        const overflow = group.indices.length - shown.length;
                        return (
                          <div
                            key={group.documentId}
                            className="flex items-center gap-1.5 rounded-full border border-ink-600 hover:border-brass-400/60 bg-ink-800 pl-1 pr-2.5 py-0.5 transition-colors"
                          >
                            <div className="flex items-center gap-0.5">
                              {shown.map((idx) => (
                                <button
                                  key={idx}
                                  onClick={() => onCiteClick(idx)}
                                  title={formatPages(message.sources![idx].pageStart, message.sources![idx].pageEnd) ?? undefined}
                                  className="flex items-center justify-center h-4 w-4 rounded-full border border-brass-400/60 text-brass-300 text-[10px] font-mono hover:bg-brass-400/10 transition-colors"
                                >
                                  {idx + 1}
                                </button>
                              ))}
                              {overflow > 0 && (
                                <span className="text-[10px] text-paper-400 font-mono px-0.5">
                                  +{overflow}
                                </span>
                              )}
                            </div>
                            <button
                              onClick={() => onCiteClick(group.indices[0])}
                              className="max-w-[140px] truncate text-xs text-paper-300 hover:text-paper-200 transition-colors"
                            >
                              {group.documentName}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {!message.isStreaming && (
                    <div
                      className={cn(
                        "flex items-center gap-0.5 mt-2 transition-opacity",
                        isSpeaking ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                      )}
                    >
                      <CopyButton text={message.content} />
                      {onToggleSpeak && (
                        <SpeakButton isSpeaking={!!isSpeaking} onToggle={onToggleSpeak} />
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
