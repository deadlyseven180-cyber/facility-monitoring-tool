// Modular refund-reason filters. New report types (Unauthorized Parking,
// Wrong Spot, Towed Vehicles, etc.) can be added here without touching the
// analysis engine — just define another RefundFilter and expose it.

export interface RefundFilter {
  id: string;
  label: string;
  /** Case-insensitive substrings; a reason matches if it contains ANY. */
  patterns: string[];
}

export const LOT_FULL_FILTER: RefundFilter = {
  id: "lot_full",
  label: "Lot Full",
  patterns: ["lot full", "lot was full"],
};

// SpotHero CSVs spell it "Inaccessible"; internal refund CSVs use
// "Inaccessibility"; the Customer Interactions / RingCentral conversation
// exports use "INACCESIBLE …" (one s) and "INACCESSIBLE …" (two s). The stems
// below tolerate every spelling variant — one/two c's, one/two s's, and the
// -ible / -ibility / -ability endings:
//   "inacces" → Inaccesible, Inaccessible, Inaccessibility (double-c, any s)
//   "inaccess" → Inaccessible, Inaccessibility, Inaccessability
//   "inacess"  → Inacessibility, Inacessability (single-c misspellings)
export const INACCESSIBILITY_FILTER: RefundFilter = {
  id: "inaccessibility",
  label: "Inaccessibility",
  patterns: ["inacces", "inaccess", "inacess"],
};

/** Lot Full + Inaccessibility — everything the report can currently surface. */
export const ALL_ISSUES_FILTER: RefundFilter = {
  id: "all",
  label: "All Issues",
  patterns: [...LOT_FULL_FILTER.patterns, ...INACCESSIBILITY_FILTER.patterns],
};

/** Category chosen in the report's filter dropdown. */
export type IssueCategory = "all" | "lot_full" | "inaccessibility";

/** Map a dropdown category to its reason filter. */
export function filterForCategory(category: IssueCategory): RefundFilter {
  if (category === "lot_full") return LOT_FULL_FILTER;
  if (category === "inaccessibility") return INACCESSIBILITY_FILTER;
  return ALL_ISSUES_FILTER;
}

/** Per-record category, derived from the matched reason. */
export type RecordCategory = "lot_full" | "inaccessibility" | "other";

export function categoryForReason(reason: string): RecordCategory {
  if (matchesFilter(reason, LOT_FULL_FILTER)) return "lot_full";
  if (matchesFilter(reason, INACCESSIBILITY_FILTER)) return "inaccessibility";
  return "other";
}

// Future filters (not yet surfaced in the UI) — scaffolding for expansion.
export const FUTURE_FILTERS: RefundFilter[] = [
  { id: "unauthorized", label: "Unauthorized Parking", patterns: ["unauthorized"] },
  { id: "wrong_spot", label: "Wrong Spot", patterns: ["wrong spot"] },
  {
    id: "invalid_plate",
    label: "Invalid License Plate",
    patterns: ["invalid license", "invalid plate"],
  },
  { id: "towed", label: "Towed Vehicles", patterns: ["towed", "tow"] },
  { id: "complaint", label: "Customer Complaints", patterns: ["complaint"] },
];

/** Registry of currently-available filters (extend as features ship). */
export const AVAILABLE_FILTERS: RefundFilter[] = [LOT_FULL_FILTER];

/** True if a refund-reason value matches the given filter (case-insensitive). */
export function matchesFilter(reason: string, filter: RefundFilter): boolean {
  const r = reason.toLowerCase();
  return filter.patterns.some((p) => r.includes(p));
}
