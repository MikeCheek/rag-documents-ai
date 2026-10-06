"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Library } from "lucide-react";
import type { DocumentRecord } from "@/types";
import { cn } from "@/lib/utils";

/**
 * "Search in" control above the chat input: limits the next questions to
 * a subset of documents. An empty selection means every document.
 */
export function DocumentScopePicker({
  documents,
  selected,
  onChange,
}: {
  documents: DocumentRecord[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (documents.length < 2) return null;

  const label =
    selected.length === 0
      ? "All documents"
      : selected.length === 1
        ? documents.find((d) => d.id === selected[0])?.name ?? "1 document"
        : `${selected.length} documents`;

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);

  return (
    <div ref={rootRef} className="relative max-w-[720px] mx-auto mb-2 flex items-center gap-1.5 text-xs text-paper-400">
      <span>Search in</span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 transition-colors max-w-[280px]",
          selected.length
            ? "border-brass-400/60 text-brass-300"
            : "border-ink-600 text-paper-300 hover:text-paper-200"
        )}
      >
        <Library size={12} className="shrink-0" />
        <span className="truncate">{label}</span>
        <ChevronDown size={12} className="shrink-0" />
      </button>
      {selected.length > 0 && (
        <button type="button" onClick={() => onChange([])} className="hover:text-paper-200 transition-colors">
          Clear
        </button>
      )}

      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="absolute bottom-full left-0 mb-2 w-[320px] max-h-72 overflow-y-auto rounded-lg border border-ink-600 bg-ink-850 shadow-xl py-1 z-20"
        >
          <button
            type="button"
            role="option"
            aria-selected={selected.length === 0}
            onClick={() => onChange([])}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-paper-300 hover:bg-ink-700"
          >
            <span className="w-3.5 shrink-0">{selected.length === 0 && <Check size={14} className="text-brass-300" />}</span>
            All documents
          </button>
          <div className="my-1 border-t border-ink-600" />
          {documents.map((d) => (
            <button
              key={d.id}
              type="button"
              role="option"
              aria-selected={selected.includes(d.id)}
              onClick={() => toggle(d.id)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-paper-300 hover:bg-ink-700"
            >
              <span className="w-3.5 shrink-0">
                {selected.includes(d.id) && <Check size={14} className="text-brass-300" />}
              </span>
              <span className="truncate">{d.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
