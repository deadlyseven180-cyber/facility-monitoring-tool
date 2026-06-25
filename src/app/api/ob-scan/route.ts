import { readFile } from "fs/promises";
import path from "path";
import snapshot from "@/data/facilities.json";

const BASE_ID = "app9iYUN8J3z2wjXN";
const FACILITY_TABLE = "tblmun9KBYW4aYBe1"; // FACILITY INFORMATION
const MONTHLY_TABLE = "tblhJsSqzXe3LFopr"; // MONTHLY (Monthly Data Manager)
const TRANSIENT_TABLE = "tblPoNX9E3WSnsLyc"; // TRANSIENT

export const dynamic = "force-dynamic";

function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object" && "name" in (v as object))
    return String((v as { name: string }).name);
  return String(v);
}

/**
 * Parse a date to ms. A date-only "YYYY-MM-DD" (Airtable date field) is read as
 * LOCAL midnight to avoid the UTC off-by-one that shifts it back a day. Strings
 * with a time component fall through to Date.parse.
 */
function parseDateMs(s: string): number | null {
  if (!s) return null;
  const t = String(s).trim();
  const m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  }
  const p = Date.parse(t);
  return Number.isNaN(p) ? null : p;
}

interface AtRecord {
  id: string;
  fields: Record<string, unknown>;
}

interface DailyParker {
  reservationId: string;
  facility: string;
  bookingDate?: string;
  start: string;
  end: string;
  startMs: number | null;
  endMs: number | null;
}

async function loadStore(file: string): Promise<DailyParker[]> {
  try {
    const raw = await readFile(
      path.join(process.cwd(), ".data", file),
      "utf8",
    );
    return JSON.parse(raw) as DailyParker[];
  } catch {
    return [];
  }
}

/** SH Daily Parkers confirmations gathered from Gmail. */
const loadDailyParkers = () => loadStore("daily-parkers.json");
/** SpotHero cancellation emails gathered from Gmail. */
const loadCancelled = () => loadStore("cancelled-bookings.json");

/** Fetch every record matching a formula from an Airtable table. */
async function fetchAll(
  pat: string,
  table: string,
  fields: string[],
  formula: string,
): Promise<AtRecord[]> {
  const out: AtRecord[] = [];
  let offset: string | undefined;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${table}`);
    url.searchParams.set("pageSize", "100");
    if (formula) url.searchParams.set("filterByFormula", formula);
    for (const f of fields) url.searchParams.append("fields[]", f);
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${pat}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { records: AtRecord[]; offset?: string };
    out.push(...data.records);
    offset = data.offset;
  } while (offset);
  return out;
}

// Strip characters that would break an Airtable formula string literal.
const esc = (q: string) =>
  q.replace(/["\\]/g, "").replace(/\s+/g, " ").trim();

/* --- Lenient facility-name matching (case/punctuation-insensitive) --------- */

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function isContiguousSublist(small: string[], big: string[]): boolean {
  if (small.length === 0 || small.length > big.length) return false;
  for (let i = 0; i + small.length <= big.length; i++) {
    let ok = true;
    for (let j = 0; j < small.length; j++) {
      if (big[i + j] !== small[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/**
 * True if the query and a facility name are "the same except for extra/trailing
 * words" — one's tokens are a contiguous run of the other's. Ignores case and
 * punctuation, so "33 Concord Ave. - Spot #16 Only" matches "33 Concord Ave. -
 * Spot #16", but "Spot #16" does NOT match "Spot #1".
 */
function looseFacilityMatch(query: string, name: string): boolean {
  const a = tokens(query);
  const b = tokens(name);
  if (!a.length || !b.length) return false;
  return a.length <= b.length
    ? isContiguousSublist(a, b)
    : isContiguousSublist(b, a);
}

/**
 * Airtable pre-filter: a superset of `looseFacilityMatch` — match if either
 * side's alphanumeric-only form is a substring of the other. JS then refines.
 */
function fuzzyFormula(safe: string, field: string): string {
  const nq = `REGEX_REPLACE(LOWER("${safe}"),"[^a-z0-9]","")`;
  const nf = `REGEX_REPLACE(LOWER({${field}}),"[^a-z0-9]","")`;
  return `OR(FIND(${nq},${nf}),FIND(${nf},${nq}))`;
}

/** Peak number of transient bookings overlapping at any instant (date + time). */
function transientPeak(
  bookings: { startMs: number | null; endMs: number | null }[],
): { peak: number; windowStart: number | null; windowEnd: number | null } {
  const events: { t: number; d: number }[] = [];
  for (const b of bookings) {
    if (b.startMs == null || b.endMs == null || b.endMs <= b.startMs) continue;
    events.push({ t: b.startMs, d: 1 });
    events.push({ t: b.endMs, d: -1 });
  }
  // Ends before starts at the same instant (touching ≠ overlap).
  events.sort((a, b) => a.t - b.t || a.d - b.d);
  let active = 0;
  let peak = 0;
  let windowStart: number | null = null;
  let windowEnd: number | null = null;
  for (const e of events) {
    active += e.d;
    if (active > peak) {
      peak = active;
      windowStart = e.t;
      windowEnd = null;
    } else if (active < peak && windowStart != null && windowEnd == null) {
      windowEnd = e.t;
    }
  }
  return { peak, windowStart, windowEnd };
}

/** Peak concurrent transient bookings within a single day window [start,end). */
function dayTransientPeak(
  bookings: { startMs: number | null; endMs: number | null }[],
  dayStart: number,
  dayEnd: number,
): number {
  const clipped = bookings
    .filter(
      (b) =>
        b.startMs != null &&
        b.endMs != null &&
        b.endMs > dayStart &&
        b.startMs < dayEnd,
    )
    .map((b) => ({
      startMs: Math.max(b.startMs as number, dayStart),
      endMs: Math.min(b.endMs as number, dayEnd),
    }));
  return transientPeak(clipped).peak;
}

export async function GET(req: Request) {
  const facility = (new URL(req.url).searchParams.get("facility") ?? "").trim();
  if (!facility) {
    return Response.json({ error: "Enter a facility name." }, { status: 400 });
  }
  const pat = req.headers.get("x-airtable-pat") || process.env.AIRTABLE_PAT;
  if (!pat) {
    return Response.json(
      { error: "Connect Airtable in Settings to scan bookings." },
      { status: 400 },
    );
  }

  const safe = esc(facility);

  // --- Stalls (live from Facility Information, snapshot fallback) ---
  let matched: { name: string; stalls: number }[] = [];
  try {
    const recs = await fetchAll(
      pat,
      FACILITY_TABLE,
      ["FACILITY NAME", "NO. OF STALLS"],
      fuzzyFormula(safe, "FACILITY NAME"),
    );
    matched = recs
      .map((r) => ({
        name: str(r.fields["FACILITY NAME"]).replace(/\s+/g, " ").trim(),
        stalls: Number(r.fields["NO. OF STALLS"] ?? 0),
      }))
      .filter((m) => looseFacilityMatch(facility, m.name));
  } catch {
    // fall through to snapshot
  }
  if (matched.length === 0) {
    matched = (
      snapshot.facilities as { name: string; stalls: number | null }[]
    )
      .filter((f) => looseFacilityMatch(facility, f.name))
      .map((f) => ({ name: f.name, stalls: f.stalls ?? 0 }));
  }
  if (matched.length === 0) {
    return Response.json({
      facility,
      found: false,
      message: `No facility matching “${facility}” was found.`,
    });
  }
  const stalls = matched.reduce((s, m) => s + (m.stalls || 0), 0);

  // --- Monthly (active) + Transient (active/upcoming) bookings ---
  let monthlyRecs: AtRecord[];
  let transientRecs: AtRecord[];
  try {
    [monthlyRecs, transientRecs] = await Promise.all([
      fetchAll(
        pat,
        MONTHLY_TABLE,
        ["Facility Name", "RESERVATION ID", "START DATE", "END DATE", "REMARKS"],
        // Active/upcoming + recently-ended (inactive) + cancelled monthly:
        // end date in the future, blank, or within the last 60 days. Categories
        // are computed in code from REMARKS + END DATE.
        `AND(${fuzzyFormula(safe, "Facility Name")}, OR({END DATE} = BLANK(), NOT(IS_BEFORE({END DATE}, DATEADD(TODAY(), -60, 'days')))))`,
      ),
      fetchAll(
        pat,
        TRANSIENT_TABLE,
        ["FACILITY", "RESERVATION ID", "START", "END", "BOOKING DATE", "PLATFORM"],
        `AND(${fuzzyFormula(safe, "FACILITY")}, UPPER({RESERVATION STATUS})!="ENDED", UPPER({RESERVATION STATUS})!="CANCELLED")`,
      ),
    ]);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Airtable scan failed." },
      { status: 502 },
    );
  }

  // "Today" at local midnight, used for date comparisons below + the forecast.
  const DAY = 86_400_000;
  const today = new Date();
  const todayStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();

  // Classify each monthly:
  //  • cancelled  — REMARKS = CANCELLED. Frees its stall at the end date.
  //  • inactive   — NOT cancelled but END DATE already passed. Assumed it may
  //                 renew, so it still holds a stall (does NOT free).
  //  • active     — NOT cancelled, end date in the future (or blank).
  const allMonthly = monthlyRecs.map((r) => {
    const remarks = str(r.fields["REMARKS"]);
    const start = str(r.fields["START DATE"]);
    const end = str(r.fields["END DATE"]);
    const startMs = parseDateMs(start);
    const endMs = parseDateMs(end);
    const cancelled = /cancel/i.test(remarks);
    const endPassed = endMs != null && endMs < todayStart;
    const category: "active" | "inactive" | "cancelled" = cancelled
      ? "cancelled"
      : endPassed
        ? "inactive"
        : "active";
    return {
      reservationId: str(r.fields["RESERVATION ID"]).trim(),
      facility: str(r.fields["Facility Name"]),
      start,
      end,
      startMs,
      endMs,
      cancelled,
      endPassed,
      category,
    };
  });
  // Drop cancelled reservations whose end already passed (stall freed long ago)
  // and refine the loose Airtable match with precise token matching.
  const monthly = allMonthly.filter(
    (m) =>
      looseFacilityMatch(facility, m.facility) &&
      !(m.cancelled && m.endPassed),
  );
  const monthlyCount = monthly.length;
  const monthlyCancelled = monthly.filter((m) => m.category === "cancelled");
  const monthlyInactiveCount = monthly.filter(
    (m) => m.category === "inactive",
  ).length;
  const monthlyActiveCount = monthly.filter(
    (m) => m.category === "active",
  ).length;

  const airtableTransient = transientRecs.map((r) => {
    const startIso = str(r.fields["START"]);
    const endIso = str(r.fields["END"]);
    const sMs = Date.parse(startIso);
    const eMs = Date.parse(endIso);
    const platform = str(r.fields["PLATFORM"] || "").trim();
    return {
      reservationId: str(r.fields["RESERVATION ID"]).trim(),
      facility: str(r.fields["FACILITY"]).replace(/\s+/g, " ").trim(),
      bookingDate: str(r.fields["BOOKING DATE"]),
      start: startIso,
      end: endIso,
      startMs: Number.isNaN(sMs) ? null : sMs,
      endMs: Number.isNaN(eMs) ? null : eMs,
      source: /spothero/i.test(platform)
        ? "SpotHero"
        : platform || "Other",
    };
  }).filter((t) => looseFacilityMatch(facility, t.facility));

  // SH Daily Parkers from Gmail = additional SpotHero transient bookings:
  // same facility match + overlap logic. Merged with Airtable, deduped by ID.
  const dpMatched = (await loadDailyParkers())
    .filter((d) => looseFacilityMatch(facility, d.facility ?? ""))
    .map((d) => {
      const sMs = d.startMs ?? Date.parse(d.start);
      const eMs = d.endMs ?? Date.parse(d.end);
      return {
        reservationId: String(d.reservationId ?? "").trim(),
        facility: String(d.facility ?? "").replace(/\s+/g, " ").trim(),
        bookingDate: d.bookingDate ?? "",
        start: d.start ?? "",
        end: d.end ?? "",
        startMs: typeof sMs === "number" && !Number.isNaN(sMs) ? sMs : null,
        endMs: typeof eMs === "number" && !Number.isNaN(eMs) ? eMs : null,
        source: "SpotHero",
      };
    });
  const seenT = new Set(airtableTransient.map((t) => t.reservationId));
  const merged = [...airtableTransient];
  for (const d of dpMatched) {
    if (d.reservationId && seenT.has(d.reservationId)) continue;
    if (d.reservationId) seenT.add(d.reservationId);
    merged.push(d);
  }

  // Cancellation emails DECREASE occupancy: drop any transient whose reservation
  // was cancelled (matched by reservation ID).
  const cancelledRecs = await loadCancelled();
  const cancelledIds = new Set(
    cancelledRecs.map((c) => String(c.reservationId ?? "").trim()).filter(Boolean),
  );
  const transient = merged.filter((t) => !cancelledIds.has(t.reservationId));
  const cancelledTransient = merged
    .filter((t) => cancelledIds.has(t.reservationId))
    .map(({ startMs, endMs, ...rest }) => {
      void startMs;
      void endMs;
      return rest;
    });

  const {
    peak: transientPeakCount,
    windowStart,
    windowEnd,
  } = transientPeak(transient);
  const transientWindow =
    transientPeakCount > 0 && windowStart != null
      ? {
          start: new Date(windowStart).toISOString(),
          end: windowEnd != null ? new Date(windowEnd).toISOString() : "",
        }
      : null;

  // Occupancy NOW: only monthlies that have already STARTED hold a stall (a
  // reservation starting in the future doesn't occupy yet) + transient today.
  const transientNow = dayTransientPeak(transient, todayStart, todayStart + DAY);
  const monthlyOccupyingNow = monthly.filter((m) => {
    const ms = m.startMs ?? -Infinity;
    if (ms > todayStart) return false; // hasn't started yet
    if (m.cancelled) return (m.endMs ?? Infinity) >= todayStart;
    return true;
  }).length;
  const occupied = monthlyOccupyingNow + transientNow;
  const available = stalls - occupied;

  // Cancelled monthly free their stall once their end date passes — project the
  // resulting availability in chronological order.
  const projection: {
    reservationId: string;
    endDate: string;
    availableAfter: number;
  }[] = [];
  [...monthlyCancelled]
    .sort((a, b) => (a.endMs ?? Infinity) - (b.endMs ?? Infinity))
    .forEach((m, i) => {
      projection.push({
        reservationId: m.reservationId,
        endDate: m.end,
        availableAfter: available + i + 1,
      });
    });

  const stallWord = stalls === 1 ? "stall" : "stalls";
  let level: "green" | "yellow" | "red";
  let message: string;
  if (available <= 0) {
    level = "red";
    message =
      available === 0
        ? `Full — all ${stalls} ${stallWord} occupied (0 available now).`
        : `Overbooked by ${Math.abs(available)} — ${occupied} occupied exceeds ${stalls} ${stallWord}.`;
  } else if (available <= 3) {
    level = "yellow";
    message = `Low availability — ${available} spot${available === 1 ? "" : "s"} available now.`;
  } else {
    level = "green";
    message = `${available} spot${available === 1 ? "" : "s"} available now.`;
  }

  // --- 30-day forecast: simulate availability each day so a NEW monthly can be
  // checked for overbooking across its whole term (next 1–30 days). ---
  const forecast: {
    date: string;
    available: number;
    monthly: number;
    transient: number;
  }[] = [];
  let minAvailable = Infinity;
  let minAvailableDate = "";
  for (let d = 0; d < 30; d++) {
    const dayStart = todayStart + d * DAY;
    const dayEnd = dayStart + DAY;
    // Monthly occupancy that day. A reservation occupies only from the day it
    // starts (start ≤ this day). Cancelled frees after its end date; everything
    // else (active/inactive) is assumed to renew, so it keeps occupying.
    const mOcc = monthly.filter((m) => {
      const ms = m.startMs ?? -Infinity;
      if (ms > dayStart) return false; // hasn't started yet on this day
      if (m.cancelled) return (m.endMs ?? Infinity) >= dayStart;
      return true;
    }).length;
    const tPeak = dayTransientPeak(transient, dayStart, dayEnd);
    const avail = stalls - (mOcc + tPeak);
    if (avail < minAvailable) {
      minAvailable = avail;
      minAvailableDate = new Date(dayStart).toISOString();
    }
    forecast.push({
      date: new Date(dayStart).toISOString(),
      available: avail,
      monthly: mOcc,
      transient: tPeak,
    });
  }
  // A new monthly (held every day of its term) fits only if every day keeps at
  // least one free stall.
  const canAddMonthly = minAvailable >= 1;
  // First day availability hits 0, and the last day before that you can still
  // add a reservation (the "open window").
  const firstFullIdx = forecast.findIndex((f) => f.available <= 0);
  const firstFullDate = firstFullIdx >= 0 ? forecast[firstFullIdx].date : null;
  const lastOpenDate = firstFullIdx > 0 ? forecast[firstFullIdx - 1].date : null;

  const note =
    transient.length > 0
      ? `Transient bookings only occupy a stall during their specific date/time window. The figure above uses the busiest overlap — a peak of ${transientPeakCount} transient booking${transientPeakCount === 1 ? "" : "s"} at once. Outside that peak window there may be additional spots available — review the transient booking times below.`
      : "";

  return Response.json({
    facility,
    found: true,
    matched,
    stalls,
    monthlyCount,
    monthlyActiveCount,
    monthlyInactiveCount,
    monthlyCancelledCount: monthlyCancelled.length,
    transientPeak: transientPeakCount,
    transientCount: transient.length,
    transientWindow,
    occupied,
    available,
    level,
    message,
    note,
    projection,
    forecast,
    minAvailable: minAvailable === Infinity ? stalls : minAvailable,
    minAvailableDate,
    canAddMonthly,
    firstFullDate,
    lastOpenDate,
    monthly: monthly.map(({ startMs, endMs, endPassed, ...rest }) => {
      void startMs;
      void endMs;
      void endPassed;
      return rest;
    }),
    transient: transient.map(({ startMs, endMs, ...rest }) => {
      void startMs;
      void endMs;
      return rest;
    }),
    transientCancelledCount: cancelledTransient.length,
    cancelledTransient,
  });
}
