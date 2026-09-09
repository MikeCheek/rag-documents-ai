"use client";

import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import { AlertTriangle, Bot, BookOpen, Clock } from "lucide-react";
import type { ChatMessage } from "@/types";
import { normalizeMathDelimiters } from "@/lib/markdown";
import { PipelineStatus } from "./PipelineStatus";
import { AgentSteps } from "./AgentSteps";
import { cn, formatDuration, formatClockTime } from "@/lib/utils";
import "katex/dist/katex.min.css";

// Turn "[1]" style citation markers into markdown links (#cite-1) so
// react-markdown renders them, then we intercept those links below and
// render them as clickable citation badges instead. Math delimiters are
// normalized first so this never runs on raw LaTeX brace/bracket syntax.
function prepareContent(text: string): string {
  return normalizeMathDelimiters(text).replace(/\[(\d+)\]/g, "[$1](#cite-$1)");
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
}: {
  message: ChatMessage;
  onCiteClick: (index: number) => void;
}) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex flex-col items-end animate-rise">
        <div className="max-w-[75%] rounded-2xl rounded-tr-sm bg-ink-700 px-4 py-2.5 text-[15px] text-paper-200">
          {message.content}
        </div>
        {message.createdAt && (
          <span className="text-[10px] text-paper-400/60 mt-1 mr-1">
            {formatClockTime(message.createdAt)}
          </span>
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
    <div className="flex justify-start animate-rise">
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
                      {message.sources!.map((s, i) => (
                        <button
                          key={s.chunkId}
                          onClick={() => onCiteClick(i)}
                          className="flex items-center gap-1.5 rounded-full border border-ink-600 hover:border-brass-400/60 bg-ink-800 pl-1.5 pr-2.5 py-0.5 text-xs text-paper-300 hover:text-paper-200 transition-colors"
                        >
                          <span className="flex items-center justify-center h-4 w-4 rounded-full border border-brass-400/60 text-brass-300 text-[10px] font-mono">
                            {i + 1}
                          </span>
                          <span className="max-w-[140px] truncate">{s.documentName}</span>
                        </button>
                      ))}
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
