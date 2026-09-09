import { Wrench } from "lucide-react";
import type { ToolUsageRow } from "@/types";
import { relativeTime, cn } from "@/lib/utils";

export function ToolUsageGrid({ rows }: { rows: ToolUsageRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-paper-400 py-6 text-center">
        No tool calls yet — switch to Agent mode and ask something that needs a tool.
      </p>
    );
  }

  const maxCalls = Math.max(...rows.map((r) => r.calls), 1);

  return (
    <div className="rounded-lg border border-ink-600 overflow-hidden">
      <div className="grid grid-cols-[1fr,90px,90px,110px] bg-ink-850 px-4 py-2 text-xs text-paper-400 border-b border-ink-600">
        <span>Tool</span>
        <span className="text-right">Calls</span>
        <span className="text-right">Success</span>
        <span className="text-right">Last used</span>
      </div>
      <div className="divide-y divide-ink-600">
        {rows.map((r) => (
          <div
            key={r.toolName}
            className="grid grid-cols-[1fr,90px,90px,110px] px-4 py-2.5 items-center hover:bg-ink-800/60 transition-colors"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Wrench size={12} className="text-paper-400 shrink-0" />
              <span className="text-sm font-mono text-paper-200 truncate">{r.toolName}</span>
            </div>
            <div className="flex items-center justify-end gap-2">
              <div className="h-1.5 w-10 rounded-full bg-ink-600 overflow-hidden">
                <div
                  className="h-full rounded-full bg-brass-400"
                  style={{ width: `${(r.calls / maxCalls) * 100}%` }}
                />
              </div>
              <span className="text-sm font-mono text-paper-200 w-6 text-right">{r.calls}</span>
            </div>
            <span
              className={cn(
                "text-sm font-mono text-right",
                r.successRate >= 0.9
                  ? "text-teal-400"
                  : r.successRate >= 0.5
                  ? "text-brass-300"
                  : "text-rust-400"
              )}
            >
              {Math.round(r.successRate * 100)}%
            </span>
            <span className="text-xs text-paper-400 text-right">
              {r.lastUsed ? relativeTime(r.lastUsed) : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
