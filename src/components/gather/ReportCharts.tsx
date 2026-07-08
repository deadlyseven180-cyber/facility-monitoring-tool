"use client";

import { useMemo, useState } from "react";
import type { ChartConfiguration } from "chart.js/auto";
import ChartCanvas from "@/components/shared/ChartCanvas";
import { useTheme } from "@/components/theme/ThemeProvider";
import { formatCurrency } from "@/lib/format";
import { toIsoDate } from "@/lib/reports/columns";
import type { FilteredRecord, MonthlyDetail } from "@/types/report";

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const AMBER = "#f59e0b"; // Internal
const round1 = (n: number) => Math.round(n * 10) / 10;

const selectCls =
  "rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:ring-indigo-500/30";

/** Selectable month range shown on the X-axis. */
const YOY_PERIODS: { value: string; label: string; months: number[] }[] = [
  { value: "full", label: "Full Year", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  { value: "h1", label: "Jan–Jun", months: [1, 2, 3, 4, 5, 6] },
  { value: "h2", label: "Jul–Dec", months: [7, 8, 9, 10, 11, 12] },
  { value: "q1", label: "Q1 · Jan–Mar", months: [1, 2, 3] },
  { value: "q2", label: "Q2 · Apr–Jun", months: [4, 5, 6] },
  { value: "q3", label: "Q3 · Jul–Sep", months: [7, 8, 9] },
  { value: "q4", label: "Q4 · Oct–Dec", months: [10, 11, 12] },
];

/** One color per state; a fallback palette covers anything else. */
const STATE_COLOR: Record<string, string> = { MA: "#1e3a5f", IL: "#c19a3e", DC: "#0d9488" };
const STATE_FALLBACK = ["#6366f1", "#ef4444", "#a855f7", "#ec4899", "#0ea5e9"];
const stateColor = (st: string, i: number) => STATE_COLOR[st] ?? STATE_FALLBACK[i % STATE_FALLBACK.length];
const YEAR_PALETTE = ["#c19a3e", "#1e3a5f", "#0d9488", "#a855f7", "#ef4444", "#ec4899"];

const periodMonths = (period: string) => YOY_PERIODS.find((p) => p.value === period)?.months ?? [];
/** True when the caller wants all states aggregated into one series set. */
const isCombined = (states: string[]) => states.length === 1 && states[0] === "";

/** Draws each bar/point's value just above it (formatted via `fmt`). */
function valueOnBarsPlugin(color: string, fmt: (n: number) => string = String) {
  return {
    id: "yoyValues",
    afterDatasetsDraw(chart: {
      ctx: CanvasRenderingContext2D;
      data: { datasets: { data: unknown[] }[] };
      getDatasetMeta: (i: number) => { hidden?: boolean; data: { x: number; y: number }[] };
    }) {
      const { ctx } = chart;
      ctx.save();
      ctx.font = "bold 9px 'Segoe UI', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillStyle = color;
      chart.data.datasets.forEach((ds, di) => {
        const meta = chart.getDatasetMeta(di);
        if (meta.hidden) return;
        meta.data.forEach((el, i) => {
          const v = ds.data[i] as number | null;
          if (v == null || v === 0) return;
          ctx.fillText(fmt(Number(v)), el.x, el.y - 2);
        });
      });
      ctx.restore();
    },
  };
}

function chartCard(
  title: string,
  period: string,
  setPeriod: (v: string) => void,
  type: "bar" | "line" | null,
  setType: ((v: "bar" | "line") => void) | null,
  hasData: boolean,
  config: ChartConfiguration,
  ariaLabel: string,
  subtitle?: string,
) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
          <span className="h-4 w-1 rounded-full bg-indigo-500" />
          {title}
        </h4>
        <div className="flex items-center gap-2">
          <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Month range" className={selectCls}>
            {YOY_PERIODS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          {type && setType && (
            <select value={type} onChange={(e) => setType(e.target.value as "bar" | "line")} aria-label="Chart type" className={selectCls}>
              <option value="bar">Bar</option>
              <option value="line">Line</option>
            </select>
          )}
        </div>
      </div>
      {subtitle && <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
      {hasData ? (
        <ChartCanvas config={config} height={400} ariaLabel={ariaLabel} />
      ) : (
        <p className="py-12 text-center text-sm text-slate-400">No data for this period.</p>
      )}
    </div>
  );
}

/* --------------------- Year-over-Year comparison chart --------------------- */

/**
 * Complaints per month, this year vs last year, with one series per state
 * (MA/IL/DC) shown in a single chart. State = color, prior year = dashed line.
 * Pass `states: [""]` to aggregate all states into one series set.
 */
export function YearComparisonChart({
  records,
  states,
  title = "Complaints",
}: {
  records: FilteredRecord[];
  states: string[];
  title?: string;
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const text = dark ? "#cbd5e1" : "#475569";
  const grid = dark ? "rgba(148,163,184,0.16)" : "rgba(148,163,184,0.22)";
  const [period, setPeriod] = useState("h1");
  const [type, setType] = useState<"bar" | "line">(states.length > 1 ? "line" : "bar");

  const { config, hasData } = useMemo(() => {
    const months = periodMonths(period);
    const monthSet = new Set(months);
    const combined = isCombined(states);
    let maxYear = 0;
    for (const r of records) {
      const iso = toIsoDate(r.starts);
      if (iso) { const y = Number(iso.slice(0, 4)); if (y > maxYear) maxYear = y; }
    }
    const keepYears = [maxYear - 1, maxYear].filter((y) => y > 0).sort((a, b) => a - b);
    const counts = new Map<string, number>(); // `${st}|${y}|${m}`
    for (const r of records) {
      const iso = toIsoDate(r.starts);
      if (!iso) continue;
      const [y, m] = iso.split("-").map(Number);
      if (!keepYears.includes(y) || !monthSet.has(m)) continue;
      const st = combined ? "" : r.state;
      if (!combined && !states.includes(st)) continue;
      const k = `${st}|${y}|${m}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    let maxMonth = 0;
    for (const k of counts.keys()) { const m = Number(k.split("|")[2]); if (m > maxMonth) maxMonth = m; }
    const shownMonths = months.filter((m) => m <= maxMonth);
    const labels = shownMonths.map((m) => MONTHS_SHORT[m - 1]);
    const seriesStates = combined ? [""] : states;
    const datasets: Record<string, unknown>[] = [];
    seriesStates.forEach((st, si) => {
      keepYears.forEach((y, yi) => {
        const color = combined ? YEAR_PALETTE[yi % YEAR_PALETTE.length] : stateColor(st, si);
        const prior = y !== maxYear;
        datasets.push({
          type,
          label: combined ? String(y) : `${st} ${y}`,
          data: shownMonths.map((m) => counts.get(`${st}|${y}|${m}`) ?? 0),
          backgroundColor: color,
          borderColor: color,
          borderDash: type === "line" && prior && !combined ? [6, 4] : [],
          borderRadius: type === "bar" ? 4 : 0,
          tension: 0.3,
          fill: false,
          pointRadius: 3,
        });
      });
    });
    const cfg = {
      type,
      plugins: [valueOnBarsPlugin(text)],
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 20 } },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { labels: { color: text, boxWidth: 12, font: { size: 10 } } },
          tooltip: { callbacks: { label: (c: { dataset: { label?: string }; parsed: { y: number | null } }) => `${c.dataset.label}: ${c.parsed.y ?? 0}` } },
        },
        scales: {
          x: { ticks: { color: text }, grid: { display: false }, title: { display: true, text: "Month", color: text } },
          y: { beginAtZero: true, ticks: { color: text, precision: 0 }, grid: { color: grid }, title: { display: true, text: "Complaints", color: text, font: { size: 11, weight: "bold" } } },
        },
      },
    } as unknown as ChartConfiguration;
    const hasData = datasets.some((d) => (d.data as number[]).some((v) => v > 0));
    return { config: cfg, hasData };
  }, [records, states, period, type, text, grid]);

  const periodLabel = YOY_PERIODS.find((p) => p.value === period)?.label ?? "Full Year";
  return chartCard(`${title} — ${periodLabel}`, period, setPeriod, type, setType, hasData, config, `${title} chart`);
}

/* ------------------------------ Refunds chart ------------------------------ */

/** Refund amount by month, one line/bar per state, for the latest data year. */
export function RefundBySourceChart({ records, states }: { records: FilteredRecord[]; states: string[] }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const text = dark ? "#cbd5e1" : "#475569";
  const grid = dark ? "rgba(148,163,184,0.16)" : "rgba(148,163,184,0.22)";
  const [period, setPeriod] = useState("h1");
  const [type, setType] = useState<"bar" | "line">(states.length > 1 ? "line" : "bar");

  const { config, hasData, year } = useMemo(() => {
    const months = periodMonths(period);
    const monthSet = new Set(months);
    const combined = isCombined(states);
    let maxYear = 0;
    for (const r of records) {
      const iso = toIsoDate(r.starts);
      if (iso) { const y = Number(iso.slice(0, 4)); if (y > maxYear) maxYear = y; }
    }
    const byState = new Map<string, Map<number, number>>();
    for (const r of records) {
      const iso = toIsoDate(r.starts);
      if (!iso) continue;
      const [y, m] = iso.split("-").map(Number);
      if (y !== maxYear || !monthSet.has(m)) continue;
      const st = combined ? "" : r.state;
      if (!combined && !states.includes(st)) continue;
      const amt = Math.abs(r.refundAmount);
      if (!amt) continue;
      const mm = byState.get(st) ?? new Map<number, number>();
      mm.set(m, (mm.get(m) ?? 0) + amt);
      byState.set(st, mm);
    }
    let maxMonth = 0;
    for (const mm of byState.values()) for (const m of mm.keys()) if (m > maxMonth) maxMonth = m;
    const shownMonths = months.filter((m) => m <= maxMonth);
    const labels = shownMonths.map((m) => MONTHS_SHORT[m - 1]);
    const seriesStates = combined ? [""] : states;
    const datasets = seriesStates.map((st, si) => {
      const color = combined ? AMBER : stateColor(st, si);
      const mm = byState.get(st) ?? new Map<number, number>();
      return {
        type,
        label: combined ? "Refunds" : st,
        data: shownMonths.map((m) => round1(mm.get(m) ?? 0)),
        backgroundColor: color,
        borderColor: color,
        borderRadius: type === "bar" ? 4 : 0,
        tension: 0.3,
        fill: false,
        pointRadius: 3,
      };
    });
    const cfg = {
      type,
      plugins: [valueOnBarsPlugin(text, formatCurrency)],
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 20 } },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { labels: { color: text, boxWidth: 12, font: { size: 10 } } },
          tooltip: { callbacks: { label: (c: { dataset: { label?: string }; parsed: { y: number | null } }) => `${c.dataset.label}: ${formatCurrency(c.parsed.y ?? 0)}` } },
        },
        scales: {
          x: { ticks: { color: text }, grid: { display: false }, title: { display: true, text: "Month", color: text } },
          y: { beginAtZero: true, ticks: { color: text, callback: (v: string | number) => formatCurrency(Number(v)) }, grid: { color: grid }, title: { display: true, text: "Refunds", color: text, font: { size: 11, weight: "bold" } } },
        },
      },
    } as unknown as ChartConfiguration;
    const hasData = datasets.some((d) => (d.data as number[]).some((v) => v > 0));
    return { config: cfg, hasData, year: maxYear ? String(maxYear) : "" };
  }, [records, states, period, type, text, grid]);

  const periodLabel = YOY_PERIODS.find((p) => p.value === period)?.label ?? "Full Year";
  return chartCard(
    `Refunds by State${year ? ` · ${year}` : ""} — ${periodLabel}`,
    period, setPeriod, type, setType, hasData, config, `Refunds by state ${periodLabel} chart`,
  );
}

/* ------------------- Complaint Rate vs Refund % (per state) ------------------ */

/**
 * Complaint rate (% of reservations, bars) vs refund % of net remit (dashed
 * lines) per month, one pair per state, for the latest data year.
 */
export function RateVsRefundChart({ detail, states }: { detail: MonthlyDetail[]; states: string[] }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const text = dark ? "#cbd5e1" : "#475569";
  const grid = dark ? "rgba(148,163,184,0.16)" : "rgba(148,163,184,0.22)";
  const [period, setPeriod] = useState("h1");

  const { config, hasData, year } = useMemo(() => {
    const months = periodMonths(period);
    const monthSet = new Set(months);
    const combined = isCombined(states);
    let maxYear = 0;
    for (const d of detail) { const y = Number(d.ym.slice(0, 4)); if (y > maxYear) maxYear = y; }
    const map = new Map<string, { res: number; comp: number; ref: number; rem: number }>();
    for (const d of detail) {
      const y = Number(d.ym.slice(0, 4));
      const m = Number(d.ym.slice(5, 7));
      if (y !== maxYear || !monthSet.has(m)) continue;
      const st = combined ? "" : d.state;
      if (!combined && !states.includes(st)) continue;
      const k = `${st}|${m}`;
      const e = map.get(k) ?? { res: 0, comp: 0, ref: 0, rem: 0 };
      e.res += d.reservations;
      e.comp += d.spotHeroComplaints + d.internalComplaints;
      e.ref += Math.abs(d.refund);
      e.rem += d.netRemit;
      map.set(k, e);
    }
    let maxMonth = 0;
    for (const k of map.keys()) { const m = Number(k.split("|")[1]); if (m > maxMonth) maxMonth = m; }
    const shownMonths = months.filter((m) => m <= maxMonth);
    const labels = shownMonths.map((m) => MONTHS_SHORT[m - 1]);
    const seriesStates = combined ? [""] : states;
    const datasets: Record<string, unknown>[] = [];
    seriesStates.forEach((st, si) => {
      const color = combined ? "#1e3a5f" : stateColor(st, si);
      const at = (m: number) => map.get(`${st}|${m}`);
      const pfx = combined ? "" : `${st} `;
      datasets.push({
        type: "bar",
        label: `${pfx}Complaint rate`,
        data: shownMonths.map((m) => { const e = at(m); return e && e.res > 0 ? round1((e.comp / e.res) * 100) : 0; }),
        backgroundColor: color,
        borderColor: color,
        borderRadius: 4,
        order: 2,
      });
      datasets.push({
        type: "line",
        label: `${pfx}Refund % of net remit`,
        data: shownMonths.map((m) => { const e = at(m); return e && e.rem > 0 ? round1((e.ref / e.rem) * 100) : 0; }),
        borderColor: color,
        backgroundColor: color,
        borderDash: [6, 4],
        tension: 0.3,
        pointRadius: 3,
        fill: false,
        order: 1,
      });
    });
    const cfg = {
      type: "bar",
      plugins: [valueOnBarsPlugin(text, (n) => `${n}%`)],
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 20 } },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { labels: { color: text, boxWidth: 12, font: { size: 10 } } },
          tooltip: { callbacks: { label: (c: { dataset: { label?: string }; parsed: { y: number | null } }) => `${c.dataset.label}: ${(c.parsed.y ?? 0).toFixed(2)}%` } },
        },
        scales: {
          x: { ticks: { color: text }, grid: { display: false }, title: { display: true, text: "Month", color: text } },
          y: { beginAtZero: true, ticks: { color: text, callback: (v: string | number) => `${v}%` }, grid: { color: grid }, title: { display: true, text: "% (rate / refund of net remit)", color: text, font: { size: 11, weight: "bold" } } },
        },
      },
    } as unknown as ChartConfiguration;
    const hasData = datasets.some((d) => (d.data as number[]).some((v) => v > 0));
    return { config: cfg, hasData, year: maxYear ? String(maxYear) : "" };
  }, [detail, states, period, text, grid]);

  const periodLabel = YOY_PERIODS.find((p) => p.value === period)?.label ?? "Full Year";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
          <span className="h-4 w-1 rounded-full bg-indigo-500" />
          Complaint Rate vs Refund % of Net Remit{year ? ` · ${year}` : ""} — {periodLabel}
        </h4>
        <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Month range" className={selectCls}>
          {YOY_PERIODS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
        Bars = complaint rate (% of reservations) · dashed lines = refund % of net remit · color = state.
      </p>
      {hasData ? (
        <ChartCanvas config={config} height={400} ariaLabel={`Complaint rate vs refund percent ${periodLabel} chart`} />
      ) : (
        <p className="py-12 text-center text-sm text-slate-400">No data for this period.</p>
      )}
    </div>
  );
}

/**
 * The "Complaints by Month — Internal vs SpotHero" pair — internal complaints
 * and SpotHero complaints, each with one series per state.
 */
export default function ReportCharts({ records, states }: { records: FilteredRecord[]; states: string[] }) {
  const internal = useMemo(() => records.filter((r) => r.source === "internal"), [records]);
  const spothero = useMemo(() => records.filter((r) => r.source === "spothero"), [records]);
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <YearComparisonChart records={internal} states={states} title="Internal Complaints" />
      <YearComparisonChart records={spothero} states={states} title="SpotHero Complaints" />
    </div>
  );
}
