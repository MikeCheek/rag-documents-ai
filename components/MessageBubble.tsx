"use client";

import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import { AlertTriangle } from "lucide-react";
import type { ChatMessage } from "@/types";
import { PipelineStatus } from "./PipelineStatus";
import { cn } from "@/lib/utils";

// Turn "[1]" style citation markers into markdown links (#cite-1) so
// react-markdown renders them, then we intercept those links below and
// render them as clickable citation badges instead.
function withCitationLinks(text: string): string {
  return text.replace(/\[(\d+)\]/g, "[$1](#cite-$1)");
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
      <div className="flex justify-end animate-rise">
        <div className="max-w-[75%] rounded-2xl rounded-tr-sm bg-ink-700 px-4 py-2.5 text-[15px] text-paper-200">
          {message.content}
        </div>
      </div>
    );
  }

  const showPipeline = message.isStreaming && !message.content && message.stage;
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
          ) : showPipeline ? (
            <PipelineStatus stage={message.stage!} detail={message.stageDetail} kind="chat" />
          ) : (
            <>
              <div className="prose-answer text-[15px] text-paper-200 leading-relaxed">
                <ReactMarkdown components={components}>
                  {withCitationLinks(message.content)}
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
        </div>
      </div>
    </div>
  );
}
