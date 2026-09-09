"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Brain } from "lucide-react";
import type { AgentMemory } from "@/types";
import { relativeTime } from "@/lib/utils";

export function MemoryManager() {
  const [memories, setMemories] = useState<AgentMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/agent-memory");
      const json = await res.json();
      setMemories(json.memories ?? []);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load memory");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function add() {
    const content = draft.trim();
    if (!content) return;
    setSaving(true);
    try {
      const res = await fetch("/api/agent-memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to save memory");
      setMemories((prev) => [json.memory, ...prev]);
      setDraft("");
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? "Failed to save memory");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setMemories((prev) => prev.filter((m) => m.id !== id));
    await fetch(`/api/agent-memory/${id}`, { method: "DELETE" }).catch(() => {});
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-xs text-rust-400">{error}</p>}

      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Add something to remember manually..."
          className="flex-1 bg-ink-800 border border-ink-600 rounded-lg px-3 py-2 text-sm text-paper-200 outline-none focus:border-brass-400/60"
        />
        <button
          onClick={add}
          disabled={saving || !draft.trim()}
          className="flex items-center gap-1 text-xs bg-brass-400 text-ink-950 rounded-lg px-3 py-2 hover:bg-brass-300 disabled:opacity-40 transition-colors shrink-0"
        >
          <Plus size={13} />
          Add
        </button>
      </div>

      {!loading && memories.length === 0 && (
        <p className="text-xs text-paper-400">
          Nothing remembered yet — Agent mode saves things here when you ask it
          to remember something, or add one manually above.
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        {memories.map((m) => (
          <div
            key={m.id}
            className="flex items-start gap-2.5 rounded-lg border border-ink-600 bg-ink-800 px-3 py-2.5"
          >
            <Brain size={13} className="text-brass-300 mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-paper-200 leading-relaxed">{m.content}</p>
              <p className="text-[11px] text-paper-400 mt-0.5">{relativeTime(m.createdAt)}</p>
            </div>
            <button
              onClick={() => remove(m.id)}
              className="text-paper-400 hover:text-rust-400 p-1 shrink-0"
              aria-label="Forget"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
