"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { ChunkUsageRow } from "@/types";
import { cn } from "@/lib/utils";

export function ChunkUsageGrid({ chunks }: { chunks: ChunkUsageRow[] }) {
  const [query, setQuery] = useState("");

  const maxUsage = Math.max(1, ...chunks.map((c) => c.usageCount));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chunks;
    return chunks.filter(
      (c) =>
        c.documentName.toLowerCase().includes(q) ||
        c.content.toLowerCase().includes(q)
    );
  }, [chunks, query]);

  if (chunks.length === 0) {
    return (
      <p className="text-sm text-paper-400 py-10 text-center">
        No passages yet — upload a document to see it here.
      </p>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 mb-4 max-w-sm">
        <Search size={14} className="text-paper-400 shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by document or text..."
          className="bg-transparent text-sm text-paper-200 placeholder:text-paper-400 outline-none flex-1"
        />
      </div>

      <div className="rounded-lg border border-ink-600 overflow-hidden">
        <div className="grid grid-cols-[1fr,2.5fr,110px] bg-ink-850 px-4 py-2 text-xs text-paper-400 border-b border-ink-600">
          <span>Document</span>
          <span>Passage</span>
          <span className="text-right">Times used</span>
        </div>
        <div className="max-h-[520px] overflow-y-auto divide-y divide-ink-600">
          {filtered.map((c) => (
            <div
              key={c.chunkId}
              className="grid grid-cols-[1fr,2.5fr,110px] px-4 py-3 items-center hover:bg-ink-800/60 transition-colors"
            >
              <div className="min-w-0 pr-3">
                <p className="text-sm text-paper-200 truncate" title={c.documentName}>
                  {c.documentName}
                </p>
                <p className="text-[11px] text-paper-400 font-mono mt-0.5">
                  passage {c.chunkIndex + 1}
                </p>
              </div>
              <p className="text-sm text-paper-300 line-clamp-2 pr-4">{c.content}</p>
              <div className="flex items-center justify-end gap-2">
                <div className="h-1.5 w-14 rounded-full bg-ink-600 overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      c.usageCount > 0 ? "bg-brass-400" : "bg-ink-600"
                    )}
                    style={{ width: `${(c.usageCount / maxUsage) * 100}%` }}
                  />
                </div>
                <span className="text-sm font-mono text-paper-200 w-5 text-right">
                  {c.usageCount}
                </span>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="text-sm text-paper-400 py-8 text-center">No passages match &quot;{query}&quot;.</p>
          )}
        </div>
      </div>
    </div>
  );
}
