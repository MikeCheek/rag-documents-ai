"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Shrink } from "lucide-react";
import type { ContextUsage } from "@/types";
import { cn } from "@/lib/utils";

// The ring under the prompt bar: how much of the model's context budget
// the chat's conversation uses. Click for the numbers and "Compact now".

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const RADIUS = 6;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ContextGauge({
  context,
  busy,
  onCompact,
}: {
  /** null for a new chat, before its first message. */
  context: ContextUsage | null;
  /** A turn is running: compacting now would race it. */
  busy: boolean;
  onCompact: () => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const ratio = context ? Math.min(context.usedTokens / context.budgetTokens, 1) : 0;
  const percent = Math.round(ratio * 100);
  const tone = ratio >= 0.85 ? "text-rust-400" : ratio >= 0.6 ? "text-brass-300" : "text-teal-400";
  const canCompact = !!context && context.messageCount > 2 && !busy && !compacting;

  async function compact() {
    setCompacting(true);
    setError(null);
    setError(await onCompact());
    setCompacting(false);
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] text-paper-400 hover:text-paper-200 hover:bg-ink-800 transition-colors"
        aria-label={`Context ${percent}% full`}
        aria-expanded={open}
        title="Context used by this conversation"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" className={cn("-rotate-90", tone)} aria-hidden>
          <circle cx="8" cy="8" r={RADIUS} fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth="2.5" />
          <circle
            cx="8"
            cy="8"
            r={RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - ratio)}
            className="transition-[stroke-dashoffset] duration-500"
          />
        </svg>
        <span className="tabular-nums">{percent}%</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Context"
          className="absolute bottom-full left-0 mb-2 w-72 rounded-lg border border-ink-600 bg-ink-800 p-3.5 text-left shadow-xl z-20"
        >
          <p className="text-sm text-paper-100 font-medium">Context</p>
          {context ? (
            <>
              <p className="mt-1.5 text-xs text-paper-300 leading-relaxed">
                <span className={cn("font-medium tabular-nums", tone)}>
                  {formatTokens(context.usedTokens)} of {formatTokens(context.budgetTokens)} tokens
                </span>{" "}
                used by this conversation ({percent}%).
              </p>
              <div className="mt-2 h-1.5 rounded-full bg-ink-600 overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-500",
                    ratio >= 0.85 ? "bg-rust-500" : ratio >= 0.6 ? "bg-brass-400" : "bg-teal-500"
                  )}
                  style={{ width: `${percent}%` }}
                />
              </div>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                <dt className="text-paper-400">Model window</dt>
                <dd className="text-paper-200 tabular-nums">
                  {formatTokens(context.windowTokens)}
                  {!context.windowKnown && <span className="text-paper-400"> (assumed)</span>}
                </dd>
                <dt className="text-paper-400">Last request</dt>
                <dd className="text-paper-200 tabular-nums">
                  {context.lastPromptTokens !== null ? `${formatTokens(context.lastPromptTokens)} tokens sent` : "—"}
                </dd>
                <dt className="text-paper-400">Messages</dt>
                <dd className="text-paper-200">
                  {context.messageCount} in full{context.summarized ? ", older ones summarized" : ""}
                </dd>
              </dl>
              <p className="mt-3 text-[11px] text-paper-400 leading-relaxed">
                {context.windowKnown
                  ? "The rest of the window is kept for sources and the answer."
                  : "The auto-router picks a model per request, so its window is assumed. The rest is kept for sources and the answer."}{" "}
                When it&apos;s full, older messages are summarized automatically so the chat can continue.
              </p>
              <button
                type="button"
                onClick={compact}
                disabled={!canCompact}
                className="mt-3 flex items-center gap-1.5 text-xs text-brass-300 hover:text-paper-100 disabled:text-paper-400/50 disabled:cursor-not-allowed"
                title={context.messageCount <= 2 ? "Nothing to compact yet" : busy ? "Wait for the answer to finish" : undefined}
              >
                {compacting ? <Loader2 size={12} className="animate-spin" /> : <Shrink size={12} />}
                {compacting ? "Compacting…" : "Compact now"}
              </button>
              {error && <p className="mt-1.5 text-[11px] text-rust-400">{error}</p>}
            </>
          ) : (
            <p className="mt-1.5 text-xs text-paper-400 leading-relaxed">
              Nothing in context yet. As the conversation grows, this fills up; when it&apos;s full, older
              messages are summarized automatically so the chat can continue.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
