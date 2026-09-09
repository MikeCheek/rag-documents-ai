"use client";

import { Clock } from "lucide-react";
import type { StageTimingRow, TimingDailyPoint } from "@/types";
import { formatDuration } from "@/lib/utils";

const STAGE_LABELS: Record<string, string> = {
  optimize_query: "Query optimization (LLM)",
  optimize_query_local: "Query optimization (local)",
  retrieve: "Retrieval (vector search)",
  rerank: "Reranking",
  generate: "Answer generation",
  llm_call: "Agent LLM round-trip",
  total: "Total turn",
};

function stageLabel(stage: string): string {
  if (STAGE_LABELS[stage]) return STAGE_LABELS[stage];
  if (stage.startsWith("tool:")) return `Tool: ${stage.slice(5)}`;
  return stage;
}

function StageBar({ row, maxAvg }: { row: StageTimingRow; maxAvg: number }) {
  return (
    <div className="grid grid-cols-[1fr,110px] items-center gap-3 py-2">
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-sm text-paper-200 truncate">{stageLabel(row.stage)}</span>
          <span className="text-xs font-mono text-paper-400 shrink-0">
            {formatDuration(row.avgDurationMs)} avg
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-ink-600 overflow-hidden">
          <div
            className="h-full rounded-full bg-brass-400"
            style={{ width: `${Math.max(2, (row.avgDurationMs / maxAvg) * 100)}%` }}
          />
        </div>
      </div>
      <div className="text-right text-xs text-paper-400">
        <div>{row.count} call{row.count === 1 ? "" : "s"}</div>
        <div className="font-mono">
          {formatDuration(row.minDurationMs)}–{formatDuration(row.maxDurationMs)}
        </div>
      </div>
    </div>
  );
}

function DailyTrendChart({ points }: { points: TimingDailyPoint[] }) {
  if (points.length < 2) {
    return (
      <p className="text-xs text-paper-400 py-4 text-center">
        Not enough days of data yet for a trend line.
      </p>
    );
  }

  const width = 600;
  const height = 120;
  const padding = 8;
  const maxVal = Math.max(...points.map((p) => p.avgDurationMs), 1);

  const coords = points.map((p, i) => {
    const x = padding + (i / (points.length - 1)) * (width - padding * 2);
    const y = height - padding - (p.avgDurationMs / maxVal) * (height - padding * 2);
    return { x, y, point: p };
  });

  const linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`).join(" ");
  const areaPath = `${linePath} L ${coords[coords.length - 1].x} ${height - padding} L ${coords[0].x} ${height - padding} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-28" preserveAspectRatio="none">
      <path d={areaPath} fill="#E0BD7C" fillOpacity={0.08} />
      <path d={linePath} fill="none" stroke="#E0BD7C" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      {coords.map((c, i) => (
        <circle key={i} cx={c.x} cy={c.y} r={2} fill="#E0BD7C">
          <title>
            {c.point.date}: {formatDuration(c.point.avgDurationMs)} avg
          </title>
        </circle>
      ))}
    </svg>
  );
}

export function TimingCharts({
  byStage,
  dailyTrend,
}: {
  byStage: StageTimingRow[];
  dailyTrend: TimingDailyPoint[];
}) {
  if (byStage.length === 0) {
    return (
      <p className="text-sm text-paper-400 py-6 text-center">
        No timing data yet — ask a question in either mode to start recording it.
      </p>
    );
  }

  const maxAvg = Math.max(...byStage.map((r) => r.avgDurationMs), 1);
  const totalRow = byStage.find((r) => r.stage === "total");
  const stageRows = byStage.filter((r) => r.stage !== "total");

  return (
    <div className="flex flex-col gap-5">
      {totalRow && (
        <div className="flex items-center gap-3 rounded-lg border border-ink-600 bg-ink-800 px-4 py-3">
          <Clock size={16} className="text-brass-300 shrink-0" />
          <div>
            <p className="text-xs text-paper-400">Average total turn time</p>
            <p className="text-lg font-mono text-paper-100">
              {formatDuration(totalRow.avgDurationMs)}
            </p>
          </div>
          <div className="ml-auto text-right text-xs text-paper-400">
            <div>{totalRow.count} turn{totalRow.count === 1 ? "" : "s"} measured</div>
            <div className="font-mono">
              {formatDuration(totalRow.minDurationMs)}–{formatDuration(totalRow.maxDurationMs)}
            </div>
          </div>
        </div>
      )}

      <div>
        <p className="text-xs text-paper-400 mb-1">Daily average (last 14 days with data)</p>
        <DailyTrendChart points={dailyTrend} />
      </div>

      <div className="rounded-lg border border-ink-600 px-4 divide-y divide-ink-600">
        {stageRows.map((row) => (
          <StageBar key={row.stage} row={row} maxAvg={maxAvg} />
        ))}
      </div>
    </div>
  );
}
