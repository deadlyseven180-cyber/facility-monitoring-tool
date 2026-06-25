"use client";

import { useState } from "react";

const PAT_KEY = "airtablePat";

interface DayCell {
  date: string;
  available: number;
}
interface MonthlyB {
  reservationId: string;
  category: string;
  start: string;
  end: string;
}
interface TransientB {
  reservationId: string;
  facility: string;
  start: string;
  end: string;
  source: string;
}
interface Overbooked {
  name: string;
  stalls: number;
  overbookedBy: number;
  worstDate: string;
  peakOccupied: number;
  worstDay: { monthly: number; transient: number; occupied: number };
  monthlyActive: number;
  monthlyInactive: number;
  monthlyCancelled: number;
  monthly: MonthlyB[];
  transient: TransientB[];
  days: DayCell[];
}
interface ScanAll {
  scannedAt?: string;
  facilitiesScanned?: number;
  windowDays?: number;
  overbooked?: Overbooked[];
  error?: string;
}

function fmtDate(s: string): string {
  if (!s) return "—";
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  const d = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    : new Date(Date.parse(s));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function fmtDT(s: string): string {
  if (!s) return "—";
  const t = Date.parse(s);
  if (Number.isNaN(t)) return s;
  return new Date(t).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function cellBg(a: number): string {
  if (a < 0) return "bg-rose-500";
  if (a === 0) return "bg-rose-400";
  if (a <= 3) return "bg-amber-500";
  return "bg-emerald-500";
}

function catBadge(category: string) {
  const map: Record<string, string> = {
    active: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300",
    inactive: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
    cancelled: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
  };
  const label = category.charAt(0).toUpperCase() + category.slice(1);
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${map[category] ?? map.active}`}>
      {label}
    </span>
  );
}

function sourcePill(s: string) {
  const cls = /spothero/i.test(s)
    ? "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300"
    : "bg-slate-200 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>
      {s || "Other"}
    </span>
  );
}

export default function AllFacilities() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ScanAll | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  function toggle(name: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function scan() {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem(PAT_KEY);
      const res = await fetch("/api/ob-scan-all", {
        cache: "no-store",
        headers: token ? { "x-airtable-pat": token } : {},
      });
      const d = (await res.json()) as ScanAll;
      if (d.error) setError(d.error);
      else setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed.");
    } finally {
      setLoading(false);
    }
  }

  const overbooked = data?.overbooked ?? [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
            Check All Facilities
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Scans every in-operation facility and lists those already overbooked
            within the next 30 days (no new reservation added).
          </p>
        </div>
        {data && (
          <button
            type="button"
            onClick={scan}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-700"
          >
            {loading ? "Scanning…" : "Re-scan"}
          </button>
        )}
      </header>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </p>
      )}

      {!data ? (
        <div className="flex flex-col items-center justify-center gap-6 py-16">
          <div className="relative">
            {/* soft glow / pulse */}
            <span
              className={`pointer-events-none absolute -inset-4 rounded-full bg-indigo-500/25 blur-2xl ${loading ? "animate-pulse" : ""}`}
            />
            {/* raised socket the button sits in */}
            <div
              className="relative rounded-full p-2"
              style={{
                background: "linear-gradient(145deg, #e2e8f0, #cbd5e1)",
                boxShadow:
                  "0 10px 30px -8px rgba(15,23,42,.35), inset 0 2px 4px rgba(255,255,255,.7), inset 0 -3px 6px rgba(100,116,139,.4)",
              }}
            >
              <button
                type="button"
                onClick={scan}
                disabled={loading}
                className="group relative flex h-44 w-44 items-center justify-center rounded-full transition-transform duration-150 ease-out hover:-translate-y-1.5 active:translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-80"
                style={{
                  background:
                    "radial-gradient(circle at 38% 28%, #a5b4fc 0%, #6366f1 36%, #4338ca 72%, #312e81 100%)",
                  boxShadow:
                    "0 22px 45px -10px rgba(67,56,202,.7), 0 8px 16px -6px rgba(0,0,0,.4), inset 0 5px 11px rgba(255,255,255,.5), inset 0 -12px 24px rgba(30,27,75,.6)",
                }}
              >
                {/* glossy top highlight */}
                <span className="pointer-events-none absolute left-1/2 top-4 h-14 w-28 -translate-x-1/2 rounded-[50%] bg-white/35 blur-md" />
                {loading ? (
                  <svg className="relative h-12 w-12 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.4 0 0 5.4 0 12h4z" />
                  </svg>
                ) : (
                  <span
                    className="relative text-3xl font-extrabold tracking-[0.25em] text-white"
                    style={{ textShadow: "0 2px 5px rgba(0,0,0,.45)" }}
                  >
                    SCAN
                  </span>
                )}
              </button>
            </div>
          </div>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
            {loading ? "Scanning all facilities…" : "Press to scan all facilities"}
          </p>
        </div>
      ) : (
        <>
          <div
            className={`rounded-2xl border p-5 ${
              overbooked.length > 0
                ? "border-rose-300 bg-rose-50 dark:border-rose-500/40 dark:bg-rose-500/10"
                : "border-emerald-300 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-500/10"
            }`}
          >
            <p
              className={`text-lg font-bold ${
                overbooked.length > 0
                  ? "text-rose-700 dark:text-rose-300"
                  : "text-emerald-700 dark:text-emerald-300"
              }`}
            >
              {overbooked.length > 0
                ? `${overbooked.length} facilit${overbooked.length === 1 ? "y" : "ies"} overbooked in the next ${data.windowDays ?? 30} days`
                : `No overbooked facilities in the next ${data.windowDays ?? 30} days 🎉`}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Scanned {data.facilitiesScanned ?? 0} facilities ·{" "}
              {data.scannedAt ? new Date(data.scannedAt).toLocaleString() : ""}
            </p>
          </div>

          <div className="space-y-3">
            {overbooked.map((f) => {
              const isOpen = open.has(f.name);
              return (
                <div
                  key={f.name}
                  className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
                >
                  {/* Clickable header */}
                  <button
                    type="button"
                    onClick={() => toggle(f.name)}
                    className="flex w-full flex-wrap items-start justify-between gap-3 p-5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  >
                    <div className="flex items-start gap-2">
                      <svg
                        className={`mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform ${isOpen ? "rotate-90" : ""}`}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                      <div>
                        <h3 className="font-semibold text-slate-800 dark:text-slate-100">
                          {f.name}
                        </h3>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {f.stalls} stall{f.stalls === 1 ? "" : "s"} · peak occupancy{" "}
                          {f.peakOccupied} · {f.monthlyActive} active /{" "}
                          {f.monthlyInactive} inactive monthly
                        </p>
                      </div>
                    </div>
                    <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-bold text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">
                      Overbooked by {f.overbookedBy} on {fmtDate(f.worstDate)}
                    </span>
                  </button>

                  {/* 30-day strip (day-of-month on top, available below) */}
                  <div className="grid grid-cols-10 gap-1 px-5 pb-5">
                    {f.days.map((day) => {
                      const dt = new Date(day.date);
                      return (
                        <div
                          key={day.date}
                          title={`${fmtDate(day.date)} — ${day.available} available`}
                          className={`flex min-h-[2.4rem] flex-col items-center justify-center rounded-md text-white ${cellBg(day.available)}`}
                        >
                          <span className="text-[9px] leading-none opacity-90">
                            {dt.getDate()}
                          </span>
                          <span className="text-xs font-extrabold leading-tight">
                            {day.available}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Why it's overbooked (expanded) */}
                  {isOpen && (
                    <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-4 dark:border-slate-800 dark:bg-slate-800/30">
                      <p className="text-sm text-slate-700 dark:text-slate-200">
                        <span className="font-semibold">Why:</span> on{" "}
                        <span className="font-semibold">{fmtDate(f.worstDate)}</span>,{" "}
                        <b>{f.worstDay.monthly}</b> monthly +{" "}
                        <b>{f.worstDay.transient}</b> transient ={" "}
                        <b>{f.worstDay.occupied}</b> occupied, but only{" "}
                        <b>{f.stalls}</b> stall{f.stalls === 1 ? "" : "s"} —{" "}
                        <span className="font-semibold text-rose-600 dark:text-rose-400">
                          overbooked by {f.overbookedBy}
                        </span>
                        .
                      </p>

                      {f.monthly.length > 0 && (
                        <div className="mt-3">
                          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Monthly ({f.monthly.length})
                          </h4>
                          <div className="overflow-x-auto">
                            <table className="min-w-full text-xs">
                              <thead>
                                <tr className="text-left text-slate-400 dark:text-slate-500">
                                  <th className="py-1 pr-4">Status</th>
                                  <th className="py-1 pr-4">Reservation ID</th>
                                  <th className="py-1 pr-4">Start</th>
                                  <th className="py-1">End</th>
                                </tr>
                              </thead>
                              <tbody>
                                {f.monthly.map((m, i) => (
                                  <tr
                                    key={`${m.reservationId}-${i}`}
                                    className="border-t border-slate-100 text-slate-600 dark:border-slate-800 dark:text-slate-300"
                                  >
                                    <td className="py-1 pr-4">{catBadge(m.category)}</td>
                                    <td className="py-1 pr-4 font-medium">{m.reservationId || "—"}</td>
                                    <td className="py-1 pr-4">{fmtDate(m.start)}</td>
                                    <td className="py-1">{fmtDate(m.end)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {f.transient.length > 0 && (
                        <div className="mt-3">
                          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Transient ({f.transient.length})
                          </h4>
                          <div className="overflow-x-auto">
                            <table className="min-w-full text-xs">
                              <thead>
                                <tr className="text-left text-slate-400 dark:text-slate-500">
                                  <th className="py-1 pr-4">Source</th>
                                  <th className="py-1 pr-4">Reservation ID</th>
                                  <th className="py-1 pr-4">Start</th>
                                  <th className="py-1">End</th>
                                </tr>
                              </thead>
                              <tbody>
                                {f.transient.map((t, i) => (
                                  <tr
                                    key={`${t.reservationId}-${i}`}
                                    className="border-t border-slate-100 text-slate-600 dark:border-slate-800 dark:text-slate-300"
                                  >
                                    <td className="py-1 pr-4">{sourcePill(t.source)}</td>
                                    <td className="py-1 pr-4 font-medium">{t.reservationId || "—"}</td>
                                    <td className="py-1 pr-4">{fmtDT(t.start)}</td>
                                    <td className="py-1">{fmtDT(t.end)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
