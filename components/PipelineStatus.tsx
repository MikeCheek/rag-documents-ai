"use client";

import { cn } from "@/lib/utils";

const CHAT_STAGES = [
  { key: "optimizing", label: "Reading question" },
  { key: "retrieving", label: "Searching the shelf" },
  { key: "reranking", label: "Ranking passages" },
  { key: "generating", label: "Writing answer" },
];

const UPLOAD_STAGES = [
  { key: "reading", label: "Reading file" },
  { key: "chunking", label: "Splitting into passages" },
  { key: "embedding", label: "Embedding" },
  { key: "storing", label: "Saving to the shelf" },
];

export function PipelineStatus({
  stage,
  detail,
  kind = "chat",
}: {
  stage: string;
  detail?: string;
  kind?: "chat" | "upload";
}) {
  const stages = kind === "chat" ? CHAT_STAGES : UPLOAD_STAGES;
  const activeIndex = stages.findIndex((s) => s.key === stage);

  return (
    <div className="flex flex-col gap-2 animate-rise">
      <div className="flex items-center gap-1.5">
        {stages.map((s, i) => {
          const isDone = activeIndex > i;
          const isActive = activeIndex === i;
          return (
            <div key={s.key} className="flex items-center gap-1.5">
              <div
                className={cn(
                  "h-1.5 w-1.5 rounded-full transition-colors",
                  isDone && "bg-teal-500",
                  isActive && "bg-brass-400 animate-blink",
                  !isDone && !isActive && "bg-ink-600"
                )}
              />
              {i < stages.length - 1 && (
                <div
                  className={cn(
                    "h-px w-4",
                    isDone ? "bg-teal-500/60" : "bg-ink-600"
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
      <p className="text-sm text-paper-400 font-mono">
        {stages[activeIndex]?.label ?? "Working"}
        {detail ? <span className="text-paper-400/70"> ({detail})</span> : null}
      </p>
    </div>
  );
}
