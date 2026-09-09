"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, Inbox, Sparkles, Loader2 } from "lucide-react";
import type { DocumentRecord, DocumentStatus, ClusterResult } from "@/types";
import { UploadZone } from "@/components/UploadZone";
import { DocumentTile } from "@/components/shelf/DocumentTile";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | DocumentStatus;
type SortKey = "newest" | "oldest" | "name-asc" | "name-desc" | "passages" | "chars";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "name-asc", label: "Name (A\u2013Z)" },
  { value: "name-desc", label: "Name (Z\u2013A)" },
  { value: "passages", label: "Most passages" },
  { value: "chars", label: "Most text" },
];

export default function ShelfPage() {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortKey>("newest");
  const [grouping, setGrouping] = useState(false);
  const [clusters, setClusters] = useState<ClusterResult | null>(null);
  const [clustersLoading, setClustersLoading] = useState(false);
  const [clustersError, setClustersError] = useState<string | null>(null);

  async function toggleGrouping() {
    const next = !grouping;
    setGrouping(next);
    if (next && !clusters) {
      setClustersLoading(true);
      setClustersError(null);
      try {
        const res = await fetch("/api/document-clusters");
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to group documents");
        setClusters(json);
      } catch (err: any) {
        setClustersError(err?.message ?? "Failed to group documents");
      } finally {
        setClustersLoading(false);
      }
    }
  }

  async function loadDocuments() {
    try {
      const res = await fetch("/api/documents");
      const json = await res.json();
      setDocuments(json.documents ?? []);
    } catch {
      // best-effort
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    loadDocuments();
  }, []);

  // Any change to the document set invalidates a cached grouping — if
  // grouping is active right now, refetch immediately; otherwise just drop
  // the cache so the next time it's turned on fetches fresh instead of
  // showing a stale grouping from before the change.
  useEffect(() => {
    setClusters(null);
    if (!grouping) return;
    setClustersLoading(true);
    fetch("/api/document-clusters")
      .then((res) => res.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        setClusters(json);
        setClustersError(null);
      })
      .catch((err) => setClustersError(err?.message ?? "Failed to group documents"))
      .finally(() => setClustersLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documents.length]);

  function handleDocumentUpdate(doc: DocumentRecord) {
    setDocuments((prev) => {
      const exists = prev.some((d) => d.id === doc.id);
      if (exists) return prev.map((d) => (d.id === doc.id ? doc : d));
      return [doc, ...prev];
    });
  }

  async function handleDeleteDocument(id: string) {
    setDocuments((prev) => prev.filter((d) => d.id !== id));
    await fetch(`/api/documents/${id}`, { method: "DELETE" }).catch(() => {});
  }

  async function handleRenameDocument(id: string, name: string) {
    setDocuments((prev) => prev.map((d) => (d.id === id ? { ...d, name } : d)));
    await fetch(`/api/documents/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => {});
  }

  const fileTypes = useMemo(
    () => Array.from(new Set(documents.map((d) => d.fileType))).sort(),
    [documents]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();

    const filtered = documents.filter((d) => {
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      if (typeFilter !== "all" && d.fileType !== typeFilter) return false;
      if (q && !d.name.toLowerCase().includes(q)) return false;
      return true;
    });

    const sorted = [...filtered];
    switch (sortBy) {
      case "newest":
        sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        break;
      case "oldest":
        sorted.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        break;
      case "name-asc":
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "name-desc":
        sorted.sort((a, b) => b.name.localeCompare(a.name));
        break;
      case "passages":
        sorted.sort((a, b) => b.chunkCount - a.chunkCount);
        break;
      case "chars":
        sorted.sort((a, b) => b.charCount - a.charCount);
        break;
    }
    return sorted;
  }, [documents, search, statusFilter, typeFilter, sortBy]);

  const readyCount = documents.filter((d) => d.status === "ready").length;
  const filtersActive = search.trim() !== "" || statusFilter !== "all" || typeFilter !== "all";

  const groupedSections = useMemo(() => {
    if (!grouping || !clusters) return null;

    const visibleIds = new Set(visible.map((d) => d.id));
    const byId = new Map(visible.map((d) => [d.id, d]));

    const sections: { key: string; label: string; docs: DocumentRecord[] }[] = [];
    const grouped = new Set<string>();

    for (const cluster of clusters.clusters) {
      const docs = cluster.documentIds
        .filter((id) => visibleIds.has(id))
        .map((id) => byId.get(id)!)
        .filter(Boolean);
      if (docs.length === 0) continue;
      docs.forEach((d) => grouped.add(d.id));
      sections.push({ key: cluster.id, label: cluster.label, docs });
    }

    const ungrouped = visible.filter((d) => !grouped.has(d.id));
    if (ungrouped.length > 0) {
      sections.push({ key: "__ungrouped", label: "Not similar to others", docs: ungrouped });
    }

    return sections;
  }, [grouping, clusters, visible]);

  return (
    <main className="h-full overflow-y-auto bg-ink-900 text-paper-200">
      <div className="max-w-[1200px] mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="font-serif italic text-3xl text-paper-100">The Shelf</h1>
          <p className="text-sm text-paper-400 mt-1">
            {documents.length === 0
              ? "Nothing here yet."
              : `${readyCount} of ${documents.length} document${
                  documents.length === 1 ? "" : "s"
                } ready.`}
          </p>
        </div>

        <div className="mb-8">
          <UploadZone onDocumentUpdate={handleDocumentUpdate} />
        </div>

        {loaded && documents.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-6">
            <div className="flex items-center gap-2 rounded-lg border border-ink-600 bg-ink-800 px-3 py-1.5 w-full sm:w-56">
              <Search size={13} className="text-paper-400 shrink-0" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter by name..."
                className="bg-transparent text-sm text-paper-200 placeholder:text-paper-400 outline-none flex-1 min-w-0"
              />
            </div>

            <div className="flex items-center gap-1">
              {(["all", "ready", "processing", "failed"] as StatusFilter[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={cn(
                    "text-xs px-2.5 py-1 rounded-full border transition-colors capitalize",
                    statusFilter === s
                      ? "border-brass-400/60 text-brass-300 bg-brass-400/5"
                      : "border-ink-600 text-paper-400 hover:text-paper-200"
                  )}
                >
                  {s}
                </button>
              ))}
            </div>

            {fileTypes.length > 1 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setTypeFilter("all")}
                  className={cn(
                    "text-xs px-2.5 py-1 rounded-full border transition-colors uppercase font-mono",
                    typeFilter === "all"
                      ? "border-brass-400/60 text-brass-300 bg-brass-400/5"
                      : "border-ink-600 text-paper-400 hover:text-paper-200"
                  )}
                >
                  all types
                </button>
                {fileTypes.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTypeFilter(t)}
                    className={cn(
                      "text-xs px-2.5 py-1 rounded-full border transition-colors uppercase font-mono",
                      typeFilter === t
                        ? "border-brass-400/60 text-brass-300 bg-brass-400/5"
                        : "border-ink-600 text-paper-400 hover:text-paper-200"
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}

            <button
              onClick={toggleGrouping}
              disabled={documents.filter((d) => d.status === "ready").length < 2}
              className={cn(
                "flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
                grouping
                  ? "border-brass-400/60 text-brass-300 bg-brass-400/5"
                  : "border-ink-600 text-paper-400 hover:text-paper-200"
              )}
              title="Group documents that are similar to each other, computed locally from their embeddings"
            >
              {clustersLoading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              Group similar
            </button>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              className="text-xs bg-ink-800 border border-ink-600 rounded-lg px-2.5 py-1.5 text-paper-300 outline-none focus:border-brass-400/60 ml-auto"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {grouping && clustersError && (
          <p className="text-sm text-rust-400 border border-rust-500/30 bg-rust-500/10 rounded-lg px-4 py-3 mb-6">
            {clustersError}
          </p>
        )}

        {loaded && documents.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center py-16">
            <Inbox size={28} className="text-paper-400 mb-3" />
            <p className="text-paper-400 max-w-sm leading-relaxed">
              Nothing on the shelf yet. Upload a document above to start asking
              questions about it.
            </p>
          </div>
        )}

        {loaded && documents.length > 0 && visible.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center py-16">
            <p className="text-paper-400">No documents match your filters.</p>
            <button
              onClick={() => {
                setSearch("");
                setStatusFilter("all");
                setTypeFilter("all");
              }}
              className="text-sm text-brass-300 hover:text-brass-200 mt-2 transition-colors"
            >
              Clear filters
            </button>
          </div>
        )}

        {groupedSections ? (
          <div className="flex flex-col gap-8">
            {groupedSections.map((section) => (
              <div key={section.key}>
                <div className="flex items-center gap-2 mb-3">
                  {section.key !== "__ungrouped" && <Sparkles size={13} className="text-brass-300" />}
                  <h2 className="text-sm text-paper-200 font-medium">{section.label}</h2>
                  <span className="text-xs text-paper-400">
                    {section.docs.length} document{section.docs.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {section.docs.map((doc) => (
                    <DocumentTile
                      key={doc.id}
                      doc={doc}
                      onDelete={handleDeleteDocument}
                      onRename={handleRenameDocument}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          visible.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {visible.map((doc) => (
                <DocumentTile
                  key={doc.id}
                  doc={doc}
                  onDelete={handleDeleteDocument}
                  onRename={handleRenameDocument}
                />
              ))}
            </div>
          )
        )}

        {filtersActive && visible.length > 0 && (
          <p className="text-xs text-paper-400 mt-4">
            Showing {visible.length} of {documents.length}.{" "}
            <button
              onClick={() => {
                setSearch("");
                setStatusFilter("all");
                setTypeFilter("all");
              }}
              className="text-brass-300 hover:text-brass-200 transition-colors"
            >
              Clear filters
            </button>
          </p>
        )}
      </div>
    </main>
  );
}
