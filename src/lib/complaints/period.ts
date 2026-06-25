// Period bucketing + progress math for the Facility Progress Checker.
// Bi-weekly is the PRIMARY KPI: Period 1 = days 1-14, Period 2 = day 15 → end.

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export interface PeriodParts {
  year: number;
  month: number; // 1-12
  biweekly: 1 | 2;
  weekStartISO: string; // Monday of the complaint's week
}

/** Parse an ISO (or loose) date into Y/M/biweekly/week parts (local). */
export function periodOf(iso: string): PeriodParts | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  let d: Date;
  if (m) d = new Date(+m[1], +m[2] - 1, +m[3]);
  else {
    const p = Date.parse(iso);
    if (Number.isNaN(p)) return null;
    d = new Date(p);
  }
  const day = d.getDate();
  // Monday-start week
  const wd = (d.getDay() + 6) % 7;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - wd);
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    biweekly: day <= 14 ? 1 : 2,
    weekStartISO: `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`,
  };
}

/** "2026-05 P1" style key for a bi-weekly period. */
export function biweeklyKey(year: number, month: number, bw: 1 | 2): string {
  return `${year}-${String(month).padStart(2, "0")} P${bw}`;
}
export function biweeklyLabel(year: number, month: number, bw: 1 | 2): string {
  const lastDay = new Date(year, month, 0).getDate();
  return bw === 1
    ? `${MONTHS[month - 1]} 1–14, ${year}`
    : `${MONTHS[month - 1]} 15–${lastDay}, ${year}`;
}

/** Percentage change from a previous count to a current count. */
export function changePct(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 100;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export type TrendDir = "down" | "up" | "flat";
/** For complaints, DOWN is good. Returns the raw direction of the count. */
export function trendDir(current: number, previous: number): TrendDir {
  if (current < previous) return "down";
  if (current > previous) return "up";
  return "flat";
}
