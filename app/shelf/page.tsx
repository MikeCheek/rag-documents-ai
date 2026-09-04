"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, Inbox } from "lucide-react";
import type { DocumentRecord, DocumentStatus } from "@/types";
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

        {visible.length > 0 && (
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
