"use client";

import { useMemo, useRef, useState } from "react";
import { Table2 } from "lucide-react";
import {
  formatNumber,
  niceTicks,
  parseChartSpec,
  type StatsSpec,
  type XYChartSpec,
} from "@/lib/rich/chart-spec";
import { cn } from "@/lib/utils";

// Renders a ```chart block from an answer (spec: lib/rich/chart-spec.ts).
// Colors are the validated categorical slots (--series-1..8 in
// globals.css), assigned to series in fixed order; text always uses the
// text tokens, never a series color.

const WIDTH = 640;
const HEIGHT = 240;
const M = { top: 12, right: 12, bottom: 28, left: 48 };

const seriesColor = (i: number) => `var(--series-${(i % 8) + 1})`;

/** Path for a bar whose data end (away from the baseline) has 4px rounded corners. */
function barPath(x: number, y: number, w: number, h: number, horizontal: boolean, positive: boolean): string {
  const r = Math.min(4, (horizontal ? h : w) / 2, Math.abs(horizontal ? w : h));
  if (r <= 0 || w <= 0 || h <= 0) return `M${x},${y}h${w}v${h}h${-w}Z`;
  if (!horizontal && positive) {
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }
  if (!horizontal) {
    return `M${x},${y}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w - r}Q${x + w},${y + h} ${x + w},${y + h - r}V${y}Z`;
  }
  if (positive) {
    return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
  }
  return `M${x + w},${y}H${x + r}Q${x},${y} ${x},${y + r}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w}Z`;
}

function Legend({ spec }: { spec: XYChartSpec }) {
  if (spec.series.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2">
      {spec.series.map((s, i) => (
        <span key={i} className="flex items-center gap-1.5 text-[11px] text-paper-300">
          <span className="h-2 w-2 rounded-sm shrink-0" style={{ background: seriesColor(i) }} />
          {s.name}
        </span>
      ))}
    </div>
  );
}

function DataTable({ spec }: { spec: XYChartSpec }) {
  return (
    <div className="overflow-x-auto mt-2">
      <table className="text-[11px]">
        <thead>
          <tr>
            <th className="text-left"></th>
            {spec.series.map((s, i) => (
              <th key={i} className="text-right">
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spec.x.map((label, row) => (
            <tr key={row}>
              <td>{label}</td>
              {spec.series.map((s, i) => (
                <td key={i} className="text-right font-mono">
                  {s.values[row] === null ? "–" : formatNumber(s.values[row] as number, spec.unit)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function XYChart({ spec }: { spec: XYChartSpec }) {
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const horizontal = spec.type === "hbar";

  const geo = useMemo(() => {
    const all = spec.series.flatMap((s) => s.values.filter((v): v is number => v !== null));
    const ticks = niceTicks(Math.min(...all, 0), Math.max(...all, 0));
    const lo = ticks[0];
    const hi = ticks[ticks.length - 1];
    // hbar: category labels need room on the left.
    const left = horizontal ? Math.min(160, 12 + Math.max(...spec.x.map((l) => l.length)) * 6.2) : M.left;
    const height = horizontal ? Math.max(HEIGHT, spec.x.length * (14 * spec.series.length + 10) + M.top + M.bottom) : HEIGHT;
    const plotW = WIDTH - left - M.right;
    const plotH = height - M.top - M.bottom;
    const valueToPx = (v: number) =>
      horizontal ? left + ((v - lo) / (hi - lo)) * plotW : M.top + plotH - ((v - lo) / (hi - lo)) * plotH;
    const bands = spec.x.length;
    const bandSize = (horizontal ? plotH : plotW) / bands;
    const bandStart = (i: number) => (horizontal ? M.top : left) + i * bandSize;
    return { ticks, left, height, plotW, plotH, valueToPx, bandSize, bandStart };
  }, [spec, horizontal]);

  const { ticks, left, height, plotW, plotH, valueToPx, bandSize, bandStart } = geo;
  const zero = valueToPx(0);
  const n = spec.series.length;
  // Bars fill ~70% of a band; 2px gap between bars in a group.
  const groupSize = bandSize * 0.7;
  const barSize = Math.max(2, (groupSize - (n - 1) * 2) / n);
  const showDots = spec.x.length <= 24;
  const labelEvery = Math.ceil(spec.x.length / (horizontal ? 40 : 10));

  const tooltipPos = (() => {
    if (hover === null) return null;
    const center = bandStart(hover) + bandSize / 2;
    return horizontal ? { left: left + 8, top: center } : { left: center, top: M.top };
  })();

  return (
    <div ref={wrapRef} className="relative">
      <Legend spec={spec} />
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="w-full h-auto"
        role="img"
        aria-label={`${spec.title ?? "Chart"}: ${spec.type === "line" ? "line" : "bar"} chart of ${spec.series.map((s) => s.name).join(", ")}`}
        onMouseLeave={() => setHover(null)}
      >
        {/* Gridlines and value axis: recessive. */}
        {ticks.map((t) => {
          const p = valueToPx(t);
          return horizontal ? (
            <g key={t}>
              <line x1={p} x2={p} y1={M.top} y2={M.top + plotH} className="stroke-ink-600" strokeWidth={t === 0 ? 1 : 0.5} />
              <text x={p} y={height - 8} textAnchor="middle" className="fill-paper-400 text-[10px]">
                {formatNumber(t)}
              </text>
            </g>
          ) : (
            <g key={t}>
              <line x1={left} x2={left + plotW} y1={p} y2={p} className="stroke-ink-600" strokeWidth={t === 0 ? 1 : 0.5} />
              <text x={left - 6} y={p + 3} textAnchor="end" className="fill-paper-400 text-[10px]">
                {formatNumber(t)}
              </text>
            </g>
          );
        })}

        {/* Category labels. */}
        {spec.x.map((label, i) =>
          i % labelEvery !== 0 ? null : horizontal ? (
            <text key={i} x={left - 6} y={bandStart(i) + bandSize / 2 + 3} textAnchor="end" className="fill-paper-300 text-[10px]">
              {label.length > 26 ? label.slice(0, 25) + "…" : label}
            </text>
          ) : (
            <text key={i} x={bandStart(i) + bandSize / 2} y={height - 10} textAnchor="middle" className="fill-paper-300 text-[10px]">
              {label.length > 14 ? label.slice(0, 13) + "…" : label}
            </text>
          )
        )}

        {/* Hover highlight band. */}
        {hover !== null &&
          (horizontal ? (
            <rect x={left} y={bandStart(hover)} width={plotW} height={bandSize} className="fill-paper-200/5" />
          ) : spec.type === "line" ? (
            <line x1={bandStart(hover) + bandSize / 2} x2={bandStart(hover) + bandSize / 2} y1={M.top} y2={M.top + plotH} className="stroke-paper-400" strokeWidth={1} strokeDasharray="3 3" />
          ) : (
            <rect x={bandStart(hover)} y={M.top} width={bandSize} height={plotH} className="fill-paper-200/5" />
          ))}

        {spec.type === "line"
          ? spec.series.map((s, si) => {
              // A gap (null) breaks the line rather than bridging it.
              let d = "";
              s.values.forEach((v, i) => {
                if (v === null) return;
                const prevMissing = i === 0 || s.values[i - 1] === null;
                d += `${prevMissing ? "M" : "L"}${bandStart(i) + bandSize / 2},${valueToPx(v)}`;
              });
              return (
                <g key={si}>
                  <path d={d} fill="none" stroke={seriesColor(si)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  {s.values.map((v, i) =>
                    v === null || !(showDots || i === hover) ? null : (
                      <circle
                        key={i}
                        cx={bandStart(i) + bandSize / 2}
                        cy={valueToPx(v)}
                        r={i === hover ? 5 : 4}
                        fill={seriesColor(si)}
                        className="stroke-ink-850"
                        strokeWidth={2}
                      />
                    )
                  )}
                </g>
              );
            })
          : spec.x.map((_, i) =>
              spec.series.map((s, si) => {
                const v = s.values[i];
                if (v === null) return null;
                const offset = bandStart(i) + (bandSize - groupSize) / 2 + si * (barSize + 2);
                const end = valueToPx(v);
                const positive = v >= 0;
                const path = horizontal
                  ? barPath(Math.min(zero, end), offset, Math.abs(end - zero), barSize, true, positive)
                  : barPath(offset, Math.min(zero, end), barSize, Math.abs(end - zero), false, positive);
                return <path key={`${i}-${si}`} d={path} fill={seriesColor(si)} opacity={hover === null || hover === i ? 1 : 0.55} />;
              })
            )}

        {/* Hit targets: a whole band per category, bigger than any mark. */}
        {spec.x.map((_, i) =>
          horizontal ? (
            <rect key={i} x={left} y={bandStart(i)} width={plotW} height={bandSize} fill="transparent" onMouseEnter={() => setHover(i)} />
          ) : (
            <rect key={i} x={bandStart(i)} y={M.top} width={bandSize} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
          )
        )}
      </svg>

      {hover !== null && tooltipPos && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-ink-600 bg-ink-900/95 px-2.5 py-1.5 text-[11px] shadow-lg"
          style={{
            left: `${(tooltipPos.left / WIDTH) * 100}%`,
            top: horizontal ? `${(tooltipPos.top / height) * 100}%` : 24,
            transform: horizontal ? "translateY(-50%)" : hover > spec.x.length / 2 ? "translateX(-105%)" : "translateX(5%)",
          }}
        >
          <p className="text-paper-200 mb-0.5">{spec.x[hover]}</p>
          {spec.series.map((s, i) => (
            <p key={i} className="flex items-center gap-1.5 text-paper-300">
              <span className="h-2 w-2 rounded-sm" style={{ background: seriesColor(i) }} />
              {n > 1 && <span>{s.name}:</span>}
              <span className="font-mono text-paper-200">
                {s.values[hover] === null ? "–" : formatNumber(s.values[hover] as number, spec.unit)}
              </span>
            </p>
          ))}
        </div>
      )}

      <button
        onClick={() => setShowTable((t) => !t)}
        className="mt-1 flex items-center gap-1 text-[11px] text-paper-400 hover:text-paper-200 transition-colors"
      >
        <Table2 size={11} />
        {showTable ? "Hide data" : "Show data"}
      </button>
      {showTable && <DataTable spec={spec} />}
    </div>
  );
}

function StatTiles({ spec }: { spec: StatsSpec }) {
  return (
    <div className={cn("grid gap-2", spec.items.length === 1 ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-3")}>
      {spec.items.map((it, i) => (
        <div key={i} className="rounded-md border border-ink-600 bg-ink-800 px-3 py-2">
          <p className="text-[11px] text-paper-400">{it.label}</p>
          <p className="text-xl text-paper-100 font-serif leading-tight mt-0.5">{it.value}</p>
          {it.detail && <p className="text-[11px] text-paper-400 mt-0.5">{it.detail}</p>}
        </div>
      ))}
    </div>
  );
}

export function ChartBlock({ source, streaming }: { source: string; streaming?: boolean }) {
  const parsed = useMemo(() => parseChartSpec(source), [source]);

  if ("error" in parsed) {
    // Mid-stream the JSON is simply incomplete: show a placeholder, not an error.
    if (streaming) {
      return <div className="viz-root my-3 h-24 rounded-lg border border-ink-600 bg-ink-850 animate-pulse" aria-label="Building chart" />;
    }
    return (
      <div className="my-3 rounded-lg border border-ink-600 bg-ink-850 p-3">
        <p className="text-[11px] text-rust-400 mb-1">Couldn&apos;t draw this chart: {parsed.error}</p>
        <pre className="text-[11px] font-mono text-paper-400 whitespace-pre-wrap break-all">{source}</pre>
      </div>
    );
  }

  const { spec } = parsed;
  return (
    <figure className="viz-root not-prose my-3 rounded-lg border border-ink-600 bg-ink-850 p-3">
      {spec.title && <figcaption className="text-sm text-paper-200 mb-2">{spec.title}</figcaption>}
      {spec.type === "stats" ? <StatTiles spec={spec} /> : <XYChart spec={spec} />}
    </figure>
  );
}
