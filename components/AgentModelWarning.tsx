"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, X } from "lucide-react";
import type { ModelToolCheck } from "@/types";

const DISMISS_KEY_PREFIX = "reading-room:model-warning-dismissed:";

export function AgentModelWarning() {
  const [check, setCheck] = useState<ModelToolCheck | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    fetch("/api/agent-model-check")
      .then((res) => res.json())
      .then((json: ModelToolCheck) => {
        if (!json?.modelId) return;
        setCheck(json);
        setDismissed(
          window.localStorage.getItem(DISMISS_KEY_PREFIX + json.modelId) === "1"
        );
      })
      .catch(() => {});
  }, []);

  if (!check || dismissed) return null;

  // A concrete model that does support tools needs no warning.
  if (check.supportsTools === true) return null;

  const suggestionText =
    check.suggestions.length > 0
      ? `Free tool-capable models currently available: ${check.suggestions.join(", ")}.`
      : "Couldn't find a confirmed free tool-capable model right now — check the list in Settings, or openrouter.ai/models filtered by \"Tools\" support.";

  const headline = check.isAutoRouter
    ? `Model is set to the auto-router (${check.modelId}), which picks a different underlying model per request and may not always support tool calling.`
    : check.supportsTools === false
    ? `The configured model (${check.modelId}) doesn't appear to support tool calling.`
    : `Couldn't verify whether the configured model (${check.modelId}) supports tool calling.`;

  function dismiss() {
    if (check) window.localStorage.setItem(DISMISS_KEY_PREFIX + check.modelId, "1");
    setDismissed(true);
  }

  return (
    <div className="max-w-[720px] mx-auto mt-4 flex items-start gap-2.5 rounded-lg border border-brass-400/40 bg-brass-400/5 px-4 py-3">
      <AlertTriangle size={15} className="text-brass-300 mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-paper-200 leading-relaxed">{headline}</p>
        <p className="text-xs text-paper-400 leading-relaxed mt-1">
          {suggestionText}{" "}
          <Link href="/settings" className="text-brass-300 hover:text-brass-200 transition-colors">
            Pick a tool-capable model in Settings
          </Link>{" "}
          for reliable Agent mode.
        </p>
      </div>
      <button
        onClick={dismiss}
        className="text-paper-400 hover:text-paper-200 p-1 -mt-1 -mr-1 shrink-0"
        aria-label="Dismiss"
      >
        <X size={13} />
      </button>
    </div>
  );
}
