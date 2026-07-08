// The SpotHero report analysis engine.
// Modular by design: pass any RefundFilter and (optionally) a custom ScoreFn.

import type { ParsedCsv } from "@/types/data";
import type {
  FacilitySummary,
  FilteredRecord,
  ReportResult,
  StateSummary,
} from "@/types/report";
import {
  FACILITY_NAME_CANDIDATES,
  parseMoney,
  resolveColumn,
  resolveColumns,
  toIsoDate,
  type ColumnMap,
} from "./columns";
import { stateForCity } from "./cities";
import {
  canonicalFacilityKey,
  canonicalStreetKey,
  normalizeState,
} from "./facilityKey";
import { categoryForReason, matchesFilter, type RefundFilter } from "./filters";
import {
  defaultScoreFn,
  priorityLevelFromCount,
  type ScoreFn,
} from "./scoring";

/** Inclusive date range as ISO `YYYY-MM-DD` strings. Either bound is optional. */
export interface DateRange {
  start?: string;
  end?: string;
}

/**
 * An explicit mapping of logical fields → actual CSV header names, as chosen
 * in the column-mapping UI. Required fields are header strings; `facilityName`
 * is "" when there is no separate facility-name column.
 */
export interface DetectedColumns {
  reason: string;
  rentalId: string;
  spot: string;
  starts: string;
  refundAmount: string;
  facility: string;
  totalRemit: string;
  facilityName: string;
}

/** Logical fields that must be mapped for analysis to run. */
export const REQUIRED_FIELDS: (keyof DetectedColumns)[] = [
  "reason",
  "rentalId",
  "spot",
  "starts",
  "refundAmount",
  "facility",
  "totalRemit",
];

/**
 * Best-effort auto-detection of every column from the headers, used to seed
 * the mapping UI. Unmatched fields come back as "".
 */
export function detectColumns(headers: string[]): DetectedColumns {
  const { map } = resolveColumns(headers);
  const name = resolveColumn(headers, [...FACILITY_NAME_CANDIDATES]);
  return {
    reason: map.reason ?? "",
    rentalId: map.rentalId ?? "",
    spot: map.spot ?? "",
    starts: map.starts ?? "",
    refundAmount: map.refundAmount ?? "",
    facility: map.facility ?? "",
    totalRemit: map.totalRemit ?? "",
    facilityName: name && name !== map.facility ? name : "",
  };
}

/** Required fields that are still unmapped in a DetectedColumns. */
export function missingRequired(cols: DetectedColumns): (keyof DetectedColumns)[] {
  return REQUIRED_FIELDS.filter((f) => !cols[f]);
}

export interface AnalyzeOptions {
  scoreFn?: ScoreFn;
  dateRange?: DateRange;
  /** Explicit column mapping; overrides auto-detection when provided. */
  columns?: DetectedColumns;
  /** Restrict the report to one state (e.g. "MA"); "All"/undefined = no filter. */
  stateFilter?: string;
  /**
   * Canonical-facility-key → state (MA/IL/DC) lookup, used to fill in the state
   * for facilities whose uploaded rows carry no state (e.g. call logs). See
   * `canonicalFacilityKey`. Optional — falls back to states found in the data.
   */
  facilityStates?: Record<string, string>;
}

/** True if an ISO date falls within the range. Rows with no/unknown date pass. */
function inRange(isoDate: string | null, range?: DateRange): boolean {
  if (!range || (!range.start && !range.end)) return true;
  if (isoDate == null) return true; // can't place undated rows — keep them
  if (range.start && isoDate < range.start) return false;
  if (range.end && isoDate > range.end) return false;
  return true;
}

/**
 * Min/max `Starts` date in the report (ISO strings), for seeding the UI's
 * date-range picker. Returns null if the report has no parseable dates.
 */
export function getDateBounds(
  data: ParsedCsv,
  startsColumn?: string,
): { min: string; max: string } | null {
  const startsCol = startsColumn ?? resolveColumns(data.headers).map.starts;
  if (!startsCol) return null;
  let min: string | null = null;
  let max: string | null = null;
  for (const row of data.rows) {
    const iso = toIsoDate(row[startsCol]);
    if (!iso) continue;
    if (min === null || iso < min) min = iso;
    if (max === null || iso > max) max = iso;
  }
  return min && max ? { min, max } : null;
}

/** Filename prefix that identifies a SpotHero accounting report. */
export const ACCOUNTING_PREFIX = "cp_accounting_detail";
/** Filename prefix that identifies an internal refunds/reimbursement report. */
export const INTERNAL_PREFIX = "refunds&reimbursement";

/**
 * The source kind of an uploaded report file:
 * - spothero      → cp_accounting_detail accounting export
 * - internal      → REFUNDS&REIMBURSEMENT refund/reimbursement export
 * - interactions  → CUSTOMER INTERACTIONS / RingCentral Conversations export
 *   (call-center logs filtered by "REASON FOR CONTACT CATEGORY"). Counted as
 *   internal issues in the report.
 */
export type ReportSource = "spothero" | "internal" | "interactions";

/** True if the filename marks a SpotHero accounting report. */
export function isAccountingReport(fileName: string): boolean {
  return fileName.trim().toLowerCase().startsWith(ACCOUNTING_PREFIX);
}

/** True if the filename marks an internal refunds/reimbursement report. */
export function isInternalReport(fileName: string): boolean {
  return fileName.replace(/\s+/g, "").toLowerCase().startsWith(INTERNAL_PREFIX);
}

/**
 * True if the filename marks a Customer Interactions or RingCentral
 * Conversations export. Matched leniently (anywhere in the name) so date or
 * batch suffixes don't break detection.
 */
export function isInteractionsReport(fileName: string): boolean {
  const n = fileName.replace(/\s+/g, "").toLowerCase();
  return n.includes("customerinteractions") || n.includes("ringcentral");
}

/** Human-readable "where the conversation lives" label, from the filename. */
export function interactionsSourceLabel(fileName: string): string {
  const n = fileName.replace(/\s+/g, "").toLowerCase();
  if (n.includes("ringcentral")) return "RingCentral";
  if (n.includes("customerinteractions")) return "Customer Interactions";
  return "Conversation";
}

/** Classify an uploaded file by its name, or null if unsupported. */
export function classifyReport(fileName: string): ReportSource | null {
  if (isAccountingReport(fileName)) return "spothero";
  if (isInternalReport(fileName)) return "internal";
  if (isInteractionsReport(fileName)) return "interactions";
  return null;
}

/** Thrown when required columns are missing from the report. */
export class ReportColumnError extends Error {
  missing: string[];
  constructor(missing: string[]) {
    super(
      `This report is missing required column(s): ${missing.join(", ")}.`,
    );
    this.name = "ReportColumnError";
    this.missing = missing;
  }
}

const UNKNOWN_FACILITY = "(Unknown facility)";
const UNKNOWN_STATE = "(Unknown)";

/**
 * Analyze a parsed accounting report under one filter.
 *
 * - Optionally scopes the whole report to a `Starts` date range.
 * - Filters rows by refund reason.
 * - Groups matches by facility name → incident count + refund total.
 * - Sums Total Remit across ALL (in-range) rows of each affected facility.
 * - Computes a modular priority score + level per facility.
 *
 * Business rule for cp_accounting_detail reports: the facility NAME is the
 * value in the "Spot" column. The MA State / facility-id column is used only
 * for the state-level roll-up (and as a fallback label).
 */
export function analyzeReport(
  data: ParsedCsv,
  filter: RefundFilter,
  options: AnalyzeOptions = {},
): ReportResult {
  const { scoreFn = defaultScoreFn, dateRange, columns, stateFilter } = options;

  let cols: ColumnMap;
  if (columns) {
    // Explicit mapping from the UI.
    const missing = missingRequired(columns);
    if (missing.length > 0) throw new ReportColumnError(missing);
    cols = columns;
  } else {
    // Auto-detect.
    const { map, missing } = resolveColumns(data.headers);
    if (missing.length > 0) throw new ReportColumnError(missing);
    cols = map as ColumnMap;
  }

  // MA business rule: for Massachusetts rows the executive/summary "Total Net
  // Remit" must be summed from the CSV's "Total Remit" column (col O = gross
  // remit − refunds − manual adjustments, which is exactly what SpotHero's
  // control panel reports as "Net Remit"), NOT the tax-netted "Net Total Remit"
  // column (col Z) used for every other state. Resolve that column once and use
  // it only for MA; fall back to the default remit column when it's absent.
  const maRemitCol =
    resolveColumn(data.headers, ["Total Remit", "Total Remittance"]) ?? cols.totalRemit;
  const remitColFor = (state: string): string =>
    state === "MA" ? maRemitCol : cols.totalRemit;

  // Raw facility label from the "Spot" column, falling back to MA State.
  const facilityLabelRaw = (row: Record<string, string>): string =>
    (row[cols.spot] ?? "").trim() ||
    (row[cols.facility] ?? "").trim() ||
    UNKNOWN_FACILITY;

  // Per-row reporting year (from the Starts date). "" when undated.
  const rowYear = (row: Record<string, string>): string => {
    const iso = toIsoDate(row[cols.starts]);
    return iso ? iso.slice(0, 4) : "";
  };

  // Canonical grouping key: facility (case/punctuation/spacing-insensitive) +
  // reporting YEAR, so a facility's 2025 and 2026 complaints stay on separate
  // summary rows instead of being combined into one.
  const keyOf = (row: Record<string, string>): string => {
    const raw = facilityLabelRaw(row);
    if (raw === UNKNOWN_FACILITY) return "__unknown__";
    const fk = canonicalFacilityKey(raw) || "__unknown__";
    if (fk === "__unknown__") return "__unknown__";
    return `${fk}|${rowYear(row)}`;
  };

  // The facility part of a composite key (strips the "|year" suffix).
  const facilityPart = (k: string): string =>
    k.includes("|") ? k.slice(0, k.lastIndexOf("|")) : k;
  const yearPart = (k: string): string =>
    k.includes("|") ? k.slice(k.lastIndexOf("|") + 1) : "";

  // Pick the cleanest display label for each canonical key: the spelling that
  // appears most often (tie-break: longest) across every row in the dataset.
  // Also remember each key's street key, for the fallback state lookup.
  const labelFreq = new Map<string, Map<string, number>>();
  const keyToStreet = new Map<string, string>();
  for (const row of data.rows) {
    const k = keyOf(row);
    const raw = facilityLabelRaw(row);
    const m = labelFreq.get(k) ?? new Map<string, number>();
    m.set(raw, (m.get(raw) ?? 0) + 1);
    labelFreq.set(k, m);
    if (!keyToStreet.has(k)) keyToStreet.set(k, canonicalStreetKey(raw));
  }
  const bestLabel = (k: string): string => {
    const m = labelFreq.get(k);
    if (!m) return UNKNOWN_FACILITY;
    let best = UNKNOWN_FACILITY;
    let bestN = -1;
    for (const [label, n] of m) {
      if (n > bestN || (n === bestN && label.length > best.length)) {
        best = label;
        bestN = n;
      }
    }
    return best;
  };

  // Optional column (auto-detected): SpotHero City → state mapping.
  const cityCol = resolveColumn(data.headers, [
    "SpotHero City",
    "Spothero City",
    "City",
  ]);

  // Raw per-row state: SpotHero City (e.g. Boston → MA) when available, else
  // the MA State / facility-id column value.
  const rawStateLabel = (row: Record<string, string>): string => {
    if (cityCol) {
      const mapped = stateForCity(row[cityCol]);
      if (mapped) return mapped;
    }
    return (row[cols.facility] ?? "").trim();
  };

  // Resolve each facility's MA/IL/DC state: prefer a valid state seen in the
  // uploaded data, then fall back to the facility→state map (Airtable). Keyed
  // by canonical facility so every spelling/source shares one state.
  const snapStates = options.facilityStates ?? {};
  const dataState = new Map<string, string>();
  for (const row of data.rows) {
    const k = keyOf(row);
    if (dataState.has(k)) continue;
    const s = normalizeState(rawStateLabel(row));
    if (s) dataState.set(k, s);
  }
  // The merged dataset carries a "__source" column marking each row's origin,
  // letting us treat SpotHero and internal rows differently.
  const sourceCol = data.headers.includes("__source") ? "__source" : null;
  const isInternalRow = (r: Record<string, string>): boolean =>
    sourceCol ? r[sourceCol] === "internal" : false;

  const stateForKey = (k: string): string => {
    const fromData = dataState.get(k);
    if (fromData) return fromData;
    // The facility→state directory is keyed by facility only, so strip the year.
    const exact = normalizeState(snapStates[facilityPart(k)]);
    if (exact) return exact;
    const sk = keyToStreet.get(k);
    const street = sk ? normalizeState(snapStates[sk]) : null;
    return street ?? UNKNOWN_STATE;
  };
  // Internal complaints are placed strictly by their OWN state value (the
  // Airtable Refunds "STATE" field) — no facility-directory or sibling-row
  // inference — so per-state internal counts match Airtable's STATE filter
  // exactly (a blank-STATE facility is never pulled into MA/IL/DC). SpotHero
  // rows keep the richer per-facility state resolution.
  const rowState = (row: Record<string, string>): string =>
    isInternalRow(row)
      ? normalizeState(rawStateLabel(row)) ?? UNKNOWN_STATE
      : stateForKey(keyOf(row));

  const activeState = stateFilter && stateFilter !== "All" ? stateFilter : null;

  // Scope calculations to the selected state. The DATE RANGE filter applies
  // ONLY to internal rows — SpotHero rows are never filtered by date.
  const rows = data.rows.filter((r) => {
    if (
      isInternalRow(r) &&
      dateRange &&
      !inRange(toIsoDate(r[cols.starts]), dateRange)
    ) {
      return false;
    }
    if (activeState && rowState(r) !== activeState) return false;
    return true;
  });

  // Total Remit and the full "refund" column summed across EVERY (in-range)
  // row, by facility; Total Remit also by state.
  const remitByFacility = new Map<string, number>();
  const refundByFacility = new Map<string, number>();
  const reservationsByFacility = new Map<string, number>();
  const remitByState = new Map<string, number>();
  // Per-month aggregates for the year-over-year trend charts.
  const monthlyMap = new Map<
    string,
    { reservations: number; netRemit: number; refund: number; complaints: number }
  >();
  const monthOf = (row: Record<string, string>): string =>
    (toIsoDate(row[cols.starts]) ?? "").slice(0, 7);
  let netRemitTotal = 0;
  let refundAllTotal = 0;
  let spotHeroReservations = 0;
  for (const row of rows) {
    if (!isInternalRow(row)) spotHeroReservations += 1;
    const state = rowState(row);
    // MA rows sum the "Total Remit" column; all other states keep the default.
    const remit = parseMoney(row[remitColFor(state)]);
    const refund = parseMoney(row[cols.refundAmount]);
    netRemitTotal += remit;
    refundAllTotal += refund;
    const key = keyOf(row);
    remitByFacility.set(key, (remitByFacility.get(key) ?? 0) + remit);
    refundByFacility.set(key, (refundByFacility.get(key) ?? 0) + refund);
    reservationsByFacility.set(key, (reservationsByFacility.get(key) ?? 0) + 1);
    remitByState.set(state, (remitByState.get(state) ?? 0) + remit);
    const ym = monthOf(row);
    if (ym) {
      const e =
        monthlyMap.get(ym) ?? { reservations: 0, netRemit: 0, refund: 0, complaints: 0 };
      e.reservations += 1;
      e.netRemit += remit;
      e.refund += refund;
      monthlyMap.set(ym, e);
    }
  }

  // Filter matching records and group by facility.
  const records: FilteredRecord[] = [];
  const grouped = new Map<
    string,
    { incidentCount: number; refundTotal: number }
  >();
  const groupedState = new Map<
    string,
    { incidentCount: number; refundTotal: number }
  >();
  // Lot Full split by source file: SpotHero (cp_accounting_detail) vs Internal
  // (REFUNDS&REIMBURSEMENT), read from the merged "__source" column (computed
  // above) when present; otherwise fall back to reason phrasing.
  let spotHeroLotFull = 0;
  let internalLotFull = 0;
  // Category split (within the matched set), so the source totals can be shown
  // as Lot Full + Inaccessibility.
  let lotFullCount = 0;
  let inaccessibilityCount = 0;
  let spotHeroInaccessibility = 0;
  let internalInaccessibility = 0;
  // SpotHero-only refund column (col L) total for the matched category — the
  // uploaded CSV's own refund figure (signed), excluding internal amounts.
  let catRefundColumnTotal = 0;

  for (const row of rows) {
    const reason = row[cols.reason] ?? "";
    if (!matchesFilter(reason, filter)) continue;

    // Records with no facility name can't be attributed to a facility — skip
    // them silently (no "(Unknown facility)" group, no warning).
    const key = keyOf(row);
    if (key === "__unknown__") continue;

    // Source of this Lot Full record: prefer the merged "__source" column,
    // else infer from the reason phrasing.
    const recSource: "spothero" | "internal" = sourceCol
      ? row[sourceCol] === "internal"
        ? "internal"
        : "spothero"
      : reason.toLowerCase().includes("lot was full")
        ? "internal"
        : "spothero";
    if (recSource === "internal") internalLotFull++;
    else spotHeroLotFull++;

    const recCategory = categoryForReason(reason);
    if (recCategory === "inaccessibility") {
      inaccessibilityCount++;
      if (recSource === "internal") internalInaccessibility++;
      else spotHeroInaccessibility++;
    } else if (recCategory === "lot_full") {
      lotFullCount++;
    }

    const facility = bestLabel(key);
    const refundAmount = parseMoney(row[cols.refundAmount]);
    if (recSource === "spothero") catRefundColumnTotal += refundAmount;
    const state = stateForKey(key);

    records.push({
      rentalId: row[cols.rentalId] ?? "",
      spot: row[cols.spot] ?? "",
      starts: row[cols.starts] ?? "",
      refundAmount,
      facility,
      state,
      source: recSource,
      category: categoryForReason(reason),
    });

    const ymC = monthOf(row);
    if (ymC) {
      const e =
        monthlyMap.get(ymC) ?? { reservations: 0, netRemit: 0, refund: 0, complaints: 0 };
      e.complaints += 1;
      monthlyMap.set(ymC, e);
    }

    const g = grouped.get(key) ?? { incidentCount: 0, refundTotal: 0 };
    g.incidentCount += 1;
    g.refundTotal += refundAmount;
    grouped.set(key, g);

    const s = groupedState.get(state) ?? { incidentCount: 0, refundTotal: 0 };
    s.incidentCount += 1;
    s.refundTotal += refundAmount;
    groupedState.set(state, s);
  }

  // Build facility summaries.
  const facilities: FacilitySummary[] = [];
  for (const [key, g] of grouped) {
    const totalRemit = remitByFacility.get(key) ?? 0;
    const priorityScore = scoreFn({
      incidentCount: g.incidentCount,
      refundTotal: g.refundTotal,
      totalRemit,
    });
    const reservations = reservationsByFacility.get(key) ?? 0;
    facilities.push({
      facility: bestLabel(key),
      // Reporting year for this row ("" when undated) — keeps 2025/2026 separate.
      year: yearPart(key),
      state: stateForKey(key),
      incidentCount: g.incidentCount,
      refundTotal: g.refundTotal,
      // Refunds column = the facility's summed "refund" column (all rows).
      refundColumnTotal: refundByFacility.get(key) ?? 0,
      totalRemit,
      // Net remit = the facility's summed "total remit" column.
      netRemit: totalRemit,
      reservations,
      // Avg Rev = net remit ÷ number of reservations booked.
      avgRevPerReservation: reservations > 0 ? totalRemit / reservations : 0,
      priorityScore,
      // Priority level is driven by the complaint count, not the score.
      priorityLevel: priorityLevelFromCount(g.incidentCount),
    });
  }

  // Summary table: sort by complaint count desc (tie-break by refund total).
  facilities.sort(
    (a, b) =>
      b.incidentCount - a.incidentCount || b.refundTotal - a.refundTotal,
  );

  // Build state summaries, sorted by incident count desc.
  const states: StateSummary[] = [];
  for (const [state, s] of groupedState) {
    states.push({
      state,
      incidentCount: s.incidentCount,
      refundTotal: s.refundTotal,
      totalRemit: remitByState.get(state) ?? 0,
    });
  }
  states.sort(
    (a, b) =>
      b.incidentCount - a.incidentCount || b.refundTotal - a.refundTotal,
  );

  // Dashboard: top 10 by priority score desc.
  const topByPriority = [...facilities]
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, 10);

  const warnings: string[] = [];
  if (records.length === 0) {
    warnings.push(
      `No "${filter.label}" records were found in this report.`,
    );
  }

  return {
    filterLabel: filter.label,
    records,
    facilities,
    states,
    topByPriority,
    monthly: [...monthlyMap.entries()]
      .map(([ym, v]) => ({ ym, ...v }))
      .sort((a, b) => a.ym.localeCompare(b.ym)),
    totals: {
      incidentCount: records.length,
      refundTotal: records.reduce((s, r) => s + r.refundAmount, 0),
      catRefundColumnTotal,
      facilitiesAffected: facilities.length,
      // Each in-range row is one reservation.
      reservations: rows.length,
      spotHeroReservations,
      netRemitTotal,
      refundAllTotal,
      spotHeroLotFull,
      internalLotFull,
      lotFullCount,
      inaccessibilityCount,
      spotHeroInaccessibility,
      internalInaccessibility,
    },
    warnings,
  };
}
