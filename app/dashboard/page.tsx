"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import type { AppLimits, DashboardData } from "@/types";
import { StatCard } from "@/components/dashboard/StatCard";
import { OpenRouterUsageCard, CohereUsageCard, LocalUsageCard } from "@/components/dashboard/UsageCard";
import { ChunkUsageGrid } from "@/components/dashboard/ChunkUsageGrid";
import { formatBytes } from "@/lib/utils";

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const res = await fetch("/api/dashboard");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load dashboard");
      setData(json);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function saveLimits(patch: Partial<AppLimits>) {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update limits");
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Failed to update limits");
    }
  }

  return (
    <main className="h-full overflow-y-auto bg-ink-900 text-paper-200">
      <div className="max-w-[1100px] mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-serif italic text-3xl text-paper-100">The Ledger</h1>
            <p className="text-sm text-paper-400 mt-1">
              What&apos;s on the shelf, and how hard the free tiers are working.
            </p>
          </div>
          <button
            onClick={() => {
              setLoading(true);
              load();
            }}
            className="flex items-center gap-1.5 text-sm text-paper-300 border border-ink-600 rounded-lg px-3 py-1.5 hover:border-brass-400/50 hover:bg-ink-800 transition-colors shrink-0"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        <Link
          href="/settings"
          className="inline-flex items-center gap-1.5 text-sm text-paper-400 hover:text-paper-200 transition-colors mb-6"
        >
          Adjust query optimization &amp; reranking method
        </Link>

        {error && (
          <p className="text-sm text-rust-400 border border-rust-500/30 bg-rust-500/10 rounded-lg px-4 py-3 mb-6">
            {error}
          </p>
        )}

        {data && (
          <div className="flex flex-col gap-10">
            <section>
              <h2 className="text-xs text-paper-400 mb-3">Database</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard
                  label="Documents ready"
                  value={`${data.documents.ready}/${data.documents.total}`}
                  sublabel={
                    data.documents.processing > 0
                      ? `${data.documents.processing} processing`
                      : data.documents.failed > 0
                      ? `${data.documents.failed} failed`
                      : "all processed"
                  }
                  accent="brass"
                />
                <StatCard
                  label="Passages stored"
                  value={String(data.documents.totalChunks)}
                  sublabel="chunks in pgvector"
                  accent="teal"
                />
                <StatCard
                  label="Text stored"
                  value={formatBytes(data.documents.totalChars)}
                  sublabel="extracted characters"
                />
                <StatCard
                  label="Answers generated"
                  value={String(data.usage.openrouter.byPurpose["chat_completion"] ?? 0)}
                  sublabel="all time"
                />
              </div>
            </section>

            <section>
              <h2 className="text-xs text-paper-400 mb-3">API usage</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <OpenRouterUsageCard
                  usage={data.usage.openrouter}
                  configured={data.configured.openrouter}
                  limits={data.limits}
                  onSaveLimits={saveLimits}
                />
                <CohereUsageCard
                  usage={data.usage.cohere}
                  configured={data.configured.cohere}
                  limits={data.limits}
                  onSaveLimits={saveLimits}
                />
                <LocalUsageCard usage={data.usage.local} />
              </div>
            </section>

            <section>
              <h2 className="text-xs text-paper-400 mb-3">Passage usage</h2>
              <ChunkUsageGrid chunks={data.chunks} />
            </section>
          </div>
        )}

        {loading && !data && (
          <p className="text-sm text-paper-400 py-16 text-center">Loading the ledger...</p>
        )}
      </div>
    </main>
  );
}
