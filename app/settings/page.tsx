"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import type { AppSettings, QueryOptimizationMode, RerankMode } from "@/types";
import { AgentToolsManager } from "@/components/settings/AgentToolsManager";
import { ModelPicker } from "@/components/settings/ModelPicker";
import { cn } from "@/lib/utils";

const QUERY_OPTIONS: { value: QueryOptimizationMode; label: string; description: string }[] = [
  {
    value: "off",
    label: "Off",
    description:
      "Search with your question exactly as typed. Zero processing, fastest, but literal — no rewriting, no resolving \"it\"/\"that\" against earlier messages.",
  },
  {
    value: "local",
    label: "Local (NLP)",
    description:
      "Strips filler words and reduces words to their root form (\"running\" → \"run\", \"reports\" → \"report\") using an offline model. No API call, no cost, a few milliseconds.",
  },
  {
    value: "llm",
    label: "LLM",
    description:
      "Rewrites the question with an OpenRouter call — best at resolving pronouns and context from earlier in the conversation, at the cost of one extra API call per turn.",
  },
];

const RERANK_OPTIONS: { value: RerankMode; label: string; description: string }[] = [
  {
    value: "cohere",
    label: "Cohere",
    description:
      "Neural reranking via Cohere's API for the best precision. Automatically falls back to local BM25 if no key is set or a call fails — never blocks an answer.",
  },
  {
    value: "bm25",
    label: "Local (BM25)",
    description:
      "Classic lexical-overlap ranking (the algorithm behind most search engines), computed locally against the retrieved passages. No API call, instant.",
  },
  {
    value: "off",
    label: "Off",
    description: "Skip reranking entirely and use plain vector-similarity order.",
  },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cohereConfigured, setCohereConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((json) => setSettings(json.limits))
      .catch((err) => setError(err?.message ?? "Failed to load settings"));

    fetch("/api/usage")
      .then((res) => res.json())
      .then((json) => setCohereConfigured(json?.configured?.cohere ?? null))
      .catch(() => {});
  }, []);

  async function update(patch: Partial<AppSettings>) {
    const key = Object.keys(patch)[0];
    setSavingKey(key);
    setSettings((s) => (s ? { ...s, ...patch } : s));
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update setting");
      setSettings(json.limits);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? "Failed to update setting");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <main className="h-full overflow-y-auto bg-ink-900 text-paper-200">
      <div className="max-w-[820px] mx-auto px-6 py-8">
        <h1 className="font-serif italic text-3xl text-paper-100">The Method</h1>
        <p className="text-sm text-paper-400 mt-1 mb-8">
          How each question gets processed before it&apos;s answered — trade API calls
          for retrieval quality wherever you like.
        </p>

        {error && (
          <p className="text-sm text-rust-400 border border-rust-500/30 bg-rust-500/10 rounded-lg px-4 py-3 mb-6">
            {error}
          </p>
        )}

        {!settings ? (
          <p className="text-sm text-paper-400 py-10 text-center">Loading...</p>
        ) : (
          <div className="flex flex-col gap-10">
            <section>
              <h2 className="text-xs text-paper-400 mb-3">Model</h2>
              <p className="text-xs text-paper-400 mb-3 leading-relaxed">
                Used for every OpenRouter call — query rewriting, RAG answers,
                Agent mode, and compaction. The auto-router
                (<span className="font-mono">openrouter/free</span>) picks a
                different free model per request and may not always support
                tool calling; pin a specific model below for reliable Agent
                mode.
              </p>
              <ModelPicker
                value={settings.openrouterModel}
                onSave={(model) => update({ openrouterModel: model })}
              />
            </section>

            <section>
              <h2 className="text-xs text-paper-400 mb-3">Query optimization</h2>
              <p className="text-xs text-paper-400 mb-3 leading-relaxed">
                Runs before retrieval, turning your question into a better search query.
              </p>
              <ModeGroup
                options={QUERY_OPTIONS}
                value={settings.queryOptimization}
                onChange={(value) => update({ queryOptimization: value })}
                saving={savingKey === "queryOptimization"}
              />
            </section>

            <section>
              <h2 className="text-xs text-paper-400 mb-3">Reranking</h2>
              <p className="text-xs text-paper-400 mb-3 leading-relaxed">
                Runs after retrieval, reordering the candidate passages by relevance
                before they're sent to the model.
              </p>
              <ModeGroup
                options={RERANK_OPTIONS}
                value={settings.rerankMethod}
                onChange={(value) => update({ rerankMethod: value })}
                saving={savingKey === "rerankMethod"}
                note={
                  cohereConfigured === false
                    ? 'No COHERE_API_KEY is set — "Cohere" will behave the same as "Local (BM25)" until you add one.'
                    : undefined
                }
              />
            </section>

            <section>
              <h2 className="text-xs text-paper-400 mb-3">Agent mode</h2>
              <p className="text-xs text-paper-400 mb-3 leading-relaxed">
                Switch a chat into Agent mode (top navbar) and the model can call
                tools — possibly several times — before answering. The step
                limit below caps the total number of tool calls in a single
                turn, even if the model requests several at once — each one is
                a real search or API call, not a free action.
              </p>

              <MaxStepsInput value={settings.agentMaxSteps} onSave={(v) => update({ agentMaxSteps: v })} />

              <AgentToolsManager />
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

function MaxStepsInput({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => setDraft(String(value)), [value]);

  function commit() {
    const n = Math.round(Number(draft));
    if (Number.isFinite(n) && n >= 1 && n <= 20 && n !== value) {
      onSave(n);
    } else {
      setDraft(String(value));
    }
  }

  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-ink-600 bg-ink-800 px-4 py-3 mb-4 max-w-xs">
      <span className="text-sm text-paper-300">Max tool-call steps per turn</span>
      <input
        type="number"
        min={1}
        max={20}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            e.currentTarget.blur();
          }
        }}
        className="w-16 bg-ink-700 border border-ink-600 rounded px-2 py-1 text-paper-200 text-right outline-none focus:border-brass-400/60"
      />
    </label>
  );
}

function ModeGroup<T extends string>({
  options,
  value,
  onChange,
  saving,
  note,
}: {
  options: { value: T; label: string; description: string }[];
  value: T;
  onChange: (value: T) => void;
  saving?: boolean;
  note?: string;
}) {
  return (
    <div>
      <div className="flex flex-col gap-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            disabled={saving}
            className={cn(
              "text-left rounded-lg border px-4 py-3 transition-colors disabled:opacity-60",
              value === opt.value
                ? "border-brass-400/60 bg-brass-400/5"
                : "border-ink-600 hover:border-ink-500 bg-ink-800"
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "flex items-center justify-center h-4 w-4 rounded-full border shrink-0",
                  value === opt.value ? "border-brass-400 bg-brass-400" : "border-ink-600"
                )}
              >
                {value === opt.value && <Check size={10} className="text-ink-950" strokeWidth={3} />}
              </span>
              <span className="text-sm text-paper-200 font-medium">{opt.label}</span>
            </div>
            <p className="text-xs text-paper-400 mt-1 ml-6 leading-relaxed">
              {opt.description}
            </p>
          </button>
        ))}
      </div>
      {note && <p className="text-xs text-paper-400 mt-2">{note}</p>}
    </div>
  );
}
