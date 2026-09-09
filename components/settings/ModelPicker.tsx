"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Search, Wrench } from "lucide-react";
import type { FreeModelInfo } from "@/types";
import { cn } from "@/lib/utils";

export function ModelPicker({
  value,
  onSave,
}: {
  value: string;
  onSave: (model: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [models, setModels] = useState<FreeModelInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => setDraft(value), [value]);

  useEffect(() => {
    fetch("/api/openrouter-models")
      .then((res) => res.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        setModels(json.models ?? []);
      })
      .catch((err) => setLoadError(err?.message ?? "Failed to load models"));
  }, []);

  function commit(model: string) {
    const trimmed = model.trim();
    if (trimmed && trimmed !== value) onSave(trimmed);
    else setDraft(value);
  }

  const filtered = useMemo(() => {
    if (!models) return [];
    const q = search.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
    );
  }, [models, search]);

  const toolCount = models?.filter((m) => m.supportsTools).length ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-paper-400">Model id</span>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(draft);
              e.currentTarget.blur();
            }
          }}
          className="bg-ink-800 border border-ink-600 rounded-lg px-3 py-2 text-sm text-paper-200 font-mono outline-none focus:border-brass-400/60"
        />
      </label>

      {loadError && <p className="text-xs text-rust-400">{loadError}</p>}

      {models && (
        <div className="rounded-lg border border-ink-600 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-ink-600 bg-ink-850">
            <Search size={12} className="text-paper-400 shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Filter ${models.length} free models (${toolCount} support tools)...`}
              className="bg-transparent text-xs text-paper-200 placeholder:text-paper-400 outline-none flex-1"
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {filtered.map((m) => {
              const active = m.id === value;
              return (
                <button
                  key={m.id}
                  onClick={() => commit(m.id)}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 text-left border-b border-ink-700/60 last:border-0 transition-colors",
                    active ? "bg-brass-400/10" : "hover:bg-ink-800"
                  )}
                >
                  <span
                    className={cn(
                      "flex items-center justify-center h-4 w-4 rounded-full border shrink-0",
                      active ? "border-brass-400 bg-brass-400" : "border-ink-600"
                    )}
                  >
                    {active && <Check size={10} className="text-ink-950" strokeWidth={3} />}
                  </span>
                  <span className="text-xs font-mono text-paper-200 truncate flex-1">{m.id}</span>
                  {m.supportsTools ? (
                    <span className="flex items-center gap-1 text-[10px] text-teal-400 border border-teal-500/40 bg-teal-500/10 rounded-full px-1.5 py-0.5 shrink-0">
                      <Wrench size={9} />
                      Tools
                    </span>
                  ) : (
                    <span className="text-[10px] text-paper-400 shrink-0">no tools</span>
                  )}
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p className="text-xs text-paper-400 px-3 py-4 text-center">No models match.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
