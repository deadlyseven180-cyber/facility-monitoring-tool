// Shared types for the Facility Progress Checker.
// ComplaintRecord mirrors a future Airtable "Complaint History" table 1:1, so
// the local store can be transferred to Airtable later with a one-module swap.

export type ComplaintType = "lot_full" | "inaccessibility";
export type ComplaintSource = "SpotHero" | "Internal";

export interface ComplaintRecord {
  rentalId: string;
  facilityName: string;
  facilityId: string;
  complaintType: ComplaintType;
  complaintDate: string; // ISO YYYY-MM-DD
  source: ComplaintSource;
  resolutionStatus: string; // Open | Closed (default "Open")
  resolutionDate?: string; // ISO, when closed
  rootCause?: string; // assigned via the overlay
  notes: string;
  uploadDate: string; // ISO datetime when ingested
  reportingYear: number;
  reportingMonth: number; // 1-12
  reportingBiweekly: 1 | 2; // 1 = days 1-14, 2 = days 15-end
}

export interface UploadLog {
  id: string;
  fileName: string;
  uploadDate: string;
  uploadedBy: string;
  totalRecords: number;
  newRecordsAdded: number;
  duplicateRecordsSkipped: number;
}

export interface FacilityNote {
  id: string;
  facilityKey: string;
  facilityName: string;
  category: string; // action category (Updated Photos, Added Signage, Reduced Inventory, …)
  note: string;
  author: string;
  dateCreated: string;
  dateImplemented?: string; // when present, this note is an "action" eligible for before/after impact
}

/** A raw incident parsed from a SpotHero CSV (client-side), sent to the API. */
export interface RawIncident {
  facility: string;
  date: string; // ISO YYYY-MM-DD
  rentalId: string;
  category: ComplaintType;
}

export interface HistoryStore {
  complaints: ComplaintRecord[]; // SpotHero only (Internal is fetched live)
  uploads: UploadLog[];
}
