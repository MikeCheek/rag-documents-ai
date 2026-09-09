"use client";

import { useEffect, useState } from "react";
import type { UsageSnapshot } from "@/types";
import { cn } from "@/lib/utils";

type CircleState = {
  color: "teal" | "brass" | "rust" | "dim";
  title: string;
  pct: number;
};

function colorFromPct(pct: number): "teal" | "brass" | "rust" {
  if (pct >= 90) return "rust";
  if (pct >= 65) return "brass";
  return "teal";
}

function computeCircles(snapshot: UsageSnapshot): { label: string; state: CircleState }[] {
  const { usage, limits, configured } = snapshot;

  const openrouterPct = Math.min(
    100,
    Math.max(
      limits.openrouterPerMinuteCap > 0
        ? (usage.openrouter.callsLastMinute / limits.openrouterPerMinuteCap) * 100
        : 0,
      limits.openrouterDailyCap > 0
        ? (usage.openrouter.callsToday / limits.openrouterDailyCap) * 100
        : 0
    )
  );

  const coherePct = Math.min(
    100,
    Math.max(
      limits.cohereMonthlyCap > 0
        ? (usage.cohere.callsMonth / limits.cohereMonthlyCap) * 100
        : 0,
      limits.coherePerMinuteCap > 0
        ? (usage.cohere.callsLastMinute / limits.coherePerMinuteCap) * 100
        : 0
    )
  );

  const cohereDot: CircleState = !configured.cohere
    ? { color: "dim", title: "Cohere: no key set, using vector similarity only", pct: 0 }
    : {
      color: colorFromPct(coherePct),
      title: `Cohere: ${usage.cohere.callsMonth}/${limits.cohereMonthlyCap} this month, ${usage.cohere.callsLastMinute}/${limits.coherePerMinuteCap} in the last minute`,
      pct: Math.round(coherePct),
    };

  return [
    {
      label: "OpenRouter",
      state: !configured.openrouter
        ? { color: "dim", title: "OpenRouter: no key set", pct: 0 }
        : {
          color: colorFromPct(openrouterPct),
          title: `OpenRouter: ${usage.openrouter.callsLastMinute}/${limits.openrouterPerMinuteCap} per minute, ${usage.openrouter.callsToday}/${limits.openrouterDailyCap}+ today`,
          pct: Math.round(openrouterPct),
        },
    },
    { label: "Cohere", state: cohereDot },
    {
      label: "Local embeddings",
      state: { color: "teal", title: `Local embeddings: ${usage.local.callsToday} calls today, no limit`, pct: 100 },
    },
  ];
}

const STROKE_CLASS: Record<CircleState["color"], string> = {
  teal: "text-teal-500",
  brass: "text-brass-400",
  rust: "text-rust-500",
  dim: "text-ink-600",
};

export function UsageCircles() {
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

  const circles = computeCircles(snapshot);
  const RADIUS = 8;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  return (
    <div className="flex items-center gap-3" aria-label="API usage status">
      {circles.map((c) => {
        const strokeDashoffset = CIRCUMFERENCE - (c.state.pct / 100) * CIRCUMFERENCE;

        return (
          <div
            key={c.label}
            title={c.state.title}
            className="flex items-center gap-1.5 cursor-help"
          >
            <div className="relative flex items-center justify-center h-5 w-5">
              <svg className="h-full w-full -rotate-90" viewBox="0 0 20 20">
                {/* Background Ring */}
                <circle
                  cx="10"
                  cy="10"
                  r={RADIUS}
                  className="stroke-current opacity-20 text-ink-600"
                  strokeWidth="2"
                  fill="transparent"
                />
                {/* Progress Ring */}
                <circle
                  cx="10"
                  cy="10"
                  r={RADIUS}
                  className={cn("stroke-current transition-all duration-300", STROKE_CLASS[c.state.color])}
                  strokeWidth="2"
                  strokeDasharray={CIRCUMFERENCE}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                  fill="transparent"
                />
              </svg>
            </div>
            {/* <span className="text-xs text-ink-300 font-medium">{c.label}</span> */}
          </div>
        );
      })}
    </div>
  );
}
