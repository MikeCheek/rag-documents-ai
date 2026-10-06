"use client";

import { useRef, useState } from "react";
import { Download, Upload, Loader2, CheckCircle2, XCircle } from "lucide-react";
import type { ImportSummary } from "@/lib/rag/export-import";

export function DataManager({ onImported }: { onImported?: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;

    setImporting(true);
    setResult(null);

    try {
      const text = await file.text();
      const bundle = JSON.parse(text);

      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bundle),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Import failed");

      const s: ImportSummary = json.summary;
      const parts = [
        s.documents ? `${s.documents} document${s.documents === 1 ? "" : "s"}` : null,
        s.chats ? `${s.chats} chat${s.chats === 1 ? "" : "s"}` : null,
        s.agentMemories ? `${s.agentMemories} memory entr${s.agentMemories === 1 ? "y" : "ies"}` : null,
        s.agentTools ? `${s.agentTools} custom tool${s.agentTools === 1 ? "" : "s"}` : null,
      ].filter(Boolean);

      const skippedNote = s.skippedTools > 0 ? ` (${s.skippedTools} tool(s) skipped — name already in use)` : "";
      setResult({
        ok: true,
        message: parts.length
          ? `Imported ${parts.join(", ")}.${skippedNote}`
          : `Nothing new to import.${skippedNote}`,
      });
      onImported?.();
    } catch (err: any) {
      setResult({ ok: false, message: err?.message ?? "Import failed" });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-ink-600 bg-ink-800 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-paper-200 font-medium">Export everything</p>
            <p className="text-xs text-paper-400 mt-0.5 leading-relaxed">
              Downloads a single JSON file: every document with its passages and
              embeddings, every chat with its full history, agent memory, and
              custom tools. Settings are included for reference only — an
              import never overwrites your live configuration.
            </p>
          </div>
          <a
            href="/api/export"
            className="flex items-center gap-1.5 text-xs bg-brass-400 text-ink-950 rounded-lg px-3 py-2 hover:bg-brass-300 transition-colors shrink-0"
          >
            <Download size={13} />
            Export
          </a>
        </div>
      </div>

      <div className="rounded-lg border border-ink-600 bg-ink-800 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-paper-200 font-medium">Import from a file</p>
            <p className="text-xs text-paper-400 mt-0.5 leading-relaxed">
              Adds documents, chats, memory, and tools from a previously-exported
              file as new entries — nothing existing is replaced or removed. Use
              the Danger Zone first if you want a clean slate before importing.
            </p>
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-1.5 text-xs border border-ink-600 rounded-lg px-3 py-2 text-paper-300 hover:border-brass-400/50 disabled:opacity-50 transition-colors shrink-0"
          >
            {importing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            {importing ? "Importing..." : "Choose file"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleFileChosen}
            className="hidden"
          />
        </div>

        {result && (
          <div
            className={`flex items-start gap-2 mt-3 text-xs rounded-md px-3 py-2 ${
              result.ok
                ? "text-teal-400 bg-teal-500/10 border border-teal-500/30"
                : "text-rust-400 bg-rust-500/10 border border-rust-500/30"
            }`}
          >
            {result.ok ? (
              <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
            ) : (
              <XCircle size={13} className="mt-0.5 shrink-0" />
            )}
            <span>{result.message}</span>
          </div>
        )}
      </div>
    </div>
  );
}
