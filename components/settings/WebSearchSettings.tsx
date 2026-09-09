"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function WebSearchSettings({
  value,
  onSave,
}: {
  value: string | null;
  onSave: (url: string) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => setDraft(value ?? ""), [value]);

  function commit() {
    const trimmed = draft.trim();
    if (trimmed !== (value ?? "")) onSave(trimmed);
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/web-search-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: draft.trim() }),
      });
      const json = await res.json();
      setTestResult(json);
    } catch (err: any) {
      setTestResult({ ok: false, message: err?.message ?? "Request failed." });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
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
          placeholder="http://localhost:8080 (your SearXNG instance)"
          className="flex-1 bg-ink-800 border border-ink-600 rounded-lg px-3 py-2 text-sm text-paper-200 font-mono outline-none focus:border-brass-400/60"
        />
        <button
          onClick={test}
          disabled={testing || !draft.trim()}
          className="flex items-center gap-1.5 text-xs border border-ink-600 rounded-lg px-3 py-2 text-paper-300 hover:border-brass-400/50 disabled:opacity-40 transition-colors shrink-0"
        >
          {testing ? <Loader2 size={13} className="animate-spin" /> : null}
          Test
        </button>
      </div>

      {testResult && (
        <div
          className={cn(
            "flex items-start gap-2 text-xs rounded-md px-3 py-2",
            testResult.ok
              ? "text-teal-400 bg-teal-500/10 border border-teal-500/30"
              : "text-rust-400 bg-rust-500/10 border border-rust-500/30"
          )}
        >
          {testResult.ok ? (
            <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
          ) : (
            <XCircle size={13} className="mt-0.5 shrink-0" />
          )}
          <span>{testResult.message}</span>
        </div>
      )}

      <p className="text-[11px] text-paper-400 leading-relaxed">
        SearXNG is free and open source, but its JSON API is <strong className="text-paper-300">off by default</strong> even
        on public instances (most operators leave it off deliberately). The
        reliable option is self-hosting: <span className="font-mono">docker run -p 8080:8080 searxng/searxng</span>,
        then add <span className="font-mono">json</span> to <span className="font-mono">search.formats</span> in
        its <span className="font-mono">settings.yml</span> (and usually <span className="font-mono">server.limiter: false</span> for
        a simple single-user setup). Leave this blank to not offer web search at all.
      </p>
    </div>
  );
}
