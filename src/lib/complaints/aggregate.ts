// Client-side aggregation for the Facility Progress Checker. All trend math runs
// here on the single fetched dataset (fast, no re-fetch per view).

import { MONTHS, biweeklyKey, biweeklyLabel, periodOf, changePct, trendDir, type TrendDir } from "./period";
import type { ComplaintRecord, ComplaintType, ComplaintSource } from "./types";

/** Stable key for a complaint, used to attach the per-complaint overlay. */
export function complaintKey(r: { rentalId: string; facilityName: string; complaintDate: string; complaintType: string }): string {
  return r.rentalId ? `id:${r.rentalId}` : `sig:${r.facilityName}|${r.complaintDate}|${r.complaintType}`;
}

/** Normalized Levenshtein similarity (0–1) between two facility names. */
function nameSimilarity(a: string, b: string): number {
  const s = a.toLowerCase().trim(), t = b.toLowerCase().trim();
  if (s === t) return 1;
  const m = s.length, n = t.length;
  if (!m || !n) return 0;
  if (Math.abs(m - n) / Math.max(m, n) > 0.1) return 0; // length too different to be ≥90%
  const dp = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = s[i - 1] === t[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return 1 - dp[n] / Math.max(m, n);
}

/**
 * Cluster near-duplicate facility names: any name ≥90% similar to a cluster's
 * representative is folded into it. `names` should be ordered most-frequent
 * first so the common spelling becomes the representative. Returns a map from
 * every raw name to its representative, plus the list of representatives.
 */
export function clusterFacilities(names: string[]): { repOf: Map<string, string>; reps: string[] } {
  const reps: string[] = [];
  const repOf = new Map<string, string>();
  for (const name of names) {
    let rep = reps.find((r) => nameSimilarity(name, r) >= 0.9);
    if (!rep) { rep = name; reps.push(name); }
    repOf.set(name, rep);
  }
  return { repOf, reps };
}

/** Configurable root-cause options per complaint type. */
export const ROOT_CAUSES: Record<ComplaintType, string[]> = {
  lot_full: ["Oversold Inventory", "Monthly Parker Occupancy", "Event Parking Conflict", "Inventory Configuration Issue", "Unauthorized Parking", "Unknown"],
  inaccessibility: ["Incorrect Gate Code", "Poor Getting There Instructions", "Construction Work", "Missing Signage", "Access Restriction", "Facility Closure", "Unknown"],
};

export interface Counts {
  total: number;
  spotHero: number;
  internal: number;
  lotFull: number;
  inaccessibility: number;
}
export function emptyCounts(): Counts {
  return { total: 0, spotHero: 0, internal: 0, lotFull: 0, inaccessibility: 0 };
}
export function tally(records: ComplaintRecord[]): Counts {
  const c = emptyCounts();
  for (const r of records) {
    c.total++;
    if (r.source === "SpotHero") c.spotHero++; else c.internal++;
    if (r.complaintType === "lot_full") c.lotFull++; else c.inaccessibility++;
  }
  return c;
}

export interface Filters {
  year?: number;
  month?: number;
  biweekly?: 1 | 2;
  facility?: string;
  type?: ComplaintType;
  source?: ComplaintSource;
  start?: string; // ISO
  end?: string; // ISO
}
export function applyFilters(records: ComplaintRecord[], f: Filters): ComplaintRecord[] {
  return records.filter((r) => {
    if (f.year && r.reportingYear !== f.year) return false;
    if (f.month && r.reportingMonth !== f.month) return false;
    if (f.biweekly && r.reportingBiweekly !== f.biweekly) return false;
    if (f.facility && r.facilityName !== f.facility) return false;
    if (f.type && r.complaintType !== f.type) return false;
    if (f.source && r.source !== f.source) return false;
    if (f.start && r.complaintDate < f.start) return false;
    if (f.end && r.complaintDate > f.end) return false;
    return true;
  });
}

export interface SeriesPoint { key: string; label: string; range: string; sort: number; counts: Counts }

const fmtShort = (d: Date) => d.toLocaleDateString([], { month: "short", day: "numeric" });

export function biweeklySeries(records: ComplaintRecord[]): SeriesPoint[] {
  const m = new Map<string, ComplaintRecord[]>();
  for (const r of records) {
    const k = biweeklyKey(r.reportingYear, r.reportingMonth, r.reportingBiweekly);
    (m.get(k) ?? m.set(k, []).get(k)!).push(r);
  }
  return [...m.entries()]
    .map(([key, recs]) => {
      const [, , bwStr] = key.match(/^(\d{4})-(\d{2}) P(\d)$/) ?? [];
      const r0 = recs[0];
      const range = biweeklyLabel(r0.reportingYear, r0.reportingMonth, r0.reportingBiweekly);
      return {
        key,
        label: `${MONTHS[r0.reportingMonth - 1].slice(0, 3)} P${r0.reportingBiweekly}`,
        range,
        sort: r0.reportingYear * 100 + r0.reportingMonth * 10 + Number(bwStr ?? r0.reportingBiweekly),
        counts: tally(recs),
      };
    })
    .sort((a, b) => a.sort - b.sort);
}

export function monthlySeries(records: ComplaintRecord[]): SeriesPoint[] {
  const m = new Map<string, ComplaintRecord[]>();
  for (const r of records) {
    const k = `${r.reportingYear}-${String(r.reportingMonth).padStart(2, "0")}`;
    (m.get(k) ?? m.set(k, []).get(k)!).push(r);
  }
  return [...m.entries()]
    .map(([key, recs]) => {
      const r0 = recs[0];
      const last = new Date(r0.reportingYear, r0.reportingMonth, 0).getDate();
      return {
        key,
        label: `${MONTHS[r0.reportingMonth - 1].slice(0, 3)} ${r0.reportingYear}`,
        range: `${MONTHS[r0.reportingMonth - 1]} 1–${last}, ${r0.reportingYear}`,
        sort: r0.reportingYear * 100 + r0.reportingMonth,
        counts: tally(recs),
      };
    })
    .sort((a, b) => a.sort - b.sort);
}

export function yearlySeries(records: ComplaintRecord[]): SeriesPoint[] {
  const m = new Map<number, ComplaintRecord[]>();
  for (const r of records) (m.get(r.reportingYear) ?? m.set(r.reportingYear, []).get(r.reportingYear)!).push(r);
  return [...m.entries()].map(([y, recs]) => ({ key: String(y), label: String(y), range: `Jan–Dec ${y}`, sort: y, counts: tally(recs) })).sort((a, b) => a.sort - b.sort);
}

export function weeklySeries(records: ComplaintRecord[]): SeriesPoint[] {
  const m = new Map<string, ComplaintRecord[]>();
  for (const r of records) {
    const w = periodOf(r.complaintDate)?.weekStartISO;
    if (!w) continue;
    (m.get(w) ?? m.set(w, []).get(w)!).push(r);
  }
  return [...m.entries()]
    .map(([key, recs]) => {
      const d = new Date(key);
      const end = new Date(d);
      end.setDate(d.getDate() + 6);
      return { key, label: fmtShort(d), range: `${fmtShort(d)} – ${fmtShort(end)}`, sort: d.getTime(), counts: tally(recs) };
    })
    .sort((a, b) => a.sort - b.sort);
}

export type Gran = "weekly" | "biweekly" | "monthly" | "yearly";
export function seriesFor(records: ComplaintRecord[], gran: Gran): SeriesPoint[] {
  return gran === "weekly" ? weeklySeries(records)
    : gran === "monthly" ? monthlySeries(records)
    : gran === "yearly" ? yearlySeries(records)
    : biweeklySeries(records);
}
function periodSortKey(r: ComplaintRecord, gran: Gran): number {
  if (gran === "yearly") return r.reportingYear;
  if (gran === "monthly") return r.reportingYear * 100 + r.reportingMonth;
  if (gran === "biweekly") return r.reportingYear * 1000 + r.reportingMonth * 10 + r.reportingBiweekly;
  const w = periodOf(r.complaintDate)?.weekStartISO;
  return w ? Math.round(new Date(w).getTime() / 86_400_000) : 0;
}

export interface FacilityRow {
  name: string;
  facilityId: string;
  counts: Counts;
  current: number; // latest period count
  previous: number; // prior period count
  changePct: number;
  dir: TrendDir;
}

/**
 * Per-facility rollup, with a current-vs-previous trend computed from the two
 * most recent periods at the requested granularity (default bi-weekly).
 */
export function facilityRollup(records: ComplaintRecord[], gran: Gran = "biweekly"): FacilityRow[] {
  const periods = [...new Set(records.map((r) => periodSortKey(r, gran)))].sort((a, b) => a - b);
  const curSort = periods[periods.length - 1];
  const prevSort = periods[periods.length - 2];

  const m = new Map<string, ComplaintRecord[]>();
  for (const r of records) {
    const k = r.facilityName || "(Unknown)";
    (m.get(k) ?? m.set(k, []).get(k)!).push(r);
  }
  return [...m.entries()].map(([name, recs]) => {
    const cur = curSort !== undefined ? recs.filter((r) => periodSortKey(r, gran) === curSort).length : 0;
    const prev = prevSort !== undefined ? recs.filter((r) => periodSortKey(r, gran) === prevSort).length : 0;
    return {
      name,
      facilityId: recs.find((r) => r.facilityId)?.facilityId ?? "",
      counts: tally(recs),
      current: cur,
      previous: prev,
      changePct: changePct(cur, prev),
      dir: trendDir(cur, prev),
    };
  });
}

/** Compare two record sets and return the headline progress numbers. */
export function compare(current: ComplaintRecord[], previous: ComplaintRecord[]) {
  const c = current.length, p = previous.length;
  return { current: c, previous: p, diff: c - p, pct: changePct(c, p), dir: trendDir(c, p) };
}

const DAY_MS = 86_400_000;
export type AlertLevel = "Critical" | "High Risk" | "Warning" | "Stable";
/** Alert level from a facility's total complaint volume. */
export function alertLevel(total: number): AlertLevel {
  if (total >= 50) return "Critical";
  if (total >= 25) return "High Risk";
  if (total >= 10) return "Warning";
  return "Stable";
}

/** 30 days before vs 30 days after an action's implementation date. */
export function actionImpact(records: ComplaintRecord[], facility: string, dateImplementedISO: string) {
  const d = new Date(dateImplementedISO).getTime();
  if (Number.isNaN(d)) return null;
  const win = (from: number, to: number) =>
    records.filter((r) => {
      if (r.facilityName !== facility) return false;
      const t = new Date(r.complaintDate).getTime();
      return !Number.isNaN(t) && t >= from && t < to;
    }).length;
  const before = win(d - 30 * DAY_MS, d);
  const after = win(d, d + 30 * DAY_MS);
  return { before, after, diff: after - before, pct: changePct(after, before) };
}

/** Run-rate forecast for end of month / quarter from records (now = Date.now()). */
export function forecast(records: ComplaintRecord[], now: number) {
  const d = new Date(now);
  const y = d.getFullYear(), m = d.getMonth();
  const monthSoFar = records.filter((r) => r.reportingYear === y && r.reportingMonth === m + 1).length;
  const dayOfMonth = d.getDate();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const eomProjected = dayOfMonth ? Math.round((monthSoFar / dayOfMonth) * daysInMonth) : monthSoFar;

  const q = Math.floor(m / 3);
  const qStart = new Date(y, q * 3, 1).getTime();
  const qEnd = new Date(y, q * 3 + 3, 1).getTime();
  const qSoFar = records.filter((r) => { const t = new Date(r.complaintDate).getTime(); return t >= qStart && t < qEnd; }).length;
  const qElapsed = Math.max(1, (now - qStart) / DAY_MS);
  const qTotal = (qEnd - qStart) / DAY_MS;
  const eoqProjected = Math.round((qSoFar / qElapsed) * qTotal);

  const pm = m === 0 ? 12 : m, py = m === 0 ? y - 1 : y;
  const prevMonth = records.filter((r) => r.reportingYear === py && r.reportingMonth === pm).length;
  const risk: "increasing" | "stable" | "improving" =
    eomProjected > prevMonth * 1.05 ? "increasing" : eomProjected < prevMonth * 0.95 ? "improving" : "stable";
  return { monthSoFar, eomProjected, eomPct: changePct(eomProjected, monthSoFar), qSoFar, eoqProjected, prevMonth, risk };
}
