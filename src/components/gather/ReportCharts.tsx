"use client";

import { useMemo, useState } from "react";
import type { ChartConfiguration } from "chart.js/auto";
import ChartCanvas from "@/components/shared/ChartCanvas";
import { useTheme } from "@/components/theme/ThemeProvider";
import { formatCurrency } from "@/lib/format";
import { toIsoDate } from "@/lib/reports/columns";
import type { FilteredRecord, ReportResult } from "@/types/report";

const BLUE = "#3b82f6";
const AMBER = "#f59e0b";
const PURPLE = "#a855f7";
const PALETTE = [
  "#3b82f6", "#f59e0b", "#a855f7", "#14b8a6", "#ef4444",
  "#6366f1", "#10b981", "#ec4899", "#eab308", "#0ea5e9",
];

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const DAY_MS = 86_400_000;
const EPOCH = Date.UTC(2024, 0, 1); // a Monday — anchors the 2-week blocks

/** Start ISO (Mon) of the fixed 2-week block that `starts` falls in ("" if undated). */
function biweekStartIso(starts: string): string {
  const iso = toIsoDate(starts);
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const block = Math.floor((ms - EPOCH) / (14 * DAY_MS)) * 14;
  const s = new Date(EPOCH + block * DAY_MS);
  return `${s.getUTCFullYear()}-${String(s.getUTCMonth() + 1).padStart(2, "0")}-${String(s.getUTCDate()).padStart(2, "0")}`;
}

/** Label a 2-week block by its range, e.g. "Jun 1–14" or "Jun 29–Jul 12". */
function biweekLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const e = new Date(Date.UTC(y, m - 1, d) + 13 * DAY_MS);
  const sm = MONTHS_SHORT[(m || 1) - 1];
  const em = MONTHS_SHORT[e.getUTCMonth()];
  const ed = e.getUTCDate();
  return sm === em ? `${sm} ${d}–${ed}` : `${sm} ${d}–${em} ${ed}`;
}

type Granularity = "biweekly" | "monthly" | "bimonthly" | "yearly";

const GRANULARITIES: { value: Granularity; label: string; axis: string }[] = [
  { value: "biweekly", label: "Every 2 Weeks", axis: "2-week period" },
  { value: "monthly", label: "Monthly", axis: "Month" },
  { value: "bimonthly", label: "Every 2 Months", axis: "2-month period" },
  { value: "yearly", label: "Yearly", axis: "Year" },
];

/** Bucket a record's date at the chosen granularity → sortable key + label. */
function bucketize(
  starts: string,
  gran: Granularity,
): { key: string; label: string } | null {
  const iso = toIsoDate(starts);
  if (!iso) return null;
  const [y, m] = iso.split("-").map(Number);
  if (gran === "biweekly") {
    const k = biweekStartIso(iso);
    return { key: k, label: biweekLabel(k) };
  }
  if (gran === "monthly") {
    return { key: `${y}-${String(m).padStart(2, "0")}`, label: `${MONTHS_SHORT[m - 1]} ${y}` };
  }
  if (gran === "bimonthly") {
    const startM = Math.floor((m - 1) / 2) * 2 + 1;
    return {
      key: `${y}-${String(startM).padStart(2, "0")}`,
      label: `${MONTHS_SHORT[startM - 1]}–${MONTHS_SHORT[startM]} ${y}`,
    };
  }
  return { key: `${y}`, label: `${y}` }; // yearly
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/* --------------------------- chart configuration --------------------------- */

type ChartType = "bar" | "line" | "area" | "pie" | "doughnut";
type SeriesMode =
  | "spothero"
  | "internal"
  | "spothero_vs_internal"
  | "lot_full"
  | "inaccessibility"
  | "lotfull_vs_inacc";

const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: "bar", label: "Bar" },
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
  { value: "pie", label: "Pie" },
  { value: "doughnut", label: "Doughnut" },
];

const SERIES_MODES: { value: SeriesMode; label: string }[] = [
  { value: "spothero", label: "SpotHero Only" },
  { value: "internal", label: "Internal Only" },
  { value: "spothero_vs_internal", label: "SpotHero vs Internal" },
  { value: "lot_full", label: "Lot Full" },
  { value: "inaccessibility", label: "Inaccessibility" },
  { value: "lotfull_vs_inacc", label: "Lot Full vs Inaccessibility" },
];

interface Series {
  label: string;
  color: string;
  match: (r: FilteredRecord) => boolean;
}

function seriesFor(mode: SeriesMode): Series[] {
  const SH: Series = { label: "SpotHero", color: BLUE, match: (r) => r.source === "spothero" };
  const IN: Series = { label: "Internal", color: AMBER, match: (r) => r.source === "internal" };
  const LF: Series = { label: "Lot Full", color: BLUE, match: (r) => r.category === "lot_full" };
  const IA: Series = { label: "Inaccessibility", color: PURPLE, match: (r) => r.category === "inaccessibility" };
  switch (mode) {
    case "spothero": return [SH];
    case "internal": return [IN];
    case "spothero_vs_internal": return [SH, IN];
    case "lot_full": return [LF];
    case "inaccessibility": return [IA];
    case "lotfull_vs_inacc": return [LF, IA];
  }
}

/** Plugin that draws each bar/point's refund amount on the chart. */
function valueLabelsPlugin(color: string) {
  return {
    id: "valueLabels",
    afterDatasetsDraw(chart: {
      ctx: CanvasRenderingContext2D;
      data: { datasets: { data: unknown[] }[] };
      getDatasetMeta: (i: number) => { hidden?: boolean; data: { x: number; y: number }[] };
    }) {
      const { ctx } = chart;
      ctx.save();
      ctx.font = "bold 10px 'Segoe UI', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillStyle = color;
      chart.data.datasets.forEach((ds, di) => {
        const meta = chart.getDatasetMeta(di);
        if (meta.hidden) return;
        meta.data.forEach((el, i) => {
          const v = ds.data[i] as number | null;
          if (v == null || v === 0) return;
          ctx.fillText(formatCurrency(Number(v)), el.x, el.y - 3);
        });
      });
      ctx.restore();
    },
  };
}

function buildConfig(
  records: FilteredRecord[],
  type: ChartType,
  mode: SeriesMode,
  gran: Granularity,
  text: string,
  grid: string,
): ChartConfiguration {
  const series = seriesFor(mode);
  const axisTitle =
    GRANULARITIES.find((g) => g.value === gran)?.axis ?? "Period";

  // Buckets present across all records, at the chosen granularity.
  const bucketMap = new Map<string, string>(); // key → label
  for (const r of records) {
    const b = bucketize(r.starts, gran);
    if (b) bucketMap.set(b.key, b.label);
  }
  const keys = [...bucketMap.keys()].sort();
  const labels = keys.map((k) => bucketMap.get(k));

  // Per-series, per-bucket summed |refund|.
  const data = series.map((s) => {
    const m = new Map<string, number>();
    for (const r of records) {
      if (!s.match(r)) continue;
      const b = bucketize(r.starts, gran);
      if (!b) continue;
      m.set(b.key, (m.get(b.key) ?? 0) + Math.abs(r.refundAmount));
    }
    return keys.map((k) => round1(m.get(k) ?? 0));
  });

  const arcTooltip = {
    callbacks: {
      label: (c: { label?: string; parsed: number }) =>
        `${c.label}: ${formatCurrency(c.parsed)}`,
    },
  };

  // Pie / Doughnut: ≥2 series → one slice per series (totals); else slice per period.
  if (type === "pie" || type === "doughnut") {
    const multi = series.length >= 2;
    const sliceLabels = multi ? series.map((s) => s.label) : labels;
    const sliceData = multi
      ? data.map((arr) => round1(arr.reduce((a, b) => a + b, 0)))
      : data[0];
    const colors = multi
      ? series.map((s) => s.color)
      : sliceLabels.map((_, i) => PALETTE[i % PALETTE.length]);
    return {
      type,
      data: {
        labels: sliceLabels,
        datasets: [{ data: sliceData, backgroundColor: colors, borderWidth: 0 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "right", labels: { color: text, boxWidth: 12, font: { size: 11 } } },
          tooltip: arcTooltip,
        },
      },
    } as unknown as ChartConfiguration;
  }

  // Bar / Line / Area.
  const datasets = series.map((s, i) =>
    type === "bar"
      ? { type: "bar", label: s.label, data: data[i], backgroundColor: s.color, borderRadius: 4 }
      : {
          type: "line",
          label: s.label,
          data: data[i],
          borderColor: s.color,
          backgroundColor: type === "area" ? hexA(s.color, 0.18) : s.color,
          fill: type === "area",
          tension: 0.3,
          pointRadius: 3,
        },
  );

  return {
    type: type === "bar" ? "bar" : "line",
    plugins: [valueLabelsPlugin(text)],
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 18 } },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: series.length > 1, labels: { color: text, boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: (c: { dataset: { label?: string }; parsed: { y: number | null } }) =>
              `${c.dataset.label}: ${formatCurrency(c.parsed.y ?? 0)}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: text, font: { size: 10 }, maxRotation: 45 },
          grid: { display: false },
          title: { display: true, text: axisTitle, color: text },
        },
        y: {
          beginAtZero: true,
          ticks: { color: text, callback: (v: string | number) => formatCurrency(Number(v)) },
          grid: { color: grid },
          title: { display: true, text: "Refunds", color: text, font: { size: 11, weight: "bold" } },
        },
      },
    },
  } as unknown as ChartConfiguration;
}

/* ------------------------------- components ------------------------------- */

const selectCls =
  "rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:ring-indigo-500/30";

function ConfigurableChart({
  records,
  defaultType,
  defaultMode,
}: {
  records: FilteredRecord[];
  defaultType: ChartType;
  defaultMode: SeriesMode;
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const text = dark ? "#cbd5e1" : "#475569";
  const grid = dark ? "rgba(148,163,184,0.16)" : "rgba(148,163,184,0.22)";

  const [type, setType] = useState<ChartType>(defaultType);
  const [mode, setMode] = useState<SeriesMode>(defaultMode);
  const [gran, setGran] = useState<Granularity>("biweekly");

  const config = useMemo(
    () => buildConfig(records, type, mode, gran, text, grid),
    [records, type, mode, gran, text, grid],
  );

  const modeLabel = SERIES_MODES.find((m) => m.value === mode)?.label ?? "Refunds";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
          <span className="h-4 w-1 rounded-full bg-indigo-500" />
          {modeLabel}
        </h4>
        <div className="flex items-center gap-2">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as ChartType)}
            aria-label="Chart type"
            className={selectCls}
          >
            {CHART_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as SeriesMode)}
            aria-label="Data to show"
            className={selectCls}
          >
            {SERIES_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <select
            value={gran}
            onChange={(e) => setGran(e.target.value as Granularity)}
            aria-label="Date range grouping"
            className={selectCls}
          >
            {GRANULARITIES.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <ChartCanvas config={config} height={250} ariaLabel={`${modeLabel} chart`} />
    </div>
  );
}

/* --------------------- Year-over-Year comparison chart --------------------- */

/** Selectable comparison periods: full year, each quarter, or a single month. */
const YOY_PERIODS: { value: string; label: string; months: number[] }[] = [
  { value: "full", label: "Full Year", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  { value: "q1", label: "Q1 · Jan–Mar", months: [1, 2, 3] },
  { value: "q2", label: "Q2 · Apr–Jun", months: [4, 5, 6] },
  { value: "q3", label: "Q3 · Jul–Sep", months: [7, 8, 9] },
  { value: "q4", label: "Q4 · Oct–Dec", months: [10, 11, 12] },
  ...MONTHS_SHORT.map((m, i) => ({ value: `m${i + 1}`, label: m, months: [i + 1] })),
];

/** Draws the stacked total above each bar. */
function stackTotalPlugin(color: string) {
  return {
    id: "yoyStackTotal",
    afterDatasetsDraw(chart: {
      ctx: CanvasRenderingContext2D;
      data: { datasets: { data: unknown[] }[] };
      getDatasetMeta: (i: number) => { data: { x: number; y: number }[] };
    }) {
      const { ctx } = chart;
      const meta0 = chart.getDatasetMeta(0);
      if (!meta0?.data) return;
      ctx.save();
      ctx.font = "bold 11px 'Segoe UI', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillStyle = color;
      meta0.data.forEach((_, i) => {
        let total = 0;
        let topY = Infinity;
        let x = 0;
        chart.data.datasets.forEach((ds, di) => {
          total += Number(ds.data[i]) || 0;
          const el = chart.getDatasetMeta(di).data[i];
          if (el && el.y < topY) { topY = el.y; x = el.x; }
        });
        if (total > 0) ctx.fillText(String(total), x, topY - 4);
      });
      ctx.restore();
    },
  };
}

/**
 * Compares the same calendar period across every year present in the data —
 * e.g. Jan 2025 vs Jan 2026, or Q1 2025 vs Q1 2026. Each year is one stacked
 * bar (Lot Full + Inaccessibility); an all-empty category series auto-hides.
 */
export function YearComparisonChart({ records }: { records: FilteredRecord[] }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const text = dark ? "#cbd5e1" : "#475569";
  const grid = dark ? "rgba(148,163,184,0.16)" : "rgba(148,163,184,0.22)";
  const [period, setPeriod] = useState("full");
  const [type, setType] = useState<"bar" | "line">("bar");

  const { config, years } = useMemo(() => {
    const months = new Set(YOY_PERIODS.find((p) => p.value === period)?.months ?? []);
    const byYear = new Map<number, { lf: number; ia: number }>();
    for (const r of records) {
      const iso = toIsoDate(r.starts);
      if (!iso) continue;
      const [y, m] = iso.split("-").map(Number);
      if (!months.has(m)) continue;
      const e = byYear.get(y) ?? { lf: 0, ia: 0 };
      if (r.category === "lot_full") e.lf++;
      else if (r.category === "inaccessibility") e.ia++;
      byYear.set(y, e);
    }
    const ys = [...byYear.keys()].sort((a, b) => a - b);
    const lf = ys.map((y) => byYear.get(y)!.lf);
    const ia = ys.map((y) => byYear.get(y)!.ia);
    const hasLF = lf.some((n) => n > 0);
    const hasIA = ia.some((n) => n > 0);
    const mk = (label: string, d: number[], color: string) => ({
      label, data: d, backgroundColor: color, borderColor: color,
      borderRadius: type === "bar" ? 4 : 0, tension: 0.3, fill: false, stack: "a",
    });
    const datasets = [
      ...(hasLF || !hasIA ? [mk("Lot Full", lf, BLUE)] : []),
      ...(hasIA || !hasLF ? [mk("Inaccessibility", ia, PURPLE)] : []),
    ];
    const cfg = {
      type,
      plugins: [stackTotalPlugin(text)],
      data: { labels: ys.map(String), datasets },
      options: {
        responsive: true, maintainAspectRatio: false, layout: { padding: { top: 20 } },
        plugins: {
          legend: { labels: { color: text, boxWidth: 12 } },
          tooltip: { callbacks: { footer: (items: { parsed: { y: number | null } }[]) => `Total: ${items.reduce((s, it) => s + (it.parsed.y || 0), 0)}` } },
        },
        scales: {
          x: { stacked: true, ticks: { color: text }, grid: { display: false }, title: { display: true, text: "Year", color: text } },
          y: { stacked: true, beginAtZero: true, ticks: { color: text, precision: 0 }, grid: { color: grid }, title: { display: true, text: "Complaints", color: text, font: { size: 11, weight: "bold" } } },
        },
      },
    } as unknown as ChartConfiguration;
    return { config: cfg, years: ys };
  }, [records, period, type, text, grid]);

  const periodLabel = YOY_PERIODS.find((p) => p.value === period)?.label ?? "Full Year";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
          <span className="h-4 w-1 rounded-full bg-indigo-500" />
          Year-over-Year — {periodLabel}
        </h4>
        <div className="flex items-center gap-2">
          <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Comparison period" className={selectCls}>
            {YOY_PERIODS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          <select value={type} onChange={(e) => setType(e.target.value as "bar" | "line")} aria-label="Chart type" className={selectCls}>
            <option value="bar">Bar</option>
            <option value="line">Line</option>
          </select>
        </div>
      </div>
      {years.length > 0 ? (
        <ChartCanvas config={config} height={260} ariaLabel={`Year-over-year ${periodLabel} chart`} />
      ) : (
        <p className="py-12 text-center text-sm text-slate-400">No dated records for this period.</p>
      )}
    </div>
  );
}

export default function ReportCharts({ result }: { result: ReportResult }) {
  const records = result.records;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <ConfigurableChart records={records} defaultType="bar" defaultMode="spothero_vs_internal" />
      <ConfigurableChart records={records} defaultType="bar" defaultMode="lotfull_vs_inacc" />
      <ConfigurableChart records={records} defaultType="line" defaultMode="internal" />
      <ConfigurableChart records={records} defaultType="line" defaultMode="spothero" />
    </div>
  );
}
