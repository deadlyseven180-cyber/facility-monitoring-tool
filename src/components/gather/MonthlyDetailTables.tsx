"use client";

import type { MonthlyDetail } from "@/types/report";
import { formatCurrency } from "@/lib/format";

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
/** Primary markets shown in the monthly tables. */
const MARKETS = ["MA", "IL", "DC"];

function groupDetail(detail: MonthlyDetail[], stateFilter: string) {
  const wanted = stateFilter !== "All" ? [stateFilter] : MARKETS;
  const years = [...new Set(detail.map((d) => Number(d.ym.slice(0, 4))))]
    .sort((a, b) => b - a)
    .slice(0, 2)
    .sort((a, b) => b - a);
  const out: { state: string; year: number; rows: MonthlyDetail[] }[] = [];
  for (const st of wanted) {
    for (const yr of years) {
      const rows = detail
        .filter((d) => d.state === st && Number(d.ym.slice(0, 4)) === yr)
        .sort((a, b) => a.ym.localeCompare(b.ym));
      if (rows.length) out.push({ state: st, year: yr, rows });
    }
  }
  return out;
}

/**
 * Month-by-month tables per MA/IL/DC state and the two most recent years —
 * reservations, complaints (with SpotHero vs Internal split), rate, refunds,
 * refund %, net remit. When a specific state is filtered, only that state shows.
 */
export default function MonthlyDetailTables({
  detail,
  stateFilter,
}: {
  detail: MonthlyDetail[];
  stateFilter: string;
}) {
  const groups = groupDetail(detail, stateFilter);
  if (!groups.length) {
    return (
      <p className="py-6 text-center text-sm text-slate-400">
        No MA / IL / DC monthly data for this selection.
      </p>
    );
  }
  return (
    <div className="space-y-5">
      {groups.map(({ state, year, rows }) => {
        let tRes = 0, tS = 0, tI = 0, tRef = 0, tRem = 0;
        const bodyRows = rows.map((d) => {
          const total = d.spotHeroComplaints + d.internalComplaints;
          const rate = d.reservations > 0 ? (total / d.reservations) * 100 : 0;
          const ref = Math.abs(d.refund);
          const refPct = d.netRemit > 0 ? (ref / d.netRemit) * 100 : 0;
          tRes += d.reservations; tS += d.spotHeroComplaints; tI += d.internalComplaints; tRef += ref; tRem += d.netRemit;
          return (
            <tr key={d.ym} className="border-t border-slate-100 dark:border-slate-800">
              <td className="px-3 py-1.5 text-left font-medium text-slate-600 dark:text-slate-300">{MONTH_ABBR[Number(d.ym.slice(5, 7)) - 1]}</td>
              <td className="px-3 text-right tabular-nums">{d.reservations.toLocaleString()}</td>
              <td className="px-3 text-right tabular-nums text-blue-600 dark:text-blue-400">{d.spotHeroComplaints}</td>
              <td className="px-3 text-right tabular-nums text-amber-600 dark:text-amber-400">{d.internalComplaints}</td>
              <td className="px-3 text-right font-semibold tabular-nums">{total}</td>
              <td className="px-3 text-right tabular-nums">{rate.toFixed(2)}%</td>
              <td className="px-3 text-right tabular-nums">{formatCurrency(ref)}</td>
              <td className="px-3 text-right tabular-nums">{refPct.toFixed(2)}%</td>
              <td className="px-3 text-right tabular-nums">{formatCurrency(d.netRemit)}</td>
            </tr>
          );
        });
        const tTotal = tS + tI;
        const tRate = tRes > 0 ? (tTotal / tRes) * 100 : 0;
        const tRefPct = tRem > 0 ? (tRef / tRem) * 100 : 0;
        return (
          <div key={`${state}-${year}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h4 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
              {state} — {year}
            </h4>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="text-right text-[10px] uppercase tracking-wide text-slate-400">
                    <th className="px-3 py-1.5 text-left">Month</th>
                    <th className="px-3">Reservations</th>
                    <th className="px-3">SpotHero</th>
                    <th className="px-3">Internal</th>
                    <th className="px-3">Total</th>
                    <th className="px-3">Rate</th>
                    <th className="px-3">Refunds</th>
                    <th className="px-3">Refund %</th>
                    <th className="px-3">Net Remit</th>
                  </tr>
                </thead>
                <tbody>
                  {bodyRows}
                  <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-100">
                    <td className="px-3 py-1.5 text-left">TOTAL</td>
                    <td className="px-3 text-right tabular-nums">{tRes.toLocaleString()}</td>
                    <td className="px-3 text-right tabular-nums">{tS}</td>
                    <td className="px-3 text-right tabular-nums">{tI}</td>
                    <td className="px-3 text-right tabular-nums">{tTotal}</td>
                    <td className="px-3 text-right tabular-nums">{tRate.toFixed(2)}%</td>
                    <td className="px-3 text-right tabular-nums">{formatCurrency(tRef)}</td>
                    <td className="px-3 text-right tabular-nums">{tRefPct.toFixed(2)}%</td>
                    <td className="px-3 text-right tabular-nums">{formatCurrency(tRem)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
