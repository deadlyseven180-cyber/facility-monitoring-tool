import { readFile } from "fs/promises";
import path from "path";
import snapshot from "@/data/facilities.json";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BASE_ID = "app9iYUN8J3z2wjXN";
const FACILITY_TABLE = "tblmun9KBYW4aYBe1";
const MONTHLY_TABLE = "tblhJsSqzXe3LFopr";
const TRANSIENT_TABLE = "tblPoNX9E3WSnsLyc";
const DAY = 86_400_000;
const WINDOW_DAYS = 30;

function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object" && "name" in (v as object))
    return String((v as { name: string }).name);
  return String(v);
}

interface AtRecord {
  id: string;
  fields: Record<string, unknown>;
}

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

/** Date-only "YYYY-MM-DD" → LOCAL midnight; otherwise Date.parse. */
function parseDateMs(s: string): number | null {
  if (!s) return null;
  const t = String(s).trim();
  const m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  const p = Date.parse(t);
  return Number.isNaN(p) ? null : p;
}

/** Peak concurrent transient bookings within [dayStart, dayEnd). */
function dayTransientPeak(
  bookings: { startMs: number | null; endMs: number | null }[],
  dayStart: number,
  dayEnd: number,
): number {
  const events: { t: number; d: number }[] = [];
  for (const b of bookings) {
    if (b.startMs == null || b.endMs == null) continue;
    const s = Math.max(b.startMs, dayStart);
    const e = Math.min(b.endMs, dayEnd);
    if (e <= s) continue;
    events.push({ t: s, d: 1 }, { t: e, d: -1 });
  }
  events.sort((a, b) => a.t - b.t || a.d - b.d);
  let active = 0;
  let peak = 0;
  for (const e of events) {
    active += e.d;
    if (active > peak) peak = active;
  }
  return peak;
}

/* --- Lenient facility matching --------------------------------------------- */
function tokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
}
function isContiguousSublist(small: string[], big: string[]): boolean {
  if (small.length === 0 || small.length > big.length) return false;
  for (let i = 0; i + small.length <= big.length; i++) {
    let ok = true;
    for (let j = 0; j < small.length; j++) {
      if (big[i + j] !== small[j]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}
function looseTokens(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false;
  return a.length <= b.length ? isContiguousSublist(a, b) : isContiguousSublist(b, a);
}

interface Stored {
  reservationId?: string;
  facility?: string;
  start?: string;
  end?: string;
  startMs?: number | null;
  endMs?: number | null;
}
async function loadStore(file: string): Promise<Stored[]> {
  try {
    return JSON.parse(
      await readFile(path.join(process.cwd(), ".data", file), "utf8"),
    );
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  const pat = req.headers.get("x-airtable-pat") || process.env.AIRTABLE_PAT;
  if (!pat) {
    return Response.json(
      { error: "Connect Airtable in Settings to scan all facilities." },
      { status: 400 },
    );
  }

  const today = new Date();
  const todayStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();

  let facRecs: AtRecord[];
  let monthlyRecs: AtRecord[];
  let transientRecs: AtRecord[];
  try {
    [facRecs, monthlyRecs, transientRecs] = await Promise.all([
      fetchAll(
        pat,
        FACILITY_TABLE,
        ["FACILITY NAME", "NO. OF STALLS", "FACILITY STATUS"],
        `{NO. OF STALLS} > 0`,
      ),
      fetchAll(
        pat,
        MONTHLY_TABLE,
        ["Facility Name", "RESERVATION ID", "START DATE", "END DATE", "REMARKS"],
        `OR({END DATE} = BLANK(), NOT(IS_BEFORE({END DATE}, DATEADD(TODAY(), -60, 'days'))))`,
      ),
      fetchAll(
        pat,
        TRANSIENT_TABLE,
        ["FACILITY", "RESERVATION ID", "START", "END", "PLATFORM"],
        `AND(UPPER({RESERVATION STATUS})!="ENDED", UPPER({RESERVATION STATUS})!="CANCELLED")`,
      ),
    ]);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Airtable scan failed." },
      { status: 502 },
    );
  }

  // Facilities in operation with stalls.
  let facs = facRecs
    .map((r) => ({
      name: str(r.fields["FACILITY NAME"]).replace(/\s+/g, " ").trim(),
      stalls: Number(r.fields["NO. OF STALLS"] ?? 0),
      status: str(r.fields["FACILITY STATUS"]),
    }))
    .filter((f) => f.name && f.stalls > 0 && /in operation/i.test(f.status));
  if (facs.length === 0) {
    facs = (
      snapshot.facilities as { name: string; stalls: number | null; status: string }[]
    )
      .filter((f) => (f.stalls ?? 0) > 0 && /in operation/i.test(f.status ?? ""))
      .map((f) => ({ name: f.name, stalls: f.stalls ?? 0, status: f.status }));
  }

  const facList = facs.map((f) => ({ ...f, toks: tokens(f.name) }));
  const facByNorm = new Map<string, number>();
  facList.forEach((f, i) => facByNorm.set(f.toks.join(" "), i));
  const assign = (name: string): number => {
    const bt = tokens(name);
    const exact = facByNorm.get(bt.join(" "));
    if (exact != null) return exact;
    for (let i = 0; i < facList.length; i++) {
      if (looseTokens(bt, facList[i].toks)) return i;
    }
    return -1;
  };

  // Occupying monthly (cancelled-ended dropped).
  const monthly = monthlyRecs
    .map((r) => {
      const start = str(r.fields["START DATE"]);
      const end = str(r.fields["END DATE"]);
      const endMs = parseDateMs(end);
      const cancelled = /cancel/i.test(str(r.fields["REMARKS"]));
      const endPassed = endMs != null && endMs < todayStart;
      return {
        reservationId: str(r.fields["RESERVATION ID"]).trim(),
        facility: str(r.fields["Facility Name"]),
        start,
        end,
        startMs: parseDateMs(start),
        endMs,
        cancelled,
        endPassed,
        category: cancelled ? "cancelled" : endPassed ? "inactive" : "active",
      };
    })
    .filter((m) => !(m.cancelled && m.endPassed));

  // Transient (Airtable + SH Daily Parkers), deduped, cancellations removed.
  const dpConf = await loadStore("daily-parkers.json");
  const dpCanc = await loadStore("cancelled-bookings.json");
  const cancelledIds = new Set(
    dpCanc.map((c) => String(c.reservationId ?? "").trim()).filter(Boolean),
  );
  const rawTransient = [
    ...transientRecs.map((r) => {
      const platform = str(r.fields["PLATFORM"] || "").trim();
      return {
        reservationId: str(r.fields["RESERVATION ID"]).trim(),
        facility: str(r.fields["FACILITY"]).replace(/\s+/g, " ").trim(),
        start: str(r.fields["START"]),
        end: str(r.fields["END"]),
        startMs: parseDateMs(str(r.fields["START"])),
        endMs: parseDateMs(str(r.fields["END"])),
        source: /spothero/i.test(platform) ? "SpotHero" : platform || "Other",
      };
    }),
    ...dpConf.map((d) => ({
      reservationId: String(d.reservationId ?? "").trim(),
      facility: String(d.facility ?? "").trim(),
      start: String(d.start ?? ""),
      end: String(d.end ?? ""),
      startMs: d.startMs ?? parseDateMs(d.start ?? ""),
      endMs: d.endMs ?? parseDateMs(d.end ?? ""),
      source: "SpotHero",
    })),
  ];
  const seen = new Set<string>();
  const transient = rawTransient.filter((t) => {
    if (t.reservationId && seen.has(t.reservationId)) return false;
    if (t.reservationId) seen.add(t.reservationId);
    return !(t.reservationId && cancelledIds.has(t.reservationId));
  });

  // Bucket bookings per facility.
  const facMonthly: (typeof monthly)[] = facList.map(() => []);
  const facTransient: (typeof transient)[] = facList.map(() => []);
  for (const m of monthly) {
    const i = assign(m.facility);
    if (i >= 0) facMonthly[i].push(m);
  }
  for (const t of transient) {
    const i = assign(t.facility);
    if (i >= 0) facTransient[i].push(t);
  }

  // 7-day overbooking check per facility.
  interface OverbookedFacility {
    name: string;
    stalls: number;
    overbookedBy: number;
    worstDate: string;
    peakOccupied: number;
    worstDay: { monthly: number; transient: number; occupied: number };
    monthlyActive: number;
    monthlyInactive: number;
    monthlyCancelled: number;
    monthly: { reservationId: string; category: string; start: string; end: string }[];
    transient: { reservationId: string; facility: string; start: string; end: string; source: string }[];
    days: { date: string; available: number }[];
  }
  const overbooked: OverbookedFacility[] = [];

  for (let i = 0; i < facList.length; i++) {
    const f = facList[i];
    const ms = facMonthly[i];
    const ts = facTransient[i];
    if (ms.length === 0 && ts.length === 0) continue;

    let minAvail = Infinity;
    let worstDate = "";
    let peakOcc = 0;
    let wMonthly = 0;
    let wTransient = 0;
    const days: { date: string; available: number }[] = [];
    for (let d = 0; d < WINDOW_DAYS; d++) {
      const dayStart = todayStart + d * DAY;
      const dayEnd = dayStart + DAY;
      // Each monthly occupies its actual [start, end] term — same interval-
      // overlap logic as transient. Cancelled included: it still holds its
      // stall until its end date, so it counts while it overlaps the others.
      const mOcc = ms.filter((m) => {
        const s = m.startMs ?? -Infinity;
        const e = m.endMs ?? Infinity;
        return s <= dayStart && e >= dayStart;
      }).length;
      const tPeak = dayTransientPeak(ts, dayStart, dayEnd);
      const occ = mOcc + tPeak;
      const avail = f.stalls - occ;
      if (occ > peakOcc) peakOcc = occ;
      if (avail < minAvail) {
        minAvail = avail;
        worstDate = new Date(dayStart).toISOString();
        wMonthly = mOcc;
        wTransient = tPeak;
      }
      days.push({ date: new Date(dayStart).toISOString(), available: avail });
    }
    if (minAvail < 0) {
      overbooked.push({
        name: f.name,
        stalls: f.stalls,
        overbookedBy: -minAvail,
        worstDate,
        peakOccupied: peakOcc,
        worstDay: {
          monthly: wMonthly,
          transient: wTransient,
          occupied: wMonthly + wTransient,
        },
        monthlyActive: ms.filter((m) => m.category === "active").length,
        monthlyInactive: ms.filter((m) => m.category === "inactive").length,
        monthlyCancelled: ms.filter((m) => m.category === "cancelled").length,
        monthly: ms.map((m) => ({
          reservationId: m.reservationId,
          category: m.category,
          start: m.start,
          end: m.end,
        })),
        transient: ts.map((t) => ({
          reservationId: t.reservationId,
          facility: t.facility,
          start: t.start,
          end: t.end,
          source: t.source,
        })),
        days,
      });
    }
  }

  overbooked.sort((a, b) => b.overbookedBy - a.overbookedBy);

  return Response.json({
    scannedAt: new Date().toISOString(),
    facilitiesScanned: facList.length,
    windowDays: WINDOW_DAYS,
    overbooked,
  });
}
