// Types for the SpotHero accounting-report analysis engine.

export type PriorityLevel = "Critical" | "High" | "Medium" | "Low";

/** A single record that matched the active refund filter (e.g. Lot Full). */
export interface FilteredRecord {
  rentalId: string;
  spot: string;
  starts: string;
  refundAmount: number;
  facility: string;
  state: string;
  /** Which report this record came from: SpotHero accounting vs internal. */
  source: "spothero" | "internal";
  /** Issue category derived from the matched reason. */
  category: "lot_full" | "inaccessibility" | "other";
}

/** Per-facility roll-up. */
export interface FacilitySummary {
  facility: string;
  /** State (MA State / facility-id value) this facility belongs to. */
  state: string;
  /** Count of matching incidents at this facility. */
  incidentCount: number;
  /** Total refunded amount across matching incidents (Lot Full only). */
  refundTotal: number;
  /** Total of the "refund" column across ALL of this facility's rows. */
  refundColumnTotal: number;
  /** Sum of ALL Total Remit values for this facility (not just matches). */
  totalRemit: number;
  /** Net remit for this facility (= summed "total remit" column). */
  netRemit: number;
  /** Number of reservations (rows) booked at this facility. */
  reservations: number;
  /** Net remit ÷ reservations = average revenue per reservation. */
  avgRevPerReservation: number;
  priorityScore: number;
  priorityLevel: PriorityLevel;
}

/** Roll-up grouped by MA State value. */
export interface StateSummary {
  state: string;
  incidentCount: number;
  refundTotal: number;
  totalRemit: number;
}

/** Full analysis result for one uploaded report under one filter. */
export interface ReportResult {
  /** Display label of the filter applied (e.g. "Lot Full"). */
  filterLabel: string;
  /** Records matching the filter. */
  records: FilteredRecord[];
  /** Facilities with at least one match, sorted by incident count desc. */
  facilities: FacilitySummary[];
  /** Matches grouped by MA State, sorted by incident count desc. */
  states: StateSummary[];
  /** Top facilities by priority score (highest first). */
  topByPriority: FacilitySummary[];
  totals: {
    incidentCount: number;
    /** Lot Full refunds total. */
    refundTotal: number;
    facilitiesAffected: number;
    /** Total reservations (rows) in the selected date range. */
    reservations: number;
    /** Sum of the "total remit" column across all rows (= total net remit). */
    netRemitTotal: number;
    /** Sum of the "refund" column across all rows. */
    refundAllTotal: number;
    /** Matched incidents from SpotHero reports (current category filter). */
    spotHeroLotFull: number;
    /** Matched incidents from internal reports (current category filter). */
    internalLotFull: number;
    /** Matched incidents in the Lot Full category. */
    lotFullCount: number;
    /** Matched incidents in the Inaccessibility category. */
    inaccessibilityCount: number;
    /** SpotHero incidents in the Inaccessibility category. */
    spotHeroInaccessibility: number;
    /** Internal incidents in the Inaccessibility category. */
    internalInaccessibility: number;
  };
  /** Non-fatal notes (e.g. rows with no facility). */
  warnings: string[];
}
