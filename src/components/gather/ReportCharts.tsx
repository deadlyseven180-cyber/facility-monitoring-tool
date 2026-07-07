"use client";

import { useMemo, useState } from "react";
import type { ChartConfiguration } from "chart.js/auto";
import ChartCanvas from "@/components/shared/ChartCanvas";
import { useTheme } from "@/components/theme/ThemeProvider";
import { formatCurrency } from "@/lib/format";
import { toIsoDate } from "@/lib/reports/columns";
import type { FilteredRecord, MonthlyPoint } from "@/types/report";

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const AMBER = "#f59e0b"; // Internal
const BLUE = "#3b82f6"; // SpotHero
const round1 = (n: number) => Math.round(n * 10) / 10;

const selectCls =
  "rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:ring-indigo-500/30";

/* --------------------- Year-over-Year comparison chart --------------------- */

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

// One color per year (oldest → newest): gold, navy, then extras.
const YEAR_PALETTE = ["#c19a3e", "#1e3a5f", "#0d9488", "#a855f7", "#ef4444", "#ec4899"];

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

/**
 * Month-by-month comparison across years in one chart: the X-axis is the months
 * in the selected range and each year present is its own grouped series (e.g.
 * complaints per month for 2025 vs 2026). Only the two most recent data years
 * are shown, and only months up to the latest one with data. Counts reflect
 * whatever records are passed in (so a source-filtered set shows that source).
 */
export function YearComparisonChart({
  records,
  title = "By Month, Year-over-Year",
}: {
  records: FilteredRecord[];
  title?: string;
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const text = dark ? "#cbd5e1" : "#475569";
  const grid = dark ? "rgba(148,163,184,0.16)" : "rgba(148,163,184,0.22)";
  // Default to Jan–Jun (H1) — the comparable period both years share.
  const [period, setPeriod] = useState("h1");
  const [type, setType] = useState<"bar" | "line">("bar");

  const { config, hasData } = useMemo(() => {
    const months = YOY_PERIODS.find((p) => p.value === period)?.months ?? [];
    const monthSet = new Set(months);
    // Compare only the two most recent years in the data (this year vs last
    // year), excluding any stray older years. Derived from the data — not the
    // server clock — so it's correct regardless of where it runs.
    let maxYear = 0;
    for (const r of records) {
      const iso = toIsoDate(r.starts);
      if (iso) {
        const y = Number(iso.slice(0, 4));
        if (y > maxYear) maxYear = y;
      }
    }
    const keepYears = new Set([maxYear - 1, maxYear]);
    const years = new Set<number>();
    const counts = new Map<string, number>(); // `${year}-${month}` → count
    for (const r of records) {
      const iso = toIsoDate(r.starts);
      if (!iso) continue;
      const [y, m] = iso.split("-").map(Number);
      if (!keepYears.has(y) || !monthSet.has(m)) continue;
      years.add(y);
      const k = `${y}-${m}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    // Only render months up to the latest one that has data — future/empty
    // months (e.g. Aug–Dec mid-year) are hidden and appear automatically once
    // they have records.
    let maxMonth = 0;
    for (const k of counts.keys()) {
      const m = Number(k.split("-")[1]);
      if (m > maxMonth) maxMonth = m;
    }
    const shownMonths = months.filter((m) => m <= maxMonth);
    const yearList = [...years].sort((a, b) => a - b);
    const labels = shownMonths.map((m) => MONTHS_SHORT[m - 1]);
    const datasets = yearList.map((y, i) => {
      const color = YEAR_PALETTE[i % YEAR_PALETTE.length];
      return {
        label: String(y),
        data: shownMonths.map((m) => counts.get(`${y}-${m}`) ?? 0),
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
      plugins: [valueOnBarsPlugin(text)],
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 20 } },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { labels: { color: text, boxWidth: 12 } },
          tooltip: { callbacks: { label: (c: { dataset: { label?: string }; parsed: { y: number | null } }) => `${c.dataset.label}: ${c.parsed.y ?? 0}` } },
        },
        scales: {
          x: { ticks: { color: text }, grid: { display: false }, title: { display: true, text: "Month", color: text } },
          y: { beginAtZero: true, ticks: { color: text, precision: 0 }, grid: { color: grid }, title: { display: true, text: "Complaints", color: text, font: { size: 11, weight: "bold" } } },
        },
      },
    } as unknown as ChartConfiguration;
    return { config: cfg, hasData: yearList.length > 0 };
  }, [records, period, type, text, grid]);

  const periodLabel = YOY_PERIODS.find((p) => p.value === period)?.label ?? "Full Year";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
          <span className="h-4 w-1 rounded-full bg-indigo-500" />
          {title} — {periodLabel}
        </h4>
        <div className="flex items-center gap-2">
          <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Month range" className={selectCls}>
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
      {hasData ? (
        <ChartCanvas config={config} height={400} ariaLabel={`${title} ${periodLabel} chart`} />
      ) : (
        <p className="py-12 text-center text-sm text-slate-400">No dated records for this period.</p>
      )}
    </div>
  );
}

/**
 * Refund amount by month, Internal vs SpotHero, for the latest data year. Two
 * series (Internal, SpotHero); bars are the summed refund magnitude per month.
 */
export function RefundBySourceChart({ records }: { records: FilteredRecord[] }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const text = dark ? "#cbd5e1" : "#475569";
  const grid = dark ? "rgba(148,163,184,0.16)" : "rgba(148,163,184,0.22)";
  const [period, setPeriod] = useState("h1");
  const [type, setType] = useState<"bar" | "line">("bar");

  const { config, hasData, year } = useMemo(() => {
    const months = YOY_PERIODS.find((p) => p.value === period)?.months ?? [];
    const monthSet = new Set(months);
    // Refunds for the latest data year (avoids mixing 2025 + 2026 in one bar).
    let maxYear = 0;
    for (const r of records) {
      const iso = toIsoDate(r.starts);
      if (iso) {
        const y = Number(iso.slice(0, 4));
        if (y > maxYear) maxYear = y;
      }
    }
    const internal = new Map<number, number>();
    const spothero = new Map<number, number>();
    for (const r of records) {
      const iso = toIsoDate(r.starts);
      if (!iso) continue;
      const [y, m] = iso.split("-").map(Number);
      if (y !== maxYear || !monthSet.has(m)) continue;
      const amt = Math.abs(r.refundAmount);
      if (!amt) continue;
      const bucket = r.source === "internal" ? internal : spothero;
      bucket.set(m, (bucket.get(m) ?? 0) + amt);
    }
    let maxMonth = 0;
    for (const m of [...internal.keys(), ...spothero.keys()]) if (m > maxMonth) maxMonth = m;
    const shownMonths = months.filter((m) => m <= maxMonth);
    const labels = shownMonths.map((m) => MONTHS_SHORT[m - 1]);
    const mk = (label: string, map: Map<number, number>, color: string) => ({
      label,
      data: shownMonths.map((m) => round1(map.get(m) ?? 0)),
      backgroundColor: color,
      borderColor: color,
      borderRadius: type === "bar" ? 4 : 0,
      tension: 0.3,
      fill: false,
      pointRadius: 3,
    });
    const datasets = [mk("Internal", internal, AMBER), mk("SpotHero", spothero, BLUE)];
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
          legend: { labels: { color: text, boxWidth: 12 } },
          tooltip: { callbacks: { label: (c: { dataset: { label?: string }; parsed: { y: number | null } }) => `${c.dataset.label}: ${formatCurrency(c.parsed.y ?? 0)}` } },
        },
        scales: {
          x: { ticks: { color: text }, grid: { display: false }, title: { display: true, text: "Month", color: text } },
          y: { beginAtZero: true, ticks: { color: text, callback: (v: string | number) => formatCurrency(Number(v)) }, grid: { color: grid }, title: { display: true, text: "Refunds", color: text, font: { size: 11, weight: "bold" } } },
        },
      },
    } as unknown as ChartConfiguration;
    return { config: cfg, hasData: shownMonths.length > 0, year: maxYear ? String(maxYear) : "" };
  }, [records, period, type, text, grid]);

  const periodLabel = YOY_PERIODS.find((p) => p.value === period)?.label ?? "Full Year";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
          <span className="h-4 w-1 rounded-full bg-indigo-500" />
          Refunds — Internal vs SpotHero{year ? ` · ${year}` : ""} — {periodLabel}
        </h4>
        <div className="flex items-center gap-2">
          <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Month range" className={selectCls}>
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
      {hasData ? (
        <ChartCanvas config={config} height={400} ariaLabel={`Refunds internal vs SpotHero ${periodLabel} chart`} />
      ) : (
        <p className="py-12 text-center text-sm text-slate-400">No refunds for this period.</p>
      )}
    </div>
  );
}

/**
 * Complaint rate (% of reservations) vs refund % of net remit, year-over-year.
 * Bars = complaint rate per year; dashed lines = refund % of net remit per year
 * (this year vs last year), by month.
 */
export function RateVsRefundChart({ monthly }: { monthly: MonthlyPoint[] }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const text = dark ? "#cbd5e1" : "#475569";
  const grid = dark ? "rgba(148,163,184,0.16)" : "rgba(148,163,184,0.22)";
  const [period, setPeriod] = useState("h1");

  const { config, hasData } = useMemo(() => {
    const months = YOY_PERIODS.find((p) => p.value === period)?.months ?? [];
    const monthSet = new Set(months);
    const byYM = new Map<string, MonthlyPoint>();
    let maxYear = 0;
    for (const p of monthly) {
      const y = Number(p.ym.slice(0, 4));
      if (y > maxYear) maxYear = y;
      byYM.set(p.ym, p);
    }
    const keepYears = [maxYear - 1, maxYear].filter(
      (y) => y > 0 && monthly.some((p) => Number(p.ym.slice(0, 4)) === y),
    );
    let maxMonth = 0;
    for (const p of monthly) {
      const y = Number(p.ym.slice(0, 4));
      const m = Number(p.ym.slice(5, 7));
      if (keepYears.includes(y) && monthSet.has(m) && (p.reservations > 0 || p.complaints > 0)) {
        if (m > maxMonth) maxMonth = m;
      }
    }
    const shownMonths = months.filter((m) => m <= maxMonth);
    const labels = shownMonths.map((m) => MONTHS_SHORT[m - 1]);
    const at = (y: number, m: number) => byYM.get(`${y}-${String(m).padStart(2, "0")}`);
    const rate = (y: number) =>
      shownMonths.map((m) => {
        const p = at(y, m);
        return p && p.reservations > 0 ? round1((p.complaints / p.reservations) * 100) : 0;
      });
    const refPct = (y: number) =>
      shownMonths.map((m) => {
        const p = at(y, m);
        return p && p.netRemit > 0 ? round1((Math.abs(p.refund) / p.netRemit) * 100) : 0;
      });
    const datasets: Record<string, unknown>[] = [];
    keepYears
      .sort((a, b) => a - b)
      .forEach((y, i) => {
        const color = YEAR_PALETTE[i % YEAR_PALETTE.length];
        datasets.push({ type: "bar", label: `Complaint rate ${y}`, data: rate(y), backgroundColor: color, borderColor: color, borderRadius: 4, order: 2 });
        datasets.push({ type: "line", label: `Refund % of net remit ${y}`, data: refPct(y), borderColor: color, backgroundColor: color, borderDash: [6, 4], tension: 0.3, pointRadius: 3, fill: false, order: 1 });
      });
    const cfg = {
      type: "bar",
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
    return { config: cfg, hasData: shownMonths.length > 0 && keepYears.length > 0 };
  }, [monthly, period, text, grid]);

  const periodLabel = YOY_PERIODS.find((p) => p.value === period)?.label ?? "Full Year";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
          <span className="h-4 w-1 rounded-full bg-indigo-500" />
          Complaint Rate vs Refund % of Net Remit — {periodLabel}
        </h4>
        <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Month range" className={selectCls}>
          {YOY_PERIODS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
        Bars = complaint rate (% of reservations) · dashed lines = refund % of net remit · this year vs last year.
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
 * Two year-over-year comparisons side by side — internal complaints and SpotHero
 * complaints, each this year vs last year by month.
 */
export default function ReportCharts({ records }: { records: FilteredRecord[] }) {
  const internal = useMemo(() => records.filter((r) => r.source === "internal"), [records]);
  const spothero = useMemo(() => records.filter((r) => r.source === "spothero"), [records]);
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <YearComparisonChart records={internal} title="Internal Complaints" />
      <YearComparisonChart records={spothero} title="SpotHero Complaints" />
    </div>
  );
}
