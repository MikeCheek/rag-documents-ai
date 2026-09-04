import { cn } from "@/lib/utils";

export function UsageMeter({
  label,
  value,
  max,
  formattedValue,
}: {
  label: string;
  value: number;
  max: number;
  formattedValue?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const isHot = pct >= 90;
  const isWarm = pct >= 70;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-xs text-paper-400">{label}</span>
        <span className="text-xs font-mono text-paper-300">
          {formattedValue ?? `${value} / ${max}`}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-ink-600 overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            isHot ? "bg-rust-500" : isWarm ? "bg-brass-400" : "bg-teal-500"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
