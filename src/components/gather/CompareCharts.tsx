"use client";

import { useMemo } from "react";
import type { ChartConfiguration } from "chart.js/auto";
import ChartCanvas from "@/components/shared/ChartCanvas";
import { useTheme } from "@/components/theme/ThemeProvider";
import { formatCurrency } from "@/lib/format";
import type { ReportResult } from "@/types/report";

const A_COLOR = "#6366f1"; // indigo
const B_COLOR = "#14b8a6"; // teal

function truncTick(
  this: { getLabelForValue(v: number): string },
  value: string | number,
): string {
  const l = this.getLabelForValue(Number(value));
  return l.length > 16 ? `${l.slice(0, 15)}…` : l;
}

/** Build {labels, a[], b[]} for a metric, unioned across both periods, top N. */
function pair(
  aItems: { key: string; val: number }[],
  bItems: { key: string; val: number }[],
  topN?: number,
): { labels: string[]; a: number[]; b: number[] } {
  const am = new Map(aItems.map((x) => [x.key, x.val]));
  const bm = new Map(bItems.map((x) => [x.key, x.val]));
  let keys = [...new Set([...am.keys(), ...bm.keys()])];
  keys.sort(
    (k1, k2) =>
      (bm.get(k2) ?? 0) + (am.get(k2) ?? 0) - ((bm.get(k1) ?? 0) + (am.get(k1) ?? 0)),
  );
  if (topN) keys = keys.slice(0, topN);
  return {
    labels: keys,
    a: keys.map((k) => am.get(k) ?? 0),
    b: keys.map((k) => bm.get(k) ?? 0),
  };
}

export default function CompareCharts({
  a,
  b,
  labelA,
  labelB,
}: {
  a: ReportResult;
  b: ReportResult;
  labelA: string;
  labelB: string;
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const text = dark ? "#cbd5e1" : "#475569";
  const grid = dark ? "rgba(148,163,184,0.16)" : "rgba(148,163,184,0.22)";

  const grouped = (
    labels: string[],
    aData: number[],
    bData: number[],
    money: boolean,
    truncate: boolean,
  ): ChartConfiguration =>
    ({
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: labelA, data: aData, backgroundColor: A_COLOR, borderRadius: 3 },
          { label: labelB, data: bData, backgroundColor: B_COLOR, borderRadius: 3 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { labels: { color: text, boxWidth: 12 } },
          tooltip: money
            ? {
                callbacks: {
                  label: (c: { dataset: { label?: string }; parsed: { y: number } }) =>
                    `${c.dataset.label}: ${formatCurrency(c.parsed.y ?? 0)}`,
                },
              }
            : {},
        },
        scales: {
          x: {
            ticks: {
              color: text,
              maxRotation: 45,
              minRotation: truncate ? 45 : 0,
              font: { size: 11 },
              ...(truncate ? { callback: truncTick } : {}),
            },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            ticks: {
              color: text,
              precision: money ? undefined : 0,
              ...(money
                ? { callback: (v: string | number) => formatCurrency(Number(v)) }
                : {}),
            },
            grid: { color: grid },
          },
        },
      },
    }) as unknown as ChartConfiguration;

  const lotFullByState = useMemo(() => {
    const p = pair(
      a.states.map((s) => ({ key: s.state, val: s.incidentCount })),
      b.states.map((s) => ({ key: s.state, val: s.incidentCount })),
    );
    return grouped(p.labels, p.a, p.b, false, false);
  }, [a, b, text, grid, labelA, labelB]);

  const lotFullByFacility = useMemo(() => {
    const p = pair(
      a.facilities.map((f) => ({ key: f.facility, val: f.incidentCount })),
      b.facilities.map((f) => ({ key: f.facility, val: f.incidentCount })),
      10,
    );
    return grouped(p.labels, p.a, p.b, false, true);
  }, [a, b, text, grid, labelA, labelB]);

  const refundByState = useMemo(() => {
    const p = pair(
      a.states.map((s) => ({ key: s.state, val: s.refundTotal })),
      b.states.map((s) => ({ key: s.state, val: s.refundTotal })),
    );
    return grouped(p.labels, p.a, p.b, true, false);
  }, [a, b, text, grid, labelA, labelB]);

  const scoreByFacility = useMemo(() => {
    const p = pair(
      a.facilities.map((f) => ({ key: f.facility, val: f.priorityScore })),
      b.facilities.map((f) => ({ key: f.facility, val: f.priorityScore })),
      10,
    );
    return grouped(p.labels, p.a, p.b, false, true);
  }, [a, b, text, grid, labelA, labelB]);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card title="Lot Full by State">
        <ChartCanvas config={lotFullByState} height={320} />
      </Card>
      <Card title="Lot Full by Facility (Top 10)">
        <ChartCanvas config={lotFullByFacility} height={320} />
      </Card>
      <Card title="Refund Total by State">
        <ChartCanvas config={refundByState} height={320} />
      </Card>
      <Card title="Priority Score by Facility (Top 10)">
        <ChartCanvas config={scoreByFacility} height={320} />
      </Card>
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h4 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
        <span className="h-4 w-1 rounded-full bg-indigo-500" />
        {title}
      </h4>
      {children}
    </div>
  );
}
