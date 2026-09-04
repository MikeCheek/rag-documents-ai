"use client";

import { useState } from "react";
import { ChevronDown, X } from "lucide-react";
import type { EmbeddingSpaceResult } from "@/types";
import { FALLBACK_DOCUMENT_COLOR } from "@/lib/constellation-colors";
import { cn } from "@/lib/utils";

export function ResultsOverlay({
  data,
  documentColorMap,
  pinnedId,
  onSelect,
}: {
  data: EmbeddingSpaceResult;
  documentColorMap: Map<string, string>;
  pinnedId: number | null;
  onSelect: (id: number | null) => void;
}) {
  const [open, setOpen] = useState(true);
  const sorted = [...data.points].sort((a, b) => b.similarity - a.similarity);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="absolute top-4 right-4 z-10 flex items-center gap-1.5 text-xs bg-ink-850/90 border border-ink-600 rounded-lg px-3 py-1.5 text-paper-300 hover:border-brass-400/50 transition-colors backdrop-blur-sm"
      >
        <ChevronDown size={13} className="-rotate-90" />
        Results ({sorted.length})
      </button>
    );
  }

  return (
    <div className="absolute top-4 right-4 z-10 w-[300px] max-h-[calc(100%-2rem)] flex flex-col rounded-lg border border-ink-600 bg-ink-850/95 backdrop-blur-sm overflow-hidden shadow-lg">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-ink-600 shrink-0">
        <p className="text-sm text-paper-200 font-medium">Results ({sorted.length})</p>
        <button
          onClick={() => setOpen(false)}
          className="text-paper-400 hover:text-paper-200 p-1 -mr-1"
          aria-label="Collapse results"
        >
          <X size={14} />
        </button>
      </div>

      <div className="overflow-y-auto flex-1">
        {sorted.map((p) => {
          const color = documentColorMap.get(p.documentId) ?? FALLBACK_DOCUMENT_COLOR;
          const active = pinnedId === p.chunkId;
          const pct = Math.round(Math.max(0, Math.min(1, p.similarity)) * 100);

          return (
            <button
              key={p.chunkId}
              onClick={() => onSelect(active ? null : p.chunkId)}
              className={cn(
                "w-full text-left px-4 py-2.5 border-b border-ink-700/60 last:border-0 transition-colors",
                active ? "bg-ink-700" : "hover:bg-ink-800"
              )}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ background: color, opacity: p.isNeighbor ? 1 : 0.4 }}
                />
                <span className="text-xs text-paper-200 truncate flex-1">{p.documentName}</span>
                <span className="text-[11px] font-mono text-paper-400 shrink-0">{pct}%</span>
              </div>
              <p className="text-[11px] text-paper-400 leading-relaxed line-clamp-2">{p.content}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
