"use client";

import { useEffect, useState } from "react";

const PAT_KEY = "airtablePat";

interface MonthlyBooking {
  reservationId: string;
  facility: string;
  start: string;
  end: string;
  cancelled: boolean;
  category: "active" | "inactive" | "cancelled";
}

interface TransientBooking {
  reservationId: string;
  facility: string;
  start: string;
  end: string;
  bookingDate?: string;
  source?: string;
}

interface Projection {
  reservationId: string;
  endDate: string;
  availableAfter: number;
}

interface ScanResult {
  facility: string;
  found: boolean;
  matched?: { name: string; stalls: number }[];
  stalls?: number;
  monthlyCount?: number;
  monthlyActiveCount?: number;
  monthlyInactiveCount?: number;
  monthlyCancelledCount?: number;
  transientPeak?: number;
  transientCount?: number;
  transientWindow?: { start: string; end: string } | null;
  occupied?: number;
  available?: number;
  level?: "green" | "yellow" | "red";
  message?: string;
  note?: string;
  projection?: Projection[];
  forecast?: { date: string; available: number; monthly: number; transient: number }[];
  minAvailable?: number;
  minAvailableDate?: string;
  canAddMonthly?: boolean;
  firstFullDate?: string | null;
  lastOpenDate?: string | null;
  monthly?: MonthlyBooking[];
  transient?: TransientBooking[];
  transientCancelledCount?: number;
  cancelledTransient?: TransientBooking[];
  error?: string;
}

const LEVEL_STYLES = {
  red: {
    box: "border-rose-300 bg-rose-50 dark:border-rose-500/40 dark:bg-rose-500/10",
    text: "text-rose-700 dark:text-rose-300",
    dot: "bg-rose-500",
    label: "OVERBOOKED",
  },
  yellow: {
    box: "border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10",
    text: "text-amber-700 dark:text-amber-300",
    dot: "bg-amber-500",
    label: "LOW AVAILABILITY",
  },
  green: {
    box: "border-emerald-300 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-500/10",
    text: "text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
    label: "AVAILABLE",
  },
};

export default function OverbookingChecker() {
  const [facility, setFacility] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<string[]>([]);

  // Populate facility-name suggestions from the stored facility data.
  useEffect(() => {
    const token = localStorage.getItem(PAT_KEY);
    fetch("/api/facilities", {
      cache: "no-store",
      headers: token ? { "x-airtable-pat": token } : {},
    })
      .then((r) => r.json())
      .then((d) =>
        setOptions(
          (d.facilities ?? [])
            .filter((f: { status: string }) => /in operation/i.test(f.status))
            .map((f: { name: string }) => f.name),
        ),
      )
      .catch(() => {});
  }, []);

  async function scan() {
    if (!facility.trim()) {
      setError("Enter a facility name to scan.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const token = localStorage.getItem(PAT_KEY);
      const res = await fetch(
        `/api/ob-scan?facility=${encodeURIComponent(facility.trim())}`,
        {
          cache: "no-store",
          headers: token ? { "x-airtable-pat": token } : {},
        },
      );
      const data = (await res.json()) as ScanResult;
      if (data.error) setError(data.error);
      else setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed.");
    } finally {
      setLoading(false);
    }
  }

  function clear() {
    setFacility("");
    setResult(null);
    setError(null);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
            Overbook Checker
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Scan a facility&apos;s monthly and transient bookings against its
            stalls. Cancelled monthlies are flagged with the date their stall
            frees up.
          </p>
        </div>
        <button
          type="button"
          onClick={clear}
          title="Clear data"
          aria-label="Clear data"
          className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white p-2 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6M14 11v6" />
          </svg>
        </button>
      </header>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
          Facility name
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            list="ob-facilities"
            value={facility}
            onChange={(e) => setFacility(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && scan()}
            placeholder="e.g. 33 Essex St. - Spots #13, 14, 15, 16 or 17 only"
            className="grow rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-indigo-500/30"
          />
          <datalist id="ob-facilities">
            {options.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
          <button
            type="button"
            onClick={scan}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-700"
          >
            {loading && (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.4 0 0 5.4 0 12h4z" />
              </svg>
            )}
            {loading ? "Scanning…" : "Scan"}
          </button>
        </div>

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </p>
        )}
      </div>

      {result && !result.found && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          {result.message}
        </div>
      )}

      {result && result.found && result.level && <Results result={result} />}
    </div>
  );
}

function fmtDate(s: string): string {
  if (!s) return "—";
  // Date-only "YYYY-MM-DD" → local date (avoid the UTC off-by-one that shifts
  // an end date of Jun 30 to Jun 29). Strings with a time use Date.parse.
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const d = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    : new Date(Date.parse(s));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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

function Results({ result }: { result: ScanResult }) {
  const s = LEVEL_STYLES[result.level ?? "green"];
  const stalls = result.stalls ?? 0;
  const active = result.monthlyActiveCount ?? 0;
  const inactive = result.monthlyInactiveCount ?? 0;
  const cancelled = result.monthlyCancelledCount ?? 0;
  const transient = result.transientPeak ?? 0;
  const available = result.available ?? 0;
  const proj = result.projection ?? [];

  return (
    <div className="space-y-5">
      {/* Status banner */}
      <div className={`rounded-2xl border p-5 ${s.box}`}>
        <div className="flex flex-wrap items-center gap-3">
          <span className={`inline-flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-1 text-xs font-bold ${s.text} dark:bg-black/20`}>
            <span className={`h-2 w-2 rounded-full ${s.dot}`} />
            {s.label}
          </span>
          <p className={`text-lg font-bold ${s.text}`}>{result.message}</p>
        </div>

        {/* Capacity bar */}
        <div className="mt-4">
          <CapacityBar
            stalls={stalls}
            active={active}
            inactive={inactive}
            cancelled={cancelled}
            transient={transient}
            available={available}
          />
        </div>

        {result.matched && result.matched.length > 1 && (
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Matched {result.matched.length} facility listings:{" "}
            {result.matched.map((m) => `${m.name} (${m.stalls})`).join(", ")}
          </p>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Stalls" value={String(stalls)} />
        <Stat label="Monthly active" value={String(active)} tone="text-indigo-600 dark:text-indigo-400" />
        <Stat label="Monthly inactive" value={String(inactive)} tone="text-amber-600 dark:text-amber-400" />
        <Stat label="Monthly cancelled" value={String(cancelled)} tone="text-rose-600 dark:text-rose-400" />
        <Stat label="Transient peak" value={String(transient)} tone="text-purple-600 dark:text-purple-400" />
        <Stat label="Available now" value={String(available)} tone={s.text} />
      </div>

      {/* 30-day forecast for adding a new monthly */}
      {result.forecast && result.forecast.length > 0 && (
        <ForecastPanel result={result} />
      )}

      {/* Stall-opening projection from cancelled monthlies */}
      {proj.length > 0 && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 dark:border-emerald-500/30 dark:bg-emerald-500/10">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-emerald-800 dark:text-emerald-300">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
            Upcoming stall openings
          </h3>
          <p className="mt-1 text-xs text-emerald-700/80 dark:text-emerald-300/70">
            {cancelled} cancelled monthly{cancelled === 1 ? "" : "s"} still hold a
            stall until the end date below, then free up.
          </p>
          <ol className="mt-3 space-y-2">
            {proj.map((p, i) => (
              <li key={`${p.reservationId}-${i}`} className="flex items-center gap-3 text-sm">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold text-white">
                  {i + 1}
                </span>
                <span className="text-slate-700 dark:text-slate-200">
                  After <span className="font-semibold">{fmtDate(p.endDate)}</span>
                  {p.reservationId ? ` (${p.reservationId})` : ""}, stalls available
                  increases to{" "}
                  <span className="font-bold text-emerald-700 dark:text-emerald-300">
                    {p.availableAfter}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Transient impact */}
      {transient > 0 && (
        <div className="rounded-xl border border-purple-200 bg-purple-50 px-4 py-3 text-sm text-purple-800 dark:border-purple-500/30 dark:bg-purple-500/10 dark:text-purple-300">
          <span className="font-semibold">Transient impact:</span> availability
          drops by <b>{transient}</b> stall{transient === 1 ? "" : "s"} during the
          busiest transient window
          {result.transientWindow
            ? ` (${fmtDT(result.transientWindow.start)}${
                result.transientWindow.end
                  ? ` – ${fmtDT(result.transientWindow.end)}`
                  : ""
              })`
            : ""}
          . Outside that window more spots are free — see the times below.
        </div>
      )}

      <MonthlyTable bookings={result.monthly} />
      <BookingTable
        title="Transient bookings (active / upcoming)"
        bookings={result.transient}
      />
      {result.cancelledTransient && result.cancelledTransient.length > 0 && (
        <BookingTable
          title="Cancelled transient — freed (from Gmail cancellations)"
          bookings={result.cancelledTransient}
        />
      )}
    </div>
  );
}

function cellBg(a: number): string {
  if (a <= 0) return "bg-rose-500";
  if (a <= 3) return "bg-amber-500";
  return "bg-emerald-500";
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ForecastCalendar({
  days,
}: {
  days: { date: string; available: number; monthly: number; transient: number }[];
}) {
  if (days.length === 0) return null;
  const first = new Date(days[0].date);
  const last = new Date(days[days.length - 1].date);
  const lead = first.getDay(); // 0 = Sun … 6 = Sat
  const monthOf = (d: Date) =>
    d.toLocaleDateString([], { month: "long", year: "numeric" });
  const span =
    monthOf(first) === monthOf(last)
      ? monthOf(first)
      : `${monthOf(first)} – ${monthOf(last)}`;

  return (
    <div className="mt-4">
      <p className="mb-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
        {span}
      </p>
      <div className="grid grid-cols-7 gap-1.5">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="text-center text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500"
          >
            {w}
          </div>
        ))}
        {Array.from({ length: lead }).map((_, i) => (
          <div key={`blank-${i}`} />
        ))}
        {days.map((day, i) => {
          const dt = new Date(day.date);
          const dnum = dt.getDate();
          const monthTag =
            dnum === 1 || i === 0
              ? `${dt.toLocaleDateString([], { month: "short" })} `
              : "";
          return (
            <div
              key={day.date}
              title={`${fmtDate(day.date)} — ${day.available} available (monthly ${day.monthly}, transient ${day.transient})`}
              className={`flex min-h-[3.5rem] flex-col rounded-lg px-1.5 py-1 text-white ${cellBg(day.available)}`}
            >
              <span className="text-[10px] font-semibold opacity-90">
                {monthTag}
                {dnum}
              </span>
              <span className="mt-auto text-center text-base font-extrabold leading-none">
                {day.available}
              </span>
              <span className="text-center text-[8px] uppercase tracking-wide opacity-80">
                free
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ForecastPanel({ result }: { result: ScanResult }) {
  const fc = result.forecast ?? [];
  const minA = result.minAvailable ?? 0;
  const firstFull = result.firstFullDate ?? null;
  const lastOpen = result.lastOpenDate ?? null;

  // ok = free every day; window = open until a date then full; full = full today.
  const state: "ok" | "window" | "full" = !firstFull
    ? "ok"
    : lastOpen
      ? "window"
      : "full";

  const tone = {
    ok: {
      icon: "✓",
      badge: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300",
      text: "text-emerald-700 dark:text-emerald-300",
    },
    window: {
      icon: "!",
      badge: "bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300",
      text: "text-amber-700 dark:text-amber-300",
    },
    full: {
      icon: "✕",
      badge: "bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-300",
      text: "text-rose-700 dark:text-rose-300",
    },
  }[state];

  const message =
    state === "ok"
      ? `Yes — at least ${minA} stall${minA === 1 ? "" : "s"} stay free every day for the next 30 days, so a new monthly won't overbook.`
      : state === "window"
        ? `You can still add a reservation from today through ${fmtDate(lastOpen as string)}. From ${fmtDate(firstFull as string)} onward there's no free slot — a monthly booking starts then — so a renewing monthly won't fit.`
        : `No free slot — the facility is already full from today (${fmtDate(firstFull as string)}).`;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-bold ${tone.badge}`}
        >
          {tone.icon}
        </span>
        <div>
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            30-Day Forecast — Can a new reservation be added?
          </h3>
          <p className={`mt-0.5 text-sm font-medium ${tone.text}`}>{message}</p>
        </div>
      </div>

      <ForecastCalendar days={fc} />

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Open (&gt;3 free)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-amber-500" /> Tight (1–3 free)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-rose-500" /> Full / overbooked (0)
        </span>
      </div>
      <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
        Each cell shows the date and the number of stalls available that day
        (today → 29 days out). Monthly terms ending and transient windows are
        factored in per day.
      </p>
    </div>
  );
}

function CapacityBar({
  stalls,
  active,
  inactive,
  cancelled,
  transient,
  available,
}: {
  stalls: number;
  active: number;
  inactive: number;
  cancelled: number;
  transient: number;
  available: number;
}) {
  const occupied = active + inactive + cancelled + transient;
  const total = Math.max(stalls, occupied, 1);
  const pct = (n: number) => `${(Math.max(n, 0) / total) * 100}%`;
  const segs = [
    { n: active, cls: "bg-indigo-500", label: "Monthly active" },
    { n: inactive, cls: "bg-amber-400", label: "Monthly inactive" },
    { n: cancelled, cls: "bg-rose-400", label: "Monthly cancelled" },
    { n: transient, cls: "bg-purple-500", label: "Transient peak" },
    { n: Math.max(available, 0), cls: "bg-emerald-400", label: "Available" },
  ];
  return (
    <div>
      <div className="flex h-6 w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800">
        {segs.map((s) =>
          s.n > 0 ? (
            <div
              key={s.label}
              style={{ width: pct(s.n) }}
              className={s.cls}
              title={`${s.label}: ${s.n}`}
            />
          ) : null,
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
        {segs.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-sm ${s.cls}`} />
            {s.label} ({s.n})
          </span>
        ))}
      </div>
    </div>
  );
}

function categoryBadge(category: MonthlyBooking["category"]) {
  const map = {
    active: {
      label: "Active",
      cls: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300",
    },
    inactive: {
      label: "Inactive",
      cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
    },
    cancelled: {
      label: "Cancelled",
      cls: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
    },
  } as const;
  const c = map[category] ?? map.active;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.cls}`}>
      {c.label}
    </span>
  );
}

function MonthlyTable({ bookings }: { bookings?: MonthlyBooking[] }) {
  if (!bookings || bookings.length === 0) return null;
  // Sort by end date, earliest → latest (undated end dates sink to the bottom).
  const sorted = [...bookings].sort((a, b) => {
    const ea = Date.parse(a.end);
    const eb = Date.parse(b.end);
    const na = Number.isNaN(ea);
    const nb = Number.isNaN(eb);
    if (na && nb) return 0;
    if (na) return 1;
    if (nb) return -1;
    return ea - eb;
  });
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
        Monthly bookings ({bookings.length}) — sorted by end date
      </h3>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 dark:text-slate-400">
              <th className="py-1.5 pr-4">Status</th>
              <th className="py-1.5 pr-4">Reservation ID</th>
              <th className="py-1.5 pr-4">Facility</th>
              <th className="py-1.5 pr-4">Start</th>
              <th className="py-1.5">End{" "}<span className="font-normal text-slate-400">(frees stall if cancelled)</span></th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, 200).map((b, i) => (
              <tr
                key={`${b.reservationId}-${i}`}
                className="border-t border-slate-100 text-slate-700 dark:border-slate-800 dark:text-slate-300"
              >
                <td className="py-1.5 pr-4">{categoryBadge(b.category)}</td>
                <td className="py-1.5 pr-4 font-medium">{b.reservationId || "—"}</td>
                <td className="py-1.5 pr-4">{b.facility}</td>
                <td className="py-1.5 pr-4">{fmtDate(b.start)}</td>
                <td className={`py-1.5 ${b.category === "cancelled" ? "font-semibold text-rose-700 dark:text-rose-300" : b.category === "inactive" ? "font-semibold text-amber-700 dark:text-amber-300" : ""}`}>
                  {fmtDate(b.end)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function sourcePill(s?: string) {
  const v = s || "Other";
  const cls = /spothero/i.test(v)
    ? "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300"
    : "bg-slate-200 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300";
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}
    >
      {v}
    </span>
  );
}

function BookingTable({
  title,
  bookings,
}: {
  title: string;
  bookings?: TransientBooking[];
}) {
  if (!bookings || bookings.length === 0) return null;
  // Sort by end date, earliest → furthest (undated ends sink to the bottom).
  const sorted = [...bookings].sort((a, b) => {
    const ea = Date.parse(a.end);
    const eb = Date.parse(b.end);
    const na = Number.isNaN(ea);
    const nb = Number.isNaN(eb);
    if (na && nb) return 0;
    if (na) return 1;
    if (nb) return -1;
    return ea - eb;
  });
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
        {title} ({bookings.length}) — sorted by end date
      </h3>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 dark:text-slate-400">
              <th className="py-1.5 pr-4">Reservation ID</th>
              <th className="py-1.5 pr-4">Source</th>
              <th className="py-1.5 pr-4">Facility</th>
              <th className="py-1.5 pr-4">Booking date</th>
              <th className="py-1.5 pr-4">Start</th>
              <th className="py-1.5">End</th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, 200).map((b, i) => (
              <tr
                key={`${b.reservationId}-${i}`}
                className="border-t border-slate-100 text-slate-700 dark:border-slate-800 dark:text-slate-300"
              >
                <td className="py-1.5 pr-4 font-medium">{b.reservationId || "—"}</td>
                <td className="py-1.5 pr-4">{sourcePill(b.source)}</td>
                <td className="py-1.5 pr-4">{b.facility}</td>
                <td className="py-1.5 pr-4">{b.bookingDate || "—"}</td>
                <td className="py-1.5 pr-4">{fmtDT(b.start)}</td>
                <td className="py-1.5">{fmtDT(b.end)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </p>
      <p className={`mt-0.5 text-xl font-bold ${tone ?? "text-slate-900 dark:text-slate-100"}`}>
        {value}
      </p>
    </div>
  );
}
