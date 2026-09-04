"use client";

import { useEffect, useState } from "react";
import type { UsageSnapshot } from "@/types";
import { cn } from "@/lib/utils";

type DotState = { color: "teal" | "brass" | "rust" | "dim"; title: string };

function colorFromPct(pct: number): "teal" | "brass" | "rust" {
  if (pct >= 90) return "rust";
  if (pct >= 65) return "brass";
  return "teal";
}

function computeDots(snapshot: UsageSnapshot): { label: string; state: DotState }[] {
  const { usage, limits, configured } = snapshot;

  const openrouterPct = Math.max(
    limits.openrouterPerMinuteCap > 0
      ? (usage.openrouter.callsLastMinute / limits.openrouterPerMinuteCap) * 100
      : 0,
    limits.openrouterDailyCap > 0
      ? (usage.openrouter.callsToday / limits.openrouterDailyCap) * 100
      : 0
  );

  const cohereDot: DotState = !configured.cohere
    ? { color: "dim", title: "Cohere: no key set, using vector similarity only" }
    : {
        color: colorFromPct(
          Math.max(
            limits.cohereMonthlyCap > 0
              ? (usage.cohere.callsMonth / limits.cohereMonthlyCap) * 100
              : 0,
            limits.coherePerMinuteCap > 0
              ? (usage.cohere.callsLastMinute / limits.coherePerMinuteCap) * 100
              : 0
          )
        ),
        title: `Cohere: ${usage.cohere.callsMonth}/${limits.cohereMonthlyCap} this month, ${usage.cohere.callsLastMinute}/${limits.coherePerMinuteCap} in the last minute`,
      };

  return [
    {
      label: "OpenRouter",
      state: !configured.openrouter
        ? { color: "dim", title: "OpenRouter: no key set" }
        : {
            color: colorFromPct(openrouterPct),
            title: `OpenRouter: ${usage.openrouter.callsLastMinute}/${limits.openrouterPerMinuteCap} per minute, ${usage.openrouter.callsToday}/${limits.openrouterDailyCap}+ today`,
          },
    },
    { label: "Cohere", state: cohereDot },
    {
      label: "Local embeddings",
      state: { color: "teal", title: `Local embeddings: ${usage.local.callsToday} calls today, no limit` },
    },
  ];
}

const DOT_CLASS: Record<DotState["color"], string> = {
  teal: "bg-teal-500",
  brass: "bg-brass-400",
  rust: "bg-rust-500",
  dim: "bg-ink-600",
};

export function UsageDots() {
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/usage");
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setSnapshot(json);
      } catch {
        // best-effort UI indicator; a failed poll just leaves the last state
      }
    }

    load();
    const interval = setInterval(load, 20_000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  if (!snapshot) return null;

  const dots = computeDots(snapshot);

  return (
    <div className="flex items-center gap-1.5" aria-label="API usage status">
      {dots.map((d) => (
        <span
          key={d.label}
          title={d.state.title}
          className={cn("h-2 w-2 rounded-full shrink-0", DOT_CLASS[d.state.color])}
        />
      ))}
    </div>
  );
}
