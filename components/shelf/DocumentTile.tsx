"use client";

import { useState } from "react";
import { FileText, Loader2, CheckCircle2, XCircle, Trash2, Clock, RotateCcw } from "lucide-react";
import type { DocumentRecord } from "@/types";
import { formatBytes, relativeTime, cn } from "@/lib/utils";
import { InlineEditableText } from "@/components/InlineEditableText";

const STATUS_STYLE: Record<
  DocumentRecord["status"],
  { icon: typeof CheckCircle2; className: string }
> = {
  ready: { icon: CheckCircle2, className: "text-teal-400 border-teal-500/40 bg-teal-500/10" },
  queued: { icon: Clock, className: "text-paper-300 border-ink-500 bg-ink-700" },
  processing: { icon: Loader2, className: "text-brass-300 border-brass-400/40 bg-brass-400/10" },
  failed: { icon: XCircle, className: "text-rust-400 border-rust-500/40 bg-rust-500/10" },
};

function StatusBadge({ status }: { status: DocumentRecord["status"] }) {
  const { icon: Icon, className } = STATUS_STYLE[status];
  return (
    <span
      className={cn(
        "flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border shrink-0",
        className
      )}
    >
      <Icon size={10} className={status === "processing" ? "animate-spin" : ""} />
      {status}
    </span>
  );
}

const STAGE_LABEL: Record<string, string> = {
  queued: "Waiting to be processed",
  ocr: "Reading scanned pages",
  embedding: "Indexing passages",
  reembedding: "Re-indexing for the new model",
};

const LANGUAGE_LABEL: Record<string, string> = {
  english: "English",
  italian: "Italian",
  french: "French",
  german: "German",
  spanish: "Spanish",
  portuguese: "Portuguese",
  dutch: "Dutch",
};

/** What the background worker is doing with a document, with a progress bar. */
function ProgressLine({ doc }: { doc: DocumentRecord }) {
  const label = STAGE_LABEL[doc.stage ?? "queued"] ?? "Processing";
  const total = doc.progressTotal ?? 0;
  const done = doc.progressDone ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <span className="block">
      <span className="block">
        {label}
        {total > 0 && ` · ${done}/${total}${doc.stage === "ocr" ? " pages" : ""}`}
      </span>
      {total > 0 && (
        <span className="mt-1.5 block h-1 rounded-full bg-ink-600 overflow-hidden">
          <span className="block h-full bg-brass-400 transition-all" style={{ width: `${pct}%` }} />
        </span>
      )}
    </span>
  );
}

export function DocumentTile({
  doc,
  onDelete,
  onRename,
  onRetry,
}: {
  doc: DocumentRecord;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onRetry?: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);

  return (
    <div className="flex flex-col rounded-lg border border-ink-600 bg-ink-800 p-4 hover:border-ink-500 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-ink-700 text-paper-400 shrink-0">
          <FileText size={16} />
        </div>
        <StatusBadge status={doc.status} />
      </div>

      <InlineEditableText
        value={doc.name}
        onSave={(next) => onRename(doc.id, next)}
        className="text-sm text-paper-200 leading-snug line-clamp-2 mb-2 block"
        inputClassName="text-sm text-paper-200 w-full"
      />

      <p className="text-xs text-paper-400 mt-auto line-clamp-2">
        {doc.status === "ready" &&
          `${doc.chunkCount} passages, ${formatBytes(doc.charCount)}${
            doc.language && LANGUAGE_LABEL[doc.language] ? `, ${LANGUAGE_LABEL[doc.language]}` : ""
          }`}
        {(doc.status === "processing" || doc.status === "queued") && <ProgressLine doc={doc} />}
        {doc.status === "failed" && (doc.error || "Failed")}
      </p>

      <div className="flex items-center justify-between mt-2.5 pt-2.5 border-t border-ink-700/60">
        <span className="text-[10px] font-mono uppercase text-paper-400">{doc.fileType}</span>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-paper-400">{relativeTime(doc.createdAt)}</span>
          {doc.status === "failed" && onRetry && (
            <button
              onClick={() => onRetry(doc.id)}
              className="text-paper-400 hover:text-brass-300 transition-colors p-0.5"
              aria-label={`Retry processing ${doc.name}`}
              title="Retry"
            >
              <RotateCcw size={13} />
            </button>
          )}
          <button
            onClick={async () => {
              setDeleting(true);
              await onDelete(doc.id);
              setDeleting(false);
            }}
            disabled={deleting}
            className="text-paper-400 hover:text-rust-400 transition-colors p-0.5 disabled:opacity-40"
            aria-label={`Remove ${doc.name}`}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
