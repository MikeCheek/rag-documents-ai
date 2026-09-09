"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

type DangerAction = {
  action: string;
  title: string;
  description: string;
  confirmWord: string; // what the user must type to enable the final button
};

const ACTIONS: DangerAction[] = [
  {
    action: "clear_chats",
    title: "Delete all chats",
    description:
      "Permanently deletes every conversation and every message in it, including saved sources, agent steps, and timing history. Documents are not affected.",
    confirmWord: "delete chats",
  },
  {
    action: "clear_documents",
    title: "Delete all documents",
    description:
      "Permanently deletes every uploaded document and all of its passages/embeddings. Chats that cited them keep their saved text, but the citations will no longer open a live source.",
    confirmWord: "delete documents",
  },
  {
    action: "clear_usage_history",
    title: "Clear API usage history",
    description:
      "Resets the Ledger's call counters (today / this month / all-time) to zero. Use this after rotating to a fresh API key, so tracked usage matches what that key has actually made.",
    confirmWord: "clear usage",
  },
  {
    action: "reset_limits",
    title: "Reset usage limits to defaults",
    description:
      "Reverts the OpenRouter/Cohere rate and quota limits shown on the Ledger, and the max tool-call steps per turn, back to their original defaults — in case you've customized them and want a clean slate.",
    confirmWord: "reset limits",
  },
  {
    action: "clear_memory",
    title: "Clear all agent memory",
    description:
      "Permanently deletes everything Agent mode has remembered across every chat. It won't recall any of it again unless you or the agent save it fresh.",
    confirmWord: "clear memory",
  },
];

function DangerActionRow({ item, onDone }: { item: DangerAction; onDone: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const canConfirm = typed.trim().toLowerCase() === item.confirmWord;

  async function confirm() {
    if (!canConfirm) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/danger-zone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: item.action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      setResult({ ok: true, message: json.message ?? "Done." });
      setExpanded(false);
      setTyped("");
      onDone();
    } catch (err: any) {
      setResult({ ok: false, message: err?.message ?? "Failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-rust-500/30 bg-rust-500/5 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-paper-200 font-medium">{item.title}</p>
          {!expanded && (
            <p className="text-xs text-paper-400 mt-0.5 leading-relaxed">{item.description}</p>
          )}
        </div>
        {!expanded && (
          <button
            onClick={() => {
              setExpanded(true);
              setResult(null);
            }}
            className="text-xs border border-rust-500/50 text-rust-400 rounded-lg px-3 py-1.5 hover:bg-rust-500/10 transition-colors shrink-0"
          >
            Start
          </button>
        )}
      </div>

      {expanded && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-xs text-paper-400 leading-relaxed">{item.description}</p>
          <p className="text-xs text-paper-300">
            This can't be undone. Type{" "}
            <span className="font-mono text-rust-400">{item.confirmWord}</span> to confirm.
          </p>
          <div className="flex items-center gap-2">
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={item.confirmWord}
              autoFocus
              className="flex-1 bg-ink-800 border border-rust-500/40 rounded-lg px-3 py-1.5 text-sm text-paper-200 font-mono outline-none focus:border-rust-400"
            />
            <button
              onClick={confirm}
              disabled={!canConfirm || busy}
              className="flex items-center gap-1.5 text-xs bg-rust-500 text-ink-950 rounded-lg px-3 py-1.5 hover:bg-rust-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
            >
              {busy && <Loader2 size={12} className="animate-spin" />}
              Confirm delete
            </button>
            <button
              onClick={() => {
                setExpanded(false);
                setTyped("");
              }}
              className="text-xs text-paper-400 hover:text-paper-200 px-2 py-1.5 shrink-0"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {result && (
        <div
          className={cn(
            "flex items-center gap-1.5 mt-2 text-xs",
            result.ok ? "text-teal-400" : "text-rust-400"
          )}
        >
          {result.ok && <CheckCircle2 size={12} />}
          {result.message}
        </div>
      )}
    </div>
  );
}

export function DangerZone({ onDone }: { onDone: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2 text-xs text-rust-400/90 mb-1">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <p>
          Every action below is permanent and cannot be undone. Each one requires
          clicking "Start" and then typing an exact confirmation phrase — there's
          no accidental single click that deletes anything.
        </p>
      </div>
      {ACTIONS.map((item) => (
        <DangerActionRow key={item.action} item={item} onDone={onDone} />
      ))}
    </div>
  );
}
