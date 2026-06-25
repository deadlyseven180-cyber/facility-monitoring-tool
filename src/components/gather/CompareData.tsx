"use client";

import { useMemo, useState } from "react";
import MultiFileUpload from "@/components/shared/MultiFileUpload";
import DateRangeFilter from "@/components/shared/DateRangeFilter";
import CompareCharts from "./CompareCharts";
import {
  analyzeReport,
  classifyReport,
  type DateRange,
  type ReportSource,
} from "@/lib/reports/analyze";
import { mergeReportFiles, MERGED_COLUMNS } from "@/lib/reports/merge";
import { LOT_FULL_FILTER } from "@/lib/reports/filters";
import { toIsoDate } from "@/lib/reports/columns";
import { formatCurrency } from "@/lib/format";
import type { ParsedCsv } from "@/types/data";
import type { ReportResult } from "@/types/report";

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Merge one period's uploaded files into a single dataset (null if empty). */
function mergePeriod(files: ParsedCsv[]): ParsedCsv | null {
  if (files.length === 0) return null;
  try {
    return mergeReportFiles(
      files.map((f) => ({
        data: f,
        source: (classifyReport(f.fileName) ?? "spothero") as ReportSource,
      })),
    );
  } catch {
    return null;
  }
}

/** Run the Lot Full analysis on a merged period, scoped to a date range. */
function analyzePeriod(
  merged: ParsedCsv | null,
  dateRange?: DateRange,
): ReportResult | null {
  if (!merged) return null;
  try {
    return analyzeReport(merged, LOT_FULL_FILTER, {
      columns: MERGED_COLUMNS,
      dateRange,
    });
  } catch {
    return null;
  }
}

/** Earliest dated record (ISO) in a period, or null. */
function earliestIso(r: ReportResult): string | null {
  let min: string | null = null;
  for (const rec of r.records) {
    const d = toIsoDate(rec.starts);
    if (d && (min === null || d < min)) min = d;
  }
  return min;
}

function periodLabel(r: ReportResult, fallback: string): string {
  let min: string | null = null;
  let max: string | null = null;
  for (const rec of r.records) {
    const d = toIsoDate(rec.starts);
    if (!d) continue;
    if (min === null || d < min) min = d;
    if (max === null || d > max) max = d;
  }
  if (!min || !max) return fallback;
  const fmt = (iso: string) => {
    const [y, m] = iso.split("-").map(Number);
    return `${MONTHS_SHORT[(m || 1) - 1]} ${y}`;
  };
  return fmt(min) === fmt(max) ? fmt(min) : `${fmt(min)} – ${fmt(max)}`;
}

type Kind = "count" | "money" | "percent";
interface MetricDef {
  label: string;
  kind: Kind;
  get: (r: ReportResult) => number;
}

const METRICS: MetricDef[] = [
  { label: "Lot Full Incidents", kind: "count", get: (r) => r.totals.incidentCount },
  { label: "Total Net Remit", kind: "money", get: (r) => r.totals.netRemitTotal },
  { label: "Total Lot Full Refunds", kind: "money", get: (r) => r.totals.refundTotal },
  { label: "SpotHero Lot Full", kind: "count", get: (r) => r.totals.spotHeroLotFull },
  { label: "Internal Lot Full", kind: "count", get: (r) => r.totals.internalLotFull },
  {
    label: "Complaint Rate",
    kind: "percent",
    get: (r) =>
      r.totals.reservations > 0
        ? (r.totals.incidentCount / r.totals.reservations) * 100
        : 0,
  },
  {
    label: "Average Revenue",
    kind: "money",
    get: (r) =>
      r.totals.reservations > 0 ? r.totals.netRemitTotal / r.totals.reservations : 0,
  },
  {
    label: "Refund Rate",
    kind: "percent",
    get: (r) =>
      r.totals.netRemitTotal > 0
        ? (r.totals.refundAllTotal / r.totals.netRemitTotal) * 100
        : 0,
  },
];

function fmtVal(kind: Kind, v: number): string {
  if (kind === "money") return formatCurrency(v);
  if (kind === "percent") return `${v.toFixed(2)}%`;
  return String(Math.round(v));
}

function fmtDelta(kind: Kind, d: number): string {
  const sign = d >= 0 ? "+" : "−";
  const a = Math.abs(d);
  if (kind === "money") return sign + formatCurrency(a);
  if (kind === "percent") return `${sign}${a.toFixed(2)} pts`;
  return sign + Math.round(a);
}

export default function CompareData() {
  const [filesA, setFilesA] = useState<ParsedCsv[]>([]);
  const [filesB, setFilesB] = useState<ParsedCsv[]>([]);
  const [dateRangeA, setDateRangeA] = useState<DateRange>({});
  const [dateRangeB, setDateRangeB] = useState<DateRange>({});
  const [compared, setCompared] = useState(false);

  const mergedA = useMemo(() => mergePeriod(filesA), [filesA]);
  const mergedB = useMemo(() => mergePeriod(filesB), [filesB]);
  const resultA = useMemo(
    () => analyzePeriod(mergedA, dateRangeA),
    [mergedA, dateRangeA],
  );
  const resultB = useMemo(
    () => analyzePeriod(mergedB, dateRangeB),
    [mergedB, dateRangeB],
  );
  const ready = Boolean(resultA && resultB);

  function clear() {
    setCompared(false);
    setFilesA([]);
    setFilesB([]);
    setDateRangeA({});
    setDateRangeB({});
  }

  // Order the two periods chronologically (earlier → later) regardless of which
  // side they were uploaded to.
  const ordered = useMemo(() => {
    if (!resultA || !resultB) return null;
    const ka = earliestIso(resultA);
    const kb = earliestIso(resultB);
    const swap = Boolean(ka && kb && ka > kb);
    const a = swap ? resultB : resultA;
    const b = swap ? resultA : resultB;
    return {
      a,
      b,
      labelA: periodLabel(a, "Period A"),
      labelB: periodLabel(b, "Period B"),
    };
  }, [resultA, resultB]);

  return (
    <div className="space-y-6">
      {!compared || !resultA || !resultB ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Compare Data
          </h2>
          <p className="mb-5 mt-1 text-sm text-slate-500 dark:text-slate-400">
            Upload the CSVs for two reporting periods (multiple files allowed per
            period). They run through the same Lot Full analysis and are compared
            side by side.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-3">
              <MultiFileUpload
                label="Period A"
                value={filesA}
                onChange={setFilesA}
                checkDuplicateDateRange
                validate={(d) =>
                  classifyReport(d.fileName)
                    ? null
                    : "Unsupported file. The name must begin with “cp_accounting_detail” or “REFUNDS&REIMBURSEMENT”."
                }
              />
              {filesA.some((f) => classifyReport(f.fileName) === "internal") && (
                <DateRangeFilter
                  label="Date range"
                  value={dateRangeA}
                  onChange={setDateRangeA}
                />
              )}
            </div>
            <div className="space-y-3">
              <MultiFileUpload
                label="Period B"
                value={filesB}
                onChange={setFilesB}
                checkDuplicateDateRange
                validate={(d) =>
                  classifyReport(d.fileName)
                    ? null
                    : "Unsupported file. The name must begin with “cp_accounting_detail” or “REFUNDS&REIMBURSEMENT”."
                }
              />
              {filesB.some((f) => classifyReport(f.fileName) === "internal") && (
                <DateRangeFilter
                  label="Date range"
                  value={dateRangeB}
                  onChange={setDateRangeB}
                />
              )}
            </div>
          </div>

          <button
            type="button"
            disabled={!ready}
            onClick={() => setCompared(true)}
            className="mt-5 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-700"
          >
            Compare Periods
          </button>
        </div>
      ) : (
        ordered && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {ordered.labelA}{" "}
              <span className="text-slate-400 dark:text-slate-500">vs</span>{" "}
              {ordered.labelB}
            </h2>
            <button
              type="button"
              onClick={clear}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              Clear Data
            </button>
          </div>
        )
      )}

      {compared && ordered && (
        <>
          <Insights
            a={ordered.a}
            b={ordered.b}
            labelA={ordered.labelA}
            labelB={ordered.labelB}
          />
          <KpiTable
            a={ordered.a}
            b={ordered.b}
            labelA={ordered.labelA}
            labelB={ordered.labelB}
          />
          <section>
            <h3 className="mb-3 text-base font-semibold text-slate-900 dark:text-slate-100">
              Comparison Charts
            </h3>
            <CompareCharts
              a={ordered.a}
              b={ordered.b}
              labelA={ordered.labelA}
              labelB={ordered.labelB}
            />
          </section>
        </>
      )}
    </div>
  );
}

/* ----------------------------- KPI table ----------------------------- */

function KpiTable({
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
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-slate-50 text-left dark:bg-slate-800/60">
            <th className="px-4 py-2.5 font-semibold text-slate-600 dark:text-slate-300">
              Metric
            </th>
            <th className="px-4 py-2.5 text-right font-semibold text-slate-600 dark:text-slate-300">
              {labelA}
            </th>
            <th className="px-4 py-2.5 text-right font-semibold text-slate-600 dark:text-slate-300">
              {labelB}
            </th>
            <th className="px-4 py-2.5 text-right font-semibold text-slate-600 dark:text-slate-300">
              Change
            </th>
          </tr>
        </thead>
        <tbody>
          {METRICS.map((m) => {
            const va = m.get(a);
            const vb = m.get(b);
            const delta = vb - va;
            const pct = va !== 0 ? (delta / va) * 100 : vb > 0 ? 100 : 0;
            const up = delta > 0;
            const flat = Math.abs(delta) < 1e-9;
            return (
              <tr
                key={m.label}
                className="border-t border-slate-100 dark:border-slate-800"
              >
                <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-slate-100">
                  {m.label}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-700 dark:text-slate-300">
                  {fmtVal(m.kind, va)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-700 dark:text-slate-300">
                  {fmtVal(m.kind, vb)}
                </td>
                <td
                  className={`px-4 py-2.5 text-right tabular-nums font-semibold ${
                    flat
                      ? "text-slate-400 dark:text-slate-500"
                      : up
                        ? "text-rose-600 dark:text-rose-400"
                        : "text-emerald-600 dark:text-emerald-400"
                  }`}
                >
                  {flat ? "—" : `${fmtDelta(m.kind, delta)} (${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(0)}%)`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ----------------------------- Insights ----------------------------- */

function diffByKey(
  aItems: { key: string; val: number }[],
  bItems: { key: string; val: number }[],
): { key: string; a: number; b: number; delta: number }[] {
  const am = new Map(aItems.map((x) => [x.key, x.val]));
  const bm = new Map(bItems.map((x) => [x.key, x.val]));
  const keys = [...new Set([...am.keys(), ...bm.keys()])];
  return keys.map((key) => {
    const av = am.get(key) ?? 0;
    const bv = bm.get(key) ?? 0;
    return { key, a: av, b: bv, delta: bv - av };
  });
}

function Insights({
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
  const stateDiff = diffByKey(
    a.states.map((s) => ({ key: s.state, val: s.incidentCount })),
    b.states.map((s) => ({ key: s.state, val: s.incidentCount })),
  );
  const refundDiff = diffByKey(
    a.facilities.map((f) => ({ key: f.facility, val: f.refundColumnTotal })),
    b.facilities.map((f) => ({ key: f.facility, val: f.refundColumnTotal })),
  );
  const scoreDiff = diffByKey(
    a.facilities.map((f) => ({ key: f.facility, val: f.priorityScore })),
    b.facilities.map((f) => ({ key: f.facility, val: f.priorityScore })),
  );

  const maxBy = <T,>(arr: T[], val: (t: T) => number): T | null =>
    arr.length ? arr.reduce((m, x) => (val(x) > val(m) ? x : m)) : null;
  const minBy = <T,>(arr: T[], val: (t: T) => number): T | null =>
    arr.length ? arr.reduce((m, x) => (val(x) < val(m) ? x : m)) : null;

  const incUp = maxBy(stateDiff, (d) => d.delta);
  const incDown = minBy(stateDiff, (d) => d.delta);
  const refUp = maxBy(refundDiff, (d) => d.delta);
  const scoreUp = maxBy(scoreDiff, (d) => d.delta);
  const riskiest = maxBy(b.facilities, (f) => f.priorityScore);

  const cards: { title: string; body: string; tone: "red" | "green" | "amber" | "indigo" }[] =
    [];
  if (incUp && incUp.delta > 0)
    cards.push({
      title: "Largest Lot Full increase (state)",
      tone: "red",
      body: `${incUp.key}: ${incUp.a} → ${incUp.b} (+${incUp.delta})`,
    });
  if (incDown && incDown.delta < 0)
    cards.push({
      title: "Largest Lot Full decrease (state)",
      tone: "green",
      body: `${incDown.key}: ${incDown.a} → ${incDown.b} (${incDown.delta})`,
    });
  if (refUp && refUp.delta > 0)
    cards.push({
      title: "Largest refund increase (facility)",
      tone: "amber",
      body: `${refUp.key}: ${formatCurrency(refUp.a)} → ${formatCurrency(refUp.b)}`,
    });
  if (scoreUp && scoreUp.delta > 0)
    cards.push({
      title: "Largest priority-score increase (facility)",
      tone: "red",
      body: `${scoreUp.key}: ${scoreUp.a.toFixed(1)} → ${scoreUp.b.toFixed(1)}`,
    });
  if (riskiest)
    cards.push({
      title: `Highest-risk facility (${labelB})`,
      tone: "indigo",
      body: `${riskiest.facility} — score ${riskiest.priorityScore.toFixed(1)} (${riskiest.priorityLevel})`,
    });

  if (cards.length === 0) return null;

  const toneMap = {
    red: "border-rose-200 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10",
    green:
      "border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10",
    amber:
      "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10",
    indigo:
      "border-indigo-200 bg-indigo-50 dark:border-indigo-500/30 dark:bg-indigo-500/10",
  };

  return (
    <section>
      <h3 className="mb-3 text-base font-semibold text-slate-900 dark:text-slate-100">
        Executive Insights
        <span className="ml-2 text-sm font-normal text-slate-400 dark:text-slate-500">
          {labelA} → {labelB}
        </span>
      </h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <div
            key={c.title}
            className={`rounded-xl border p-4 ${toneMap[c.tone]}`}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {c.title}
            </p>
            <p className="mt-1 text-sm font-medium text-slate-800 dark:text-slate-100">
              {c.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
