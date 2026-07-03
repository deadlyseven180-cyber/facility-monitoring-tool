// Column resolution + value parsing for SpotHero accounting reports.
// Header names vary slightly between exports, so we match them tolerantly.

/** Normalize a header: lowercase, collapse separators/whitespace. */
function normalize(header: string): string {
  return header
    .toLowerCase()
    .replace(/[_/\\.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Find the actual header in `headers` that best matches one of `candidates`.
 * Tries exact normalized match first, then a contains-match fallback.
 * Returns the original header string, or null if nothing matches.
 */
export function resolveColumn(
  headers: string[],
  candidates: string[],
): string | null {
  const normed = headers.map((h) => [h, normalize(h)] as const);

  for (const candidate of candidates) {
    const cn = normalize(candidate);
    const exact = normed.find(([, n]) => n === cn);
    if (exact) return exact[0];
  }
  for (const candidate of candidates) {
    const cn = normalize(candidate);
    const partial = normed.find(([, n]) => n.includes(cn));
    if (partial) return partial[0];
  }
  return null;
}

/** The logical columns the analyzer needs, with accepted header aliases. */
export const COLUMN_CANDIDATES = {
  reason: [
    "Refund or Adjustment Reason",
    "Refund/Adjustment Reason",
    "Refund Reason",
    "Adjustment Reason",
    "Reason",
  ],
  rentalId: ["Rental ID", "RentalID", "Rental"],
  spot: ["Spot", "Spot ID", "Spot Name"],
  starts: ["Starts", "Start", "Start Time", "Start Date"],
  refundAmount: ["Refund Amount", "Refund", "Refunded Amount"],
  facility: ["MA State", "Facility", "Facility Name", "Garage"],
  // Prefer the NET remit column (after fees/refunds); only fall back to the
  // gross "Total Remit" when no net column exists. A report can contain both,
  // and the net figure is the one that matches SpotHero's reported total.
  totalRemit: [
    "Net Total Remit",
    "Total Net Remit",
    "Net Remit",
    "Net Total Remittance",
    "Total Net Remittance",
    "Net Remittance",
    "Net Remit Total",
    "Total Remit",
    "Remit",
    "Total Remittance",
  ],
} as const;

/**
 * Optional human-readable facility name. When present, it is used as the
 * facility label everywhere instead of the MA State value. Listed most
 * specific first so exact matches win over the generic "Facility".
 */
export const FACILITY_NAME_CANDIDATES = [
  "Facility Name",
  "Garage Name",
  "Property Name",
  "Location Name",
  "Lot Name",
  "Garage",
  "Property",
  "Facility",
];

export type ColumnKey = keyof typeof COLUMN_CANDIDATES;

export type ColumnMap = Record<ColumnKey, string>;

/** Human-friendly labels for missing-column error messages. */
const COLUMN_LABELS: Record<ColumnKey, string> = {
  reason: "Refund or Adjustment Reason",
  rentalId: "Rental ID",
  spot: "Spot",
  starts: "Starts",
  refundAmount: "Refund Amount",
  facility: "MA State",
  totalRemit: "Total Remit",
};

/**
 * Resolve every required column. Returns the map plus a list of any
 * logical columns that could not be found (by their friendly label).
 */
export function resolveColumns(headers: string[]): {
  map: Partial<ColumnMap>;
  missing: string[];
} {
  const map: Partial<ColumnMap> = {};
  const missing: string[] = [];

  (Object.keys(COLUMN_CANDIDATES) as ColumnKey[]).forEach((key) => {
    if (key === "totalRemit") return; // resolved with a dedicated rule below
    const found = resolveColumn(headers, [...COLUMN_CANDIDATES[key]]);
    if (found) map[key] = found;
    else missing.push(COLUMN_LABELS[key]);
  });

  // Net remit: SpotHero's true net payout lives in the "net total remit" column
  // (column Z in the full accounting export). Prefer ANY header containing both
  // "net" and "remit" so every naming variant is caught; only fall back to a
  // plain "remit" column when no net column exists. This drives the Total Net
  // Remit totals (per facility and per state) on both the report and compare
  // tabs, for every state and any uploaded CSV.
  const netRemitCol = headers.find((h) => {
    const n = normalize(h);
    return n.includes("net") && n.includes("remit");
  });
  const anyRemitCol = headers.find((h) => normalize(h).includes("remit"));
  const remitCol = netRemitCol ?? anyRemitCol;
  if (remitCol) map.totalRemit = remitCol;
  else missing.push(COLUMN_LABELS.totalRemit);

  return { map, missing };
}

/**
 * Normalize a date-ish cell to an ISO `YYYY-MM-DD` string (day granularity),
 * or null if it can't be understood. Lexicographic comparison of these strings
 * is equivalent to chronological comparison, so range filtering needs no
 * timezone math.
 *
 * Handles: "2026-06-01", "2026-06-01 08:00", "2026-06-01T08:00:00",
 * "6/1/2026", "06/01/26", and anything Date can parse as a fallback.
 */
export function toIsoDate(value: string | undefined | null): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (s === "") return null;

  const datePart = s.split(/[ T]/)[0];

  let m = datePart.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  }

  m = datePart.match(/^(\d{1,2})[/](\d{1,2})[/](\d{2,4})$/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }

  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return `${y}-${mo}-${da}`;
  }
  return null;
}

/**
 * A "min..max" key of a file's date coverage (from its Starts/Date column),
 * used to detect duplicate reporting periods. Null if no dates are found.
 */
export function fileDateRangeKey(
  headers: string[],
  rows: Record<string, string>[],
): string | null {
  const dateCol = resolveColumn(headers, [
    "Starts",
    "Date",
    "Start Date",
    "Start",
  ]);
  if (!dateCol) return null;
  let min: string | null = null;
  let max: string | null = null;
  for (const r of rows) {
    const iso = toIsoDate(r[dateCol]);
    if (!iso) continue;
    if (min === null || iso < min) min = iso;
    if (max === null || iso > max) max = iso;
  }
  return min && max ? `${min}..${max}` : null;
}

/**
 * Parse a currency-ish string to a number.
 * Handles "$1,234.50", "(45.00)" (negative), leading "-", and blanks.
 */
export function parseMoney(value: string | undefined | null): number {
  if (value == null) return 0;
  let s = String(value).trim();
  if (s === "") return 0;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.includes("-")) negative = true;

  s = s.replace(/[^0-9.]/g, "");
  if (s === "" || s === ".") return 0;

  const n = Number.parseFloat(s);
  if (Number.isNaN(n)) return 0;
  return negative ? -n : n;
}
