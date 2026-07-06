// Merge one or more uploaded report files (SpotHero accounting +
// internal refunds/reimbursement) into a single normalized dataset that
// analyzeReport can process. A "__source" column records each row's origin.

import type { ParsedCsv } from "@/types/data";
import { parseMoney, resolveColumn, toIsoDate } from "./columns";
import { stateForCity } from "./cities";
import { normalizeState } from "./facilityKey";
import { ALL_ISSUES_FILTER, matchesFilter } from "./filters";
import {
  detectColumns,
  interactionsSourceLabel,
  type DetectedColumns,
  type ReportSource,
} from "./analyze";

/** Normalized headers of the merged dataset. */
export const MERGED_HEADERS = [
  "__source",
  "reason",
  "rentalId",
  "spot",
  "starts",
  "state",
  "refund",
  "totalRemit",
];

/** Explicit column mapping for the merged dataset (logical → header). */
export const MERGED_COLUMNS: DetectedColumns = {
  reason: "reason",
  rentalId: "rentalId",
  spot: "spot",
  starts: "starts",
  refundAmount: "refund",
  facility: "state",
  totalRemit: "totalRemit",
  facilityName: "",
};

export interface SourcedFile {
  data: ParsedCsv;
  source: ReportSource;
}

function val(row: Record<string, string>, col: string | null): string {
  return col ? (row[col] ?? "") : "";
}

/**
 * Merge sourced files into one normalized ParsedCsv.
 * - SpotHero rows keep their real reason (Lot Full is filtered downstream),
 *   facility name from the Spot column, state via SpotHero City → state
 *   mapping (else the MA State value), plus refund and total remit.
 * - Internal rows are first filtered to Lot Full via their Reason Category,
 *   then map Date/Rental ID/State/Facility and Amount (→ refund).
 */
export function mergeReportFiles(files: SourcedFile[]): ParsedCsv {
  const rows: Record<string, string>[] = [];
  // Dedup keys for the conversation exports (shared across every Customer
  // Interactions / RingCentral file so a Rental ID seen in one isn't counted
  // again in another).
  const interactionsSeen = new Set<string>();

  for (const { data, source } of files) {
    if (source === "spothero") {
      const cols = detectColumns(data.headers);
      const cityCol = resolveColumn(data.headers, [
        "SpotHero City",
        "Spothero City",
        "City",
      ]);
      // MA business rule: Massachusetts rows carry the "Total Remit" column
      // (col O = gross remit − refunds − manual adjustments = SpotHero's
      // control-panel "Net Remit"); every other state keeps the default
      // "Net Total Remit" column (col Z, net of taxes). Resolve the MA column
      // once; fall back to the default remit column when it's absent.
      const maRemitCol =
        resolveColumn(data.headers, ["Total Remit", "Total Remittance"]) ??
        cols.totalRemit;
      for (const r of data.rows) {
        const stateRaw = val(r, cols.facility || null).trim();
        const mapped = stateForCity(val(r, cityCol));
        const state = mapped ?? stateRaw;
        const remitCol =
          normalizeState(state) === "MA" ? maRemitCol : cols.totalRemit;
        rows.push({
          __source: "spothero",
          reason: val(r, cols.reason || null),
          rentalId: val(r, cols.rentalId || null),
          spot: val(r, cols.spot || null),
          starts: val(r, cols.starts || null),
          state,
          refund: val(r, cols.refundAmount || null),
          totalRemit: val(r, (remitCol || null) as string | null),
        });
      }
    } else if (source === "internal") {
      const dateCol = resolveColumn(data.headers, [
        "Date",
        "Starts",
        "Start Date",
        "Start",
      ]);
      const ridCol = resolveColumn(data.headers, [
        "Rental ID",
        "RentalID",
        "Rental",
      ]);
      const stateCol = resolveColumn(data.headers, ["State", "MA State"]);
      const facCol = resolveColumn(data.headers, [
        "Facility",
        "Facility Name",
        "Spot",
        "Garage",
      ]);
      const reasonCol = resolveColumn(data.headers, [
        "Reason Category",
        "Reason",
        "Refund or Adjustment Reason",
        "Category",
      ]);
      const amountCol = resolveColumn(data.headers, [
        "Amount",
        "Refund Amount",
        "Refund",
        "Reimbursement Amount",
        "Reimbursement",
      ]);
      for (const r of data.rows) {
        const reason = val(r, reasonCol);
        // Keep internal rows for any surfaced category (Lot Full or
        // Inaccessibility); the report's category filter narrows it later.
        if (!matchesFilter(reason, ALL_ISSUES_FILTER)) continue;
        // Internal refunds are stored NEGATIVE (like SpotHero's column L) so a
        // combined refund total adds both sources in the same direction.
        const amt = parseMoney(val(r, amountCol));
        rows.push({
          __source: "internal",
          reason,
          rentalId: val(r, ridCol),
          spot: val(r, facCol),
          starts: val(r, dateCol),
          state: val(r, stateCol),
          refund: amt ? String(-Math.abs(amt)) : "",
          totalRemit: "",
        });
      }
    } else {
      // Customer Interactions / RingCentral Conversations exports: call-center
      // logs filtered by "REASON FOR CONTACT CATEGORY". Counted as internal
      // issues (no refund/remit). Each kept row = one incident; duplicate
      // Rental IDs collapse to one.
      const reasonCol = resolveColumn(data.headers, [
        "Reason for Contact Category",
        "Reason For Contact Category",
        "Reason for Contact",
        "Contact Category",
        "Reason Category",
        "Reason",
      ]);
      const ridCol = resolveColumn(data.headers, [
        "Rental ID",
        "RentalID",
        "Rental",
        "Reservation ID",
        "Booking ID",
      ]);
      const dateCol = resolveColumn(data.headers, [
        "Date",
        "Date Created",
        "Created Date",
        "Created At",
        "Created",
        "Conversation Date",
        "Interaction Date",
        "Timestamp",
        "Start Date",
        "Start",
        "Time",
      ]);
      const facCol = resolveColumn(data.headers, [
        "Facility Name",
        "Facility",
        "Location Name",
        "Location",
        "Garage",
        "Property",
        "Spot",
        "Lot",
      ]);
      const stateCol = resolveColumn(data.headers, ["State", "MA State"]);
      // Where the conversation lives — used as the identifier when Rental ID
      // is blank. Prefer a per-row source/channel column, else the file label.
      const sourceCol = resolveColumn(data.headers, [
        "Source",
        "Conversation Source",
        "Channel",
        "Platform",
        "Queue",
      ]);
      const fileLabel = interactionsSourceLabel(data.fileName);

      for (const r of data.rows) {
        const reason = val(r, reasonCol);
        // Only the Lot Full / Inaccessibility contact categories.
        if (!matchesFilter(reason, ALL_ISSUES_FILTER)) continue;

        const ridRaw = val(r, ridCol).trim();
        const convoSource = val(r, sourceCol).trim() || fileLabel;
        const starts = val(r, dateCol);
        const facility = val(r, facCol);

        // Dedup: one row per Rental ID; blank-ID rows dedup on their full
        // signature so exact duplicates collapse but distinct calls don't.
        const key = ridRaw
          ? `id:${ridRaw}`
          : `noid:${convoSource}|${facility}|${toIsoDate(starts) ?? starts}|${reason}`;
        if (interactionsSeen.has(key)) continue;
        interactionsSeen.add(key);

        rows.push({
          __source: "internal",
          reason,
          // Blank Rental ID → the source where the conversation lives.
          rentalId: ridRaw || convoSource,
          spot: facility,
          starts,
          state: val(r, stateCol),
          refund: "",
          totalRemit: "",
        });
      }
    }
  }

  return {
    headers: [...MERGED_HEADERS],
    rows,
    fileName: files.map((f) => f.data.fileName).join(", "),
  };
}
