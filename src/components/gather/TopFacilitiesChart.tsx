"use client";

import { useMemo, useState } from "react";
import type { ChartConfiguration, TooltipItem } from "chart.js/auto";
import ChartCanvas from "@/components/shared/ChartCanvas";
import { useTheme } from "@/components/theme/ThemeProvider";
import { priorityLevelFromCount } from "@/lib/reports/scoring";
import { toIsoDate } from "@/lib/reports/columns";
import type { PriorityLevel, ReportResult } from "@/types/report";

const TIER_COLOR: Record<PriorityLevel, string> = {
  Critical: "#ef4444",
  High: "#f97316",
  Medium: "#f59e0b",
  Low: "#22c55e",
};
// Distinct colors for the top 5 facilities in the bi-weekly view.
const PALETTE = ["#6366f1", "#3b82f6", "#14b8a6", "#f59e0b", "#ef4444"];

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const DAY_MS = 86_400_000;
const EPOCH = Date.UTC(2024, 0, 1); // a Monday
const pad = (n: number) => String(n).padStart(2, "0");

type View = "facility" | "biweekly";

/** Start (key) + label of the fixed 2-week block a date falls in. */
function biweek(starts: string): { key: string; label: string } | null {
  const iso = toIsoDate(starts);
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const block = Math.floor((ms - EPOCH) / (14 * DAY_MS)) * 14;
  const s = new Date(EPOCH + block * DAY_MS);
  return {
    key: `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}-${pad(s.getUTCDate())}`,
    label: `${MONTHS_SHORT[s.getUTCMonth()]} ${s.getUTCDate()}`,
  };
}

const trunc = (s: string) => (s.length > 20 ? `${s.slice(0, 19)}…` : s);

const selectCls =
  "rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:ring-indigo-500/30";

/**
 * Attention chart for one issue category. Default view = top facilities by
 * complaints; the dropdown switches to each of those top facilities' complaints
 * stacked by 2-week period.
 */
export default function TopFacilitiesChart({
  result,
  category,
  limit = 5,
}: {
  result: ReportResult;
  category: "lot_full" | "inaccessibility";
  limit?: number;
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const text = dark ? "#cbd5e1" : "#475569";
  const grid = dark ? "rgba(148,163,184,0.16)" : "rgba(148,163,184,0.22)";

  const [view, setView] = useState<View>("facility");
  const catLabel = category === "lot_full" ? "Lot Full" : "Inaccessibility";

  const records = useMemo(
    () => result.records.filter((r) => r.category === category),
    [result, category],
  );

  // Top facilities by complaint count.
  const topFac = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of records) m.set(r.facility, (m.get(r.facility) ?? 0) + 1);
    return [...m.entries()]
      .map(([facility, count]) => ({ facility, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }, [records, limit]);

  // Top facilities' complaints, bucketed by 2-week period.
  const biweekly = useMemo(() => {
    const top = new Set(topFac.map((f) => f.facility));
    const labels = new Map<string, string>();
    const byFac = new Map<string, Map<string, number>>();
    for (const r of records) {
      if (!top.has(r.facility)) continue;
      const b = biweek(r.starts);
      if (!b) continue;
      labels.set(b.key, b.label);
      const fm = byFac.get(r.facility) ?? new Map<string, number>();
      fm.set(b.key, (fm.get(b.key) ?? 0) + 1);
      byFac.set(r.facility, fm);
    }
    const keys = [...labels.keys()].sort();
    return { keys, labels, byFac };
  }, [records, topFac]);

  const config = useMemo<ChartConfiguration>(() => {
    if (view === "facility") {
      return {
        type: "bar",
        data: {
          labels: topFac.map((f) => f.facility),
          datasets: [
            {
              label: "Complaints",
              data: topFac.map((f) => f.count),
              backgroundColor: topFac.map(
                (f) => TIER_COLOR[priorityLevelFromCount(f.count)],
              ),
              borderRadius: 4,
            },
          ],
        },
        options: {
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (c: TooltipItem<"bar">) => {
                  const f = topFac[c.dataIndex];
                  return `${priorityLevelFromCount(f.count)} · ${c.parsed.x} complaints`;
                },
              },
            },
          },
          scales: {
            x: {
              beginAtZero: true,
              ticks: { color: text, precision: 0 },
              grid: { color: grid },
              title: { display: true, text: "Complaints", color: text },
            },
            y: {
              ticks: {
                color: text,
                font: { size: 11 },
                callback: function (
                  this: { getLabelForValue(v: number): string },
                  value: string | number,
                ) {
                  const l = this.getLabelForValue(Number(value));
                  return l.length > 22 ? `${l.slice(0, 21)}…` : l;
                },
              },
              grid: { display: false },
            },
          },
        },
      } as unknown as ChartConfiguration;
    }

    // Bi-weekly: grouped (parallel) bars — one bar per top facility, side by
    // side within each 2-week period.
    return {
      type: "bar",
      data: {
        labels: biweekly.keys.map((k) => biweekly.labels.get(k)),
        datasets: topFac.map((f, i) => ({
          label: trunc(f.facility),
          data: biweekly.keys.map((k) => biweekly.byFac.get(f.facility)?.get(k) ?? 0),
          backgroundColor: PALETTE[i % PALETTE.length],
          borderRadius: 3,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { labels: { color: text, boxWidth: 12, font: { size: 10 } } },
          tooltip: {
            callbacks: {
              label: (c: TooltipItem<"bar">) =>
                `${c.dataset.label}: ${c.parsed.y} complaints`,
            },
          },
        },
        scales: {
          x: {
            stacked: false,
            ticks: { color: text, font: { size: 10 }, maxRotation: 45 },
            grid: { display: false },
            title: { display: true, text: "2-week period", color: text },
          },
          y: {
            stacked: false,
            beginAtZero: true,
            ticks: { color: text, precision: 0 },
            grid: { color: grid },
            title: { display: true, text: "Complaints", color: text, font: { size: 11, weight: "bold" } },
          },
        },
      },
    } as unknown as ChartConfiguration;
  }, [view, topFac, biweekly, text, grid]);

  const title =
    view === "facility"
      ? `Top ${limit} ${catLabel}`
      : `Top ${limit} ${catLabel} — Every 2 Weeks`;
  const empty =
    view === "facility" ? topFac.length === 0 : biweekly.keys.length === 0;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
          <span className="h-4 w-1 rounded-full bg-indigo-500" />
          {title}
        </h4>
        <select
          value={view}
          onChange={(e) => setView(e.target.value as View)}
          aria-label="View"
          className={selectCls}
        >
          <option value="facility">By Facility (Top {limit})</option>
          <option value="biweekly">Every 2 Weeks</option>
        </select>
      </div>
      {empty ? (
        <p className="py-10 text-center text-sm text-slate-400 dark:text-slate-500">
          No {catLabel} complaints in the current view.
        </p>
      ) : (
        <ChartCanvas
          config={config}
          height={view === "facility" ? Math.max(topFac.length * 34, 130) : 260}
          ariaLabel={title}
        />
      )}
    </div>
  );
}
