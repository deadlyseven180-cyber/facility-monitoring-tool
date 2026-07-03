"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCurrency } from "@/lib/format";
import type { FacilityFinancial } from "@/lib/complaints/store";

interface Period {
  fileName: string;
  period: string;
  uploadDate: string;
  netRemit: number;
  refund: number;
  reservations: number;
  lotFull: number;
  inacc: number;
  facilities: FacilityFinancial[];
}

/** Read-back of stored SpotHero figures (net remit, refunds, reservations,
 *  complaints) per uploaded period — no CSV re-upload needed. */
export default function StoredHistory() {
  const [fin, setFin] = useState<FacilityFinancial[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/spothero-history")
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok && Array.isArray(j.financials)) setFin(j.financials);
        else setError(j?.error || "Could not load history.");
      })
      .catch(() => setError("Could not load history."))
      .finally(() => setLoading(false));
  }, []);

  const periods = useMemo<Period[]>(() => {
    const m = new Map<string, Period>();
    for (const f of fin) {
      const e = m.get(f.fileName) ?? {
        fileName: f.fileName, period: f.period, uploadDate: f.uploadDate,
        netRemit: 0, refund: 0, reservations: 0, lotFull: 0, inacc: 0, facilities: [],
      };
      e.netRemit += f.netRemit; e.refund += f.refund; e.reservations += f.reservations;
      e.lotFull += f.lotFull; e.inacc += f.inacc; e.facilities.push(f);
      if (!e.period && f.period) e.period = f.period;
      m.set(f.fileName, e);
    }
    return [...m.values()].sort((a, b) => (b.uploadDate || "").localeCompare(a.uploadDate || ""));
  }, [fin]);

  if (loading) return <p className="py-12 text-center text-sm text-slate-400">Loading stored history…</p>;
  if (error) return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>;
  if (periods.length === 0)
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm text-slate-500 dark:text-slate-400">No stored history yet. Generate a report from a SpotHero CSV and its figures (net remit, refunds, reservations, complaints) are saved here automatically — no re-upload needed next time.</p>
      </div>
    );

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500 dark:text-slate-400">Every uploaded SpotHero period is saved to your Google Sheet database. Click a period to see its per-facility figures — no CSV re-upload needed.</p>
      {periods.map((p) => {
        const isOpen = open === p.fileName;
        return (
          <div key={p.fileName} className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <button type="button" onClick={() => setOpen(isOpen ? null : p.fileName)} className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-4 text-left">
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-800 dark:text-slate-100">{p.period || p.fileName}</p>
                <p className="truncate text-xs text-slate-400" title={p.fileName}>{p.fileName} · uploaded {p.uploadDate?.slice(0, 10)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                <Metric label="Net Remit" value={formatCurrency(p.netRemit)} strong />
                <Metric label="Refunds" value={formatCurrency(p.refund)} />
                <Metric label="Reservations" value={p.reservations.toLocaleString()} />
                <Metric label="Lot Full / Inacc." value={`${p.lotFull} / ${p.inacc}`} />
                <span className="text-slate-400">{isOpen ? "▲" : "▼"}</span>
              </div>
            </button>
            {isOpen && (
              <div className="overflow-x-auto border-t border-slate-100 dark:border-slate-800">
                <table className="min-w-full text-sm">
                  <thead><tr className="text-left text-xs uppercase text-slate-400"><th className="px-5 py-2">Facility</th><th className="px-3">State</th><th className="px-3 text-right">Net Remit</th><th className="px-3 text-right">Refunds</th><th className="px-3 text-right">Reservations</th><th className="px-3 text-right">Lot Full</th><th className="px-3 text-right">Inacc.</th></tr></thead>
                  <tbody>
                    {[...p.facilities].sort((a, b) => b.netRemit - a.netRemit).map((f, i) => (
                      <tr key={`${f.facility}-${i}`} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="max-w-[240px] truncate px-5 py-1.5 font-medium text-slate-700 dark:text-slate-200" title={f.facility}>{f.facility}</td>
                        <td className="px-3 text-slate-500">{f.state || "—"}</td>
                        <td className="px-3 text-right tabular-nums">{formatCurrency(f.netRemit)}</td>
                        <td className="px-3 text-right tabular-nums text-slate-500">{formatCurrency(f.refund)}</td>
                        <td className="px-3 text-right tabular-nums text-slate-500">{f.reservations}</td>
                        <td className="px-3 text-right tabular-nums">{f.lotFull}</td>
                        <td className="px-3 text-right tabular-nums">{f.inacc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Metric({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <span className="flex flex-col leading-tight">
      <span className="text-[10px] uppercase tracking-wide text-slate-400">{label}</span>
      <span className={strong ? "font-bold text-slate-900 dark:text-slate-100" : "font-medium text-slate-600 dark:text-slate-300"}>{value}</span>
    </span>
  );
}
