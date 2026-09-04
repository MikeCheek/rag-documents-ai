"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Search, RotateCw } from "lucide-react";
import type { DocumentRecord, EmbeddingSpaceResult } from "@/types";
import { buildDocumentColorMap } from "@/lib/constellation-colors";
import { ResultsOverlay } from "@/components/constellation/ResultsOverlay";
import { cn } from "@/lib/utils";

// The three.js canvas can't be server-rendered, so it's loaded client-only.
const ConstellationScene = dynamic(
  () => import("@/components/constellation/ConstellationScene"),
  {
    ssr: false,
    loading: () => (
      <div className="h-full w-full flex items-center justify-center text-paper-400 text-sm">
        Loading the sky...
      </div>
    ),
  }
);

export default function ConstellationPage() {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [data, setData] = useState<EmbeddingSpaceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRotate, setAutoRotate] = useState(true);
  const [pinnedId, setPinnedId] = useState<number | null>(null);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);

  // Fetched once so every document gets a stable, maximally-distinct color
  // (golden-angle hue stepping ordered by upload time) that stays the same
  // across different searches, rather than being recomputed per-query.
  useEffect(() => {
    fetch("/api/documents")
      .then((res) => res.json())
      .then((json) => setDocuments(json.documents ?? []))
      .catch(() => {});
  }, []);

  const documentColorMap = useMemo(() => {
    const sortedIds = [...documents]
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .map((d) => d.id);
    return buildDocumentColorMap(sortedIds);
  }, [documents]);

  async function search(text: string) {
    const q = text.trim();
    if (!q || loading) return;

    setLoading(true);
    setError(null);
    setPinnedId(null);

    try {
      const res = await fetch("/api/embedding-space", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to map the embedding space");
      setData(json);
      setSubmittedQuery(q);
    } catch (err: any) {
      setError(err?.message ?? "Failed to map the embedding space");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  const neighborCount = data?.points.filter((p) => p.isNeighbor).length ?? 0;
  const contrastCount = data?.points.filter((p) => !p.isNeighbor).length ?? 0;

  return (
    <main className="h-full w-full flex flex-col bg-ink-900 text-paper-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-ink-600 flex items-center justify-between gap-4 shrink-0 flex-wrap">
        <h1 className="font-serif italic text-2xl text-paper-100 shrink-0">The Constellation</h1>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            search(query);
          }}
          className="flex items-center gap-2 rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 w-full max-w-md focus-within:border-brass-400/60 transition-colors"
        >
          <Search size={14} className="text-paper-400 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Map a word or phrase..."
            className="flex-1 bg-transparent text-sm text-paper-200 placeholder:text-paper-400 outline-none"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="text-xs text-ink-950 bg-brass-400 hover:bg-brass-300 rounded-md px-3 py-1 disabled:opacity-40 transition-colors shrink-0"
          >
            {loading ? "Mapping..." : "Map it"}
          </button>
        </form>

        <button
          onClick={() => setAutoRotate((v) => !v)}
          className={cn(
            "flex items-center gap-1.5 text-xs border rounded-lg px-3 py-1.5 transition-colors shrink-0",
            autoRotate
              ? "border-brass-400/60 text-brass-300"
              : "border-ink-600 text-paper-400 hover:text-paper-200"
          )}
        >
          <RotateCw size={12} />
          Auto-rotate
        </button>
      </div>

      <div className="flex-1 relative">
        {error && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 text-sm text-rust-400 border border-rust-500/30 bg-ink-900/90 rounded-lg px-4 py-2">
            {error}
          </div>
        )}

        {!data && !loading && !error && (
          <div className="h-full flex flex-col items-center justify-center text-center px-6">
            <p className="text-paper-400 max-w-sm leading-relaxed">
              Enter a word or phrase above to see which passages sit nearest to it
              in embedding space, mapped in 3D.
            </p>
          </div>
        )}

        {data && data.points.length > 0 && (
          <>
            <ConstellationScene
              data={data}
              queryLabel={submittedQuery}
              autoRotate={autoRotate}
              documentColorMap={documentColorMap}
              pinnedId={pinnedId}
              onPinnedChange={setPinnedId}
            />
            <ResultsOverlay
              data={data}
              documentColorMap={documentColorMap}
              pinnedId={pinnedId}
              onSelect={setPinnedId}
            />
          </>
        )}

        {data && data.points.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-6 text-center">
            <p className="text-paper-400 text-sm">
              No passages found — upload a document first.
            </p>
          </div>
        )}
      </div>

      {data && data.points.length > 0 && (
        <div className="px-6 py-3 border-t border-ink-600 flex items-center justify-between text-xs text-paper-400 shrink-0 flex-wrap gap-2">
          <span>
            {neighborCount} nearest passages, {contrastCount} shown for scale
          </span>
          <span>Drag to rotate, scroll to zoom, click a point to pin its excerpt</span>
        </div>
      )}
    </main>
  );
}
