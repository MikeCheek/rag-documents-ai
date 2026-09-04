"use client";

import { useState } from "react";
import { FileText, Loader2, CheckCircle2, XCircle, Trash2 } from "lucide-react";
import type { DocumentRecord } from "@/types";
import { formatBytes, relativeTime } from "@/lib/utils";
import { InlineEditableText } from "./InlineEditableText";

function StatusIcon({ status }: { status: DocumentRecord["status"] }) {
  if (status === "ready") return <CheckCircle2 size={14} className="text-teal-500 shrink-0" />;
  if (status === "failed") return <XCircle size={14} className="text-rust-500 shrink-0" />;
  return <Loader2 size={14} className="text-brass-400 shrink-0 animate-spin" />;
}

export function DocumentList({
  documents,
  onDelete,
  onRename,
}: {
  documents: DocumentRecord[];
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  if (documents.length === 0) {
    return (
      <p className="text-sm text-paper-400 px-1 py-6 text-center leading-relaxed">
        Nothing on the shelf yet.
        <br />
        Upload a document to start asking questions.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {documents.map((doc) => (
        <li
          key={doc.id}
          className="group flex items-start gap-2.5 rounded-md px-2.5 py-2 hover:bg-ink-800 transition-colors"
        >
          <FileText size={16} className="text-paper-400 mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <InlineEditableText
              value={doc.name}
              onSave={(next) => onRename(doc.id, next)}
              className="text-sm text-paper-200 truncate block"
              inputClassName="text-sm text-paper-200"
            />
            <div className="flex items-center gap-1.5 mt-0.5">
              <StatusIcon status={doc.status} />
              <p className="text-xs text-paper-400 truncate flex-1">
                {doc.status === "ready" &&
                  `${doc.chunkCount} passages, ${formatBytes(doc.charCount)}`}
                {doc.status === "processing" && "processing"}
                {doc.status === "failed" && (doc.error || "failed")}
              </p>
              <span className="text-xs text-paper-400 shrink-0">{relativeTime(doc.createdAt)}</span>
            </div>
          </div>
          <button
            onClick={async () => {
              setDeletingId(doc.id);
              await onDelete(doc.id);
              setDeletingId(null);
            }}
            disabled={deletingId === doc.id}
            className="opacity-0 group-hover:opacity-100 text-paper-400 hover:text-rust-400 transition-opacity p-1 shrink-0"
            aria-label={`Remove ${doc.name}`}
          >
            <Trash2 size={14} />
          </button>
        </li>
      ))}
    </ul>
  );
}
