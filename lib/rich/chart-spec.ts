// The ```chart block format the model can write in an answer, and its
// validation. Kept deliberately small, so models get it right:
//
//   ```chart
//   { "type": "bar", "title": "Revenue by year", "unit": "€M",
//     "x": ["2022", "2023", "2024"],
//     "series": [{ "name": "Revenue", "values": [3.1, 3.7, 4.2] }] }
//   ```
//
// type: "bar" (vertical), "hbar" (horizontal, for long labels), "line"
// (change over time), or "stats" (headline numbers as tiles):
//
//   { "type": "stats", "items": [{ "label": "Revenue", "value": "4.2M €", "detail": "+12% vs 2023" }] }
//
// One axis only (no dual-axis charts), at most 8 series, all numbers.

export type ChartSeries = { name: string; values: (number | null)[] };

export type XYChartSpec = {
  type: "bar" | "hbar" | "line";
  title?: string;
  unit?: string;
  x: string[];
  series: ChartSeries[];
};

export type StatsSpec = {
  type: "stats";
  title?: string;
  items: { label: string; value: string; detail?: string }[];
};

export type ChartSpec = XYChartSpec | StatsSpec;

export const MAX_SERIES = 8;
export const MAX_POINTS = 60;
export const MAX_STATS = 8;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);

export function parseChartSpec(text: string): { spec: ChartSpec } | { error: string } {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: "The chart data isn't valid JSON." };
  }
  if (!raw || typeof raw !== "object") return { error: "The chart data must be a JSON object." };

  const title = str(raw.title, 120);

  if (raw.type === "stats") {
    if (!Array.isArray(raw.items) || raw.items.length === 0) return { error: "A stats block needs an \"items\" list." };
    const items = raw.items.slice(0, MAX_STATS).map((it: any) => ({
      label: str(it?.label, 60) ?? "",
      value: it?.value === undefined || it?.value === null ? "" : String(it.value).slice(0, 40),
      ...(str(it?.detail, 80) ? { detail: str(it?.detail, 80) } : {}),
    }));
    if (items.some((it: any) => !it.label || !it.value)) return { error: "Every stat needs a label and a value." };
    return { spec: { type: "stats", ...(title ? { title } : {}), items } };
  }

  if (raw.type !== "bar" && raw.type !== "hbar" && raw.type !== "line") {
    return { error: `Unknown chart type "${raw.type}". Use bar, hbar, line or stats.` };
  }
  if (!Array.isArray(raw.x) || raw.x.length === 0) return { error: "A chart needs an \"x\" list of labels." };
  if (raw.x.length > MAX_POINTS) return { error: `Too many points (max ${MAX_POINTS}).` };
  if (!Array.isArray(raw.series) || raw.series.length === 0) return { error: "A chart needs at least one series." };
  if (raw.series.length > MAX_SERIES) return { error: `Too many series (max ${MAX_SERIES}).` };

  const x = raw.x.map((l: unknown) => String(l).slice(0, 50));
  const series: ChartSeries[] = [];
  for (const [i, s] of raw.series.entries()) {
    if (!Array.isArray(s?.values) || s.values.length !== x.length) {
      return { error: `Series ${i + 1} needs exactly one value per x label (${x.length}).` };
    }
    const values = s.values.map((v: unknown) => (v === null ? null : typeof v === "number" && Number.isFinite(v) ? v : NaN));
    if (values.some((v: number | null) => v !== null && Number.isNaN(v))) {
      return { error: `Series ${i + 1} has a value that isn't a number.` };
    }
    series.push({ name: str(s?.name, 60) || `Series ${i + 1}`, values });
  }

  const unit = str(raw.unit, 12);
  return { spec: { type: raw.type, ...(title ? { title } : {}), ...(unit ? { unit } : {}), x, series } };
}

/** "Nice" axis ticks from 0 (or the minimum, if negative) to the maximum. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  if (hi === lo) return [lo, lo + 1];
  const rough = (hi - lo) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? 10 * magnitude;
  const start = Math.floor(lo / step) * step;
  const ticks: number[] = [];
  for (let t = start; t <= hi + step * 1e-9; t += step) ticks.push(Number(t.toPrecision(12)));
  if (ticks[ticks.length - 1] < hi) ticks.push(Number((ticks[ticks.length - 1] + step).toPrecision(12)));
  return ticks;
}

/** Compact number formatting for axes and tooltips: 1200 -> "1.2k". */
export function formatNumber(n: number, unit?: string): string {
  const abs = Math.abs(n);
  const s =
    abs >= 1e9 ? `${+(n / 1e9).toFixed(1)}B` : abs >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : abs >= 1e4 ? `${+(n / 1e3).toFixed(1)}k` : `${+n.toFixed(2)}`;
  return unit ? `${s} ${unit}` : s;
}
