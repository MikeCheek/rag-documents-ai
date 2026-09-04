"use client";

import { useState } from "react";
import { AlertCircle, Pencil, X } from "lucide-react";
import type { AppLimits, ProviderUsage } from "@/types";
import { UsageMeter } from "./UsageMeter";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

function LimitEditor({
  fields,
  onSave,
  onCancel,
}: {
  fields: { key: keyof AppLimits; label: string; value: number }[];
  onSave: (patch: Partial<AppLimits>) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.key, String(f.value)]))
  );
  const [saving, setSaving] = useState(false);

  return (
    <div className="flex flex-col gap-2 border border-ink-600 rounded-md p-3 bg-ink-850">
      {fields.map((f) => (
        <label key={f.key} className="flex items-center justify-between gap-3 text-xs">
          <span className="text-paper-400">{f.label}</span>
          <input
            type="number"
            min={1}
            value={draft[f.key]}
            onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
            className="w-20 bg-ink-700 border border-ink-600 rounded px-2 py-1 text-paper-200 text-right outline-none focus:border-brass-400/60"
          />
        </label>
      ))}
      <div className="flex items-center gap-2 justify-end pt-1">
        <button
          onClick={onCancel}
          className="text-xs text-paper-400 hover:text-paper-200 px-2 py-1"
        >
          Cancel
        </button>
        <button
          onClick={async () => {
            setSaving(true);
            const patch: Partial<AppLimits> = {};
            for (const f of fields) {
              const n = Number(draft[f.key]);
              if (Number.isFinite(n) && n > 0) patch[f.key] = Math.round(n);
            }
            await onSave(patch);
            setSaving(false);
          }}
          disabled={saving}
          className="text-xs bg-brass-400 text-ink-950 rounded px-2.5 py-1 hover:bg-brass-300 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

function CardShell({
  title,
  subtitle,
  editFields,
  onSaveLimits,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  editFields?: { key: keyof AppLimits; label: string; value: number }[];
  onSaveLimits?: (patch: Partial<AppLimits>) => Promise<void>;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="rounded-lg border border-ink-600 bg-ink-800 p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm text-paper-200 font-medium">{title}</p>
          <p className="text-xs text-paper-400 mt-0.5">{subtitle}</p>
        </div>
        {editFields && onSaveLimits && (
          <button
            onClick={() => setEditing((e) => !e)}
            className="text-paper-400 hover:text-brass-300 p-1 shrink-0"
            title="Adjust limits"
          >
            {editing ? <X size={14} /> : <Pencil size={13} />}
          </button>
        )}
      </div>

      {editing && editFields && onSaveLimits ? (
        <LimitEditor
          fields={editFields}
          onSave={async (patch) => {
            await onSaveLimits(patch);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        children
      )}

      {footer}
    </div>
  );
}

export function OpenRouterUsageCard({
  usage,
  configured,
  limits,
  onSaveLimits,
}: {
  usage: ProviderUsage;
  configured: boolean;
  limits: AppLimits;
  onSaveLimits: (patch: Partial<AppLimits>) => Promise<void>;
}) {
  return (
    <CardShell
      title="OpenRouter"
      subtitle="Query rewriting and answers, via openrouter/free"
      editFields={[
        { key: "openrouterPerMinuteCap", label: "Requests / minute", value: limits.openrouterPerMinuteCap },
        { key: "openrouterDailyCap", label: "Requests / day", value: limits.openrouterDailyCap },
      ]}
      onSaveLimits={onSaveLimits}
      footer={
        <p className="text-[11px] text-paper-400 leading-relaxed">
          Free (<span className="font-mono">:free</span>) models are rate-limited rather than
          credit-limited — OpenRouter's own published caps are 20/minute and 50/day (or
          1,000/day once you've bought $10+ in credits). Adjust the numbers above if yours
          differ.
        </p>
      }
    >
      {!configured && (
        <div className="flex items-start gap-2 text-xs text-rust-400 bg-rust-500/10 rounded-md px-3 py-2 mb-1">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>OPENROUTER_API_KEY isn&apos;t set — chat and query rewriting will fail.</span>
        </div>
      )}
      <div className="flex flex-col gap-3">
        <UsageMeter
          label="Calls in the last minute"
          value={usage.callsLastMinute}
          max={limits.openrouterPerMinuteCap}
        />
        <UsageMeter label="Calls today" value={usage.callsToday} max={limits.openrouterDailyCap} />
        <div className="flex items-center justify-between text-xs pt-1 border-t border-ink-600">
          <span className="text-paper-400">Tokens this month</span>
          <span className="font-mono text-paper-300">{formatTokens(usage.tokensMonth)}</span>
        </div>
      </div>
    </CardShell>
  );
}

export function CohereUsageCard({
  usage,
  configured,
  limits,
  onSaveLimits,
}: {
  usage: ProviderUsage;
  configured: boolean;
  limits: AppLimits;
  onSaveLimits: (patch: Partial<AppLimits>) => Promise<void>;
}) {
  return (
    <CardShell
      title="Cohere Rerank"
      subtitle="Trial key"
      editFields={[
        { key: "cohereMonthlyCap", label: "Calls / month", value: limits.cohereMonthlyCap },
        { key: "coherePerMinuteCap", label: "Rerank calls / minute", value: limits.coherePerMinuteCap },
      ]}
      onSaveLimits={onSaveLimits}
      footer={
        <p className="text-[11px] text-paper-400 leading-relaxed">
          Trial keys are capped at 1,000 calls/month and 10 rerank calls/minute by default —
          adjust above if Cohere changes theirs. Every failed or rate-limited call still
          falls back to plain vector similarity automatically.
        </p>
      }
    >
      {!configured && (
        <div className="flex items-start gap-2 text-xs text-paper-400 bg-ink-700 rounded-md px-3 py-2 mb-1">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>No COHERE_API_KEY set — answers use vector similarity ranking only.</span>
        </div>
      )}
      <div className="flex flex-col gap-3">
        <UsageMeter label="Calls this month" value={usage.callsMonth} max={limits.cohereMonthlyCap} />
        <UsageMeter
          label="Calls in the last minute"
          value={usage.callsLastMinute}
          max={limits.coherePerMinuteCap}
        />
      </div>
    </CardShell>
  );
}

export function LocalUsageCard({ usage }: { usage: ProviderUsage }) {
  return (
    <div className="rounded-lg border border-ink-600 bg-ink-800 p-5 flex flex-col gap-4">
      <div>
        <p className="text-sm text-paper-200 font-medium">Local embeddings</p>
        <p className="text-xs text-paper-400 mt-0.5">Xenova / all-MiniLM-L6-v2</p>
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="font-serif text-2xl text-paper-100">{usage.callsToday}</p>
          <p className="text-[11px] text-paper-400 mt-0.5">today</p>
        </div>
        <div>
          <p className="font-serif text-2xl text-paper-100">{usage.callsMonth}</p>
          <p className="text-[11px] text-paper-400 mt-0.5">this month</p>
        </div>
        <div>
          <p className="font-serif text-2xl text-paper-100">{usage.callsAllTime}</p>
          <p className="text-[11px] text-paper-400 mt-0.5">all time</p>
        </div>
      </div>

      <p className="text-[11px] text-paper-400 leading-relaxed pt-1 border-t border-ink-600">
        No API key and no rate limit — this runs inside your own Node process.
      </p>
    </div>
  );
}
