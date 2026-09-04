"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { Source } from "@/types";
import { cn } from "@/lib/utils";

export function SourcesDrawer({
  sources,
  rerankMethod,
  activeIndex,
  onClose,
}: {
  sources: Source[];
  rerankMethod?: string | null;
  activeIndex: number | null;
  onClose: () => void;
}) {
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (activeIndex === null) return;
    refs.current[activeIndex]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeIndex]);

  const methodLabel =
    rerankMethod === "cohere"
      ? "reranked by Cohere"
      : rerankMethod === "bm25"
      ? "reranked locally (BM25)"
      : "ordered by similarity";

  return (
    <aside className="w-[360px] shrink-0 border-l border-ink-600 bg-ink-850 flex flex-col animate-slidein">
      <div className="flex items-center justify-between px-5 py-4 border-b border-ink-600">
        <div>
          <h2 className="font-serif text-lg text-paper-200">Sources</h2>
          <p className="text-xs text-paper-400 mt-0.5">
            {sources.length} passage{sources.length === 1 ? "" : "s"}, {methodLabel}
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-paper-400 hover:text-paper-200 transition-colors p-1 -mr-1"
          aria-label="Close sources panel"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        {sources.map((s, i) => (
          <div
            key={s.chunkId}
            ref={(el) => {
              refs.current[i] = el;
            }}
            className={cn(
              "rounded-md border p-4 transition-colors",
              activeIndex === i
                ? "border-brass-400/70 bg-ink-700"
                : "border-ink-600 bg-ink-800"
            )}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="flex items-center justify-center h-5 w-5 rounded-full border border-brass-400/60 text-brass-300 text-[11px] font-mono shrink-0">
                {i + 1}
              </span>
              <p className="text-sm font-medium text-paper-200 truncate">
                {s.documentName}
              </p>
            </div>
            <p className="text-sm text-paper-300 leading-relaxed line-clamp-6">
              {s.content}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <div className="h-1 flex-1 rounded-full bg-ink-600 overflow-hidden">
                <div
                  className="h-full bg-teal-500"
                  style={{ width: `${Math.round(Math.min(1, Math.max(0, s.relevanceScore)) * 100)}%` }}
                />
              </div>
              <span className="text-[11px] font-mono text-paper-400">
                {Math.round(Math.min(1, Math.max(0, s.relevanceScore)) * 100)}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
